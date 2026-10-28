// src/services/billing.js — contratar (CONTEXT § Suscripción) y portal del pagador (B10).
// La suscripción local no nace aquí: nace en el webhook cuando Stripe confirma el pago.
import { servicePool } from '../config/database.js';
import { stripe, STRIPE_PORTAL_CONFIGURATION_ID, APP_URL } from '../config/stripe.js';
import { httpError } from '../lib/errors.js';
import { parseId, invalid, audit } from './catalog.js';

const LIVE = `('active', 'past_due', 'unpaid')`;
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
 * Valida los requisitos de contratar y abre un Checkout de Stripe. Perfil completo y
 * tutor→hijo los comprueba antes requireCompleteProfile.
 * @returns {{ url: string }}
 */
export async function createCheckout(client, { payerId, studentId, planId, disciplineIds = [] }) {
  if (!Array.isArray(disciplineIds)) throw invalid('discipline_ids', 'discipline_ids debe ser un array');
  const ids = [...new Set(disciplineIds.map(parseId))];

  const { rows: [plan] } = await client.query(
    `SELECT p.id, p.price_cents, p.max_disciplines, p.minors_only, p.is_active, p.stripe_price_id,
            ARRAY(SELECT discipline_id::text FROM plan_disciplines WHERE plan_id = p.id) AS eligible
       FROM plans p WHERE p.id = $1`, [parseId(planId)]);
  // El suscriptor ve su plan retirado (012), pero no lo puede contratar.
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

  const { rowCount } = await client.query(
    `SELECT 1 FROM subscriptions WHERE student_id = $1 AND status IN ${LIVE}`, [studentId]);
  if (rowCount) throw httpError(409, 'subscription_exists', 'El alumno ya tiene una suscripción');

  const customer = await ensureCustomer(client, payerId);
  // Contenido del pedido; el webhook resuelve pagador y suscripción por el grafo de Stripe, no por aquí.
  const metadata = { student_id: studentId, payer_id: payerId, plan_id: plan.id, discipline_ids: ids.join(',') };
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
    `SELECT stripe_subscription_id, status FROM subscriptions WHERE id = $1`, [id]);
  if (!s) throw httpError(404, 'subscription_not_found', 'Suscripción no encontrada');
  // Stripe manda: entre la baja y su webhook la fila local aún no dice cancelled.
  const current = s.status === 'cancelled' ? null : await stripe.subscriptions.retrieve(s.stripe_subscription_id);
  if (!current || current.status === 'canceled') {
    throw httpError(409, 'subscription_cancelled', 'La suscripción ya está cancelada');
  }
  await audit(client, actorId, atPeriodEnd ? 'subscription.cancel_at_period_end' : 'subscription.cancel_now', id, {});
  const sub = atPeriodEnd
    ? await stripe.subscriptions.update(s.stripe_subscription_id, { cancel_at_period_end: true })
    : await stripe.subscriptions.cancel(s.stripe_subscription_id);
  return { id, stripe_status: sub.status, cancel_at_period_end: sub.cancel_at_period_end };
}
