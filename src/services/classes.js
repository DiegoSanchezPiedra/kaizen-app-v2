// src/services/classes.js — CRUD admin de clases (horario semanal).
import { httpError } from '../lib/errors.js';
import { validate, invalid, insertSql, audit, parseId } from './catalog.js';
import { generateSessions } from './sessions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isInt = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;

const CLASS_SPEC = {
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

const CLASS_SELECT = `
  SELECT c.id, c.discipline_id, d.name AS discipline_name, c.trainer_id, p.display_name AS trainer_name,
         c.weekday, to_char(c.start_time, 'HH24:MI') AS start_time, c.duration_min, c.capacity,
         c.location, c.starts_on, c.ends_on
    FROM classes c JOIN disciplines d ON d.id = c.discipline_id JOIN profiles p ON p.id = c.trainer_id`;

export async function listClasses(client, { discipline_id } = {}) {
  const id = discipline_id === undefined ? null : parseId(discipline_id);
  const { rows } = await client.query(
    `${CLASS_SELECT} WHERE $1::bigint IS NULL OR c.discipline_id = $1 ORDER BY c.weekday, c.start_time`, [id]
  );
  return rows;
}

async function getClass(client, id) {
  const { rows: [c] } = await client.query(`${CLASS_SELECT} WHERE c.id = $1`, [id]);
  if (!c) throw httpError(404, 'class_not_found', 'Clase no encontrada');
  return c;
}

const overlap = (err) =>
  err.code === '23P01' ? httpError(409, 'trainer_overlap', 'El profesor ya imparte otra sesión a esa hora') : err;

export async function createClass(client, { body, actorId }) {
  const data = validate(body, CLASS_SPEC, false);
  if (data.ends_on && data.ends_on < (data.starts_on ?? data.ends_on)) throw invalid('ends_on', 'ends_on anterior a starts_on');

  const { rows: [disc] } = await client.query(`SELECT is_active FROM disciplines WHERE id = $1`, [data.discipline_id]);
  if (!disc?.is_active) throw invalid('discipline_id', 'Disciplina inexistente o inactiva');
  const { rowCount } = await client.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'profesor'`, [data.trainer_id]
  );
  if (!rowCount) throw invalid('trainer_id', 'El perfil no es profesor');

  const [sql, params] = insertSql('classes', data);
  const { rows: [{ id }] } = await client.query(sql, params);
  let sessions;
  try {
    sessions = await generateSessions(client, id);
  } catch (err) {
    throw overlap(err);
  }
  await audit(client, actorId, 'class.create', id, { ...data, sessions });
  return { ...(await getClass(client, id)), sessions_created: sessions };
}

// shortcut: hasta B7 solo se edita `location` (afecta a sesiones futuras generadas, no a las ya creadas);
// horario, profesor y aforo exigen el «cambio de clase» con propagación.
export async function updateClass(client, { id, body, actorId }) {
  const unsupported = Object.keys(body).filter((k) => k !== 'location');
  if (unsupported.length) {
    throw httpError(409, 'not_supported_yet', 'Solo se puede editar location por ahora', { fields: unsupported });
  }
  const data = validate(body, { location: CLASS_SPEC.location }, true);
  const { rowCount } = await client.query(`UPDATE classes SET location = $2 WHERE id = $1`, [id, data.location]);
  if (!rowCount) throw httpError(404, 'class_not_found', 'Clase no encontrada');
  await audit(client, actorId, 'class.update', id, data);
  return getClass(client, id);
}

// Retirar: la clase acaba el día anterior a `date` (por defecto hoy) y se cancelan sus sesiones desde esa fecha.
export async function retireClass(client, { id, date, actorId }) {
  if (date !== undefined && !isDate(date)) throw invalid('date', 'date debe ser YYYY-MM-DD');
  const { rows: [c] } = await client.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS d,
            (ends_on IS NOT NULL AND ends_on <= d - 1) AS already,
            (d - 1 < starts_on - 1) AS before_start
       FROM (SELECT starts_on, ends_on, COALESCE($2::date, (now() AT TIME ZONE 'Europe/Madrid')::date) AS d
               FROM classes WHERE id = $1 FOR UPDATE) x`, [id, date ?? null]
  );
  if (!c) throw httpError(404, 'class_not_found', 'Clase no encontrada');
  if (c.already) throw httpError(409, 'already_retired', 'La clase ya termina antes de esa fecha');
  if (c.before_start) throw invalid('date', 'date anterior al inicio de la clase');
  await client.query(`UPDATE classes SET ends_on = $2::date - 1 WHERE id = $1`, [id, c.d]);
  const { rowCount, rows } = await client.query(
    `UPDATE class_sessions SET status = 'cancelled'
      WHERE class_id = $1 AND status = 'scheduled'
        AND starts_at >= $2::date::timestamp AT TIME ZONE 'Europe/Madrid'
      RETURNING id`,
    [id, c.d]
  );
  // Cancelar una sesión anula sus reservas y esperas con aviso (CONTEXT).
  await client.query(`SELECT cancel_session_bookings(id) FROM unnest($1::uuid[]) id`, [rows.map((r) => r.id)]);
  await audit(client, actorId, 'class.retire', id, { from: c.d, cancelled_sessions: rowCount });
  return { ...(await getClass(client, id)), cancelled_sessions: rowCount };
}
