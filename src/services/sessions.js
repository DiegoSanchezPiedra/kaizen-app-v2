// src/services/sessions.js — generación de sesiones a partir de clases (ADR 0004), ajuste de sesión (B7.1), sesiones
// sueltas, cancelar, recuperar y deshacer un ajuste (B6.1), vista del profesor y calendario.
import { httpError } from '../lib/errors.js';
import { listChildren } from './profile.js';
import { validate, invalid, audit } from './catalog.js';

const TZ = 'Europe/Madrid';
const DEFAULT_HORIZON_DAYS = 365;
export const MAX_RANGE_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
export const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isInt = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;

// Campos de una clase (services/classes.js); el ajuste de sesión usa los suyos.
export const CLASS_SPEC = {
  discipline_id: [(v) => typeof v === 'string' && /^\d{1,18}$/.test(v), 'discipline_id inválido', true],
  trainer_id: [(v) => typeof v === 'string' && UUID_RE.test(v), 'trainer_id inválido', true],
  weekday: [isInt(1, 7), 'weekday entero 1 (lunes) – 7 (domingo)', true],
  start_time: [(v) => typeof v === 'string' && TIME_RE.test(v), 'start_time debe ser HH:MM', true],
  duration_min: [isInt(1, 1440), 'duration_min entero 1–1440', true],
  capacity: [isInt(1, 10000), 'capacity entero ≥ 1', true],
  location: [(v) => typeof v === 'string' && v.length <= 100, 'location ≤100'],
  starts_on: [isDate, 'starts_on debe ser YYYY-MM-DD'],
  ends_on: [isDate, 'ends_on debe ser YYYY-MM-DD'],
};
const SESSION_SPEC = {
  trainer_id: CLASS_SPEC.trainer_id,
  starts_at: [(v) => typeof v === 'string' && ISO_RE.test(v) && Date.parse(v) > Date.now(),
    'starts_at debe ser una fecha ISO futura con zona horaria'],
  duration_min: CLASS_SPEC.duration_min,
  capacity: CLASS_SPEC.capacity,
  location: CLASS_SPEC.location,
};

export async function getHorizonDays(client) {
  const { rows: [r] } = await client.query(`SELECT value #>> '{}' AS v FROM academy_settings WHERE key = 'horizon_days'`);
  const n = Number(r?.v);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HORIZON_DAYS;
}

// Idempotente: solo añade los días posteriores a la última sesión de la clase (UNIQUE class_id, slot). Un cambio de
// hora desde una fecha futura deja antes de ella sesiones con la hora anterior: regenerar esos días las duplicaría.
// FOR SHARE: espera a un cambio de clase en curso y genera con sus valores. Devuelve las sesiones creadas.
// La hora de la clase es hora local de Madrid, por lo que el cambio de horario se resuelve en SQL.
export async function generateSessions(client, classId) {
  const horizon = await getHorizonDays(client);
  const { rowCount } = await client.query(
    `WITH c AS (SELECT * FROM classes WHERE id = $1 FOR SHARE),
          today AS (SELECT (now() AT TIME ZONE '${TZ}')::date AS d),
          last AS (SELECT (max(slot) AT TIME ZONE '${TZ}')::date AS d FROM class_sessions WHERE class_id = $1)
     INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at,
                                 duration_min, capacity, location, status,
                                 class_trainer_id, class_duration_min, class_capacity, class_location)
     SELECT c.id, c.discipline_id, c.trainer_id, s.ts, s.ts, s.ts + c.duration_min * interval '1 minute',
            c.duration_min, c.capacity, c.location, 'scheduled',
            c.trainer_id, c.duration_min, c.capacity, c.location
       FROM c, today, last,
            generate_series(greatest(c.starts_on, today.d, last.d + 1),
                            least(coalesce(c.ends_on, today.d + $2::int), today.d + $2::int),
                            interval '1 day') AS g(day),
            LATERAL (SELECT (g.day::date + c.start_time) AT TIME ZONE '${TZ}' AS ts) s
      WHERE extract(isodow FROM g.day) = c.weekday
     ON CONFLICT (class_id, slot) WHERE class_id IS NOT NULL DO NOTHING`,
    [classId, horizon]
  );
  return rowCount;
}

// Proceso diario: extiende el horizonte de las clases vigentes. Una query por clase: un choque de
// solape de profesor en una no impide las demás.
export async function extendHorizon(client) {
  const { rows } = await client.query(
    `SELECT id FROM classes WHERE ends_on IS NULL OR ends_on >= (now() AT TIME ZONE '${TZ}')::date`
  );
  const result = { created: 0, failed: [] };
  for (const { id } of rows) {
    try {
      result.created += await generateSessions(client, id);
    } catch (err) {
      result.failed.push({ class_id: id, error: err.message });
    }
  }
  return result;
}

export async function assertTrainer(client, id) {
  const { rowCount } = await client.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'profesor'`, [id]);
  if (!rowCount) throw invalid('trainer_id', 'El perfil no es profesor');
}

// [status, mensaje, código HTTP si no es el de SQL, details]
const CHANGE_ERRORS = {
  not_allowed: [403, 'Solo el admin cambia clases y sesiones'],
  class_not_found: [404, 'Clase no encontrada'],
  session_not_found: [404, 'Sesión no encontrada'],
  session_not_adjustable: [409, 'La sesión está cancelada o ya ha empezado'],
  capacity_below_bookings: [409, 'El aforo quedaría por debajo de las reservas confirmadas'],
  note_required: [400, 'note es obligatorio en una sesión que ya ha empezado', 'invalid_field', { field: 'note' }],
  invalid_field: [400, 'fields debe contener trainer_id, starts_at, duration_min, capacity o location',
    'invalid_field', { field: 'fields' }],
  invalid_date: [400, 'date no puede ser pasada', 'invalid_field', { field: 'date' }],
  before_start: [400, 'date anterior al inicio de la clase', 'invalid_field', { field: 'date' }],
  session_cancelled: [409, 'La sesión ya está cancelada'],
  session_not_cancelled: [409, 'La sesión no está cancelada'],
  session_started: [409, 'La sesión ya ha empezado'],
  class_retired: [409, 'Su clase está retirada en esa fecha: crea una sesión suelta'],
  discipline_inactive: [409, 'Su disciplina está desactivada'],
  loose_session: [409, 'Una sesión suelta no tiene clase a la que volver'],
  slot_passed: [409, 'La hora que le toca según su clase ya ha pasado'],
  already_retired: [409, 'La clase ya termina antes de esa fecha'],
};

// Funciones de 021 y 022 (change_class, adjust_session, cancel_session…) → su jsonb, con sus errores en HTTP.
// El de aforo trae { sessions, fits_from } en el DETAIL.
export async function callChange(client, sql, params) {
  try {
    const { rows: [{ r }] } = await client.query(sql, params);
    return r;
  } catch (err) {
    const known = (err.code === 'P0001' || err.code === '42501') && CHANGE_ERRORS[err.message];
    if (known) {
      throw httpError(known[0], known[2] ?? err.message, known[1], known[3] ?? (err.detail ? JSON.parse(err.detail) : undefined));
    }
    if (err.code === '23P01') throw httpError(409, 'trainer_overlap', 'El profesor ya imparte otra sesión a esa hora');
    // Promociones cruzadas entre sesiones pueden bloquearse mutuamente (como en services/bookings.js).
    if (err.code === '40P01') throw httpError(409, 'booking_conflict_retry', 'Operación concurrente, vuelve a intentarlo');
    throw err;
  }
}

const SESSION_SELECT = `
  SELECT id, class_id, discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, location, status,
         slot, adjusted_fields, changed_at, cancelled_at, cancelled_by, cancel_note
    FROM class_sessions`;
const getSession = async (client, id) => (await client.query(`${SESSION_SELECT} WHERE id = $1`, [id])).rows[0];

// Ajuste de sesión (CONTEXT, B7.1): sustituto, inicio (también otro día), duración, aforo y lugar.
export async function adjustSession(client, { id, body }) {
  if (!Object.keys(SESSION_SPEC).some((k) => body[k] !== undefined)) throw invalid('body', 'Nada que ajustar');
  const data = validate(body, SESSION_SPEC, true);
  if (data.trainer_id) await assertTrainer(client, data.trainer_id);
  const counts = await callChange(client, `SELECT adjust_session($1, $2) AS r`, [id, data]);
  return { session: await getSession(client, id), ...counts };
}

// Sesión suelta (CONTEXT, B6.1): sin clase ni slot. La disciplina, FOR SHARE: espera a una desactivación en curso.
const LOOSE_SPEC = { discipline_id: CLASS_SPEC.discipline_id, ...SESSION_SPEC, starts_at: [...SESSION_SPEC.starts_at, true] };
export async function createSession(client, { body, actorId }) {
  const data = validate(body, LOOSE_SPEC, false);
  const { rows: [disc] } = await client.query(`SELECT is_active FROM disciplines WHERE id = $1 FOR SHARE`, [data.discipline_id]);
  if (!disc?.is_active) throw invalid('discipline_id', 'Disciplina inexistente o inactiva');
  if (new Date(data.starts_at).toLocaleDateString('sv-SE', { timeZone: TZ }) > addDays(today(), await getHorizonDays(client))) {
    throw invalid('starts_at', 'starts_at como mucho hoy + horizonte');
  }
  await assertTrainer(client, data.trainer_id);
  const id = await callChange(client,
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, location, status)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + $4 * interval '1 minute', $4, $5, $6, 'scheduled')
     RETURNING id AS r`,
    [data.discipline_id, data.trainer_id, data.starts_at, data.duration_min, data.capacity, data.location ?? null]);
  await audit(client, actorId, 'session.create', id, data);
  return getSession(client, id);
}

// Cancelar una sesión (CONTEXT): antes del inicio, con aviso; desde el inicio, retroactiva con motivo obligatorio.
export async function cancelSession(client, { id, body }) {
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 500)) {
    throw invalid('note', 'note texto ≤500');
  }
  const r = await callChange(client, `SELECT cancel_session($1, $2) AS r`, [id, body.note?.trim() ?? null]);
  return { session: await getSession(client, id), ...r };
}

// Recuperar una sesión cancelada que no ha empezado; las reservas no vuelven (CONTEXT).
export async function restoreSession(client, { id }) {
  const r = await callChange(client, `SELECT restore_session($1) AS r`, [id]);
  return { session: await getSession(client, id), ...r };
}

// Deshacer un ajuste: cada campo vuelve a lo que dice su clase para la sesión (CONTEXT).
const RESET_FIELDS = Object.keys(SESSION_SPEC);
export async function resetSession(client, { id, body }) {
  const { fields } = body;
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length
      || !fields.every((f) => RESET_FIELDS.includes(f))) {
    throw invalid('fields', `fields: lista no vacía, sin repetir, de ${RESET_FIELDS.join(', ')}`);
  }
  const r = await callChange(client, `SELECT reset_session($1, $2) AS r`, [id, fields]);
  return { session: await getSession(client, id), ...r };
}

export function dateParam(v, field) {
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw httpError(400, 'invalid_field', `${field} debe ser YYYY-MM-DD`, { field });
  }
  return v;
}

// Sesiones que imparte el profesor (sustituciones incluidas); `from`/`to` son días de Madrid, ambos inclusive.
export async function listTrainerSessions(client, trainerId, { from, to } = {}) {
  const f = from ? dateParam(from, 'from') : null;
  const t = to ? dateParam(to, 'to') : null;
  const { rows } = await client.query(
    `WITH r AS (SELECT COALESCE($2::date, (now() AT TIME ZONE '${TZ}')::date) AS f) 
     SELECT s.id, s.class_id, s.discipline_id, d.name AS discipline_name, s.starts_at, s.ends_at,
            s.duration_min, s.capacity, s.location, s.status
       FROM class_sessions s JOIN disciplines d ON d.id = s.discipline_id, r
      WHERE s.trainer_id = $1
        AND s.starts_at >= r.f::timestamp AT TIME ZONE '${TZ}'
        AND s.starts_at <  (COALESCE($3::date, r.f + 30) + 1)::timestamp AT TIME ZONE '${TZ}'
        AND COALESCE($3::date, r.f + 30) - r.f < ${MAX_RANGE_DAYS}
      ORDER BY s.starts_at`,
    [trainerId, f, t]
  );
  return rows;
}

export async function getTrainerSession(client, trainerId, id) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.class_id, s.discipline_id, d.name AS discipline_name, s.starts_at, s.ends_at,
            s.duration_min, s.capacity, s.location, s.status
       FROM class_sessions s JOIN disciplines d ON d.id = s.discipline_id
      WHERE s.id = $1 AND s.trainer_id = $2`,
    [id, trainerId]
  );
  if (!s) throw httpError(404, 'session_not_found', 'Sesión no encontrada');
  return s;
}

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
export const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

// Calendario (CONTEXT § Clases y sesiones): todas las sesiones que deja ver la RLS, con la cobertura y la
// reserva activa de cada sujeto. Sujetos: el alumno; los hijos vigentes del tutor; el alumno de `profile_id` (admin).
// Con un solo sujeto, `covered`/`booking` van planos; el tutor los recibe por hijo; el admin sin sujeto, sin ellos.
// Una sesión de una disciplina retirada no sale si la RLS de disciplines no la deja ver (aceptado, B6).
export async function listCalendar(client, user, { from, to, discipline_id, profile_id } = {}) {
  const f = from ? dateParam(from, 'from') : today();
  const t = to ? dateParam(to, 'to') : addDays(f, 30);
  const days = (Date.parse(t) - Date.parse(f)) / 864e5;
  if (days < 0 || days >= MAX_RANGE_DAYS) {
    throw httpError(400, 'invalid_range', `to debe ser >= from y el rango de ${MAX_RANGE_DAYS} días como mucho`);
  }
  if (discipline_id !== undefined && !/^\d{1,18}$/.test(discipline_id)) {
    throw httpError(400, 'invalid_field', 'discipline_id debe ser un entero', { field: 'discipline_id' });
  }
  if (profile_id !== undefined && user.role !== 'admin') {
    throw httpError(400, 'invalid_field', 'profile_id solo lo usa el admin', { field: 'profile_id' });
  }

  let subjects = [];
  if (user.role === 'alumno') subjects = [user.id];
  else if (user.role === 'tutor') subjects = (await listChildren(client, user.id)).filter((c) => !c.pending_claim).map((c) => c.id);
  else if (profile_id) subjects = [profile_id];

  const { rows } = await client.query(
    // covers() una vez por sujeto y disciplina, no por sesión: MATERIALIZED impide que el planificador la reparta.
    `WITH s AS MATERIALIZED (
       SELECT * FROM class_sessions
        WHERE starts_at >= $1::date::timestamp AT TIME ZONE '${TZ}'
          AND starts_at <  ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
          AND ($3::bigint IS NULL OR discipline_id = $3)),
     cov AS MATERIALIZED (
       SELECT dd.discipline_id,
              COALESCE(jsonb_object_agg(x, session_coverage(x, dd.discipline_id)) FILTER (WHERE x IS NOT NULL), '{}')
                AS covered
         FROM (SELECT DISTINCT discipline_id FROM s) dd LEFT JOIN unnest($4::uuid[]) x ON true
        GROUP BY dd.discipline_id)
     SELECT s.id, s.starts_at, s.ends_at, jsonb_build_object('id', d.id, 'name', d.name) AS discipline,
            CASE WHEN tn.id IS NOT NULL THEN jsonb_build_object('id', tn.id, 'display_name', tn.display_name) END AS trainer,
            s.location, s.capacity, s.status, (s.status = 'scheduled' AND s.ends_at < now()) AS held,
            cov.covered,
            (SELECT COALESCE(jsonb_object_agg(x, (SELECT jsonb_build_object('id', b.id, 'status', b.status)
                                                    FROM bookings b
                                                   WHERE b.session_id = s.id AND b.student_id = x
                                                     AND b.status <> 'cancelled')), '{}')
               FROM unnest($4::uuid[]) x) AS booking
       FROM s
       JOIN disciplines d ON d.id = s.discipline_id
       JOIN cov ON cov.discipline_id = s.discipline_id
       LEFT JOIN trainer_names tn ON tn.id = s.trainer_id
      ORDER BY s.starts_at, s.id`,
    [f, t, discipline_id ?? null, subjects]
  );
  if (user.role === 'tutor') return rows;
  for (const r of rows) {
    if (subjects.length) {
      [r.covered, r.booking] = [r.covered[subjects[0]], r.booking[subjects[0]]];
    } else {
      delete r.covered;
      delete r.booking;
    }
  }
  return rows;
}
