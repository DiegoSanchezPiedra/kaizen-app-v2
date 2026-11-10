// src/services/billing.js — contratar (CONTEXT § Suscripción) y portal del pagador (B10).
// La suscripción local no nace aquí: nace en el webhook cuando Stripe confirma el pago.
import { servicePool } from '../config/database.js';
import { stripe, STRIPE_PORTAL_CONFIGURATION_ID, APP_URL } from '../config/stripe.js';
import { httpError } from '../lib/errors.js';
import { parseId, invalid, audit } from './catalog.js';
import { notice } from './notices.js';
import { dateParam } from './sessions.js';
import { pagination } from './reports.js';

const LIVE = `('active', 'past_due', 'unpaid')`;
// Estados de Stripe tal cual (CONTEXT § Suscripción); canceled / incomplete_expired → cancelled.
export const STATUS = {
  active: 'active', past_due: 'past_due', unpaid: 'unpaid', incomplete: 'incomplete',
  canceled: 'cancelled', incomplete_expired: 'cancelled',
};
export const ts = (s) => (s ? new Date(s * 1000) : null);
export const idOf = (x) => (typeof x === 'string' ? x : x?.id ?? null);
const CHECKOUT_TTL_S = 30 * 60;
// Etiqueta del flujo en el Dashboard (skill de Stripe: sufijo de 8 letras aleatorias).
const INTEGRATION_ID = 'kaizen-sub-qzmhtrwa';

/** Cliente de Stripe del pagador; lo crea la primera vez. */
export async function ensureCustomer(client, payerId) {
  const { rows: [p] } = await client.query(
    `SELECT p.stripe_customer_id, p.display_name, c.email
       FROM profiles p LEFT JOIN auth_credentials c ON c.profile_id = p.id WHERE p.id = $1`, [payerId]);
  if (p.stripe_customer_id) return p.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: p.display_name ?? undefined, email: p.email ?? undefined, metadata: { profile_id: payerId },
  });
  // Fuera de la transacción: si el Checkout falla después, el cliente no se pierde.
  // Dos checkouts a la vez: gana el primero y el otro cliente queda huérfano (inofensivo).
  const { rows: [won] } = await servicePool.query(
    `UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL
     RETURNING stripe_customer_id`, [payerId, customer.id]);
  if (won) return won.stripe_customer_id;
  return (await servicePool.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [payerId])).rows[0]
    .stripe_customer_id;
}

/**
 * Plan y disciplinas de un pedido, con las mismas reglas al contratar y al cambiar de plan (B10.5):
 * plan activo y de pago, edad, solo menores, número y disciplinas elegibles.
 * @returns {{ plan, ids: string[], adult: boolean }}
 */
async function validateOrder(client, { studentId, planId, disciplineIds = [] }) {
  if (!Array.isArray(disciplineIds)) throw invalid('discipline_ids', 'discipline_ids debe ser un array');
  const ids = [...new Set(disciplineIds.map(parseId))];

  const { rows: [plan] } = await client.query(
    `SELECT p.id, p.price_cents, p.max_disciplines, p.minors_only, p.is_active, p.stripe_price_id,
            ARRAY(SELECT discipline_id::text FROM plan_disciplines WHERE plan_id = p.id) AS eligible
       FROM plans p WHERE p.id = $1`, [parseId(planId)]);
  // El suscriptor ve su plan retirado (012), pero no lo puede contratar ni cambiar a él.
  if (!plan?.is_active) throw httpError(404, 'plan_not_found', 'Plan no encontrado');
  if (plan.price_cents === 0 || !plan.stripe_price_id) {
    throw httpError(409, 'plan_not_purchasable', 'Este plan no se contrata por la pasarela');
  }

  const { rows: [{ adult }] } = await client.query(
    `SELECT birth_date IS NULL OR birth_date <= CURRENT_DATE - interval '18 years' AS adult
       FROM profiles WHERE id = $1`, [studentId]);
  if (adult && plan.minors_only) throw httpError(409, 'plan_minors_only', 'Plan solo para menores');

  // «Todas»: no se eligen disciplinas. Si no, exactamente max_disciplines.
  const expected = plan.max_disciplines ?? 0;
  if (ids.length !== expected) {
    throw httpError(400, 'invalid_field', `Elige ${expected} disciplina(s)`, { field: 'discipline_ids', expected });
  }
  if (ids.length) {
    const { rows } = await client.query(
      `SELECT id, minors_only FROM disciplines WHERE id = ANY($1::bigint[]) AND is_active AND NOT is_open`, [ids]);
    const ok = new Map(rows.map((d) => [d.id, d]));
    const bad = ids.filter((id) => !ok.has(id) || (plan.eligible.length && !plan.eligible.includes(id))
      || (adult && ok.get(id).minors_only));
    if (bad.length) throw httpError(409, 'discipline_not_eligible', 'Disciplina no elegible', { ids: bad });
  }
  return { plan, ids, adult };
}

/**
 * Valida los requisitos de contratar y abre un Checkout de Stripe. Perfil completo y
 * tutor→hijo los comprueba antes requireCompleteProfile.
 * @returns {{ url: string }}
 */
export async function createCheckout(client, { payerId, studentId, planId, disciplineIds = [] }) {
  const { plan, ids } = await validateOrder(client, { studentId, planId, disciplineIds });

  const { rowCount } = await client.query(
    `SELECT 1 FROM subscriptions WHERE student_id = $1 AND status IN ${LIVE}`, [studentId]);
  if (rowCount) throw httpError(409, 'subscription_exists', 'El alumno ya tiene una suscripción');

  const customer = await ensureCustomer(client, payerId);
  // Contenido del pedido; el webhook resuelve pagador y suscripción por el grafo de Stripe, no por aquí.
  const metadata = { student_id: studentId, payer_id: payerId, plan_id: plan.id, discipline_ids: ids.join(',') };
  // Sin payment_method_types (skill de Stripe): «solo tarjeta» se configura en el Dashboard.
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    client_reference_id: studentId,
    metadata,
    subscription_data: { metadata },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    success_url: `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/billing/cancel`,
    integration_identifier: INTEGRATION_ID,
  });
  return { url: session.url };
}

/** Portal de Stripe del pagador: cambiar tarjeta y ver recibos. */
export async function createPortalSession(client, payerId) {
  if (!STRIPE_PORTAL_CONFIGURATION_ID) {
    throw httpError(503, 'portal_not_configured', 'Falta STRIPE_PORTAL_CONFIGURATION_ID');
  }
  const { rows: [p] } = await client.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [payerId]);
  if (!p?.stripe_customer_id) throw httpError(404, 'no_billing_account', 'Aún no has contratado nada');
  const session = await stripe.billingPortal.sessions.create({
    customer: p.stripe_customer_id, configuration: STRIPE_PORTAL_CONFIGURATION_ID, return_url: `${APP_URL}/billing`,
  });
  return { url: session.url };
}

// Una suscripción cancelada deja sus recibos open cobrándose (sondeo B11): la baja inmediata los anula.
async function voidOpenInvoices(subId) {
  // shortcut: una página de 100; una suscripción no acumula tantos recibos open.
  const { data } = await stripe.invoices.list({ subscription: subId, status: 'open', limit: 100 });
  for (const inv of data) await stripe.invoices.voidInvoice(inv.id);
  return data.length;
}

/**
 * Baja de una suscripción (CONTEXT § Baja: solo el admin). Se pide a Stripe; el estado local
 * lo actualiza el webhook (customer.subscription.updated / deleted), como todo lo de billing.
 * La inmediata anula sus recibos open. Anula el cambio de pagador pendiente (y su sucesora).
 */
export async function cancelSubscription(client, { id, atPeriodEnd, actorId }) {
  const { rows: [s] } = await client.query(
    `SELECT stripe_subscription_id, status, student_id, payer_id, plan_id FROM subscriptions WHERE id = $1`, [id]);
  if (!s) throw httpError(404, 'subscription_not_found', 'Suscripción no encontrada');
  // Stripe manda: entre la baja y su webhook la fila local aún no dice cancelled.
  const current = s.status === 'cancelled'
    ? null : await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (!current || current.status === 'canceled') {
    throw httpError(409, 'subscription_cancelled', 'La suscripción ya está cancelada');
  }
  await audit(client, actorId, atPeriodEnd ? 'subscription.cancel_at_period_end' : 'subscription.cancel_now', id, {});
  // Antes de la baja: con el cambio ya cancelado, el fin de la antigua no se toma por un traspaso.
  await serviceTx(async (db) => {
    const pc = await pendingPayerChange(db, id, 'FOR UPDATE');
    if (pc) await closePayerChange(db, pc, 'subscription_cancelled', actorId);
  });
  // Con un Schedule adjunto Stripe no deja tocar la cancelación (B10.5): se libera y la bajada programada se descarta.
  const pending = pendingPhase(current.schedule);
  if (current.schedule) await stripe.subscriptionSchedules.release(current.schedule.id);
  const sub = atPeriodEnd
    ? await stripe.subscriptions.update(s.stripe_subscription_id, { cancel_at_period_end: true })
    : await stripe.subscriptions.cancel(s.stripe_subscription_id);
  const voided = atPeriodEnd ? 0 : await voidOpenInvoices(sub.id);
  // servicePool tras Stripe: la baja ya no se deshace aunque la ruta haga rollback (y app_user no escribe entregas).
  await notice(servicePool, {
    action: 'notice.subscription_cancelled', actorId, type: 'subscription', resourceId: id,
    recipients: [s.payer_id], student_id: s.student_id, plan_id: s.plan_id,
    ends_at: ts(sub.cancel_at ?? sub.ended_at), discarded_plan_id: pending?.metadata.plan_id ?? null, voided,
  });
  return { id, stripe_status: sub.status, cancel_at_period_end: sub.cancel_at_period_end };
}

// --- Cambio de plan y de disciplina (B10.5; CONTEXT § Suscripción; ADR 0007) ---
// Subida = pending update (solo se aplica si se paga); bajada = Subscription Schedule de 2 fases.
// plan_id y disciplinas nuevos viajan en la metadata y los aplica el webhook, como todo el estado de cobro.

/** Fase pendiente de un Schedule (la bajada programada), o null. Un Schedule puede seguir adjunto ya aplicado. */
export function pendingPhase(schedule) {
  if (!schedule || !['active', 'not_started'].includes(schedule.status)) return null;
  const current = schedule.current_phase?.start_date ?? 0;
  return schedule.phases.find((p) => p.start_date > current) ?? null;
}

async function subscriptionFor(client, id) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.student_id, s.payer_id, s.plan_id, s.status, s.cancel_at_period_end, s.stripe_subscription_id,
            pl.price_cents, pl.minors_only, pl.max_disciplines
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`, [id]);
  if (!s) throw httpError(404, 'subscription_not_found', 'Suscripción no encontrada');
  return s;
}

const onlyPayer = (s, actorId, isAdmin) => {
  if (!isAdmin && s.payer_id !== actorId) {
    throw httpError(403, 'not_payer', 'Solo el pagador o el admin cambian de plan');
  }
};

/**
 * Subir o bajar de plan (pagador actual o admin). Más caro = subida inmediata con prorrateo; igual o más
 * barato = bajada en la siguiente facturación. Un adulto en un plan solo menores cambia ya, suba o baje.
 * @returns {{ status: 200 | 202, body }}
 */
export async function changePlan(client, { id, actorId, isAdmin, planId, disciplineIds }) {
  const s = await subscriptionFor(client, id);
  onlyPayer(s, actorId, isAdmin);
  await assertNotFrozen(servicePool, id);
  if (s.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
  if (s.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');
  if (parseId(planId) === s.plan_id) throw httpError(409, 'same_plan', 'Ya está en ese plan');
  const { plan, ids, adult } = await validateOrder(client, { studentId: s.student_id, planId, disciplineIds });
  if (!plan.stripe_price_id) throw httpError(409, 'plan_not_purchasable', 'Este plan no se contrata por la pasarela');

  // Stripe manda: la fila local puede ir por detrás de una baja recién pedida.
  const current = await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (current.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
  if (current.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');

  const metadata = { plan_id: plan.id, discipline_ids: ids.join(',') };
  const now = plan.price_cents > s.price_cents || (adult && s.minors_only);
  await audit(client, actorId, now ? 'subscription.upgrade' : 'subscription.downgrade', id,
    { from: s.plan_id, to: plan.id, discipline_ids: ids });
  return now
    ? applyPlanNow(s, current, plan, metadata, isAdmin)
    : scheduleDowngrade(current, plan, metadata);
}

// Pending update: Stripe cobra el prorrateo y solo aplica price y metadata si se paga.
async function applyPlanNow(s, current, plan, metadata, isAdmin) {
  // Una subida anula la bajada programada (CONTEXT § Bajar de plan).
  if (current.schedule) await stripe.subscriptionSchedules.release(current.schedule.id);
  const sub = await stripe.subscriptions.update(current.id, {
    items: [{ id: current.items.data[0].id, price: plan.stripe_price_id }],
    payment_behavior: 'pending_if_incomplete', proration_behavior: 'always_invoice', metadata,
  });
  if (!sub.pending_update) return { status: 200, body: { change: 'upgrade', status: 'applied' } };

  const inv = await stripe.invoices.retrieve(idOf(sub.latest_invoice),
    { expand: ['confirmation_secret', 'payments.data.payment.payment_intent'] });
  const pi = inv.payments?.data?.[0]?.payment.payment_intent;
  if (pi?.status === 'requires_action') {
    if (!isAdmin) {
      return { status: 200, body: { change: 'upgrade', status: 'requires_action', client_secret: inv.confirmation_secret.client_secret } };
    }
    // El admin no paga: el pending update sigue vivo (caduca en 23 h) y el pagador lo completa en el recibo.
    // servicePool: el aviso sobrevive al rollback del 409.
    await notice(servicePool, {
      action: 'notice.upgrade_requires_action', actorId: s.payer_id, type: 'subscription', resourceId: s.id,
      recipients: [s.payer_id], student_id: s.student_id, from_plan_id: s.plan_id, plan_id: plan.id,
      amount_cents: inv.amount_due, hosted_invoice_url: inv.hosted_invoice_url, expires_at: ts(sub.pending_update.expires_at),
    });
    throw httpError(409, 'requires_payer_action', 'El banco pide autenticación al pagador; se le ha avisado');
  }
  // Rechazada: anular el recibo descarta el pending update; el plan no cambia.
  await stripe.invoices.voidInvoice(inv.id);
  throw httpError(402, 'payment_failed', 'El cobro de la subida ha sido rechazado',
    { decline_message: pi?.last_payment_error?.message ?? null });
}

// Schedule: fase 1 = la actual tal cual; fase 2 = el plan nuevo desde el fin de periodo. Como mucho una
// programada: si ya hay Schedule, se sustituye su fase 2.
async function scheduleDowngrade(current, plan, metadata) {
  // Una subida pendiente de pago (3DS a medias) bloquea el Schedule: la bajada la sustituye.
  if (current.pending_update) await stripe.invoices.voidInvoice(idOf(current.latest_invoice));
  const schedule = current.schedule ?? await stripe.subscriptionSchedules.create({ from_subscription: current.id });
  const phase = schedule.phases.find((p) => p.start_date === schedule.current_phase?.start_date) ?? schedule.phases[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        items: phase.items.map((i) => ({ price: idOf(i.price), quantity: i.quantity })),
        start_date: phase.start_date, end_date: phase.end_date, metadata: current.metadata, proration_behavior: 'none',
      },
      {
        items: [{ price: plan.stripe_price_id, quantity: 1 }], duration: { interval: 'month', interval_count: 1 },
        metadata, proration_behavior: 'none',
      },
    ],
  });
  return { status: 202, body: { change: 'downgrade', scheduled_at: ts(phase.end_date) } };
}

/** Anular la bajada programada (pagador o admin): se libera el Schedule y la suscripción sigue igual. */
export async function cancelScheduledChange(client, { id, actorId, isAdmin }) {
  const s = await subscriptionFor(client, id);
  onlyPayer(s, actorId, isAdmin);
  await assertNotFrozen(servicePool, id);
  const current = await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (!pendingPhase(current.schedule)) throw httpError(404, 'no_scheduled_change', 'No hay ninguna bajada programada');
  await audit(client, actorId, 'subscription.downgrade_cancel', id, {});
  await stripe.subscriptionSchedules.release(current.schedule.id);
}

const DISCIPLINE_ERRORS = {
  subscription_not_found: [404, 'Suscripción no encontrada'],
  subscription_not_in_force: [409, 'La suscripción no está en vigor'],
  plan_all_disciplines: [409, 'El plan cubre todas las disciplinas: no hay nada que cambiar'],
  discipline_not_chosen: [409, 'Esa disciplina no está entre las elegidas'],
  discipline_not_eligible: [409, 'Disciplina no elegible'],
  discipline_change_limit: [409, 'Ya no quedan cambios de disciplina en este periodo'],
};

/**
 * Cambio de disciplina (ADR 0007: lo escribe Kaizen, no el webhook). Pueden el pagador, el admin, el alumno
 * adulto y cualquier tutor vinculado. Las reglas viven en change_discipline (014); aquí, quién actúa.
 * @returns {{ disciplines: string[], changes_left: number, free: boolean }}
 */
export async function changeDiscipline(client, { id, actorId, isAdmin, fromId, toId }) {
  const field = (v, f) => {
    if (!/^\d{1,18}$/.test(String(v))) throw invalid(f, `${f} debe ser un id`);
    return String(v);
  };
  const from = field(fromId, 'from_id');
  const to = field(toId, 'to_id');
  const s = await subscriptionFor(client, id);
  const { rows: [who] } = await client.query(
    `SELECT is_guardian_of(p.id) AS guardian, p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years' AS adult
       FROM profiles p WHERE p.id = $1`, [s.student_id]);
  if (!(isAdmin || s.payer_id === actorId || (s.student_id === actorId && who.adult) || who.guardian)) {
    throw httpError(403, 'not_allowed', 'No puedes cambiar las disciplinas de este alumno');
  }

  // change_discipline es interna (servicePool).
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    // Actor de los avisos de reserva (booking_notice lee app.current_user_id).
    await db.query(`SELECT set_config('app.current_user_id', $1, true)`, [actorId]);
    // Tras el bloqueo de la fila, como requestPayerChange: un cambio de pagador pedido a la vez se ve aquí.
    await db.query(`SELECT 1 FROM subscriptions WHERE id = $1 FOR UPDATE`, [id]);
    await assertNotFrozen(db, id);
    const { rows: [{ r }] } = await db.query(`SELECT change_discipline($1, $2, $3, $4) AS r`, [id, from, to, actorId]);
    const { rows } = await db.query(
      `SELECT discipline_id FROM subscription_disciplines WHERE subscription_id = $1 ORDER BY discipline_id`, [id]);
    const disciplines = rows.map((d) => d.discipline_id);
    // Espejo en Stripe: el webhook solo aplica disciplinas cuando cambia metadata.plan_id, así que no las pisa.
    await stripe.subscriptions.update(s.stripe_subscription_id, { metadata: { discipline_ids: disciplines.join(',') } });
    const { rows: [{ left }] } = await db.query(
      `SELECT GREATEST(discipline_change_limit() - discipline_changes_used($1), 0) AS left`, [id]);
    await db.query('COMMIT');
    return { disciplines, changes_left: left, free: r.free };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    const known = err.code === 'P0001' && DISCIPLINE_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1], err.detail ? JSON.parse(err.detail) : undefined);
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Suscripción del alumno (la viva o, si no hay, la última), con la bajada programada, los cambios de
 * disciplina que le quedan en el periodo y el cambio de pagador pendiente. La RLS decide quién ve qué.
 */
export async function getSubscription(client, { studentId }) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.status,
            jsonb_build_object('id', pl.id::text, 'name', pl.name, 'price_cents', pl.price_cents,
                               'max_disciplines', pl.max_disciplines) AS plan,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id::text, 'name', d.name) ORDER BY d.name)
                        FROM subscription_disciplines sd JOIN disciplines d ON d.id = sd.discipline_id
                       WHERE sd.subscription_id = s.id), '[]') AS disciplines,
            s.current_period_end, s.cancel_at_period_end,
            CASE WHEN s.scheduled_plan_id IS NOT NULL THEN jsonb_build_object(
              'plan_id', s.scheduled_plan_id::text, 'plan_name', sp.name,
              'discipline_ids', to_jsonb(s.scheduled_discipline_ids::text[]), 'scheduled_at', s.scheduled_at) END
              AS scheduled_change,
            CASE WHEN pl.max_disciplines IS NOT NULL
                 THEN GREATEST(discipline_change_limit() - visible_discipline_changes_used(s.id), 0) END AS discipline_changes_left,
            (SELECT jsonb_build_object('id', pc.id, 'status', ${EFFECTIVE_STATUS}, 'new_payer_id', pc.new_payer_id,
                                       'starts_at', pc.starts_at, 'deadline', pc.deadline)
               FROM payer_changes pc WHERE pc.subscription_id = s.id AND pc.status IN ${PENDING}) AS payer_change
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id LEFT JOIN plans sp ON sp.id = s.scheduled_plan_id
      WHERE s.student_id = $1 ORDER BY s.status IN ${LIVE} DESC, s.created_at DESC LIMIT 1`, [studentId]);
  if (!s) throw httpError(404, 'subscription_not_found', 'El alumno no tiene suscripción');
  return s;
}

const setSetting = (client, key, value) => client.query(
  `INSERT INTO academy_settings (key, value) VALUES ($1, $2::jsonb)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);

/** Cambios de disciplina por periodo (solo admin). Admite 0: sin cambios, salvo los gratis. */
export async function updateDisciplineChangeSettings(client, body, actorId) {
  const n = body.per_period;
  if (!(Number.isInteger(n) && n >= 0 && n <= 1000)) throw invalid('per_period', 'per_period debe ser un entero ≥ 0');
  await setSetting(client, 'discipline_changes_per_period', n);
  await audit(client, actorId, 'settings.discipline_changes', 'discipline_changes_per_period', { per_period: n });
  return { per_period: n };
}

/** Cambios de disciplina por periodo; sin fila válida, 1 (como discipline_change_limit()). */
export async function getDisciplineChangeSettings(client) {
  const { rows: [r] } = await client.query(
    `SELECT value #>> '{}' AS v FROM academy_settings WHERE key = 'discipline_changes_per_period'`);
  return { per_period: /^[0-9]{1,9}$/.test(r?.v ?? '') ? Number(r.v) : 1 };
}

// --- Cambio de pagador (B11; CONTEXT § Suscripción; ADR 0009) ---
// La sucesora sale de un Checkout con billing_cycle_anchor = D (0 € hoy, X €/mes desde D) y su fila local nace en el
// traspaso (webhook). Mientras el cambio está pendiente, el pedido de la antigua se congela.

const PENDING = `('requested', 'paid')`;
const HOUR_MS = 3600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Un requested pasada la fecha límite ya no se puede pagar; el webhook lo marca expired en la renovación (sin cron).
const EFFECTIVE_STATUS = `CASE WHEN pc.status = 'requested' AND now() > pc.deadline THEN 'expired' ELSE pc.status END`;

/** Transacción propia con servicePool: app_user no escribe billing. */
async function serviceTx(fn) {
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

// Con servicePool: el alumno o un tutor que no paga no ven el cambio por RLS, pero también quedan congelados.
const pendingPayerChange = async (db, subscriptionId, lock = '') => (await db.query(
  `SELECT * FROM payer_changes WHERE subscription_id = $1 AND status IN ${PENDING} ${lock}`, [subscriptionId])).rows[0];

async function assertNotFrozen(db, subscriptionId) {
  if (await pendingPayerChange(db, subscriptionId)) {
    throw httpError(409, 'payer_change_pending', 'Hay un cambio de pagador pendiente: anúlalo antes de cambiar nada');
  }
}

/** Nuevo pagador válido: el propio alumno adulto o un tutor vinculado de un menor; nunca un menor. null = no existe. */
async function validNewPayer(studentId, payerId) {
  const { rows: [r] } = await servicePool.query(
    `SELECT p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years' AS payer_adult,
            st.birth_date IS NULL OR st.birth_date <= CURRENT_DATE - interval '18 years' AS student_adult,
            EXISTS (SELECT 1 FROM guardianships g WHERE g.tutor_id = p.id AND g.minor_id = st.id) AS guardian
       FROM profiles p, profiles st WHERE p.id = $1 AND st.id = $2`, [payerId, studentId]);
  if (!r) return null;
  return r.payer_adult && (r.student_adult ? payerId === studentId : r.guardian);
}

const expireCheckout = async (sessionId) => {
  if (sessionId && (await stripe.checkout.sessions.retrieve(sessionId)).status === 'open') {
    await stripe.checkout.sessions.expire(sessionId);
  }
};

/**
 * Sucesora de un cambio que no llega a traspasarse: se cancela, se anulan sus recibos open y se reembolsan los pagados.
 * Antes de D no tiene recibos; después (un webhook tardío) el nuevo pagador ya pagó un mes que no tendrá. Es la
 * segunda excepción a «sin reembolsos automáticos», como la carrera de checkouts.
 * @returns {Promise<number>} céntimos reembolsados
 */
export async function discardSuccessor(subId) {
  if ((await stripe.subscriptions.retrieve(subId)).status !== 'canceled') await stripe.subscriptions.cancel(subId);
  await voidOpenInvoices(subId);
  const { data } = await stripe.invoices.list(
    { subscription: subId, status: 'paid', limit: 100, expand: ['data.payments.data.payment'] });
  let refunded = 0;
  for (const p of data.flatMap((inv) => inv.payments.data)) {
    if (p.status !== 'paid' || !p.payment.payment_intent) continue;
    // La clave evita un segundo reembolso si el evento se reprocesa.
    const pi = idOf(p.payment.payment_intent);
    await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `successor-refund-${pi}` });
    refunded += p.amount_paid;
  }
  return refunded;
}

// Pendiente → cancelled. Requested: el Checkout abierto caduca (si ya se pagó, la carrera la resuelve el webhook).
// Paid (solo por la baja de la antigua): se descarta la sucesora y se avisa también al pagador antiguo.
async function closePayerChange(db, pc, reason, actorId) {
  await expireCheckout(pc.checkout_session_id);
  const refunded = pc.status === 'paid' ? await discardSuccessor(pc.stripe_subscription_id) : 0;
  await db.query(
    `UPDATE payer_changes SET status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1`, [pc.id, reason]);
  await notice(db, {
    action: 'notice.payer_change_cancelled', actorId, type: 'payer_change', resourceId: pc.id,
    recipients: pc.status === 'paid' ? [pc.new_payer_id, pc.old_payer_id] : [pc.new_payer_id],
    student_id: pc.student_id, reason, refunded,
  });
}

/**
 * Pedir el cambio de pagador (solo el admin). La sucesora tendrá lo que la antigua tendría en D: la bajada
 * programada o el plan y las disciplinas actuales. Uno requested anterior se sustituye; uno paid ya no.
 * @returns {{ status: 201, body: { id, status, new_payer_id, plan_id, discipline_ids, starts_at, deadline } }}
 */
export async function requestPayerChange(client, { id, payerId, actorId }) {
  if (typeof payerId !== 'string' || !UUID_RE.test(payerId)) throw invalid('payer_id', 'payer_id debe ser un uuid');
  const s = await subscriptionFor(client, id);
  if (payerId === s.payer_id) throw httpError(409, 'same_payer', 'Ya es el pagador de la suscripción');
  const valid = await validNewPayer(s.student_id, payerId);
  if (valid === null) throw httpError(404, 'profile_not_found', 'Perfil no encontrado');
  if (!valid) throw httpError(409, 'invalid_payer', 'Paga el propio alumno adulto o un tutor vinculado del menor');

  return serviceTx(async (db) => {
    // Serializa con otro pedido y con el cambio de disciplina (que lee el congelado tras este bloqueo).
    await db.query(`SELECT 1 FROM subscriptions WHERE id = $1 FOR UPDATE`, [id]);
    const prev = await pendingPayerChange(db, id, 'FOR UPDATE');
    if (prev?.status === 'paid') throw httpError(409, 'payer_change_paid', 'Ya hay un cambio de pagador pagado');
    if (s.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
    if (s.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');
    // Stripe manda.
    const current = await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
    if (current.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
    if (current.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');
    if (current.pending_update) throw httpError(409, 'upgrade_pending', 'Hay una subida de plan pendiente de pago');
    const startsAt = new Date(current.items.data[0].current_period_end * 1000);
    if (startsAt - Date.now() < 2 * HOUR_MS) {
      throw httpError(409, 'period_ending_soon', 'El periodo termina en menos de 2 h: pídelo tras la renovación');
    }
    const next = pendingPhase(current.schedule);
    const planId = next ? next.metadata.plan_id : s.plan_id;
    const disciplineIds = next
      ? (next.metadata.discipline_ids ? next.metadata.discipline_ids.split(',') : [])
      : (await db.query(`SELECT discipline_id FROM subscription_disciplines WHERE subscription_id = $1 ORDER BY 1`, [id]))
        .rows.map((r) => r.discipline_id);
    if (prev) await closePayerChange(db, prev, 'replaced', actorId);

    const { rows: [pc] } = await db.query(
      `INSERT INTO payer_changes (subscription_id, student_id, old_payer_id, new_payer_id, plan_id, discipline_ids,
                                  starts_at, deadline, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status, new_payer_id, plan_id::text, discipline_ids::text[], starts_at, deadline`,
      [id, s.student_id, s.payer_id, payerId, planId, disciplineIds, startsAt, new Date(startsAt - HOUR_MS), actorId]);
    await audit(db, actorId, 'subscription.payer_change_request', id, { payer_change_id: pc.id, new_payer_id: payerId });
    await notice(db, {
      action: 'notice.payer_change_requested', actorId, type: 'payer_change', resourceId: pc.id,
      recipients: [payerId], student_id: s.student_id, plan_id: pc.plan_id, starts_at: pc.starts_at,
      deadline: pc.deadline, expires_at: pc.deadline,
    });
    return { status: 201, body: pc };
  });
}

/** Anular el cambio pendiente (solo el admin). Pagado ya no se deshace. */
export async function cancelPayerChange(client, { id, actorId }) {
  await subscriptionFor(client, id);
  await serviceTx(async (db) => {
    const pc = await pendingPayerChange(db, id, 'FOR UPDATE');
    if (!pc) throw httpError(404, 'no_payer_change', 'No hay ningún cambio de pagador pendiente');
    if (pc.status === 'paid') throw httpError(409, 'payer_change_paid', 'El cambio de pagador ya está pagado');
    await closePayerChange(db, pc, 'admin', actorId);
    await audit(db, actorId, 'subscription.payer_change_cancel', id, { payer_change_id: pc.id });
  });
}

/** El cambio, para el pagador antiguo, el nuevo y el admin (RLS); el resto, 404. */
export async function getPayerChange(client, { id }) {
  if (!(await client.query(`SELECT 1 FROM payer_changes WHERE id = $1`, [id])).rowCount) {
    throw httpError(404, 'payer_change_not_found', 'Cambio de pagador no encontrado');
  }
  // Detalle con servicePool: el nuevo pagador no ve un plan retirado por RLS.
  const { rows: [pc] } = await servicePool.query(
    `SELECT pc.id, ${EFFECTIVE_STATUS} AS status, jsonb_build_object('id', st.id, 'name', st.display_name) AS student,
            jsonb_build_object('id', pl.id::text, 'name', pl.name) AS plan, pl.price_cents,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id::text, 'name', d.name) ORDER BY d.name)
                        FROM disciplines d WHERE d.id = ANY(pc.discipline_ids)), '[]') AS disciplines,
            pc.starts_at, pc.deadline
       FROM payer_changes pc JOIN profiles st ON st.id = pc.student_id JOIN plans pl ON pl.id = pc.plan_id
      WHERE pc.id = $1`, [id]);
  return pc;
}

const PAYER_STATUSES = ['requested', 'paid', 'completed', 'expired', 'cancelled'];

/**
 * Cambios de pagador del panel (B19.1): `status` admite varios («requested,paid») y se filtra por el estado efectivo
 * (un requested pasada su fecha límite sale expired aunque el webhook aún no lo haya marcado); `from` sobre
 * updated_at; `subscription_id` limita a una suscripción. Los más recientes primero.
 */
export async function listPayerChanges(client, { status, from, subscription_id: subscriptionId, limit, offset }) {
  ({ limit, offset } = pagination({ limit, offset }));
  const statuses = status === undefined ? null : String(status).split(',');
  if (statuses && !statuses.every((s) => PAYER_STATUSES.includes(s))) {
    throw invalid('status', `status: ${PAYER_STATUSES.join(', ')} separados por comas`);
  }
  if (subscriptionId !== undefined && !UUID_RE.test(subscriptionId)) throw invalid('subscription_id', 'subscription_id inválido');
  const f = from === undefined ? null : dateParam(from, 'from');
  const where = `WHERE ($1::text[] IS NULL OR (${EFFECTIVE_STATUS}) = ANY($1))
                   AND ($2::date IS NULL OR pc.updated_at >= $2::date::timestamp AT TIME ZONE 'Europe/Madrid')
                   AND ($3::uuid IS NULL OR pc.subscription_id = $3)`;
  const params = [statuses, f, subscriptionId ?? null];
  const { rows } = await client.query(
    `SELECT pc.id, ${EFFECTIVE_STATUS} AS status, pc.subscription_id,
            jsonb_build_object('id', st.id, 'display_name', st.display_name) AS student,
            jsonb_build_object('id', op.id, 'display_name', op.display_name) AS old_payer,
            jsonb_build_object('id', np.id, 'display_name', np.display_name) AS new_payer,
            jsonb_build_object('id', pc.plan_id::text, 'name', pl.name) AS plan,
            pc.starts_at, pc.deadline, pc.cancel_reason, pc.updated_at
       FROM payer_changes pc JOIN profiles st ON st.id = pc.student_id JOIN profiles op ON op.id = pc.old_payer_id
       JOIN profiles np ON np.id = pc.new_payer_id LEFT JOIN plans pl ON pl.id = pc.plan_id
       ${where} ORDER BY pc.updated_at DESC, pc.id LIMIT $4 OFFSET $5`, [...params, limit, offset]);
  const { rows: [{ total }] } = await client.query(`SELECT count(*)::int AS total FROM payer_changes pc ${where}`, params);
  return { rows, total, limit, offset };
}

/** El cambio, si quien llama es su nuevo pagador y aún cumple las condiciones (tutor vinculado o el propio adulto). */
export async function assertNewPayer(client, { id, userId }) {
  const { rows: [pc] } = await client.query(`SELECT * FROM payer_changes WHERE id = $1`, [id]);
  if (!pc) throw httpError(404, 'payer_change_not_found', 'Cambio de pagador no encontrado');
  if (pc.new_payer_id !== userId || !(await validNewPayer(pc.student_id, userId))) {
    throw httpError(403, 'not_new_payer', 'Solo el nuevo pagador paga este cambio');
  }
  return pc;
}

/**
 * Checkout del nuevo pagador: suscripción con billing_cycle_anchor = D, sin prorrateo (0 € hoy). Uno nuevo de 30 min
 * en cada «Pagar» hasta la fecha límite. Sin cobertura ni validateOrder: es la misma suscripción que continúa.
 * @returns {{ url: string }}
 */
export async function payerChangeCheckout(client, { id, payerId }) {
  await assertNewPayer(client, { id, userId: payerId });
  const customer = await ensureCustomer(client, payerId);
  return serviceTx(async (db) => {
    // Bajo el bloqueo: un DELETE a la vez espera y caduca este Checkout.
    const { rows: [pc] } = await db.query(
      `SELECT pc.*, pl.stripe_price_id FROM payer_changes pc JOIN plans pl ON pl.id = pc.plan_id
        WHERE pc.id = $1 FOR UPDATE OF pc`, [id]);
    if (pc.status === 'cancelled') throw httpError(409, 'payer_change_cancelled', 'El cambio de pagador se ha anulado');
    if (['paid', 'completed'].includes(pc.status)) throw httpError(409, 'payer_change_paid', 'El cambio ya está pagado');
    if (pc.status === 'expired' || Date.now() > pc.deadline) {
      throw httpError(409, 'payer_change_expired', 'Ha pasado la fecha límite del cambio de pagador');
    }
    if (!pc.stripe_price_id) throw httpError(409, 'plan_not_purchasable', 'Este plan no se contrata por la pasarela');
    const metadata = {
      student_id: pc.student_id, payer_id: payerId, plan_id: pc.plan_id, discipline_ids: pc.discipline_ids.join(','),
      payer_change_id: pc.id,
    };
    const back = `${APP_URL}/billing/payer-changes/${pc.id}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: pc.stripe_price_id, quantity: 1 }],
      client_reference_id: pc.student_id,
      metadata,
      subscription_data: {
        metadata, billing_cycle_anchor: Math.floor(pc.starts_at / 1000), proration_behavior: 'none',
      },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
      success_url: `${back}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: back,
      integration_identifier: INTEGRATION_ID,
    });
    // Uno abierto a la vez: dos pagados darían dos sucesoras (el webhook cancelaría la segunda).
    await expireCheckout(pc.checkout_session_id);
    await db.query(`UPDATE payer_changes SET checkout_session_id = $2, updated_at = now() WHERE id = $1`, [id, session.id]);
    return { url: session.url };
  });
}

// Una suscripción afectada = en periodo de gracia (past_due) o impagado (unpaid).
// `delinquent`: el placeholder o literal booleano (true = morosos). Lo reusa el KPI «Impago» de Usuarios (users.js).
export const affectedSql = (delinquent) => `
  affected AS (
    SELECT 'subscription' AS kind, s.id, s.payer_id, s.student_id, s.status, pl.name AS label,
           s.current_period_end, s.cancel_at_period_end
      FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.status IN ('past_due', 'unpaid')
  ),
  -- Moroso = algo unpaid; en gracia = solo past_due. Un pagador sale en una sola lista.
  payers AS (
    SELECT payer_id FROM affected GROUP BY payer_id HAVING bool_or(status = 'unpaid') = ${delinquent}
  )`;

/**
 * Pagadores morosos (`delinquent`) o en periodo de gracia (`grace`), con sus suscripciones
 * afectadas y los recibos pendientes. Solo lectura: lo escribe el webhook y la RLS decide quién lo ve.
 */
export async function listOverduePayers(client, { list, limit = 25, offset = 0 }) {
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  const delinquent = list === 'delinquent';
  const { rows } = await client.query(
    `WITH ${affectedSql('$1')},
     pending AS (
       SELECT a.payer_id, a.id AS item_id, v.id, v.period_start, v.amount_due_cents, v.attempt_count,
              v.next_payment_attempt, v.last_payment_error, v.hosted_invoice_url
         FROM invoices v JOIN affected a ON a.id = v.subscription_id
        WHERE v.status = 'open'
     )
     SELECT p.payer_id, pr.display_name,
            (SELECT jsonb_agg(jsonb_build_object(
                      'kind', a.kind, 'id', a.id, 'student_id', a.student_id, 'student_name', st.display_name,
                      'label', a.label, 'status', a.status, 'current_period_end', a.current_period_end,
                      'cancel_at_period_end', a.cancel_at_period_end) ORDER BY st.display_name, a.id)
               FROM affected a JOIN profiles st ON st.id = a.student_id WHERE a.payer_id = p.payer_id) AS items,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', n.id, 'item_id', n.item_id, 'amount_due_cents', n.amount_due_cents,
                      'attempt_count', n.attempt_count, 'next_payment_attempt', n.next_payment_attempt,
                      'last_payment_error', n.last_payment_error, 'hosted_invoice_url', n.hosted_invoice_url)
                      ORDER BY n.period_start NULLS LAST, n.id)
               FROM pending n WHERE n.payer_id = p.payer_id), '[]') AS invoices
       FROM payers p JOIN profiles pr ON pr.id = p.payer_id
      ORDER BY (SELECT min(n.period_start) FROM pending n WHERE n.payer_id = p.payer_id) NULLS LAST, p.payer_id
      LIMIT $2 OFFSET $3`, [delinquent, limit, offset]);
  const { rows: [{ total }] } = await client.query(
    `WITH ${affectedSql('$1')} SELECT count(*)::int AS total FROM payers`, [delinquent]);
  return { payers: rows, total, limit, offset };
}
