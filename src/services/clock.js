// src/services/clock.js — registro de jornada de los profesores empleados (B31; CONTEXT § Registro de jornada; ADR 0025).
// Las tablas son de solo añadir y la RLS decide quién lee y escribe (059); aquí la secuencia, las jornadas y el CSV.
// Una jornada es lo fichado desde una entrada hasta su salida, sin las pausas; los días y los meses se cortan en la
// medianoche de Madrid (una jornada que la cruza se reparte). Instantes en timestamptz: los cambios de hora salen solos.
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

// La corrección tal cual se ve; event_id es el fichaje al que apunta (original o añadido por otra corrección).
const CORRECTION = `
  SELECT c.id, COALESCE(c.event_id, c.correction_id) AS event_id, COALESCE(c.kind, e.kind, t.kind) AS kind, c.at, c.reason,
         c.created_at, jsonb_build_object('id', c.requested_by, 'display_name', rq.display_name) AS requested_by,
         COALESCE(r.status, 'pending') AS status,
         CASE WHEN r.resolved_by IS NOT NULL THEN jsonb_build_object('id', r.resolved_by, 'display_name', rs.display_name) END
           AS resolved_by,
         r.resolved_at, r.reason AS resolution_reason
    FROM clock_corrections c LEFT JOIN clock_events e ON e.id = c.event_id
    LEFT JOIN clock_corrections t ON t.id = c.correction_id
    LEFT JOIN clock_correction_resolutions r ON r.correction_id = c.id
    LEFT JOIN profiles rq ON rq.id = c.requested_by LEFT JOIN profiles rs ON rs.id = r.resolved_by`;

const getCorrection = async (client, id) => (await client.query(`${CORRECTION} WHERE c.id = $1`, [id])).rows[0];

// ISO 8601 estricto (fecha, hora y zona) y una fecha que existe: nada de Date.parse laxo («March 1», 30 de febrero).
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
function isoAt(v) {
  const m = typeof v === 'string' && ISO_RE.exec(v);
  const [y, mo, d, h, mi, s = 0, oh = 0, om = 0] = m ? m.slice(1).map((x) => Number(x ?? 0)) : [];
  if (!m || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || h > 23 || mi > 59 || s > 59
    || oh > 23 || om > 59) {
    throw invalid('at', 'at debe ser una fecha ISO 8601 con hora y zona');
  }
  if (Date.parse(v) > Date.now()) throw invalid('at', 'at no puede ser futura');
  return v;
}
// Motivo de una corrección o de un rechazo.
const reasonOf = (v) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) throw invalid('reason', 'reason requerido (hasta 500)');
  return v.trim();
};

// Solo el empleado tiene correcciones (las pida él o las haga el admin).
async function employee(client, profileId) {
  const p = await professor(client, profileId);
  if (p.employment !== 'employee') throw httpError(403, 'not_employee', 'Solo los profesores empleados tienen registro de jornada');
  return p;
}

// Valida e inserta una corrección. event_id: un fichaje original o uno añadido por una corrección aplicada; con at, nueva
// hora; sin at, lo anula. Sin event_id: kind + at del fichaje que falta.
async function insertCorrection(client, { profileId, actorId, body }) {
  const { event_id: eventId, kind } = body;
  const reason = reasonOf(body.reason);
  const at = body.at === undefined ? null : isoAt(body.at);
  let target = [null, null]; // [event_id, correction_id]
  if (eventId !== undefined) {
    uuid(eventId, 'event_id');
    if (kind !== undefined) throw invalid('kind', 'kind solo para añadir un fichaje (sin event_id)');
    const { rows: [t] } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM clock_events WHERE id = $1 AND profile_id = $2) AS event,
              EXISTS (SELECT 1 FROM clock_corrections c JOIN clock_correction_resolutions r
                                ON r.correction_id = c.id AND r.status = 'applied'
                       WHERE c.id = $1 AND c.profile_id = $2 AND c.event_id IS NULL AND c.correction_id IS NULL) AS added`,
      [eventId, profileId]);
    if (!t.event && !t.added) throw httpError(404, 'event_not_found', 'Fichaje no encontrado');
    target = t.event ? [eventId, null] : [null, eventId];
  } else if (!KINDS.includes(kind) || at === null) {
    throw invalid('kind', 'sin event_id hacen falta kind y at');
  }
  const { rows: [c] } = await client.query(
    `INSERT INTO clock_corrections (profile_id, event_id, correction_id, kind, at, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [profileId, ...target, kind ?? null, at, reason, actorId]);
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

/** El profesor empleado pide una corrección de lo suyo (pendiente). Aviso al panel tras el COMMIT. */
export async function requestCorrection(client, { profileId, body }) {
  onlyFields(body, ['event_id', 'kind', 'at', 'reason']);
  await employee(client, profileId);
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
  await employee(client, profileId);
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
  const reason = status === 'rejected' ? reasonOf(body?.reason) : null;
  const { rows: [c] } = await client.query(`SELECT profile_id FROM clock_corrections WHERE id = $1`, [id]);
  if (!c) throw httpError(404, 'correction_not_found', 'Corrección no encontrada');
  await resolve(client, { id, profileId: c.profile_id, status, reason, actorId });
  return getCorrection(client, id);
}

/** Tras el COMMIT: al profesor que la pidió, que se aplicó o se rechazó (con el motivo). */
export async function noticeResolved(c, actorId) {
  const { rows: [{ profile_id: profileId }] } = await servicePool.query(
    `SELECT profile_id FROM clock_corrections WHERE id = $1`, [c.id]);
  if (c.requested_by.id !== profileId) return; // la hizo el admin: ya avisó noticeCorrected
  await notice(servicePool, {
    action: `notice.clock_correction_${c.status}`, actorId, type: 'clock_correction', resourceId: c.id,
    recipients: [profileId], profile_id: profileId, event_id: c.event_id, kind: c.kind, at: c.at, reason: c.reason,
    resolution_reason: c.resolution_reason,
  });
}

// ── Días de Madrid ───────────────────────────────────────────────────────────

const madridDate = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
// Instante de la siguiente medianoche de Madrid (a las 00:00 nunca hay cambio de hora: el desfase de la 01:00 o 02:00
// UTC de ese día es el de su medianoche).
function nextMidnight(t) {
  const [y, m, d] = madridDate(t).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + 1);
  const [, sign, hh, mm] = new Date(guess).toLocaleString('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .match(/GMT([+-])(\d{2}):(\d{2})/);
  return guess - (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
}
// Reparte el tramo [a, b) entre los días de Madrid que toca.
function splitByDay(a, b, fn) {
  for (let t = a; t < b;) {
    const m = Math.min(b, nextMidnight(t));
    fn(madridDate(t), m - t);
    t = m;
  }
}

/**
 * Registro de un mes (YYYY-MM, por defecto el de Madrid de hoy): { profile, month, state, total_seconds, days, events,
 * corrections }. days: lo trabajado y las pausas por día de Madrid (una jornada que cruza la medianoche se reparte entre
 * los dos días, y los dos meses), con los fichajes que cuentan de ese día; events: los fichajes originales del mes;
 * corrections: las que tocan el mes y todas las pendientes, con su estado.
 */
export async function getMonth(client, { profileId, month: m }) {
  uuid(profileId, 'profile_id');
  const profile = await professor(client, profileId);
  const { rows: [b] } = await client.query(
    `SELECT to_char(s, 'YYYY-MM') AS month, s AT TIME ZONE '${TZ}' AS start, (s + interval '1 month') AT TIME ZONE '${TZ}' AS end
       FROM (SELECT COALESCE(($1 || '-01')::timestamp, date_trunc('month', now() AT TIME ZONE '${TZ}')) AS s) x`, [month(m)]);
  // Con margen a cada lado: las jornadas que cruzan el cambio de mes.
  // shortcut: una jornada de más de 2 días se corta en el margen; si hiciera falta, ampliarlo.
  const { rows: effective } = await client.query(
    `SELECT id, kind, at, origin, corrected FROM clock_effective
      WHERE profile_id = $1 AND at >= $2::timestamptz - interval '2 days' AND at < $3::timestamptz + interval '2 days'
      ORDER BY at, id`, [profileId, b.start, b.end]);
  const byDate = new Map();
  const day = (date) => byDate.get(date) ?? byDate.set(date, { date, worked: 0, pause: 0, open: false, events: [] }).get(date);
  let shift = null;
  for (const e of effective) {
    day(madridDate(e.at)).events.push(e);
    if (e.kind === 'in') shift = { in: e.at, pauseAt: null, pauses: [] };
    else if (!shift) continue; // la cola de una jornada anterior al margen
    else if (e.kind === 'pause_start') shift.pauseAt = e.at;
    else if (e.kind === 'pause_end') shift.pauses.push([shift.pauseAt, e.at]);
    else if (e.kind === 'out') {
      splitByDay(shift.in, e.at, (d, ms) => { day(d).worked += ms; });
      for (const [a, z] of shift.pauses) splitByDay(a, z, (d, ms) => { day(d).worked -= ms; day(d).pause += ms; });
      shift = null;
    }
  }
  if (shift) day(madridDate(shift.in)).open = true; // sin salida todavía: no suma
  const days = [...byDate.values()].filter((d) => d.date.startsWith(b.month)).sort((x, y) => x.date.localeCompare(y.date))
    .map(({ date, worked, pause, open, events }) => ({
      date, worked_seconds: Math.round(worked / 1000), pause_seconds: Math.round(pause / 1000), open, events,
    }));
  const { rows: events } = await client.query(
    `SELECT id, kind, at, origin FROM clock_events WHERE profile_id = $1 AND at >= $2 AND at < $3 ORDER BY at, id`,
    [profileId, b.start, b.end]);
  const { rows: corrections } = await client.query(
    `${CORRECTION} WHERE c.profile_id = $1
        AND (COALESCE(c.at, e.at, t.at) >= $2 AND COALESCE(c.at, e.at, t.at) < $3 OR COALESCE(e.at, t.at) >= $2 AND COALESCE(e.at, t.at) < $3
             OR r.status IS NULL)
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
// Inyección de fórmulas: una celda que empieza por = + - @, tabulador o retorno va con ' delante; con ; " o salto de
// línea, entre comillas.
export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** CSV de un mes: una fila por fichaje y por corrección, el total de cada día y el del mes (columna Total), horas de Madrid. */
export async function exportCsv(client, { profileId, month: m }) {
  const r = await getMonth(client, { profileId, month: m });
  const name = r.profile.display_name;
  const blank = Array(10).fill('');
  const rows = [
    ['Registro', 'Id', 'Fecha y hora (Madrid)', 'Fichaje', 'Origen', 'Corrige a', 'Motivo', 'Autor', 'Registrado',
      'Estado', 'Resuelta por', 'Resuelta', 'Motivo de la resolución', 'Total'],
    ...r.events.map((e) => ['Fichaje', e.id, madrid(e.at), KIND_ES[e.kind], ORIGIN_ES[e.origin], '', '', name,
      madrid(e.at), '', '', '', '', '']),
    ...r.corrections.map((c) => ['Corrección', c.id, c.at ? madrid(c.at) : 'Anulado', KIND_ES[c.kind], '', c.event_id ?? '',
      c.reason, c.requested_by.display_name ?? c.requested_by.id, madrid(c.created_at), STATUS_ES[c.status],
      c.resolved_by ? c.resolved_by.display_name ?? c.resolved_by.id : '', madrid(c.resolved_at), c.resolution_reason ?? '', '']),
    ...r.days.map((d) => ['Total del día', d.date, name, ...blank, hhmm(d.worked_seconds)]),
    ['Total del mes', r.month, name, ...blank, hhmm(r.total_seconds)],
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
 * Conservación (4 años): por profesor, borra las jornadas enteras cuyas filas (fichajes, correcciones y resoluciones)
 * son todas de más de 4 años; nunca media jornada (ni una salida huérfana). Corta en B: el inicio de la jornada en curso
 * a los 4 años, y lo baja al inicio de la jornada de cualquier fila que no se pueda borrar entera (una corrección o una
 * resolución reciente, o una fila con horas a los dos lados de B). Con service_role (el trigger solo le deja borrar lo de
 * más de 4 años) y una fila clock.purge por profesor en audit_log, con él como actor (no hay actor «sistema»).
 * Devuelve el total borrado.
 */
export async function purgeClock(db = servicePool) {
  const client = await db.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
    const { rows: [{ cut }] } = await client.query(`SELECT now() - interval '${KEEP_YEARS} years' AS cut`);
    const { rows: profiles } = await client.query(
      `SELECT profile_id FROM clock_events WHERE at < $1 UNION SELECT profile_id FROM clock_corrections WHERE created_at < $1`, [cut]);
    for (const { profile_id: pid } of profiles) {
      const { rows: eff } = await client.query(
        `SELECT kind, at FROM clock_effective WHERE profile_id = $1 ORDER BY at, id`, [pid]);
      const shifts = [];
      for (const e of eff) {
        if (e.kind === 'in') shifts.push([+e.at, Infinity]);
        else if (e.kind === 'out' && shifts.length) shifts.at(-1)[1] = +e.at;
      }
      const shiftStart = (t) => shifts.find(([a, z]) => a <= t && t <= z)?.[0] ?? t;
      const { rows: events } = await client.query(
        `SELECT e.id, ARRAY[e.at, f.at] AS anchors, false AS young
           FROM clock_events e LEFT JOIN clock_effective f ON f.id = e.id WHERE e.profile_id = $1`, [pid]);
      const { rows: corrections } = await client.query(
        `SELECT c.id, ARRAY[c.at, e.at, t.at, f.at] AS anchors, c.created_at >= $2 OR r.resolved_at >= $2 AS young
           FROM clock_corrections c LEFT JOIN clock_events e ON e.id = c.event_id
           LEFT JOIN clock_corrections t ON t.id = c.correction_id
           LEFT JOIN clock_effective f ON f.id = COALESCE(c.event_id, c.correction_id)
           LEFT JOIN clock_correction_resolutions r ON r.correction_id = c.id
          WHERE c.profile_id = $1`, [pid, cut]);
      const all = [...events, ...corrections].map((r) => ({ ...r, anchors: r.anchors.filter(Boolean).map(Number) }));
      let B = shiftStart(+cut);
      for (let changed = true; changed;) {
        changed = false;
        for (const r of all) {
          const lo = Math.min(...r.anchors);
          if (lo < B && (r.young || Math.max(...r.anchors) >= B) && shiftStart(lo) < B) {
            B = shiftStart(lo);
            changed = true;
          }
        }
      }
      const gone = (r) => !r.young && Math.max(...r.anchors) < B;
      const ev = events.filter((r) => gone(all.find((x) => x.id === r.id))).map((r) => r.id);
      const co = corrections.filter((r) => gone(all.find((x) => x.id === r.id)));
      if (!ev.length && !co.length) continue;
      const { rowCount: resolutions } = await client.query(
        `DELETE FROM clock_correction_resolutions WHERE correction_id = ANY($1::uuid[])`, [co.map((r) => r.id)]);
      await client.query(`DELETE FROM clock_corrections WHERE id = ANY($1::uuid[])`, [co.map((r) => r.id)]);
      await client.query(`DELETE FROM clock_events WHERE id = ANY($1::uuid[])`, [ev]);
      const deleted = ev.length + co.length + resolutions;
      await client.query(
        `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
         VALUES (gen_random_uuid(), $1, 'clock.purge', 'profile', $2, $3)`,
        [pid, pid, { deleted, events: ev.length, corrections: co.length, resolutions, by: 'nightly' }]);
      total += deleted;
    }
    await client.query('COMMIT');
    return total;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
