// src/services/events.js — eventos e inscripciones (B21.0; CONTEXT § Eventos; ADR 0018). Las reglas de inscribirse,
// cancelar y pasar lista viven en las funciones SQL de 028; aquí se traducen sus errores, se lee con RLS, se abre el
// Checkout y se piden los reembolsos a Stripe después del COMMIT (app_user no escribe event_registrations).
import { servicePool } from '../config/database.js';
import { stripe, APP_URL, STRIPE_STATEMENT_DESCRIPTOR } from '../config/stripe.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';
import { ensureCustomer } from './billing.js';
import { invalid, validate, audit } from './catalog.js';
import { notice } from './notices.js';
import { assertGuardianOf } from './profile.js';
import { pagination } from './reports.js';
import { dateParam, assertTrainer, ISO_RE, MAX_RANGE_DAYS } from './sessions.js';

const TZ = 'Europe/Madrid';
const CHECKOUT_TTL_S = 30 * 60;
const INTEGRATION_ID = 'kaizen-evt-rvqkdzmw'; // etiqueta del flujo en el Dashboard, como la de la cuota
// Un cobro con tarjeta no admite un descriptor propio (solo los de suscripción, por su Product): se añade como sufijo al
// prefijo de la cuenta («PREFIJO* KAIZEN»). El prefijo es de ≤ 10 caracteres y el total de ≤ 22: el sufijo cabe con ≤ 10.
// shortcut: en la cuenta compartida el prefijo es el de maat; solo una cuenta propia de Kaizen lo quita (B10.7).
const SUFFIX = STRIPE_STATEMENT_DESCRIPTOR?.slice(0, 10).trim();
const DESCRIPTOR_SUFFIX = /[A-Za-z]/.test(SUFFIX ?? '') ? SUFFIX : undefined;

const SQL_ERRORS = {
  not_allowed: [403, 'No puedes hacer esto en este evento'],
  not_guardian: [403, 'No eres tutor de este perfil'],
  profile_incomplete: [403, 'profile incomplete'],
  no_risk_cover: [403, 'Sin cobertura de riesgo: firma el waiver o contrata el seguro'],
  event_not_found: [404, 'Evento no encontrado'],
  registration_not_found: [404, 'Inscripción no encontrada'],
  event_cancelled: [409, 'El evento está cancelado'],
  registration_closed: [409, 'Las inscripciones están cerradas'],
  event_full: [409, 'El evento está completo'],
  already_registered: [409, 'Ya tiene una inscripción en este evento'],
  audience_mismatch: [409, 'El evento no es para su edad'],
  not_a_student: [409, 'Solo se inscribe un alumno'],
  paid_registration: [409, 'Una inscripción pagada la cancela la academia: pídelo a la academia'],
  event_started: [409, 'El evento ya ha empezado'],
  already_cancelled: [409, 'La inscripción ya está cancelada'],
  event_not_started: [409, 'El evento aún no ha empezado'],
};

async function callFn(client, sql, params) {
  try {
    return (await client.query(sql, params)).rows;
  } catch (err) {
    const known = (err.code === 'P0001' || err.code === '42501') && SQL_ERRORS[err.message];
    if (!known) throw err;
    const details = err.message === 'profile_incomplete' ? { missing: err.detail.split(',') } : undefined;
    throw httpError(known[0], err.message, known[1], details);
  }
}

// --- Lectura ---

// Lo que ve cualquiera del evento; `registration` es la del sujeto ($1): la viva o, si no, la última.
const EVENT_SELECT = `
  SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location,
         CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id', d.id, 'name', d.name) END AS discipline,
         CASE WHEN tn.id IS NOT NULL THEN jsonb_build_object('id', tn.id, 'display_name', tn.display_name) END AS trainer,
         e.capacity, event_taken(e.id) AS taken, e.audience, e.requires_risk_cover, e.price_cents, e.member_price_cents,
         e.registration_deadline, e.status, reg.registration
    FROM events e
    LEFT JOIN disciplines d ON d.id = e.discipline_id
    LEFT JOIN trainer_names tn ON tn.id = e.trainer_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('id', r.id, 'status', r.status, 'amount_cents', r.amount_cents) AS registration
        FROM event_registrations r WHERE r.event_id = e.id AND r.profile_id = $1::uuid
       ORDER BY r.status = 'cancelled', r.created_at DESC LIMIT 1) reg ON true`;

// Programados sin terminar, aquellos en los que el sujeto estuvo inscrito, los que imparte el profesor; el admin, todos.
const VISIBLE = `($2::text = 'admin' OR (e.status = 'scheduled' AND e.ends_at > now()) OR reg.registration IS NOT NULL
                 OR ($2 = 'profesor' AND e.trainer_id = $3::uuid))`;

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function subjectOf(client, user, profileId) {
  if (profileId === undefined || profileId === user.id) return user.id;
  if (!isUuid(profileId)) throw invalid('profile_id', 'profile_id debe ser un uuid');
  if (user.role !== 'admin') await assertGuardianOf(client, profileId);
  return profileId;
}

/** GET /events?profile_id&registered → los eventos que ve el sujeto, por fecha. */
export async function listEvents(client, user, { profile_id: profileId, registered } = {}) {
  if (registered !== undefined && !['true', 'false'].includes(registered)) {
    throw invalid('registered', 'registered debe ser true o false');
  }
  const subject = await subjectOf(client, user, profileId);
  const { rows } = await client.query(
    `${EVENT_SELECT} WHERE ${VISIBLE} AND (NOT $4 OR reg.registration IS NOT NULL) ORDER BY e.starts_at, e.id`,
    [subject, user.role, user.id, registered === 'true']);
  return rows;
}

/** GET /events/:id?profile_id → el evento, si el sujeto lo ve. */
export async function getEvent(client, user, id, profileId) {
  const subject = await subjectOf(client, user, profileId);
  const { rows: [e] } = await client.query(`${EVENT_SELECT} WHERE e.id = $4 AND ${VISIBLE}`,
    [subject, user.role, user.id, id]);
  if (!e) throw httpError(404, 'event_not_found', SQL_ERRORS.event_not_found[1]);
  return e;
}

const REG_COLS = 'id, event_id, profile_id, actor_id, payer_id, status, amount_cents, guest, created_at';
const pick = (r) => Object.fromEntries(REG_COLS.split(', ').map((k) => [k, r[k]]));

// --- Inscribirse y cancelar (alumno y tutor) ---

/**
 * Inscribe al sujeto. Importe 0 → `{ registration }` confirmada; si no, pendiente y `{ registration, url }` del
 * Checkout (pago único, ADR 0018). El Checkout se abre dentro de la transacción: si Stripe falla, no queda inscripción.
 */
export async function registerEvent(client, { eventId, subjectId, actorId }) {
  // El cliente de Stripe del pagador (el actor), antes de inscribir: ensureCustomer guarda el cus_ con otra conexión, y
  // la inscripción deja un FOR KEY SHARE sobre su perfil (FK) que bloquearía ese UPDATE hasta el COMMIT (cuelgue).
  const { rows: [e] } = await client.query(`SELECT title, price_cents FROM events WHERE id = $1`, [eventId]);
  const customer = e?.price_cents > 0 ? await ensureCustomer(client, actorId) : null;
  const [reg] = await callFn(client, `SELECT * FROM register_event($1, $2, false)`, [eventId, subjectId]);
  if (reg.status !== 'pending') return { registration: pick(reg) };
  // kind = 'event': lo que el webhook reconoce como de Kaizen (la cuenta la comparte maat).
  const metadata = {
    kind: 'event', registration_id: reg.id, event_id: eventId, profile_id: reg.profile_id, payer_id: reg.payer_id,
  };
  // Sin payment_method_types (como la cuota): «solo tarjeta y monederos» se configura en el Dashboard.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: reg.amount_cents, product_data: { name: e.title } } }],
    client_reference_id: reg.profile_id,
    metadata,
    payment_intent_data: { metadata, statement_descriptor_suffix: DESCRIPTOR_SUFFIX },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    success_url: `${APP_URL}/events/${eventId}?pago=ok`,
    cancel_url: `${APP_URL}/events/${eventId}`,
    integration_identifier: INTEGRATION_ID,
  });
  await client.query(`SELECT attach_event_checkout($1, $2)`, [reg.id, session.id]);
  return { registration: pick(reg), url: session.url };
}

// Pendiente cancelada: su Checkout ya no debe cobrar. Si se pagó justo antes, el webhook lo devuelve (ADR 0018).
async function expireCheckout(id) {
  try {
    await stripe.checkout.sessions.expire(id);
  } catch (err) {
    if (!err.type) throw err;
    console.warn(`[events] no se pudo caducar el Checkout ${id}: ${err.message}`);
  }
}

/** DELETE /events/registrations/:id: alumno o tutor; gratis o pendiente, hasta el inicio. */
export async function cancelRegistration(client, id) {
  const [r] = await callFn(client, `SELECT * FROM cancel_event_registration($1, false)`, [id]);
  if (r.checkout_session_id && !r.payment_intent_id) await expireCheckout(r.checkout_session_id);
}

// --- Reembolsos (después del COMMIT, con servicePool) ---

/** Reembolso rechazado (al pedirlo o más tarde, refund.failed): refund_status 'failed' y aviso de la academia. */
export async function refundFailed(db, r, error) {
  await db.query(`UPDATE event_registrations SET refund_status = 'failed' WHERE id = $1`, [r.id]);
  const admins = (await db.query(`SELECT user_id FROM user_roles WHERE role = 'admin'`)).rows.map((a) => a.user_id);
  await notice(db, {
    action: 'notice.event_refund_failed', actorId: r.payer_id, type: 'event_registration', resourceId: r.id,
    recipients: admins, event_id: r.event_id, student_id: r.profile_id, amount_cents: r.amount_cents, error,
  });
}

/**
 * Reembolso entero de una inscripción pagada (refund_status = 'requested'). Clave de idempotencia por inscripción;
 * tras cada fallo, la siguiente lleva el número de fallos (Stripe guarda también la respuesta de error de una clave).
 * Si Stripe lo rechaza: refundFailed. El email al pagador sale con charge.refunded.
 * @returns {Promise<boolean|null>} si Stripe lo ha aceptado; null si la misma clave está en curso (sigue 'requested')
 */
export async function refundRegistration(db, r) {
  const { rows: [{ n }] } = await db.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE action = 'notice.event_refund_failed' AND resource_id = $1`, [r.id]);
  try {
    await stripe.refunds.create(
      { payment_intent: r.payment_intent_id, metadata: { kind: 'event', registration_id: r.id } },
      { idempotencyKey: n ? `event-refund-${r.id}-${n}` : `event-refund-${r.id}` });
  } catch (err) {
    if (!err.type) throw err; // no es de Stripe
    if (err.code === 'idempotency_key_in_use') return null; // otra petición con la misma clave lo está pidiendo
    if (err.code !== 'charge_already_refunded') {
      await refundFailed(db, r, err.message);
      return false;
    }
  }
  await db.query(`UPDATE event_registrations SET refund_status = 'refunded' WHERE id = $1`, [r.id]);
  return true;
}

// Las inscripciones `ids` que quedaron por reembolsar o con su Checkout abierto, ya confirmadas en la base.
async function settle(ids) {
  const { rows } = await servicePool.query(
    `SELECT * FROM event_registrations WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids]);
  const out = { refunded: 0, refund_failed: 0 };
  for (const r of rows) {
    if (r.checkout_session_id && !r.payment_intent_id) await expireCheckout(r.checkout_session_id);
    if (r.refund_status !== 'requested') continue;
    const ok = await refundRegistration(servicePool, r);
    if (ok) out.refunded++; else if (ok === false) out.refund_failed++;
  }
  return out;
}

/**
 * Tarea nocturna: los reembolsos que quedaron pedidos sin llegar a Stripe (el proceso cayó tras el COMMIT). Con la
 * misma clave de idempotencia, uno que sí llegó no se repite. → { refunded, refund_failed }
 */
export async function settleRequestedRefunds() {
  const { rows } = await servicePool.query(`SELECT id FROM event_registrations WHERE refund_status = 'requested'`);
  return settle(rows.map((r) => r.id));
}

// --- Admin ---

const isText = (max, min = 1) => (v) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const isIso = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const isPrice = (v) => Number.isInteger(v) && (v === 0 || (v >= 50 && v <= 10_000_000));
const orNull = (check) => (v) => v === null || check(v);
const EVENT_SPEC = {
  title: [isText(120), 'title requerido (1–120)', true],
  description: [orNull(isText(2000, 0)), 'description ≤2000'],
  starts_at: [(v) => isIso(v) && Date.parse(v) > Date.now(), 'starts_at debe ser una fecha ISO futura con zona horaria', true],
  ends_at: [isIso, 'ends_at debe ser una fecha ISO con zona horaria', true],
  location: [isText(200), 'location requerido (1–200)', true],
  discipline_id: [orNull((v) => /^\d{1,18}$/.test(String(v))), 'discipline_id inválido'],
  trainer_id: [orNull(isUuid), 'trainer_id inválido'],
  capacity: [orNull((v) => Number.isInteger(v) && v >= 1 && v <= 100_000), 'capacity entero ≥ 1 o null (sin límite)'],
  audience: [(v) => ['all', 'minors', 'adults'].includes(v), 'audience debe ser all, minors o adults'],
  requires_risk_cover: [(v) => typeof v === 'boolean', 'requires_risk_cover debe ser booleano'],
  price_cents: [isPrice, 'price_cents: 0 (gratis) o ≥ 50'],
  member_price_cents: [orNull(isPrice), 'member_price_cents: null, 0 o ≥ 50'],
  registration_deadline: [orNull(isIso), 'registration_deadline debe ser una fecha ISO o null'],
};
const DEFAULTS = {
  description: null, discipline_id: null, trainer_id: null, capacity: null, audience: 'all', requires_risk_cover: true,
  price_cents: 0, member_price_cents: null, registration_deadline: null,
};
const ms = (v) => (v == null ? null : new Date(v).getTime());

// Reglas entre campos sobre el evento resultante (las mismas CHECK de 028, con su campo) y las referencias.
async function checkEvent(client, e, changed) {
  if (ms(e.ends_at) <= ms(e.starts_at)) throw invalid('ends_at', 'ends_at debe ser posterior a starts_at');
  if (e.member_price_cents !== null && e.member_price_cents > e.price_cents) {
    throw invalid('member_price_cents', 'member_price_cents no puede superar price_cents');
  }
  if (e.registration_deadline !== null && ms(e.registration_deadline) > ms(e.starts_at)) {
    throw invalid('registration_deadline', 'registration_deadline no puede ser posterior a starts_at');
  }
  if (changed.trainer_id) await assertTrainer(client, changed.trainer_id);
  if (changed.discipline_id) {
    const { rowCount } = await client.query(`SELECT 1 FROM disciplines WHERE id = $1`, [String(changed.discipline_id)]);
    if (!rowCount) throw invalid('discipline_id', 'Disciplina no encontrada');
  }
}

const ADMIN_SELECT = `
  SELECT ev.*, e.cancel_note, e.created_at, e.updated_at FROM (${EVENT_SELECT}) ev JOIN events e ON e.id = ev.id`;

/** GET /admin/events?from&to&status&limit&offset → { events, total, limit, offset } (cancelados incluidos). */
export async function listAdminEvents(client, { from, to, status, limit, offset }) {
  const page = pagination({ limit, offset });
  if (status !== undefined && !['scheduled', 'cancelled'].includes(status)) {
    throw invalid('status', 'status debe ser scheduled o cancelled');
  }
  const f = from ? dateParam(from, 'from') : null;
  const t = to ? dateParam(to, 'to') : null;
  const { rows } = await client.query(
    `SELECT ev.*, count(*) OVER () AS total FROM (${ADMIN_SELECT}) ev
      WHERE ($2::text IS NULL OR ev.status = $2)
        AND ($3::date IS NULL OR ev.starts_at >= $3::timestamp AT TIME ZONE '${TZ}')
        AND ($4::date IS NULL OR ev.starts_at < ($4::date + 1)::timestamp AT TIME ZONE '${TZ}')
      ORDER BY ev.starts_at, ev.id LIMIT $5 OFFSET $6`,
    [null, status ?? null, f, t, page.limit, page.offset]);
  const total = rows.length ? Number(rows[0].total) : 0;
  for (const e of rows) delete e.total;
  return { events: rows, total, ...page };
}

/** GET /admin/events/:id → { event, registrations } (todas, por orden de llegada). */
export async function getAdminEvent(client, id) {
  const { rows: [event] } = await client.query(`${ADMIN_SELECT} WHERE ev.id = $2`, [null, id]);
  if (!event) throw httpError(404, 'event_not_found', SQL_ERRORS.event_not_found[1]);
  const { rows: registrations } = await client.query(
    `SELECT r.id, jsonb_build_object('id', s.id, 'display_name', s.display_name) AS student, r.status, r.amount_cents,
            r.guest, CASE WHEN py.id IS NOT NULL THEN jsonb_build_object('id', py.id, 'display_name', py.display_name) END
              AS payer,
            r.refund_status, r.refunded_cents, r.attended, r.cancel_reason, r.created_at
       FROM event_registrations r JOIN profiles s ON s.id = r.profile_id LEFT JOIN profiles py ON py.id = r.payer_id
      WHERE r.event_id = $1 ORDER BY r.created_at, r.id`, [id]);
  return { event, registrations };
}

/** POST /admin/events → el evento creado (se publica al crearlo). */
export async function createEvent(client, { body, actorId }) {
  const v = validate(body, EVENT_SPEC, false);
  await checkEvent(client, { ...DEFAULTS, ...v }, v);
  const cols = Object.keys(v);
  const { rows: [{ id }] } = await client.query(
    `INSERT INTO events (created_by, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     RETURNING id`, [actorId, ...cols.map((k) => v[k])]);
  await audit(client, actorId, 'event.create', id, v);
  return (await getAdminEvent(client, id)).event;
}

const NOTIFY_FIELDS = ['starts_at', 'ends_at', 'location'];

/**
 * PATCH /admin/events/:id: solo lo que cambia. Lo de quien ya está inscrito (importe, público, cobertura) no se toca.
 * Un cambio de inicio, fin o lugar avisa a los inscritos vivos. → { event, notified }
 */
export async function updateEvent(client, { id, body, actorId }) {
  const v = validate(body, EVENT_SPEC, true);
  const { rows: [cur] } = await client.query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [id]);
  if (!cur) throw httpError(404, 'event_not_found', SQL_ERRORS.event_not_found[1]);
  if (cur.status === 'cancelled') throw httpError(409, 'event_cancelled', SQL_ERRORS.event_cancelled[1]);
  const same = (k) => (k.endsWith('_at') || k === 'registration_deadline'
    ? ms(cur[k]) === ms(v[k]) : String(cur[k]) === String(v[k]));
  const fields = Object.keys(v).filter((k) => !same(k));
  if (!fields.length) return { event: (await getAdminEvent(client, id)).event, notified: 0 };
  const changed = Object.fromEntries(fields.map((k) => [k, v[k]]));
  await checkEvent(client, { ...cur, ...changed }, changed);
  if (changed.capacity != null) {
    const { rows: [{ taken }] } = await client.query(`SELECT event_taken($1) AS taken`, [id]);
    if (changed.capacity < taken) {
      throw httpError(409, 'capacity_below_registrations', 'El aforo quedaría por debajo de las inscripciones vivas',
        { taken });
    }
  }
  await client.query(
    `UPDATE events SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [id, ...fields.map((k) => changed[k])]);
  await audit(client, actorId, 'event.update', id, {
    from: Object.fromEntries(fields.map((k) => [k, cur[k]])), to: changed,
  });
  const moved = fields.filter((k) => NOTIFY_FIELDS.includes(k));
  let notified = 0;
  if (moved.length) {
    const { rows: [n] } = await client.query(`SELECT event_notice($1, 'notice.event_changed', NULL, $2) AS n`,
      [id, { fields: moved, previous_starts_at: cur.starts_at, previous_location: cur.location }]);
    notified = n.n;
  }
  return { event: (await getAdminEvent(client, id)).event, notified };
}

/** POST /admin/events/:id/cancel { note? } → { refunded, refund_failed, notified }. Devuelve todo lo pagado. */
export async function cancelEvent(user, { id, body }) {
  if (body.note !== undefined && body.note !== null && !isText(500, 0)(body.note)) throw invalid('note', 'note texto ≤500');
  const note = body.note?.trim() || null;
  const { notified, ids } = await withRls({ uid: user.id, role: user.role }, async (client) => {
    const [{ n }] = await callFn(client, `SELECT cancel_event($1, $2) AS n`, [id, note]);
    // now() es el de la transacción: las que acaba de cancelar.
    const { rows } = await client.query(
      `SELECT id FROM event_registrations WHERE event_id = $1 AND cancel_reason = 'event_cancelled' AND cancelled_at = now()`,
      [id]);
    await audit(client, user.id, 'event.cancel', id, { note, registrations: rows.length });
    return { notified: n, ids: rows.map((r) => r.id) };
  });
  return { ...(await settle(ids)), notified };
}

/** POST /admin/events/:id/registrations { profile_id } → 201 invitado (sin cobro, con requisitos y aforo). */
export async function registerGuest(client, { eventId, body, actorId }) {
  if (!isUuid(body.profile_id)) throw invalid('profile_id', 'profile_id debe ser un uuid');
  const [reg] = await callFn(client, `SELECT * FROM register_event($1, $2, true)`, [eventId, body.profile_id]);
  await audit(client, actorId, 'event_registration.guest', reg.id, { event_id: eventId, profile_id: reg.profile_id });
  return pick(reg);
}

/**
 * POST /admin/event-registrations/:id/cancel { refund } → { registration }. Con refund, devuelve el importe entero;
 * sobre una ya cancelada y pagada, reintenta un reembolso no pedido o fallido.
 */
export async function adminCancelRegistration(user, { id, body }) {
  if (typeof body.refund !== 'boolean') throw invalid('refund', 'refund debe ser booleano');
  await withRls({ uid: user.id, role: user.role }, async (client) => {
    const { rows: [was] } = await client.query(`SELECT status FROM event_registrations WHERE id = $1`, [id]);
    const [r] = await callFn(client, `SELECT * FROM cancel_event_registration($1, $2)`, [id, body.refund]);
    if (was.status === 'cancelled') {
      await audit(client, user.id, 'event_registration.refund', id, { amount_cents: r.amount_cents });
    } else {
      await audit(client, user.id, 'event_registration.cancel', id, { from: was.status, refund: body.refund });
    }
  });
  await settle([id]);
  const { rows: [r] } = await servicePool.query(
    `SELECT ${REG_COLS}, cancel_reason, refund_status, refunded_cents FROM event_registrations WHERE id = $1`, [id]);
  return { registration: r };
}

// --- Profesor ---

/** GET /professor/events?from&to → los que imparte; días de Madrid, ≤ 92 (por defecto hoy + 30). */
export async function listTrainerEvents(client, user, { from, to } = {}) {
  const f = from ? dateParam(from, 'from') : null;
  const t = to ? dateParam(to, 'to') : null;
  const { rows } = await client.query(
    `WITH rg AS (SELECT COALESCE($3::date, (now() AT TIME ZONE '${TZ}')::date) AS f)
     ${EVENT_SELECT}, rg
      WHERE e.trainer_id = $2
        AND e.starts_at >= rg.f::timestamp AT TIME ZONE '${TZ}'
        AND e.starts_at < (COALESCE($4::date, rg.f + 30) + 1)::timestamp AT TIME ZONE '${TZ}'
        AND COALESCE($4::date, rg.f + 30) - rg.f < ${MAX_RANGE_DAYS}
      ORDER BY e.starts_at, e.id`, [null, user.id, f, t]);
  return rows;
}

/** GET /professor/events/:id → { event, students } con los inscritos confirmados (nombre, presente, cobertura). */
export async function getTrainerEvent(client, user, id) {
  const { rows: [event] } = await client.query(`${EVENT_SELECT} WHERE e.id = $3 AND e.trainer_id = $2`,
    [null, user.id, id]);
  if (!event) throw httpError(404, 'event_not_found', SQL_ERRORS.event_not_found[1]);
  const { rows: students } = await client.query(
    `SELECT r.profile_id, p.display_name, r.attended,
            has_risk_cover(r.profile_id) AS risk_cover -- solo el sí/no (CONTEXT § Quién ve el seguro)
       FROM event_registrations r JOIN student_names p ON p.id = r.profile_id -- solo nombre y foto (044)
      WHERE r.event_id = $1 AND r.status = 'confirmed' ORDER BY p.display_name, r.profile_id`, [id]);
  return { event, students };
}

// Cada llamada queda auditada en la BD (health.view).
export async function getEventHealth(client, id) {
  return callFn(client, `SELECT * FROM professor_event_health($1)`, [id]);
}

/** PUT /events/:id/attendance/:profileId { present }: el profesor del evento o el admin, desde el inicio. */
export async function markEventAttendance(client, { eventId, profileId, present }) {
  if (typeof present !== 'boolean') throw invalid('present', 'present debe ser booleano');
  const { rows: [r] } = await client.query(
    `SELECT id FROM event_registrations WHERE event_id = $1 AND profile_id = $2 AND status = 'confirmed'`,
    [eventId, profileId]);
  if (!r) throw httpError(404, 'registration_not_found', SQL_ERRORS.registration_not_found[1]);
  await callFn(client, `SELECT mark_event_attendance($1, $2)`, [r.id, present]);
  return { profile_id: profileId, present };
}
