// src/services/catalog.js
import crypto from 'node:crypto';
import { httpError } from '../lib/errors.js';

const ID_RE = /^\d{1,18}$/;
const BILLING_PERIODS = ['monthly'];
const isBool = (v) => typeof v === 'boolean';
const isName = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100;

const PLAN_SELECT = `
  SELECT p.id, p.name, p.price_cents, p.billing_period, p.max_disciplines, p.minors_only, p.is_active,
         ARRAY(SELECT discipline_id::text FROM plan_disciplines WHERE plan_id = p.id ORDER BY plan_disciplines.discipline_id)
           AS eligible_discipline_ids
    FROM plans p`;

export function parseId(raw) {
  if (!ID_RE.test(String(raw))) throw httpError(400, 'invalid_id', 'id inválido');
  return String(raw);
}

export function invalid(field, message) {
  return httpError(400, 'invalid_field', message, { field });
}

// Valida solo los campos presentes; `partial` = PATCH.
export function validate(body, spec, partial) {
  const out = {};
  for (const [field, [check, message, required]] of Object.entries(spec)) {
    if (body[field] === undefined) {
      if (!partial && required) throw invalid(field, message);
      continue;
    }
    if (!check(body[field])) throw invalid(field, message);
    out[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
  }
  if (partial && Object.keys(out).length === 0) throw httpError(400, 'empty_patch', 'Nada que actualizar');
  return out;
}

const DISCIPLINE_SPEC = {
  name: [isName, 'name requerido (≤100)', true],
  minors_only: [isBool, 'minors_only debe ser booleano'],
  is_active: [isBool, 'is_active debe ser booleano'],
};
const PLAN_SPEC = {
  name: [isName, 'name requerido (≤100)', true],
  price_cents: [(v) => Number.isInteger(v) && v >= 0 && v <= 2_147_483_647, 'price_cents entero ≥ 0', true],
  max_disciplines: [(v) => v === null || (Number.isInteger(v) && v >= 1), 'max_disciplines entero ≥ 1 o null (todas)', true],
  billing_period: [(v) => BILLING_PERIODS.includes(v), `billing_period debe ser uno de: ${BILLING_PERIODS.join(', ')}`],
  minors_only: [isBool, 'minors_only debe ser booleano'],
  is_active: [isBool, 'is_active debe ser booleano'],
};

// 23505 (unique) → 409; el resto se propaga.
async function guardUnique(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'name_taken', 'Ya existe un registro con ese nombre');
    throw err;
  }
}

export function insertSql(table, data) {
  const cols = Object.keys(data);
  return [
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(data),
  ];
}

export function updateSql(table, id, data) {
  const cols = Object.keys(data);
  return [
    `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
    [id, ...Object.values(data)],
  ];
}

// --- Disciplinas ---

export async function listDisciplines(client) {
  const { rows } = await client.query(
    `SELECT id, name, minors_only, is_active FROM disciplines ORDER BY name`
  );
  return rows;
}

async function getDiscipline(client, id) {
  const { rows: [d] } = await client.query(
    `SELECT id, name, minors_only, is_active FROM disciplines WHERE id = $1`, [id]
  );
  if (!d) throw httpError(404, 'discipline_not_found', 'Disciplina no encontrada');
  return d;
}

export async function createDiscipline(client, body) {
  const data = validate(body, DISCIPLINE_SPEC, false);
  const [sql, params] = insertSql('disciplines', data);
  const { rows: [{ id }] } = await guardUnique(() => client.query(sql, params));
  return getDiscipline(client, id);
}

export async function updateDiscipline(client, { id, body, actorId }) {
  const data = validate(body, DISCIPLINE_SPEC, true);
  const [sql, params] = updateSql('disciplines', id, data);
  const { rowCount } = await guardUnique(() => client.query(sql, params));
  if (!rowCount) throw httpError(404, 'discipline_not_found', 'Disciplina no encontrada');
  await audit(client, actorId, 'discipline.update', id, data);
  return getDiscipline(client, id);
}

// --- Planes ---

export async function listPlans(client) {
  const { rows } = await client.query(`${PLAN_SELECT} ORDER BY p.price_cents, p.name`);
  return rows;
}

async function getPlan(client, id, { lock = false } = {}) {
  const { rows: [p] } = await client.query(`${PLAN_SELECT} WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`, [id]);
  if (!p) throw httpError(404, 'plan_not_found', 'Plan no encontrado');
  return p;
}

export async function createPlan(client, body) {
  const data = validate(body, PLAN_SPEC, false);
  const [sql, params] = insertSql('plans', data);
  const { rows: [{ id }] } = await guardUnique(() => client.query(sql, params));
  return getPlan(client, id);
}

export async function updatePlan(client, { id, body, actorId }) {
  const data = validate(body, PLAN_SPEC, true);
  const before = await getPlan(client, id, { lock: true });

  const structural = ['max_disciplines', 'minors_only'].filter(
    (f) => f in data && data[f] !== before[f]
  );
  if (structural.length) {
    const { rowCount } = await client.query(`SELECT 1 FROM subscriptions WHERE plan_id = $1 LIMIT 1`, [id]);
    if (rowCount) {
      throw httpError(409, 'plan_has_subscriptions', 'El plan tiene suscripciones: crea otro plan', { fields: structural });
    }
  }
  checkEligible({ ...before, ...data }, before.eligible_discipline_ids);

  const [sql, params] = updateSql('plans', id, data);
  await guardUnique(() => client.query(sql, params));
  if ('price_cents' in data && data.price_cents !== before.price_cents) {
    await audit(client, actorId, 'plan.price_change', id, { from: before.price_cents, to: data.price_cents });
  }
  if ('is_active' in data && data.is_active !== before.is_active) {
    await audit(client, actorId, data.is_active ? 'plan.activate' : 'plan.retire', id, {});
  }
  return getPlan(client, id);
}

// Reglas de la lista elegible (vacía = cualquier disciplina permitida por edad: siempre válida).
function checkEligible(plan, ids) {
  if (ids.length === 0) return;
  if (plan.max_disciplines !== null && ids.length < plan.max_disciplines) {
    throw httpError(409, 'eligible_too_few', 'Menos elegibles que disciplinas a elegir', {
      max_disciplines: plan.max_disciplines, eligible: ids.length,
    });
  }
}

export async function setEligibleDisciplines(client, { planId, ids, actorId }) {
  if (!Array.isArray(ids)) throw invalid('discipline_ids', 'discipline_ids debe ser un array');
  const unique = [...new Set(ids.map(parseId))];
  const plan = await getPlan(client, planId, { lock: true });

  const { rows } = await client.query(`SELECT id FROM disciplines WHERE id = ANY($1::bigint[])`, [unique]);
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    throw httpError(400, 'unknown_discipline', 'Disciplina inexistente', { ids: unique.filter((i) => !found.has(i)) });
  }
  checkEligible(plan, unique);

  await client.query(`DELETE FROM plan_disciplines WHERE plan_id = $1`, [planId]);
  if (unique.length) {
    await client.query(
      `INSERT INTO plan_disciplines (plan_id, discipline_id)
       SELECT $1, unnest($2::bigint[])`, [planId, unique]
    );
  }
  await audit(client, actorId, 'plan.set_eligible', planId, { discipline_ids: unique });
  return (await getPlan(client, planId)).eligible_discipline_ids;
}

export async function getEligibleDisciplines(client, planId) {
  return (await getPlan(client, planId)).eligible_discipline_ids;
}

export function audit(client, actorId, action, resourceId, changes) {
  const type = action.split('.')[0];
  return client.query(
    `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), actorId, action, type, resourceId, changes]
  );
}
