// src/services/sessions.js — generación de sesiones a partir de clases (ADR 0004) vista del profesor y calendario.
import { httpError } from '../lib/errors.js';
import { listChildren } from './profile.js';

const TZ = 'Europe/Madrid';
const DEFAULT_HORIZON_DAYS = 365;
export const MAX_RANGE_DAYS = 92;
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

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

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
