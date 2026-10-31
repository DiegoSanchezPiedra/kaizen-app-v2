// src/services/catalog.js
import crypto from 'node:crypto';
import { stripe, STRIPE_STATEMENT_DESCRIPTOR } from '../config/stripe.js';
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
  is_open: [isBool, 'is_open debe ser booleano'],
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
    `SELECT id, name, minors_only, is_active, is_open FROM disciplines ORDER BY name`
  );
  return rows;
}

async function getDiscipline(client, id, { lock = false } = {}) {
  const { rows: [d] } = await client.query(
    `SELECT id, name, minors_only, is_active, is_open FROM disciplines WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]
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

// Disciplina abierta (B14): no se elige, así que no se marca con elegidas vigentes (también en una bajada
// programada); al desmarcarla, quien tenía reservas futuras en ella y ya no la cubre las pierde.
export async function updateDiscipline(client, { id, body, actorId }) {
  const data = validate(body, DISCIPLINE_SPEC, true);
  const before = await getDiscipline(client, id, { lock: true });
  if (data.is_open && !before.is_open) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM subscriptions s
        WHERE s.status = ANY($2)
          AND (EXISTS (SELECT 1 FROM subscription_disciplines sd WHERE sd.subscription_id = s.id AND sd.discipline_id = $1)
               OR $1 = ANY(s.scheduled_discipline_ids))
        LIMIT 1`, [id, LIVE]);
    if (rowCount) throw httpError(409, 'discipline_in_use', 'Hay suscripciones que tienen elegida esta disciplina');
  }
  const [sql, params] = updateSql('disciplines', id, data);
  await guardUnique(() => client.query(sql, params));
  if (before.is_open && data.is_open === false) {
    await client.query(`SELECT revoke_open_discipline($1)`, [id]);
  }
  await audit(client, actorId, 'discipline.update', id, data);
  if (before.is_active && data.is_active === false) {
    return { ...(await getDiscipline(client, id)), ...(await retireDiscipline(client, id)) };
  }
  return getDiscipline(client, id);
}

// Desactivar una disciplina (CONTEXT, B6.1): retira hoy sus clases (la que aún no ha empezado, antes de empezar) y
// cancela sus sueltas que no han empezado, en orden de id (disciplina → clase → sesiones; la disciplina ya bloqueada).
async function retireDiscipline(client, id) {
  const { rows: classes } = await client.query(
    `SELECT id, to_char(d, 'YYYY-MM-DD') AS d
       FROM (SELECT id, ends_on, greatest((now() AT TIME ZONE 'Europe/Madrid')::date, starts_on) AS d
               FROM classes WHERE discipline_id = $1) c
      WHERE ends_on IS NULL OR ends_on >= d
      ORDER BY id`, [id]);
  // shortcut: sin callChange (services/sessions.js importa este módulo: sería un ciclo), una clase retirada o una suelta
  // cancelada por otra transacción entre la lista y la llamada da 500 y nada se aplica; usar callChange si se rompe el ciclo.
  let cancelled = 0;
  for (const c of classes) {
    cancelled += (await client.query(`SELECT retire_class($1, $2) AS r`, [c.id, c.d])).rows[0].r.cancelled_sessions;
  }
  const { rows: loose } = await client.query(
    `SELECT id FROM class_sessions
      WHERE discipline_id = $1 AND class_id IS NULL AND status = 'scheduled' AND starts_at > now()
      ORDER BY id`, [id]);
  for (const s of loose) await client.query(`SELECT cancel_session($1, NULL)`, [s.id]);
  return { retired_classes: classes.length, cancelled_sessions: cancelled + loose.length };
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
  const plan = await getPlan(client, id);
  await syncPlanToStripe(client, plan, null);
  return plan;
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
  const plan = await getPlan(client, id);
  await syncPlanToStripe(client, plan, before);
  return plan;
}

// --- Plan → Stripe (B10). El plan es la fuente de verdad; Stripe va dentro de la transacción:
// si falla, el cambio local se deshace. Un Product por plan y un Price por cada precio que ha tenido.
// Sin default_price: Stripe no deja archivar el Price por defecto de un Product.

const LIVE = ['active', 'past_due', 'unpaid'];

function createPrice(product, plan) {
  return stripe.prices.create({
    product, currency: 'eur', unit_amount: plan.price_cents, recurring: { interval: 'month' },
    tax_behavior: 'inclusive', active: plan.is_active, // precio final, IVA incluido; sin Stripe Tax
  });
}

// before = null al crear. Plan a 0 €: sin Price (no se contrata por la pasarela).
export async function syncPlanToStripe(client, plan, before) {
  const { rows: [{ stripe_price_id: oldPrice }] } = await client.query(
    `SELECT stripe_price_id FROM plans WHERE id = $1`, [plan.id]);
  let newPrice = oldPrice;

  if (!oldPrice) {
    if (plan.price_cents === 0) return;
    const product = await stripe.products.create({
      name: plan.name, metadata: { plan_id: plan.id }, statement_descriptor: STRIPE_STATEMENT_DESCRIPTOR,
    });
    newPrice = (await createPrice(product.id, plan)).id;
  } else {
    const { product } = await stripe.prices.retrieve(oldPrice);
    if (plan.name !== before.name) await stripe.products.update(product, { name: plan.name });
    if (plan.price_cents !== before.price_cents) {
      // Suscriptores y bajadas programadas a este plan (B10.5): las dos cuentan como suscriptores.
      const { rows: subs } = await client.query(
        `SELECT stripe_subscription_id FROM subscriptions
          WHERE (plan_id = $1 OR scheduled_plan_id = $1) AND status = ANY($2)`, [plan.id, LIVE]);
      if (plan.price_cents === 0 && subs.length) {
        throw httpError(409, 'plan_has_subscriptions', 'Un plan con suscriptores no puede pasar a 0 €');
      }
      newPrice = plan.price_cents === 0 ? null : (await createPrice(product, plan)).id;
      // Cambio de precio: desde la siguiente renovación de cada suscriptor, sin prorrateo.
      // shortcut: secuencial dentro de la petición; con cientos de suscriptores, pasarlo a un job.
      for (const { stripe_subscription_id: subId } of subs) {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (sub.schedule) {
          await swapSchedulePrice(sub.schedule, oldPrice, newPrice);
        } else if (sub.items.data[0].price.id === oldPrice) {
          await stripe.subscriptions.update(subId, {
            items: [{ id: sub.items.data[0].id, price: newPrice }], proration_behavior: 'none',
          });
        }
      }
      await stripe.prices.update(oldPrice, { active: false });
    } else if (plan.is_active !== before.is_active) {
      await stripe.prices.update(oldPrice, { active: plan.is_active });
    }
  }
  if (newPrice !== oldPrice) {
    await client.query(`UPDATE plans SET stripe_price_id = $2 WHERE id = $1`, [plan.id, newPrice]);
  }
}

// Con un Schedule adjunto (bajada programada) el Price se cambia en sus fases: cambiarlo en la suscripción
// partiría la fase actual y dejaría la pendiente con el Price viejo. Las fases pasadas se omiten.
async function swapSchedulePrice(scheduleId, oldPrice, newPrice) {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const now = Math.floor(Date.now() / 1000);
  const swap = (price) => (price === oldPrice ? newPrice : price);
  await stripe.subscriptionSchedules.update(scheduleId, {
    proration_behavior: 'none',
    phases: schedule.phases.filter((p) => p.end_date > now).map((p) => ({
      items: p.items.map((i) => ({ price: swap(typeof i.price === 'string' ? i.price : i.price.id), quantity: i.quantity })),
      start_date: p.start_date, end_date: p.end_date, metadata: p.metadata, proration_behavior: p.proration_behavior,
    })),
  });
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
