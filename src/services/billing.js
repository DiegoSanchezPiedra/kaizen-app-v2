// src/services/billing.js — contratar (CONTEXT § Suscripción), portal del pagador (B10) y seguro (B10.3).
// La suscripción local no nace aquí: nace en el webhook cuando Stripe confirma el pago.
import { servicePool } from '../config/database.js';
import { stripe, STRIPE_PORTAL_CONFIGURATION_ID, APP_URL } from '../config/stripe.js';
import { httpError } from '../lib/errors.js';
import { parseId, invalid, audit } from './catalog.js';

const LIVE = `('active', 'past_due', 'unpaid')`;
// Estados de Stripe tal cual (CONTEXT § Suscripción); canceled / incomplete_expired → cancelled.
export const STATUS = {
  active: 'active', past_due: 'past_due', unpaid: 'unpaid', incomplete: 'incomplete',
  canceled: 'cancelled', incomplete_expired: 'cancelled',
};
export const ts = (s) => (s ? new Date(s * 1000) : null);
export const idOf = (x) => (typeof x === 'string' ? x : x?.id ?? null);
const CHECKOUT_TTL_S = 30 * 60;
// Etiqueta del flujo en el Dashboard (skill de Stripe: sufijo de 8 letras aleatorias).
const INTEGRATION_ID = 'kaizen-sub-qzmhtrwa';

/** Cliente de Stripe del pagador; lo crea la primera vez. */
async function ensureCustomer(client, payerId) {
  const { rows: [p] } = await client.query(
    `SELECT p.stripe_customer_id, p.display_name, c.email
       FROM profiles p LEFT JOIN auth_credentials c ON c.profile_id = p.id WHERE p.id = $1`, [payerId]);
  if (p.stripe_customer_id) return p.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: p.display_name ?? undefined, email: p.email ?? undefined, metadata: { profile_id: payerId },
  });
  // Fuera de la transacción: si el Checkout falla después, el cliente no se pierde.
  // Dos checkouts a la vez: gana el primero y el otro cliente queda huérfano (inofensivo).
  const { rows: [won] } = await servicePool.query(
    `UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL
     RETURNING stripe_customer_id`, [payerId, customer.id]);
  if (won) return won.stripe_customer_id;
  return (await servicePool.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [payerId])).rows[0]
    .stripe_customer_id;
}

/**
 * Plan y disciplinas de un pedido, con las mismas reglas al contratar y al cambiar de plan (B10.5):
 * plan activo y de pago, edad, solo menores, número y disciplinas elegibles.
 * @returns {{ plan, ids: string[], adult: boolean }}
 */
async function validateOrder(client, { studentId, planId, disciplineIds = [] }) {
  if (!Array.isArray(disciplineIds)) throw invalid('discipline_ids', 'discipline_ids debe ser un array');
  const ids = [...new Set(disciplineIds.map(parseId))];

  const { rows: [plan] } = await client.query(
    `SELECT p.id, p.price_cents, p.max_disciplines, p.minors_only, p.is_active, p.stripe_price_id,
            ARRAY(SELECT discipline_id::text FROM plan_disciplines WHERE plan_id = p.id) AS eligible
       FROM plans p WHERE p.id = $1`, [parseId(planId)]);
  // El suscriptor ve su plan retirado (012), pero no lo puede contratar ni cambiar a él.
  if (!plan?.is_active) throw httpError(404, 'plan_not_found', 'Plan no encontrado');
  if (plan.price_cents === 0 || !plan.stripe_price_id) {
    throw httpError(409, 'plan_not_purchasable', 'Este plan no se contrata por la pasarela');
  }

  const { rows: [{ adult }] } = await client.query(
    `SELECT birth_date IS NULL OR birth_date <= CURRENT_DATE - interval '18 years' AS adult
       FROM profiles WHERE id = $1`, [studentId]);
  if (adult && plan.minors_only) throw httpError(409, 'plan_minors_only', 'Plan solo para menores');

  // «Todas»: no se eligen disciplinas. Si no, exactamente max_disciplines.
  const expected = plan.max_disciplines ?? 0;
  if (ids.length !== expected) {
    throw httpError(400, 'invalid_field', `Elige ${expected} disciplina(s)`, { field: 'discipline_ids', expected });
  }
  if (ids.length) {
    const { rows } = await client.query(
      `SELECT id, minors_only FROM disciplines WHERE id = ANY($1::bigint[]) AND is_active`, [ids]);
    const ok = new Map(rows.map((d) => [d.id, d]));
    const bad = ids.filter((id) => !ok.has(id) || (plan.eligible.length && !plan.eligible.includes(id))
      || (adult && ok.get(id).minors_only));
    if (bad.length) throw httpError(409, 'discipline_not_eligible', 'Disciplina no elegible', { ids: bad });
  }
  return { plan, ids, adult };
}

/**
 * Valida los requisitos de contratar y abre un Checkout de Stripe. Perfil completo y
 * tutor→hijo los comprueba antes requireCompleteProfile.
 * @returns {{ url: string }}
 */
export async function createCheckout(client, { payerId, studentId, planId, disciplineIds = [], insurance = false }) {
  if (typeof insurance !== 'boolean') throw invalid('insurance', 'insurance debe ser booleano');
  const { plan, ids } = await validateOrder(client, { studentId, planId, disciplineIds });

  const { rowCount } = await client.query(
    `SELECT 1 FROM subscriptions WHERE student_id = $1 AND status IN ${LIVE}`, [studentId]);
  if (rowCount) throw httpError(409, 'subscription_exists', 'El alumno ya tiene una suscripción');

  // Elegir la cobertura (CONTEXT § Seguro): seguro o waiver, salvo que ya tenga cobertura de riesgo.
  // El waiver se firma antes (acuerdos); el seguro lo crea el webhook tras el pago (ADR 0006).
  const { rows: [rc] } = await client.query(
    `SELECT has_risk_cover($1) AS covered,
            EXISTS (SELECT 1 FROM insurances WHERE student_id = $1 AND status IN ${LIVE}) AS insured`, [studentId]);
  if (insurance) {
    if ((await insuranceSettings(client)).insurance_enabled !== true) {
      throw httpError(409, 'insurance_disabled', 'La academia no ofrece el seguro');
    }
    if (rc.insured) throw httpError(409, 'insurance_exists', 'El alumno ya tiene un seguro');
  } else if (!rc.covered) {
    throw httpError(409, 'risk_cover_required', 'Elige el seguro o firma el waiver antes de pagar');
  }

  const customer = await ensureCustomer(client, payerId);
  // Contenido del pedido; el webhook resuelve pagador y suscripción por el grafo de Stripe, no por aquí.
  const metadata = {
    student_id: studentId, payer_id: payerId, plan_id: plan.id, discipline_ids: ids.join(','),
    ...(insurance && { insurance: 'true' }),
  };
  // Sin payment_method_types (skill de Stripe): «solo tarjeta» se configura en el Dashboard.
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    client_reference_id: studentId,
    metadata,
    subscription_data: { metadata },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    success_url: `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/billing/cancel`,
    integration_identifier: INTEGRATION_ID,
  });
  return { url: session.url };
}

/** Portal de Stripe del pagador: cambiar tarjeta y ver recibos. */
export async function createPortalSession(client, payerId) {
  if (!STRIPE_PORTAL_CONFIGURATION_ID) {
    throw httpError(503, 'portal_not_configured', 'Falta STRIPE_PORTAL_CONFIGURATION_ID');
  }
  const { rows: [p] } = await client.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [payerId]);
  if (!p?.stripe_customer_id) throw httpError(404, 'no_billing_account', 'Aún no has contratado nada');
  const session = await stripe.billingPortal.sessions.create({
    customer: p.stripe_customer_id, configuration: STRIPE_PORTAL_CONFIGURATION_ID, return_url: `${APP_URL}/billing`,
  });
  return { url: session.url };
}

/**
 * Baja de una suscripción (CONTEXT § Baja: solo el admin). Se pide a Stripe; el estado local
 * lo actualiza el webhook (customer.subscription.updated / deleted), como todo lo de billing.
 * No toca el seguro (B10.3).
 */
export async function cancelSubscription(client, { id, atPeriodEnd, actorId }) {
  const { rows: [s] } = await client.query(
    `SELECT stripe_subscription_id, status, student_id, payer_id FROM subscriptions WHERE id = $1`, [id]);
  if (!s) throw httpError(404, 'subscription_not_found', 'Suscripción no encontrada');
  // Stripe manda: entre la baja y su webhook la fila local aún no dice cancelled.
  const current = s.status === 'cancelled'
    ? null : await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (!current || current.status === 'canceled') {
    throw httpError(409, 'subscription_cancelled', 'La suscripción ya está cancelada');
  }
  await audit(client, actorId, atPeriodEnd ? 'subscription.cancel_at_period_end' : 'subscription.cancel_now', id, {});
  // Con un Schedule adjunto Stripe no deja tocar la cancelación (B10.5): se libera y la bajada programada se descarta.
  if (current.schedule) {
    const pending = pendingPhase(current.schedule);
    await stripe.subscriptionSchedules.release(current.schedule.id);
    if (pending) {
      await notice(client, {
        action: 'notice.scheduled_change_discarded', actorId, type: 'subscription', resourceId: id,
        recipients: [s.payer_id], student_id: s.student_id, plan_id: pending.metadata.plan_id,
      });
    }
  }
  const sub = atPeriodEnd
    ? await stripe.subscriptions.update(s.stripe_subscription_id, { cancel_at_period_end: true })
    : await stripe.subscriptions.cancel(s.stripe_subscription_id);
  return { id, stripe_status: sub.status, cancel_at_period_end: sub.cancel_at_period_end };
}

// Aviso pendiente de envío (B15), como booking_notice (009).
export async function notice(db, { action, actorId, type, resourceId, recipients, ...extra }) {
  await db.query(
    `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [actorId, action, type, resourceId, { ...extra, recipients }]);
}

// --- Cambio de plan y de disciplina (B10.5; CONTEXT § Suscripción; ADR 0007) ---
// Subida = pending update (solo se aplica si se paga); bajada = Subscription Schedule de 2 fases.
// plan_id y disciplinas nuevos viajan en la metadata y los aplica el webhook, como todo el estado de cobro.

/** Fase pendiente de un Schedule (la bajada programada), o null. Un Schedule puede seguir adjunto ya aplicado. */
export function pendingPhase(schedule) {
  if (!schedule || !['active', 'not_started'].includes(schedule.status)) return null;
  const current = schedule.current_phase?.start_date ?? 0;
  return schedule.phases.find((p) => p.start_date > current) ?? null;
}

async function subscriptionFor(client, id) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.student_id, s.payer_id, s.plan_id, s.status, s.cancel_at_period_end, s.stripe_subscription_id,
            pl.price_cents, pl.minors_only, pl.max_disciplines
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`, [id]);
  if (!s) throw httpError(404, 'subscription_not_found', 'Suscripción no encontrada');
  return s;
}

const onlyPayer = (s, actorId, isAdmin) => {
  if (!isAdmin && s.payer_id !== actorId) {
    throw httpError(403, 'not_payer', 'Solo el pagador o el admin cambian de plan');
  }
};

/**
 * Subir o bajar de plan (pagador actual o admin). Más caro = subida inmediata con prorrateo; igual o más
 * barato = bajada en la siguiente facturación. Un adulto en un plan solo menores cambia ya, suba o baje.
 * @returns {{ status: 200 | 202, body }}
 */
export async function changePlan(client, { id, actorId, isAdmin, planId, disciplineIds }) {
  const s = await subscriptionFor(client, id);
  onlyPayer(s, actorId, isAdmin);
  if (s.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
  if (s.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');
  if (parseId(planId) === s.plan_id) throw httpError(409, 'same_plan', 'Ya está en ese plan');
  const { plan, ids, adult } = await validateOrder(client, { studentId: s.student_id, planId, disciplineIds });
  if (!plan.stripe_price_id) throw httpError(409, 'plan_not_purchasable', 'Este plan no se contrata por la pasarela');

  // Stripe manda: la fila local puede ir por detrás de una baja recién pedida.
  const current = await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (current.status !== 'active') throw httpError(409, 'subscription_not_active', 'La suscripción no está activa');
  if (current.cancel_at_period_end) throw httpError(409, 'cancel_scheduled', 'La suscripción tiene la baja programada');

  const metadata = { plan_id: plan.id, discipline_ids: ids.join(',') };
  const now = plan.price_cents > s.price_cents || (adult && s.minors_only);
  await audit(client, actorId, now ? 'subscription.upgrade' : 'subscription.downgrade', id,
    { from: s.plan_id, to: plan.id, discipline_ids: ids });
  return now
    ? applyPlanNow(s, current, plan, metadata, isAdmin)
    : scheduleDowngrade(current, plan, metadata);
}

// Pending update: Stripe cobra el prorrateo y solo aplica price y metadata si se paga.
async function applyPlanNow(s, current, plan, metadata, isAdmin) {
  // Una subida anula la bajada programada (CONTEXT § Bajar de plan).
  if (current.schedule) await stripe.subscriptionSchedules.release(current.schedule.id);
  const sub = await stripe.subscriptions.update(current.id, {
    items: [{ id: current.items.data[0].id, price: plan.stripe_price_id }],
    payment_behavior: 'pending_if_incomplete', proration_behavior: 'always_invoice', metadata,
  });
  if (!sub.pending_update) return { status: 200, body: { change: 'upgrade', status: 'applied' } };

  const inv = await stripe.invoices.retrieve(idOf(sub.latest_invoice),
    { expand: ['confirmation_secret', 'payments.data.payment.payment_intent'] });
  const pi = inv.payments?.data?.[0]?.payment.payment_intent;
  if (pi?.status === 'requires_action') {
    if (!isAdmin) {
      return { status: 200, body: { change: 'upgrade', status: 'requires_action', client_secret: inv.confirmation_secret.client_secret } };
    }
    // El admin no paga: el pending update sigue vivo (caduca en 23 h) y el pagador lo completa en el recibo.
    // servicePool: el aviso sobrevive al rollback del 409.
    await notice(servicePool, {
      action: 'notice.upgrade_requires_action', actorId: s.payer_id, type: 'subscription', resourceId: s.id,
      recipients: [s.payer_id], student_id: s.student_id, plan_id: plan.id, hosted_invoice_url: inv.hosted_invoice_url,
    });
    throw httpError(409, 'requires_payer_action', 'El banco pide autenticación al pagador; se le ha avisado');
  }
  // Rechazada: anular el recibo descarta el pending update; el plan no cambia.
  await stripe.invoices.voidInvoice(inv.id);
  throw httpError(402, 'payment_failed', 'El cobro de la subida ha sido rechazado',
    { decline_message: pi?.last_payment_error?.message ?? null });
}

// Schedule: fase 1 = la actual tal cual; fase 2 = el plan nuevo desde el fin de periodo. Como mucho una
// programada: si ya hay Schedule, se sustituye su fase 2.
async function scheduleDowngrade(current, plan, metadata) {
  // Una subida pendiente de pago (3DS a medias) bloquea el Schedule: la bajada la sustituye.
  if (current.pending_update) await stripe.invoices.voidInvoice(idOf(current.latest_invoice));
  const schedule = current.schedule ?? await stripe.subscriptionSchedules.create({ from_subscription: current.id });
  const phase = schedule.phases.find((p) => p.start_date === schedule.current_phase?.start_date) ?? schedule.phases[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        items: phase.items.map((i) => ({ price: idOf(i.price), quantity: i.quantity })),
        start_date: phase.start_date, end_date: phase.end_date, metadata: current.metadata, proration_behavior: 'none',
      },
      {
        items: [{ price: plan.stripe_price_id, quantity: 1 }], duration: { interval: 'month', interval_count: 1 },
        metadata, proration_behavior: 'none',
      },
    ],
  });
  return { status: 202, body: { change: 'downgrade', scheduled_at: ts(phase.end_date) } };
}

/** Anular la bajada programada (pagador o admin): se libera el Schedule y la suscripción sigue igual. */
export async function cancelScheduledChange(client, { id, actorId, isAdmin }) {
  const s = await subscriptionFor(client, id);
  onlyPayer(s, actorId, isAdmin);
  const current = await stripe.subscriptions.retrieve(s.stripe_subscription_id, { expand: ['schedule'] });
  if (!pendingPhase(current.schedule)) throw httpError(404, 'no_scheduled_change', 'No hay ninguna bajada programada');
  await audit(client, actorId, 'subscription.downgrade_cancel', id, {});
  await stripe.subscriptionSchedules.release(current.schedule.id);
}

const DISCIPLINE_ERRORS = {
  subscription_not_found: [404, 'Suscripción no encontrada'],
  subscription_not_in_force: [409, 'La suscripción no está en vigor'],
  plan_all_disciplines: [409, 'El plan cubre todas las disciplinas: no hay nada que cambiar'],
  discipline_not_chosen: [409, 'Esa disciplina no está entre las elegidas'],
  discipline_not_eligible: [409, 'Disciplina no elegible'],
  discipline_change_limit: [409, 'Ya no quedan cambios de disciplina en este periodo'],
};

/**
 * Cambio de disciplina (ADR 0007: lo escribe Kaizen, no el webhook). Pueden el pagador, el admin, el alumno
 * adulto y cualquier tutor vinculado. Las reglas viven en change_discipline (014); aquí, quién actúa.
 * @returns {{ disciplines: string[], changes_left: number, free: boolean }}
 */
export async function changeDiscipline(client, { id, actorId, isAdmin, fromId, toId }) {
  const field = (v, f) => {
    if (!/^\d{1,18}$/.test(String(v))) throw invalid(f, `${f} debe ser un id`);
    return String(v);
  };
  const from = field(fromId, 'from_id');
  const to = field(toId, 'to_id');
  const s = await subscriptionFor(client, id);
  const { rows: [who] } = await client.query(
    `SELECT is_guardian_of(p.id) AS guardian, p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years' AS adult
       FROM profiles p WHERE p.id = $1`, [s.student_id]);
  if (!(isAdmin || s.payer_id === actorId || (s.student_id === actorId && who.adult) || who.guardian)) {
    throw httpError(403, 'not_allowed', 'No puedes cambiar las disciplinas de este alumno');
  }

  // change_discipline es interna (servicePool), como startInsurance.
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    // Actor de los avisos de reserva (booking_notice lee app.current_user_id).
    await db.query(`SELECT set_config('app.current_user_id', $1, true)`, [actorId]);
    const { rows: [{ r }] } = await db.query(`SELECT change_discipline($1, $2, $3, $4) AS r`, [id, from, to, actorId]);
    const { rows } = await db.query(
      `SELECT discipline_id FROM subscription_disciplines WHERE subscription_id = $1 ORDER BY discipline_id`, [id]);
    const disciplines = rows.map((d) => d.discipline_id);
    // Espejo en Stripe: el webhook solo aplica disciplinas cuando cambia metadata.plan_id, así que no las pisa.
    await stripe.subscriptions.update(s.stripe_subscription_id, { metadata: { discipline_ids: disciplines.join(',') } });
    const { rows: [{ left }] } = await db.query(
      `SELECT GREATEST(discipline_change_limit() - discipline_changes_used($1), 0) AS left`, [id]);
    await db.query('COMMIT');
    return { disciplines, changes_left: left, free: r.free };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    const known = err.code === 'P0001' && DISCIPLINE_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1], err.detail ? JSON.parse(err.detail) : undefined);
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Suscripción del alumno (la viva o, si no hay, la última), con la bajada programada y los cambios de
 * disciplina que le quedan en el periodo. La RLS decide quién la ve.
 */
export async function getSubscription(client, { studentId }) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.status,
            jsonb_build_object('id', pl.id::text, 'name', pl.name, 'price_cents', pl.price_cents,
                               'max_disciplines', pl.max_disciplines) AS plan,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id::text, 'name', d.name) ORDER BY d.name)
                        FROM subscription_disciplines sd JOIN disciplines d ON d.id = sd.discipline_id
                       WHERE sd.subscription_id = s.id), '[]') AS disciplines,
            s.current_period_end, s.cancel_at_period_end,
            CASE WHEN s.scheduled_plan_id IS NOT NULL THEN jsonb_build_object(
              'plan_id', s.scheduled_plan_id::text, 'plan_name', sp.name,
              'discipline_ids', to_jsonb(s.scheduled_discipline_ids::text[]), 'scheduled_at', s.scheduled_at) END
              AS scheduled_change,
            CASE WHEN pl.max_disciplines IS NOT NULL
                 THEN GREATEST(discipline_change_limit() - discipline_changes_used(s.id), 0) END AS discipline_changes_left
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id LEFT JOIN plans sp ON sp.id = s.scheduled_plan_id
      WHERE s.student_id = $1 ORDER BY s.status IN ${LIVE} DESC, s.created_at DESC LIMIT 1`, [studentId]);
  if (!s) throw httpError(404, 'subscription_not_found', 'El alumno no tiene suscripción');
  return s;
}

/** Cambios de disciplina por periodo (solo admin). Admite 0: sin cambios, salvo los gratis. */
export async function updateDisciplineChangeSettings(client, body, actorId) {
  const n = body.per_period;
  if (!(Number.isInteger(n) && n >= 0 && n <= 1000)) throw invalid('per_period', 'per_period debe ser un entero ≥ 0');
  await setSetting(client, 'discipline_changes_per_period', n);
  await audit(client, actorId, 'settings.discipline_changes', 'discipline_changes_per_period', { per_period: n });
  return { per_period: n };
}

// --- Seguro (B10.3; CONTEXT § Seguro y cobertura de riesgo; ADR 0006) ---
// 2.ª suscripción anual de Stripe del mismo cliente (metadata.kind = 'insurance'). Parámetros en academy_settings.

const INSURANCE_KEYS = [
  'insurance_enabled', 'insurance_price_adult_cents', 'insurance_price_minor_cents',
  'insurance_stripe_price_adult', 'insurance_stripe_price_minor', 'insurance_stripe_product',
];

/** Parámetros del seguro tal cual, por clave de academy_settings. */
export async function insuranceSettings(db) {
  const { rows } = await db.query(`SELECT key, value FROM academy_settings WHERE key = ANY($1)`, [INSURANCE_KEYS]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const setSetting = (client, key, value) => client.query(
  `INSERT INTO academy_settings (key, value) VALUES ($1, $2::jsonb)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);

/**
 * Precios (adulto / menor, > 0 €) y activación del seguro (solo admin). Cada precio nuevo es un Price anual
 * nuevo y el anterior se archiva; los seguros vivos no cambian aquí: el aviso de renovación fija su precio.
 * Desactivar: los seguros vivos terminan al final de su año, con aviso a su pagador.
 */
export async function updateInsuranceSettings(client, body, actorId) {
  for (const f of ['price_adult_cents', 'price_minor_cents']) {
    if (body[f] !== undefined && !(Number.isInteger(body[f]) && body[f] > 0 && body[f] <= 10_000_000)) {
      throw invalid(f, `${f} debe ser un entero mayor que 0 (céntimos)`);
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw invalid('enabled', 'enabled debe ser booleano');
  const s = await insuranceSettings(client);

  for (const bracket of ['adult', 'minor']) {
    const cents = body[`price_${bracket}_cents`];
    const before = s[`insurance_price_${bracket}_cents`] ?? null;
    if (cents === undefined || cents === before) continue;
    if (!s.insurance_stripe_product) {
      s.insurance_stripe_product = (await stripe.products.create({ name: 'Seguro', metadata: { kind: 'insurance' } })).id;
      await setSetting(client, 'insurance_stripe_product', s.insurance_stripe_product);
    }
    const price = await stripe.prices.create({
      product: s.insurance_stripe_product, currency: 'eur', unit_amount: cents, recurring: { interval: 'year' },
      tax_behavior: 'inclusive', metadata: { bracket },
    });
    const old = s[`insurance_stripe_price_${bracket}`];
    if (old) await stripe.prices.update(old, { active: false });
    s[`insurance_stripe_price_${bracket}`] = price.id;
    await setSetting(client, `insurance_price_${bracket}_cents`, cents);
    await setSetting(client, `insurance_stripe_price_${bracket}`, price.id);
    await audit(client, actorId, 'insurance.price_change', bracket, { from: before, to: cents });
  }

  if (body.enabled !== undefined && body.enabled !== (s.insurance_enabled === true)) {
    if (body.enabled && !(s.insurance_stripe_price_adult && s.insurance_stripe_price_minor)) {
      throw httpError(409, 'insurance_prices_missing', 'Pon los dos precios antes de activar el seguro');
    }
    await setSetting(client, 'insurance_enabled', body.enabled);
    await audit(client, actorId, body.enabled ? 'insurance.enable' : 'insurance.disable', 'settings', {});
    if (!body.enabled) {
      const { rows } = await client.query(
        `SELECT id, student_id, payer_id, stripe_subscription_id FROM insurances
          WHERE status IN ${LIVE} AND NOT cancel_at_period_end`);
      // shortcut: secuencial dentro de la petición, como el cambio de precio de un plan; con cientos de seguros, a un job.
      for (const i of rows) await insuranceWontRenew(client, i, 'disabled');
    }
  }
  const r = await insuranceSettings(client);
  return {
    enabled: r.insurance_enabled === true,
    price_adult_cents: r.insurance_price_adult_cents ?? null,
    price_minor_cents: r.insurance_price_minor_cents ?? null,
  };
}

/** El seguro termina al final de su año sin renovarse; aviso al pagador (y al actual, si es otro). */
export async function insuranceWontRenew(db, ins, reason, recipients = [ins.payer_id]) {
  // Repetido (eventos duplicados o desordenados): Stripe ya lo tiene, no se avisa otra vez.
  if ((await stripe.subscriptions.retrieve(ins.stripe_subscription_id)).cancel_at_period_end) return;
  await stripe.subscriptions.update(ins.stripe_subscription_id, { cancel_at_period_end: true });
  await notice(db, {
    action: 'notice.insurance_wont_renew', actorId: ins.payer_id, type: 'insurance', resourceId: ins.id,
    recipients, student_id: ins.student_id, reason,
  });
}

/** Fila local del seguro desde la suscripción de Stripe. La escriben startInsurance y el webhook: upsert. */
export async function upsertInsurance(db, sub) {
  const status = STATUS[sub.status];
  if (!status) throw new Error(`estado de Stripe sin mapear: ${sub.status} (${sub.id})`);
  const item = sub.items.data[0];
  const { rows: [row] } = await db.query(
    `INSERT INTO insurances (student_id, payer_id, status, bracket, stripe_subscription_id,
                             current_period_start, current_period_end, cancel_at_period_end, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       status = EXCLUDED.status, bracket = EXCLUDED.bracket, current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       cancelled_at = EXCLUDED.cancelled_at
     RETURNING id, student_id, payer_id`,
    [sub.metadata.student_id, sub.metadata.payer_id, status, item.price.metadata.bracket, sub.id,
      ts(item.current_period_start), ts(item.current_period_end), sub.cancel_at_period_end, ts(sub.ended_at)]);
  return row;
}

// Estado del primer cobro de un seguro incomplete. requires_action → el pagador hace el 3DS con
// stripe.handleNextAction({ clientSecret }) en el cliente.
async function firstPayment(sub) {
  if (sub.status !== 'incomplete') return { status: STATUS[sub.status] };
  const inv = await stripe.invoices.retrieve(idOf(sub.latest_invoice),
    { expand: ['confirmation_secret', 'payments.data.payment.payment_intent'] });
  const pi = inv.payments?.data?.[0]?.payment.payment_intent;
  return {
    status: 'incomplete', payment_status: pi?.status ?? null,
    client_secret: pi?.status === 'requires_action' ? inv.confirmation_secret?.client_secret ?? null : null,
  };
}

/**
 * Crea el seguro en Stripe y cobra su primer año con la tarjeta de la cuota (ADR 0006): default_incomplete,
 * pago en servidor y, si el banco pide 3DS, lo completa el pagador. Si no se paga, Stripe lo deja
 * incomplete 23 h y luego lo cancela; la suscripción no se toca. `db`: cliente de servicePool en transacción.
 * Si ya hay un seguro incomplete del alumno, reintenta ese en vez de crear otro (no cobra dos veces).
 */
export async function startInsurance(db, { studentId, payerId, customer, paymentMethod, idempotencyKey }) {
  await db.query(`SELECT lock_student($1)`, [studentId]);
  const { rows: [cur] } = await db.query(
    `SELECT stripe_subscription_id, status FROM insurances
      WHERE student_id = $1 AND status IN ('incomplete', 'active', 'past_due', 'unpaid')
      ORDER BY status = 'incomplete', created_at DESC LIMIT 1`, [studentId]);
  if (cur && cur.status !== 'incomplete') throw httpError(409, 'insurance_exists', 'El alumno ya tiene un seguro');
  const s = await insuranceSettings(db);
  if (s.insurance_enabled !== true) throw httpError(409, 'insurance_disabled', 'La academia no ofrece el seguro');

  let sub;
  if (cur) {
    sub = await stripe.subscriptions.retrieve(cur.stripe_subscription_id, { expand: ['latest_invoice'] });
  } else {
    // Tramo por la edad de hoy.
    const { rows: [{ bracket }] } = await db.query(
      `SELECT CASE WHEN birth_date > CURRENT_DATE - interval '18 years' THEN 'minor' ELSE 'adult' END AS bracket
         FROM profiles WHERE id = $1`, [studentId]);
    sub = await stripe.subscriptions.create({
      customer, items: [{ price: s[`insurance_stripe_price_${bracket}`] }], default_payment_method: paymentMethod,
      payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { kind: 'insurance', student_id: studentId, payer_id: payerId }, expand: ['latest_invoice'],
    }, idempotencyKey && { idempotencyKey });
  }
  if (sub.status === 'incomplete' && sub.latest_invoice.status === 'open') {
    try {
      await stripe.invoices.pay(sub.latest_invoice.id, { payment_method: paymentMethod, off_session: false });
    } catch (err) {
      // 3DS pendiente o tarjeta rechazada: queda incomplete (el rechazo avisa por invoice.payment_failed).
      if (err.type !== 'StripeCardError' && err.code !== 'invoice_payment_intent_requires_action') throw err;
    }
    sub = await stripe.subscriptions.retrieve(sub.id);
  }
  const row = await upsertInsurance(db, sub);
  return { id: row.id, ...(await firstPayment(sub)) };
}

/**
 * Contratar el seguro después (CONTEXT § Elegir la cobertura): solo el pagador actual de la suscripción viva
 * del alumno, sin seguro vivo y con el seguro activado.
 */
export async function contractInsurance(client, { payerId, studentId }) {
  const { rows: [s] } = await client.query(
    `SELECT payer_id, stripe_subscription_id FROM subscriptions WHERE student_id = $1 AND status IN ${LIVE}`, [studentId]);
  if (!s) throw httpError(409, 'subscription_required', 'El alumno no tiene una suscripción');
  if (s.payer_id !== payerId) throw httpError(403, 'not_payer', 'Solo el pagador de la suscripción contrata el seguro');
  const [sub, { rows: [p] }] = await Promise.all([
    stripe.subscriptions.retrieve(s.stripe_subscription_id),
    client.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [payerId]),
  ]);
  // app_user no escribe insurances: transacción propia con servicePool.
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    const out = await startInsurance(db, {
      studentId, payerId, customer: p.stripe_customer_id, paymentMethod: idOf(sub.default_payment_method) ?? undefined,
    });
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Último seguro del alumno (la RLS decide quién lo ve). El client_secret del 3DS solo va al pagador. */
export async function getInsurance(client, { userId, studentId }) {
  const { rows: [i] } = await client.query(
    `SELECT id, payer_id, status, bracket, current_period_end, cancel_at_period_end, stripe_subscription_id
       FROM insurances WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [studentId]);
  if (!i) throw httpError(404, 'insurance_not_found', 'El alumno no tiene seguro');
  const { payer_id: payer, stripe_subscription_id: subId, ...out } = i;
  if (i.status === 'incomplete' && payer === userId) {
    Object.assign(out, await firstPayment(await stripe.subscriptions.retrieve(subId)));
  }
  return out;
}

// Una suscripción o seguro afectado = en periodo de gracia (past_due) o impagado (unpaid).
const AFFECTED_SQL = `
  affected AS (
    SELECT 'subscription' AS kind, s.id, s.payer_id, s.student_id, s.status, pl.name AS label,
           s.current_period_end, s.cancel_at_period_end
      FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.status IN ('past_due', 'unpaid')
    UNION ALL
    SELECT 'insurance', i.id, i.payer_id, i.student_id, i.status, i.bracket,
           i.current_period_end, i.cancel_at_period_end
      FROM insurances i WHERE i.status IN ('past_due', 'unpaid')
  ),
  -- Moroso = algo unpaid; en gracia = solo past_due. Un pagador sale en una sola lista.
  payers AS (
    SELECT payer_id FROM affected GROUP BY payer_id HAVING bool_or(status = 'unpaid') = $1
  )`;

/**
 * Pagadores morosos (`delinquent`) o en periodo de gracia (`grace`), con sus suscripciones y seguros
 * afectados y los recibos pendientes. Solo lectura: lo escribe el webhook y la RLS decide quién lo ve.
 */
export async function listOverduePayers(client, { list, limit = 25, offset = 0 }) {
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  const delinquent = list === 'delinquent';
  const { rows } = await client.query(
    `WITH ${AFFECTED_SQL},
     pending AS (
       SELECT a.payer_id, a.id AS item_id, v.id, v.period_start, v.amount_due_cents, v.attempt_count,
              v.next_payment_attempt, v.last_payment_error, v.hosted_invoice_url
         FROM invoices v JOIN affected a ON a.id = COALESCE(v.subscription_id, v.insurance_id)
        WHERE v.status = 'open'
     )
     SELECT p.payer_id, pr.display_name,
            (SELECT jsonb_agg(jsonb_build_object(
                      'kind', a.kind, 'id', a.id, 'student_id', a.student_id, 'student_name', st.display_name,
                      'label', a.label, 'status', a.status, 'current_period_end', a.current_period_end,
                      'cancel_at_period_end', a.cancel_at_period_end) ORDER BY st.display_name, a.id)
               FROM affected a JOIN profiles st ON st.id = a.student_id WHERE a.payer_id = p.payer_id) AS items,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'id', n.id, 'item_id', n.item_id, 'amount_due_cents', n.amount_due_cents,
                      'attempt_count', n.attempt_count, 'next_payment_attempt', n.next_payment_attempt,
                      'last_payment_error', n.last_payment_error, 'hosted_invoice_url', n.hosted_invoice_url)
                      ORDER BY n.period_start NULLS LAST, n.id)
               FROM pending n WHERE n.payer_id = p.payer_id), '[]') AS invoices
       FROM payers p JOIN profiles pr ON pr.id = p.payer_id
      ORDER BY (SELECT min(n.period_start) FROM pending n WHERE n.payer_id = p.payer_id) NULLS LAST, p.payer_id
      LIMIT $2 OFFSET $3`, [delinquent, limit, offset]);
  const { rows: [{ total }] } = await client.query(
    `WITH ${AFFECTED_SQL} SELECT count(*)::int AS total FROM payers`, [delinquent]);
  return { payers: rows, total, limit, offset };
}
