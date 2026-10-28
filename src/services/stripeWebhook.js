// src/services/stripeWebhook.js — eventos de Stripe (B10, B10.1). Solo el webhook escribe billing (servicePool).
// Los eventos llegan desordenados y repetidos: cada handler relee el objeto actual de Stripe y hace upsert.
import { servicePool } from '../config/database.js';
import { stripe } from '../config/stripe.js';

const IN_FORCE = ['active', 'past_due'];
// Estados de Stripe tal cual (CONTEXT § Suscripción); canceled / incomplete_expired → cancelled.
const STATUS = {
  active: 'active', past_due: 'past_due', unpaid: 'unpaid', incomplete: 'incomplete',
  canceled: 'cancelled', incomplete_expired: 'cancelled',
};
const ts = (s) => (s ? new Date(s * 1000) : null);
const idOf = (x) => (typeof x === 'string' ? x : x?.id ?? null);

/**
 * Procesa un evento ya verificado. La fila de webhook_events se confirma junto con sus efectos:
 * un duplicado espera en el índice único al primero y, si este confirma, no hace nada; si falla, lo reprocesa.
 * Si lanza, la transacción se deshace y la ruta responde 500 para que Stripe reintente.
 * @returns {'processed' | 'duplicate'}
 */
export async function handleEvent(event) {
  const client = await servicePool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `INSERT INTO webhook_events (id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.type, event]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }
    await HANDLERS[event.type]?.(client, event.data.object, event);
    await client.query(`UPDATE webhook_events SET processed_at = now() WHERE id = $1`, [event.id]);
    await client.query('COMMIT');
    return 'processed';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Aviso pendiente de envío (B15), como booking_notice (009).
async function notice(client, { action, actorId, type, resourceId, recipients, ...extra }) {
  await client.query(
    `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [actorId, action, type, resourceId, { ...extra, recipients }]);
}
const admins = async (client) =>
  (await client.query(`SELECT user_id FROM user_roles WHERE role = 'admin'`)).rows.map((r) => r.user_id);
const payerOf = async (client, customer) =>
  (await client.query(`SELECT id FROM profiles WHERE stripe_customer_id = $1`, [idOf(customer)])).rows[0]?.id ?? null;

// --- Contratar: la suscripción local nace aquí (nunca en success_url) ---

async function onCheckoutPaid(client, session) {
  // Con métodos de pago diferidos completed llega sin cobrar: se espera a async_payment_succeeded.
  if (session.mode !== 'subscription' || session.payment_status === 'unpaid') return;
  const sub = await stripe.subscriptions.retrieve(idOf(session.subscription));
  // Pagador por el grafo de Stripe (cliente), no por metadata; metadata solo trae el pedido.
  const payer = await payerOf(client, sub.customer);
  const m = sub.metadata;
  if (!payer || payer !== m.payer_id) {
    throw new Error(`checkout ${session.id}: el cliente ${idOf(sub.customer)} no es el pagador ${m.payer_id}`);
  }
  const item = sub.items.data[0];

  await client.query('SAVEPOINT sub');
  let row;
  try {
    ({ rows: [row] } = await client.query(
      `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id,
                                  current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (stripe_subscription_id) DO NOTHING RETURNING id`,
      [m.student_id, payer, m.plan_id, STATUS[sub.status], sub.id,
        ts(item.current_period_start), ts(item.current_period_end), sub.cancel_at_period_end]));
  } catch (err) {
    if (err.constraint !== 'subscriptions_one_live_idx') throw err;
    await client.query('ROLLBACK TO SAVEPOINT sub');
    return lostRace(client, sub, payer);
  }
  if (!row) return; // ya existía

  const ids = m.discipline_ids ? m.discipline_ids.split(',') : [];
  if (ids.length) {
    await client.query(
      `INSERT INTO subscription_disciplines (subscription_id, discipline_id) SELECT $1, unnest($2::bigint[])`,
      [row.id, ids]);
  }
  // Si el precio del plan cambió con el Checkout abierto, la sincronización (catalog.js) no la vio.
  const { rows: [plan] } = await client.query(`SELECT stripe_price_id FROM plans WHERE id = $1`, [m.plan_id]);
  if (plan.stripe_price_id && plan.stripe_price_id !== item.price.id) {
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: plan.stripe_price_id }], proration_behavior: 'none',
    });
  }
  // invoice.paid del primer cobro suele llegar antes que este evento, cuando aún no había fila.
  if (sub.latest_invoice) await syncInvoice(client, idOf(sub.latest_invoice));
}

// Pago diferido rechazado: no hay suscripción local; se avisa al pagador.
async function onCheckoutFailed(client, session) {
  const payer = await payerOf(client, session.customer);
  if (!payer) return;
  await notice(client, {
    action: 'notice.checkout_payment_failed', actorId: payer, type: 'checkout_session', resourceId: session.id,
    recipients: [payer], student_id: session.metadata?.student_id,
  });
}

// Carrera de checkouts para el mismo alumno: gana la suscripción ya viva; esta se cancela y se reembolsa.
async function lostRace(client, sub, payer) {
  if (sub.status !== 'canceled') await stripe.subscriptions.cancel(sub.id);
  const inv = await stripe.invoices.retrieve(idOf(sub.latest_invoice), { expand: ['payments.data.payment'] });
  const pi = inv.payments.data.find((p) => p.status === 'paid')?.payment.payment_intent;
  // La clave evita un segundo reembolso si este evento se reprocesa.
  if (pi) await stripe.refunds.create({ payment_intent: idOf(pi) }, { idempotencyKey: `race-refund-${sub.id}` });
  await notice(client, {
    action: 'notice.checkout_race_refunded', actorId: payer, type: 'subscription', resourceId: sub.id,
    recipients: [payer, ...(await admins(client))], student_id: sub.metadata.student_id,
  });
}

// --- Cambios de estado: renovación, gracia (past_due), impagada, baja ---

async function onSubscriptionChange(client, obj) {
  const sub = await stripe.subscriptions.retrieve(obj.id);
  const status = STATUS[sub.status];
  if (!status) throw new Error(`estado de Stripe sin mapear: ${sub.status} (${sub.id})`);
  const item = sub.items.data[0];
  const { rows: [row] } = await client.query(
    `UPDATE subscriptions SET status = $2, current_period_start = $3, current_period_end = $4,
                              cancel_at_period_end = $5, cancelled_at = $6
      WHERE stripe_subscription_id = $1 RETURNING student_id`,
    [sub.id, status, ts(item.current_period_start), ts(item.current_period_end),
      sub.cancel_at_period_end, ts(sub.ended_at)]);
  if (!row) return; // nace en checkout.session.completed (o perdió la carrera)
  // Pérdida de cobertura (CONTEXT § Reservas). En gracia (past_due) no se pierde nada.
  if (!IN_FORCE.includes(status)) await client.query(`SELECT revoke_coverage($1)`, [row.student_id]);
}

// --- Recibos (B10.1) ---

async function syncInvoice(client, invoiceId) {
  const inv = await stripe.invoices.retrieve(invoiceId, { expand: ['payments.data.payment.payment_intent'] });
  const subId = inv.parent?.subscription_details?.subscription;
  // shortcut: solo recibos de suscripción; los del seguro llegan en B10.3.
  if (!subId) return null;
  const { rows: [s] } = await client.query(
    `SELECT id, student_id, payer_id FROM subscriptions WHERE stripe_subscription_id = $1`, [subId]);
  if (!s) return null; // el primero lo guarda checkout.session.completed
  const err = inv.payments?.data?.map((p) => p.payment.payment_intent?.last_payment_error?.message).find(Boolean);
  const period = inv.lines.data[0]?.period;
  const { rows: [row] } = await client.query(
    `INSERT INTO invoices (student_id, payer_id, subscription_id, stripe_invoice_id, status, currency,
                           amount_due_cents, amount_paid_cents, paid_at, attempt_count, next_payment_attempt,
                           last_payment_error, hosted_invoice_url, invoice_pdf, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       status = EXCLUDED.status, amount_due_cents = EXCLUDED.amount_due_cents,
       amount_paid_cents = EXCLUDED.amount_paid_cents, paid_at = EXCLUDED.paid_at,
       attempt_count = EXCLUDED.attempt_count, next_payment_attempt = EXCLUDED.next_payment_attempt,
       last_payment_error = COALESCE(EXCLUDED.last_payment_error, invoices.last_payment_error),
       hosted_invoice_url = EXCLUDED.hosted_invoice_url, invoice_pdf = EXCLUDED.invoice_pdf
     RETURNING id, payer_id, next_payment_attempt, last_payment_error`,
    [s.student_id, s.payer_id, s.id, inv.id, inv.status, inv.currency, inv.amount_due, inv.amount_paid,
      ts(inv.status_transitions?.paid_at), inv.attempt_count, ts(inv.next_payment_attempt), err ?? null,
      inv.hosted_invoice_url, inv.invoice_pdf, ts(period?.start), ts(period?.end)]);
  return row;
}

async function onInvoice(client, obj, event) {
  const row = await syncInvoice(client, obj.id);
  // Cobro fallido: no quita acceso (la suscripción pasa a past_due); aviso solo al pagador, nunca al hijo.
  if (row && event.type === 'invoice.payment_failed') {
    await notice(client, {
      action: 'notice.payment_failed', actorId: row.payer_id, type: 'invoice', resourceId: row.id,
      recipients: [row.payer_id], next_payment_attempt: row.next_payment_attempt, error: row.last_payment_error,
    });
  }
}

// --- Riesgo: reembolsos, disputas y avisos de fraude → aviso al admin ---

async function onRisk(client, obj, event) {
  const charge = obj.object === 'charge' ? obj : await stripe.charges.retrieve(idOf(obj.charge));
  const payer = await payerOf(client, charge.customer);
  if (!payer) return; // no es un cliente de Kaizen
  // Suscripción afectada por el grafo: cobro → invoice payment → recibo → suscripción.
  const { data: [ip] } = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: idOf(charge.payment_intent) }, expand: ['data.invoice'],
  });
  await notice(client, {
    action: 'notice.stripe_risk', actorId: payer, type: 'charge', resourceId: charge.id,
    recipients: await admins(client), event_type: event.type, amount_cents: charge.amount,
    stripe_subscription_id: ip?.invoice?.parent?.subscription_details?.subscription ?? null,
  });
}

const HANDLERS = {
  'checkout.session.completed': onCheckoutPaid,
  'checkout.session.async_payment_succeeded': onCheckoutPaid,
  'checkout.session.async_payment_failed': onCheckoutFailed,
  'customer.subscription.updated': onSubscriptionChange,
  'customer.subscription.deleted': onSubscriptionChange,
  'invoice.finalized': onInvoice,
  'invoice.paid': onInvoice,
  'invoice.payment_failed': onInvoice,
  'charge.refunded': onRisk,
  'charge.dispute.created': onRisk,
  'radar.early_fraud_warning.created': onRisk,
};
export const HANDLED_EVENTS = Object.keys(HANDLERS);
