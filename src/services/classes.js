// src/services/classes.js — CRUD admin de clases (horario semanal).
import { httpError } from '../lib/errors.js';
import { validate, invalid, insertSql, audit, parseId } from './catalog.js';
import {
  generateSessions, getHorizonDays, assertTrainer, callChange, CLASS_SPEC, isDate, today, addDays,
} from './sessions.js';

// Lo que admite un cambio de clase; la disciplina y el día, no (se retira y se crea otra).
const CHANGE_SPEC = Object.fromEntries(
  ['trainer_id', 'start_time', 'duration_min', 'capacity', 'location'].map((k) => [k, CLASS_SPEC[k]]));

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
  await assertTrainer(client, data.trainer_id);

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

// Cambio de clase (CONTEXT, B7.1) desde `from` (día de Madrid; por defecto hoy, nunca pasado ni más allá del
// horizonte). Las reglas sobre las sesiones y las reservas viven en change_class (021).
export async function updateClass(client, { id, body }) {
  const fixed = ['discipline_id', 'weekday'].filter((k) => body[k] !== undefined);
  if (fixed.length) {
    throw httpError(409, 'not_supported', 'La disciplina y el día no se cambian: retira la clase y crea otra', { fields: fixed });
  }
  if (!Object.keys(CHANGE_SPEC).some((k) => body[k] !== undefined)) throw invalid('body', 'Nada que cambiar');
  const data = validate(body, CHANGE_SPEC, true);
  const t = today();
  const from = body.from ?? t;
  if (!isDate(from) || from < t || from > addDays(t, await getHorizonDays(client))) {
    throw invalid('from', 'from debe ser YYYY-MM-DD, desde hoy y como mucho hoy + horizonte');
  }
  if (data.trainer_id) await assertTrainer(client, data.trainer_id);
  const counts = await callChange(client, `SELECT change_class($1, $2, $3) AS r`, [id, from, data]);
  return { class: await getClass(client, id), ...counts };
}

// Retirar: la clase acaba el día anterior a `date` (por defecto hoy) y se cancelan sus sesiones desde esa fecha.
// Por slot, como el cambio de clase y la generación: una sesión ajustada a otro día sigue el día que le tocaba.
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
        AND slot >= $2::date::timestamp AT TIME ZONE 'Europe/Madrid'
      RETURNING id`,
    [id, c.d]
  );
  // Cancelar una sesión anula sus reservas y esperas con aviso (CONTEXT).
  await client.query(`SELECT cancel_session_bookings(id) FROM unnest($1::uuid[]) id`, [rows.map((r) => r.id)]);
  await audit(client, actorId, 'class.retire', id, { from: c.d, cancelled_sessions: rowCount });
  return { ...(await getClass(client, id)), cancelled_sessions: rowCount };
}
