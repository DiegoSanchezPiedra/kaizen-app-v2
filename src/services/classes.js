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

  // FOR SHARE: desactivar la disciplina a la vez espera a esta clase (y la retira) o esta ve la disciplina inactiva.
  const { rows: [disc] } = await client.query(`SELECT is_active FROM disciplines WHERE id = $1 FOR SHARE`, [data.discipline_id]);
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

// Retirar (CONTEXT): la clase acaba el día anterior a `date` (por defecto hoy, nunca pasado ni más allá del horizonte)
// y retire_class (022) cancela, con aviso, sus sesiones con slot desde esa fecha que no han empezado.
export async function retireClass(client, { id, date }) {
  if (date !== undefined) {
    const t = today();
    if (!isDate(date) || date < t || date > addDays(t, await getHorizonDays(client))) {
      throw invalid('date', 'date debe ser YYYY-MM-DD, desde hoy y como mucho hoy + horizonte');
    }
  }
  const { cancelled_sessions } = await callChange(client, `SELECT retire_class($1, $2) AS r`, [id, date ?? null]);
  return { ...(await getClass(client, id)), cancelled_sessions };
}
