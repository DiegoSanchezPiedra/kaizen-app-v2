// src/services/sessions.js — generación de sesiones a partir de clases (ADR 0004) y vista del profesor.
import { httpError } from '../lib/errors.js';

const TZ = 'Europe/Madrid';
const DEFAULT_HORIZON_DAYS = 365;
const MAX_RANGE_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getHorizonDays(client) {
  const { rows: [r] } = await client.query(`SELECT value #>> '{}' AS v FROM academy_settings WHERE key = 'horizon_days'`);
  const n = Number(r?.v);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HORIZON_DAYS;
}

// Idempotente: reejecutarla solo añade lo que falta (UNIQUE class_id, starts_at). Devuelve las sesiones creadas.
// La hora de la clase es hora local de Madrid, por lo que el cambio de horario se resuelve en SQL.
export async function generateSessions(client, classId) {
  const horizon = await getHorizonDays(client);
  const { rowCount } = await client.query(
    `WITH c AS (SELECT * FROM classes WHERE id = $1),
          today AS (SELECT (now() AT TIME ZONE '${TZ}')::date AS d)
     INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, ends_at,
                                 duration_min, capacity, location, status)
     SELECT c.id, c.discipline_id, c.trainer_id, s.ts, s.ts + c.duration_min * interval '1 minute',
            c.duration_min, c.capacity, c.location, 'scheduled'
       FROM c, today,
            generate_series(greatest(c.starts_on, today.d),
                            least(coalesce(c.ends_on, today.d + $2::int), today.d + $2::int),
                            interval '1 day') AS g(day),
            LATERAL (SELECT (g.day::date + c.start_time) AT TIME ZONE '${TZ}' AS ts) s
      WHERE extract(isodow FROM g.day) = c.weekday
     ON CONFLICT (class_id, starts_at) WHERE class_id IS NOT NULL DO NOTHING`,
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

function dateParam(v, field) {
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
