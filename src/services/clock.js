// src/services/clock.js — registro de jornada de los profesores empleados (B31; CONTEXT § Registro de jornada; ADR 0025).
// Las tablas son de solo añadir y la RLS decide quién lee y escribe (059); aquí la secuencia, las jornadas y el CSV.
// Una jornada es lo fichado desde una entrada hasta su salida y cuenta en el día de Madrid de la entrada (también si
// cruza la medianoche); el total del mes suma las jornadas cerradas sin las pausas. Instantes en timestamptz: los
// cambios de hora salen solos.
import { servicePool } from '../config/database.js';
import { httpError } from '../lib/errors.js';
import { invalid } from './catalog.js';
import { notice } from './notices.js';
import { verifyQr, qrPeriod } from './checkin.js';

const TZ = 'Europe/Madrid';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const KINDS = ['in', 'out', 'pause_start', 'pause_end'];
// Estado → fichajes que admite; fichaje → estado al que lleva.
const NEXT = { out: ['in'], in: ['out', 'pause_start'], paused: ['pause_end'] };
const AFTER = { in: 'in', out: 'out', pause_start: 'paused', pause_end: 'in' };
const OPEN_HOURS = 16;
const KEEP_YEARS = 4;

const uuid = (v, field) => {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw invalid(field, `${field} inválido`);
  return v;
};
const month = (v) => {
  if (v === undefined) return null;
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw invalid('month', 'month debe ser YYYY-MM');
  return v;
};
const onlyFields = (body, allowed) => {
  const extra = Object.keys(body ?? {}).find((k) => !allowed.includes(k));
  if (extra) throw invalid(extra, `${extra} no se admite`);
  return body ?? {};
};

/** Estado tras unos fichajes ordenados; con `bad` el primero que no encaja. */
export function replay(events) {
  let state = 'out';
  for (const e of events) {
    if (!NEXT[state].includes(e.kind)) return { state, bad: e };
    state = AFTER[e.kind];
  }
  return { state };
}

const sequenceError = (state) => httpError(409, 'invalid_sequence', 'El fichaje no sigue al anterior', { state });

// Perfil del profesor (404 / 409 not_professor) con su tipo de relación; sin fila, autónomo.
async function professor(client, profileId) {
  const { rows: [p] } = await client.query(
    `SELECT p.id, p.display_name, ur.role, COALESCE(te.employment, 'self_employed') AS employment
       FROM profiles p LEFT JOIN user_roles ur ON ur.user_id = p.id
       LEFT JOIN teacher_employment te ON te.profile_id = p.id WHERE p.id = $1`, [profileId]);
  if (!p) throw httpError(404, 'profile_not_found', 'Perfil no encontrado');
  if (p.role !== 'profesor') throw httpError(409, 'not_professor', 'Solo los profesores tienen tipo de relación');
  return { id: p.id, display_name: p.display_name, employment: p.employment };
}

/** El admin marca a un profesor como empleado o autónomo (audit_log profile.employment). */
export async function setEmployment(client, { profileId, employment, actorId }) {
  uuid(profileId, 'profile_id');
  if (!['employee', 'self_employed'].includes(employment)) {
    throw invalid('employment', 'employment debe ser employee o self_employed');
  }
  await professor(client, profileId);
  await client.query(
    `INSERT INTO teacher_employment (profile_id, employment, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (profile_id) DO UPDATE SET employment = EXCLUDED.employment, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [profileId, employment, actorId]);
  await client.query(`SELECT write_audit($1, 'profile.employment', 'profile', $2, $3)`,
    [actorId, profileId, { employment }]);
  return { profile_id: profileId, employment };
}

// Estado actual: el del último fichaje que cuenta (la secuencia completa siempre es válida).
async function currentState(client, profileId) {
  const { rows: [e] } = await client.query(
    `SELECT kind FROM clock_effective WHERE profile_id = $1 ORDER BY at DESC, id DESC LIMIT 1`, [profileId]);
  return e ? AFTER[e.kind] : 'out';
}

// Serializa fichajes y correcciones de un profesor hasta el COMMIT (dos peticiones a la vez no pisan la secuencia).
const lock = (client, profileId) => client.query(`SELECT pg_advisory_xact_lock(hashtext('clock:' || $1))`, [profileId]);

/**
 * Fichar con la hora del servidor. `code`: el QR de la tablet (origen tablet). Autónomo → 403 not_employee;
 * fuera de secuencia → 409 invalid_sequence { state }.
 */
export async function clockIn(client, { profileId, body }) {
  const { kind, code } = onlyFields(body, ['kind', 'code']);
  if (!KINDS.includes(kind)) throw invalid('kind', `kind debe ser ${KINDS.join(', ')}`);
  if (code !== undefined && !verifyQr(code, await qrPeriod(client))) throw httpError(400, 'invalid_qr', 'QR inválido o caducado');
  const me = await professor(client, profileId);
  if (me.employment !== 'employee') throw httpError(403, 'not_employee', 'Solo fichan los profesores empleados');
  await lock(client, profileId);
  const state = await currentState(client, profileId);
  if (!NEXT[state].includes(kind)) throw sequenceError(state);
  const { rows: [event] } = await client.query(
    `INSERT INTO clock_events (profile_id, kind, origin) VALUES ($1, $2, $3) RETURNING id, kind, at, origin`,
    [profileId, kind, code === undefined ? 'app' : 'tablet']);
  return { event, state: AFTER[kind] };
}

const CORRECTION = `
  SELECT c.id, c.event_id, COALESCE(c.kind, e.kind) AS kind, c.at, c.reason, c.created_at,
         jsonb_build_object('id', c.requested_by, 'display_name', rq.display_name) AS requested_by,
         COALESCE(r.status, 'pending') AS status,
         CASE WHEN r.resolved_by IS NOT NULL THEN jsonb_build_object('id', r.resolved_by, 'display_name', rs.display_name) END
           AS resolved_by,
         r.resolved_at, r.reason AS resolution_reason
    FROM clock_corrections c LEFT JOIN clock_events e ON e.id = c.event_id
    LEFT JOIN clock_correction_resolutions r ON r.correction_id = c.id
    LEFT JOIN profiles rq ON rq.id = c.requested_by LEFT JOIN profiles rs ON rs.id = r.resolved_by`;

const getCorrection = async (client, id) => (await client.query(`${CORRECTION} WHERE c.id = $1`, [id])).rows[0];

// Valida e inserta una corrección: con event_id, nueva hora (o anularlo sin at); sin él, kind + at del que falta.
async function insertCorrection(client, { profileId, actorId, body }) {
  const { event_id: eventId, kind, at, reason } = body;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw invalid('reason', 'reason requerido (hasta 500)');
  if (at !== undefined && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) throw invalid('at', 'at debe ser una fecha ISO');
  if (at !== undefined && Date.parse(at) > Date.now()) throw invalid('at', 'at no puede ser futura');
  if (eventId !== undefined) {
    uuid(eventId, 'event_id');
    if (kind !== undefined) throw invalid('kind', 'kind solo para añadir un fichaje (sin event_id)');
    const { rowCount } = await client.query(`SELECT 1 FROM clock_events WHERE id = $1 AND profile_id = $2`, [eventId, profileId]);
    if (!rowCount) throw httpError(404, 'event_not_found', 'Fichaje no encontrado');
  } else if (!KINDS.includes(kind) || at === undefined) {
    throw invalid('kind', 'sin event_id hacen falta kind y at');
  }
  const { rows: [c] } = await client.query(
    `INSERT INTO clock_corrections (profile_id, event_id, kind, at, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [profileId, eventId ?? null, kind ?? null, at ?? null, reason.trim(), actorId]);
  return c.id;
}

// Aplica o rechaza; aplicada, la secuencia entera tiene que seguir siendo válida (si no, 409 y no se guarda nada).
async function resolve(client, { id, profileId, status, reason, actorId }) {
  await lock(client, profileId);
  try {
    await client.query(`SAVEPOINT resolve`);
    await client.query(
      `INSERT INTO clock_correction_resolutions (correction_id, status, reason, resolved_by) VALUES ($1, $2, $3, $4)`,
      [id, status, reason ?? null, actorId]);
    await client.query(`RELEASE SAVEPOINT resolve`);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT resolve`);
    if (err.code === '23505') throw httpError(409, 'already_resolved', 'La corrección ya está resuelta');
    throw err;
  }
  if (status === 'applied') {
    const { rows } = await client.query(`SELECT kind FROM clock_effective WHERE profile_id = $1 ORDER BY at, id`, [profileId]);
    const r = replay(rows);
    if (r.bad) throw sequenceError(r.state);
  }
}

const adminIds = async () => (await servicePool.query(`SELECT user_id FROM user_roles WHERE role = 'admin'`)).rows.map((r) => r.user_id);

/** El profesor pide una corrección de lo suyo (pendiente). Aviso al panel (admins, sin entregas). */
export async function requestCorrection(client, { profileId, body }) {
  onlyFields(body, ['event_id', 'kind', 'at', 'reason']);
  await professor(client, profileId);
  const id = await insertCorrection(client, { profileId, actorId: profileId, body });
  return getCorrection(client, id);
}

export async function noticeCorrectionRequested(c, profileId) {
  await notice(servicePool, {
    action: 'notice.clock_correction_requested', actorId: profileId, type: 'clock_correction', resourceId: c.id,
    recipients: await adminIds(), profile_id: profileId, profile_name: c.requested_by.display_name,
  });
}

/** El admin corrige directamente: queda aplicada. El aviso al profesor (noticeCorrected) va tras el COMMIT. */
export async function adminCorrection(client, { actorId, body }) {
  const { profile_id: profileId, ...rest } = onlyFields(body, ['profile_id', 'event_id', 'kind', 'at', 'reason']);
  uuid(profileId, 'profile_id');
  await professor(client, profileId);
  const id = await insertCorrection(client, { profileId, actorId, body: rest });
  await resolve(client, { id, profileId, status: 'applied', actorId });
  return getCorrection(client, id);
}

export async function noticeCorrected(c, profileId, actorId) {
  await notice(servicePool, {
    action: 'notice.clock_corrected', actorId, type: 'clock_correction', resourceId: c.id, recipients: [profileId],
    profile_id: profileId, event_id: c.event_id, kind: c.kind, at: c.at, reason: c.reason,
  });
}

/** Aplicar o rechazar (con motivo) una solicitud. 404 / 409 already_resolved / 409 invalid_sequence. */
export async function resolveCorrection(client, { id, status, body, actorId }) {
  uuid(id, 'id');
  const reason = body?.reason;
  if (status === 'rejected' && (typeof reason !== 'string' || !reason.trim() || reason.length > 500)) {
    throw invalid('reason', 'reason requerido para rechazar (hasta 500)');
  }
  const { rows: [c] } = await client.query(`SELECT profile_id FROM clock_corrections WHERE id = $1`, [id]);
  if (!c) throw httpError(404, 'correction_not_found', 'Corrección no encontrada');
  await resolve(client, { id, profileId: c.profile_id, status, reason: reason?.trim(), actorId });
  return getCorrection(client, id);
}

/**
 * Registro de un mes (YYYY-MM, por defecto el de Madrid de hoy): { profile, month, state, total_seconds, days, events,
 * corrections }. days: jornadas por día de Madrid de la entrada, con los fichajes que cuentan; events: los fichajes
 * originales del mes; corrections: las que tocan el mes y todas las pendientes, con su estado.
 */
export async function getMonth(client, { profileId, month: m }) {
  uuid(profileId, 'profile_id');
  const profile = await professor(client, profileId);
  const { rows: [b] } = await client.query(
    `SELECT to_char(s, 'YYYY-MM') AS month, s AT TIME ZONE '${TZ}' AS start, (s + interval '1 month') AT TIME ZONE '${TZ}' AS end
       FROM (SELECT COALESCE(($1 || '-01')::timestamp, date_trunc('month', now() AT TIME ZONE '${TZ}')) AS s) x`, [month(m)]);
  // Con margen: una jornada que empieza el último día acaba al mes siguiente.
  // shortcut: una jornada de más de 2 días no se cierra en el mes; si hiciera falta, ampliar el margen.
  const { rows: effective } = await client.query(
    `SELECT id, kind, at, origin, corrected, to_char(at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS date
       FROM clock_effective WHERE profile_id = $1 AND at >= $2 AND at < $3::timestamptz + interval '2 days'
      ORDER BY at, id`, [profileId, b.start, b.end]);
  const days = [];
  let shift = null;
  for (const e of effective) {
    const { date, ...ev } = e;
    if (e.kind === 'in') {
      if (new Date(e.at) >= b.end) break;
      let day = days.at(-1);
      if (day?.date !== date) days.push(day = { date, worked_seconds: 0, pause_seconds: 0, open: false, events: [] });
      shift = { day, in: e.at, pause: 0, pauseAt: null };
      day.events.push(ev);
      continue;
    }
    if (!shift) continue; // la cola de una jornada del mes anterior
    shift.day.events.push(ev);
    if (e.kind === 'pause_start') shift.pauseAt = e.at;
    if (e.kind === 'pause_end') shift.pause += e.at - shift.pauseAt;
    if (e.kind === 'out') {
      shift.day.worked_seconds += Math.round((e.at - shift.in - shift.pause) / 1000);
      shift.day.pause_seconds += Math.round(shift.pause / 1000);
      shift = null;
    }
  }
  if (shift) shift.day.open = true; // sin salida todavía: no suma
  const { rows: events } = await client.query(
    `SELECT id, kind, at, origin FROM clock_events WHERE profile_id = $1 AND at >= $2 AND at < $3 ORDER BY at, id`,
    [profileId, b.start, b.end]);
  const { rows: corrections } = await client.query(
    `${CORRECTION} WHERE c.profile_id = $1
        AND (COALESCE(c.at, e.at) >= $2 AND COALESCE(c.at, e.at) < $3 OR e.at >= $2 AND e.at < $3 OR r.status IS NULL)
      ORDER BY c.created_at, c.id`, [profileId, b.start, b.end]);
  return {
    profile, month: b.month, state: await currentState(client, profileId),
    total_seconds: days.reduce((s, d) => s + d.worked_seconds, 0), days, events, corrections,
  };
}

// ── CSV (Excel en español: `;` y BOM) ─────────────────────────────────────────

const KIND_ES = { in: 'Entrada', out: 'Salida', pause_start: 'Inicio de pausa', pause_end: 'Fin de pausa' };
const STATUS_ES = { pending: 'Pendiente', applied: 'Aplicada', rejected: 'Rechazada' };
const ORIGIN_ES = { app: 'App', tablet: 'Tablet' };
const madrid = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: TZ }) : ''); // «2026-03-31 09:00:00»
const hhmm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
// Inyección de fórmulas: una celda que empieza por = + - @ va con ' delante; con ; " o salto de línea, entre comillas.
export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** CSV de un mes: una fila por fichaje y por corrección y el total del mes, horas de Madrid. */
export async function exportCsv(client, { profileId, month: m }) {
  const r = await getMonth(client, { profileId, month: m });
  const rows = [
    ['Registro', 'Id', 'Fecha y hora (Madrid)', 'Fichaje', 'Origen', 'Corrige a', 'Motivo', 'Autor', 'Registrado',
      'Estado', 'Resuelta por', 'Resuelta', 'Motivo de la resolución'],
    ...r.events.map((e) => ['Fichaje', e.id, madrid(e.at), KIND_ES[e.kind], ORIGIN_ES[e.origin], '', '', r.profile.display_name,
      madrid(e.at), '', '', '', '']),
    ...r.corrections.map((c) => ['Corrección', c.id, c.at ? madrid(c.at) : 'Anulado', KIND_ES[c.kind], '', c.event_id ?? '',
      c.reason, c.requested_by.display_name ?? c.requested_by.id, madrid(c.created_at), STATUS_ES[c.status],
      c.resolved_by ? c.resolved_by.display_name ?? c.resolved_by.id : '', madrid(c.resolved_at), c.resolution_reason ?? '']),
    [`Total del mes`, r.month, r.profile.display_name, '', '', '', '', '', '', '', '', '', hhmm(r.total_seconds)],
  ];
  return { month: r.month, csv: `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n` };
}

// ── Tarea nocturna ───────────────────────────────────────────────────────────

/**
 * Jornada abierta: la última entrada de un profesor sigue sin salida a las 16 h → aviso al profesor (email) y al
 * panel. Una vez por entrada (idempotente). Devuelve cuántos avisos creó.
 */
export async function warnOpenDays(db = servicePool) {
  const { rows } = await db.query(
    `SELECT l.profile_id, l.id, l.at, p.display_name
       FROM (SELECT DISTINCT ON (profile_id) profile_id, id, kind, at FROM clock_effective
              ORDER BY profile_id, at DESC, id DESC) l
       JOIN profiles p ON p.id = l.profile_id
      WHERE l.kind <> 'out'`);
  // La última es una pausa o una vuelta: la jornada abierta empieza en la entrada anterior.
  const admins = await adminIds();
  let n = 0;
  for (const r of rows) {
    const { rows: [inEv] } = await db.query(
      `SELECT id, at FROM clock_effective WHERE profile_id = $1 AND kind = 'in' AND at <= $2 ORDER BY at DESC LIMIT 1`,
      [r.profile_id, r.at]);
    if (!inEv || Date.now() - inEv.at < OPEN_HOURS * 3600_000) continue;
    const { rowCount } = await db.query(
      `SELECT 1 FROM audit_log WHERE action = 'notice.clock_open' AND resource_id = $1`, [inEv.id]);
    if (rowCount) continue;
    await notice(db, {
      action: 'notice.clock_open', actorId: r.profile_id, type: 'clock_event', resourceId: inEv.id,
      recipients: [r.profile_id, ...admins], profile_id: r.profile_id, profile_name: r.display_name, event_id: inEv.id,
      in_at: inEv.at,
    });
    n++;
  }
  return n;
}

/**
 * Conservación: borra lo de más de 4 años (con service_role, el único al que el trigger se lo deja) en una sentencia y
 * deja en audit_log una fila clock.purge por profesor con cuántos registros borró. Devuelve el total.
 */
export async function purgeClock(db = servicePool) {
  const cut = `now() - interval '${KEEP_YEARS} years'`;
  const { rows } = await db.query(`
    WITH ev AS (SELECT id FROM clock_events WHERE at < ${cut}),
    co AS (SELECT id FROM clock_corrections WHERE created_at < ${cut} OR event_id IN (SELECT id FROM ev)),
    dr AS (DELETE FROM clock_correction_resolutions r USING clock_corrections c, co
            WHERE r.correction_id = co.id AND c.id = co.id RETURNING c.profile_id, 'resolutions' AS t),
    dc AS (DELETE FROM clock_corrections c USING co WHERE c.id = co.id RETURNING c.profile_id, 'corrections' AS t),
    de AS (DELETE FROM clock_events e USING ev WHERE e.id = ev.id RETURNING e.profile_id, 'events' AS t),
    n AS (SELECT profile_id, t, count(*)::int AS n FROM (SELECT * FROM dr UNION ALL SELECT * FROM dc UNION ALL SELECT * FROM de) x
           GROUP BY profile_id, t)
    INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
    SELECT gen_random_uuid(), profile_id, 'clock.purge', 'profile', profile_id::text,
           jsonb_object_agg(t, n) || jsonb_build_object('deleted', sum(n))
      FROM n GROUP BY profile_id
    RETURNING (changes->>'deleted')::int AS deleted`);
  return rows.reduce((s, r) => s + r.deleted, 0);
}
