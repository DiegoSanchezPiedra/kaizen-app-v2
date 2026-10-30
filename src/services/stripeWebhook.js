// src/services/stripeWebhook.js — eventos de Stripe (B10, B10.1, B10.3, B10.5, B11). Solo el webhook escribe billing (servicePool).
// Los eventos llegan desordenados y repetidos: cada handler relee el objeto actual de Stripe y hace upsert.
import { servicePool } from '../config/database.js';
import { stripe } from '../config/stripe.js';
import {
  STATUS, ts, idOf, insuranceSettings, insuranceWontRenew, upsertInsurance, startInsurance, pendingPhase, discardSuccessor,
} from './billing.js';
import { notice } from './notices.js';

const IN_FORCE = ['active', 'past_due'];
const LIVE = `('active', 'past_due', 'unpaid')`;

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

const admins = async (client) =>
  (await client.query(`SELECT user_id FROM user_roles WHERE role = 'admin'`)).rows.map((r) => r.user_id);
const payerOf = async (client, customer) =>
  (await client.query(`SELECT id FROM profiles WHERE stripe_customer_id = $1`, [idOf(customer)])).rows[0]?.id ?? null;

// --- Contratar: la suscripción local nace aquí (nunca en success_url) ---

async function onCheckoutPaid(client, session) {
  // Con métodos de pago diferidos completed llega sin cobrar: se espera a async_payment_succeeded.
  if (session.mode !== 'subscription' || session.payment_status === 'unpaid') return;
  const sub = await stripe.subscriptions.retrieve(idOf(session.subscription));
  // Sin el pedido de Kaizen es de otra app de la misma cuenta (maat): no es nuestra.
  if (!sub.metadata?.student_id) return;
  // Pagador por el grafo de Stripe (cliente), no por metadata; metadata solo trae el pedido.
  const payer = await payerOf(client, sub.customer);
  const m = sub.metadata;
  if (!payer || payer !== m.payer_id) {
    throw new Error(`checkout ${session.id}: el cliente ${idOf(sub.customer)} no es el pagador ${m.payer_id}`);
  }
  // Cambio de pagador (B11): la sucesora no tiene fila hasta el traspaso.
  if (m.payer_change_id) return onPayerChangePaid(client, sub, payer);
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

  // Eligió el seguro: se crea ahora con la misma tarjeta (ADR 0006). Si no puede crearse, la suscripción sigue.
  if (m.insurance === 'true') {
    try {
      await startInsurance(client, {
        studentId: m.student_id, payerId: payer, customer: idOf(sub.customer),
        paymentMethod: idOf(sub.default_payment_method) ?? undefined, idempotencyKey: `insurance-${session.id}`,
      });
    } catch (err) {
      if (!err.status) throw err; // 409: desactivado entre medias o ya tiene seguro
      await notice(client, {
        action: 'notice.insurance_not_paid', actorId: payer, type: 'subscription', resourceId: row.id,
        recipients: [payer], student_id: m.student_id, reason: err.code,
      });
    }
  }
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

// --- Cambio de pagador (B11; ADR 0009): Checkout pagado, traspaso en D y caducidad ---

// Checkout del cambio completado (0 € hoy). Requested → paid: la antigua termina en D (se libera su Schedule, porque
// con él Stripe no deja poner cancel_at_period_end). Si no (anulado, caducado u otra sucesora ya pagada), o si el
// evento llega cuando la antigua ya renovó: se descarta la sucesora.
async function onPayerChangePaid(client, sub, payer) {
  const { rows: [pc] } = await client.query(`SELECT * FROM payer_changes WHERE id = $1 FOR UPDATE`, [sub.metadata.payer_change_id]);
  if (!pc || pc.new_payer_id !== payer) {
    throw new Error(`checkout de la sucesora ${sub.id}: el cambio ${sub.metadata.payer_change_id} no es de ${payer}`);
  }
  if (pc.stripe_subscription_id === sub.id) return; // ya procesado
  if (pc.status !== 'requested') {
    const refunded = await discardSuccessor(sub.id);
    // Otra sucesora del mismo cambio (dos Checkouts pagados): se descarta sin aviso.
    if (pc.stripe_subscription_id) return;
    return notice(client, {
      action: 'notice.payer_change_cancelled', actorId: payer, type: 'payer_change', resourceId: pc.id,
      recipients: [payer], student_id: pc.student_id, reason: pc.cancel_reason ?? pc.status, refunded,
    });
  }
  const { rows: [old] } = await client.query(
    `SELECT stripe_subscription_id, plan_id FROM subscriptions WHERE id = $1`, [pc.subscription_id]);
  const current = await stripe.subscriptions.retrieve(old.stripe_subscription_id);
  // Webhook tardío: la antigua ya renovó con su pagador. No se le pone la baja: el cambio caduca.
  if (ts(current.items.data[0].current_period_start) >= pc.starts_at) return markExpired(client, pc, sub.id);
  if (current.schedule) await stripe.subscriptionSchedules.release(idOf(current.schedule));
  if (!current.cancel_at_period_end) await stripe.subscriptions.update(current.id, { cancel_at_period_end: true });
  await client.query(
    `UPDATE payer_changes SET status = 'paid', stripe_subscription_id = $2, updated_at = now() WHERE id = $1`, [pc.id, sub.id]);
  await notice(client, {
    action: 'notice.payer_change_paid', actorId: payer, type: 'payer_change', resourceId: pc.id,
    recipients: [pc.old_payer_id, pc.new_payer_id], student_id: pc.student_id, from_plan_id: old.plan_id,
    plan_id: pc.plan_id, starts_at: pc.starts_at,
  });
}

/**
 * Traspaso: la antigua termina y la sucesora nace en local. Lo dispara el primer evento de D (fin de la antigua o
 * evento / recibo de la sucesora) y es idempotente. Después, revoke_coverage ya ve la sucesora: no cancela reservas.
 * @returns {Promise<boolean>} si se ha hecho ahora
 */
async function transferPayer(client, { id }) {
  const { rows: [pc] } = await client.query(`SELECT * FROM payer_changes WHERE id = $1`, [id]);
  await client.query(`SELECT lock_student($1)`, [pc.student_id]);
  const { rows: [{ status }] } = await client.query(`SELECT status FROM payer_changes WHERE id = $1 FOR UPDATE`, [id]);
  if (status !== 'paid') return false; // ya traspasado (u otro desenlace)
  const { rows: [old] } = await client.query(`SELECT stripe_subscription_id FROM subscriptions WHERE id = $1`, [pc.subscription_id]);
  const oldSub = await stripe.subscriptions.retrieve(old.stripe_subscription_id);
  if (oldSub.status !== 'canceled') return false; // aún no es D
  await client.query(
    `UPDATE subscriptions SET status = 'cancelled', cancel_at_period_end = $2, cancelled_at = $3 WHERE id = $1`,
    [pc.subscription_id, oldSub.cancel_at_period_end, ts(oldSub.ended_at)]);

  const sub = await stripe.subscriptions.retrieve(pc.stripe_subscription_id);
  const item = sub.items.data[0];
  const { rows: [row] } = await client.query(
    `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id,
                                current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [pc.student_id, pc.new_payer_id, pc.plan_id, STATUS[sub.status], sub.id,
      ts(item.current_period_start), ts(item.current_period_end), sub.cancel_at_period_end]);
  if (pc.discipline_ids.length) {
    await client.query(
      `INSERT INTO subscription_disciplines (subscription_id, discipline_id) SELECT $1, unnest($2::bigint[])`,
      [row.id, pc.discipline_ids]);
  }
  // Precio cambiado desde el Checkout (la sincronización no ve la sucesora sin fila): al vigente, sin prorrateo.
  const { rows: [plan] } = await client.query(`SELECT stripe_price_id FROM plans WHERE id = $1`, [pc.plan_id]);
  if (plan.stripe_price_id && plan.stripe_price_id !== item.price.id) {
    await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: plan.stripe_price_id }], proration_behavior: 'none' });
  }
  await client.query(`UPDATE payer_changes SET status = 'completed', updated_at = now() WHERE id = $1`, [id]);
  if (sub.latest_invoice) await syncInvoice(client, idOf(sub.latest_invoice));

  await client.query(`SELECT revoke_coverage($1)`, [pc.student_id]);
  // El seguro no cambia de pagador (CONTEXT § Seguro y cambio de pagador): si lo paga otro, termina sin renovarse.
  const { rows: [ins] } = await client.query(
    `SELECT id, student_id, payer_id, stripe_subscription_id FROM insurances
      WHERE student_id = $1 AND status IN ${LIVE} AND NOT cancel_at_period_end`, [pc.student_id]);
  if (ins && ins.payer_id !== pc.new_payer_id) {
    await insuranceWontRenew(client, ins, 'payer_changed', [ins.payer_id, pc.new_payer_id]);
  }
  return true;
}

const paidChange = async (client, column, value) => (await client.query(
  `SELECT id FROM payer_changes WHERE ${column} = $1 AND status = 'paid'`, [value])).rows[0];

// Renovación de la antigua sin traspaso (no pagó a tiempo): caducado, sin cron.
async function expirePayerChange(client, row, periodStart) {
  const { rows: [pc] } = await client.query(
    `SELECT * FROM payer_changes WHERE subscription_id = $1 AND status IN ('requested', 'paid') AND starts_at <= $2
     FOR UPDATE`, [row.id, periodStart]);
  if (pc) await markExpired(client, pc, pc.stripe_subscription_id);
}

// Caducado. Una sucesora que no llegó a sustituir a la antigua (Checkout tardío, o se le quitó la baja) se descarta:
// si no, cobraría al nuevo pagador sin fila local. Se guarda para que un replay del Checkout no repita nada.
async function markExpired(client, pc, successorId) {
  const refunded = successorId ? await discardSuccessor(successorId) : 0;
  await client.query(
    `UPDATE payer_changes SET status = 'expired', stripe_subscription_id = $2, updated_at = now() WHERE id = $1`,
    [pc.id, successorId]);
  await notice(client, {
    action: 'notice.payer_change_expired', actorId: pc.old_payer_id, type: 'payer_change', resourceId: pc.id,
    recipients: [...(await admins(client)), pc.old_payer_id, pc.new_payer_id], student_id: pc.student_id, refunded,
  });
}

// --- Cambios de estado: renovación, gracia (past_due), impagada, baja ---

async function onSubscriptionChange(client, obj) {
  const sub = await stripe.subscriptions.retrieve(obj.id);
  if (sub.metadata?.kind === 'insurance') return onInsuranceChange(client, sub);
  const status = STATUS[sub.status];
  if (!status) {
    // trialing / paused de otra app de la cuenta (maat): solo es un error si la suscripción es nuestra.
    const { rowCount } = await client.query(`SELECT 1 FROM subscriptions WHERE stripe_subscription_id = $1`, [sub.id]);
    if (!rowCount) return;
    throw new Error(`estado de Stripe sin mapear: ${sub.status} (${sub.id})`);
  }
  // Sucesora de un cambio de pagador pagado: su primer evento de D hace el traspaso, que crea su fila.
  const succ = await paidChange(client, 'stripe_subscription_id', sub.id);
  if (succ) await transferPayer(client, succ);
  const item = sub.items.data[0];
  const { rows: [row] } = await client.query(
    `UPDATE subscriptions s SET status = $2, current_period_start = $3, current_period_end = $4,
                                cancel_at_period_end = $5, cancelled_at = $6
       FROM (SELECT id, status FROM subscriptions WHERE stripe_subscription_id = $1 FOR UPDATE) was
      WHERE s.id = was.id RETURNING s.id, s.student_id, s.payer_id, s.plan_id, was.status AS was`,
    [sub.id, status, ts(item.current_period_start), ts(item.current_period_end),
      sub.cancel_at_period_end, ts(sub.ended_at)]);
  if (!row) return; // nace en checkout.session.completed (o perdió la carrera)
  // Cambio de plan (B10.5): pending update pagado o fase nueva del Schedule; el pedido viene en la metadata.
  // El cambio de disciplina no cambia plan_id: su espejo en la metadata no se aplica aquí (ADR 0007).
  if (sub.metadata.plan_id && sub.metadata.plan_id !== row.plan_id) await applyPlan(client, row, sub);
  await syncSchedule(client, sub);
  // Fin de la antigua con el cambio de pagador pagado: traspaso antes de revoke_coverage. Si renueva, el cambio caduca.
  if (status === 'cancelled') {
    const pc = await paidChange(client, 'subscription_id', row.id);
    if (pc) await transferPayer(client, pc);
  } else {
    await expirePayerChange(client, row, ts(item.current_period_start));
  }
  // Pérdida de cobertura (CONTEXT § Reservas). En gracia (past_due) no se pierde nada.
  if (!IN_FORCE.includes(status)) await client.query(`SELECT revoke_coverage($1)`, [row.student_id]);
  if (status === 'unpaid' && row.was !== 'unpaid') {
    await unpaidNotice(client, 'subscription', row, sub, { plan_id: row.plan_id });
  }
  // Baja sin otra suscripción viva: el seguro sigue hasta el final de su año y no renueva (CONTEXT § Seguro).
  if (status === 'cancelled') {
    const { rows: [ins] } = await client.query(
      `SELECT i.id, i.student_id, i.payer_id, i.stripe_subscription_id FROM insurances i
        WHERE i.student_id = $1 AND i.status IN ${LIVE} AND NOT i.cancel_at_period_end
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_id = i.student_id AND s.status IN ${LIVE})`,
      [row.student_id]);
    if (ins) await insuranceWontRenew(client, ins, 'subscription_cancelled');
  }
}

const disciplineIds = (m) => (m.discipline_ids ? m.discipline_ids.split(',') : []);

// Plan y disciplinas del pedido. Lo que deja de cubrirse se cancela (también lo reservado con la bajada programada).
async function applyPlan(client, row, sub) {
  const m = sub.metadata;
  const { rows: [p] } = await client.query(
    `SELECT (SELECT price_cents FROM plans WHERE id = $1) AS before, price_cents AS after, stripe_price_id
       FROM plans WHERE id = $2`, [row.plan_id, m.plan_id]);
  await client.query(`UPDATE subscriptions SET plan_id = $2 WHERE id = $1`, [row.id, m.plan_id]);
  await client.query(`DELETE FROM subscription_disciplines WHERE subscription_id = $1`, [row.id]);
  const ids = disciplineIds(m);
  if (ids.length) {
    await client.query(
      `INSERT INTO subscription_disciplines (subscription_id, discipline_id) SELECT $1, unnest($2::bigint[])`, [row.id, ids]);
  }
  await client.query(`SELECT revoke_coverage($1)`, [row.student_id]);
  // Precio cambiado con el Schedule o el pending update ya pedidos (catalog.js no lo vio): al vigente, sin prorrateo.
  const item = sub.items.data[0];
  if (p.stripe_price_id && item.price.id !== p.stripe_price_id) {
    await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: p.stripe_price_id }], proration_behavior: 'none' });
  }
  if (p.after <= p.before) {
    await notice(client, {
      action: 'notice.plan_downgraded', actorId: row.payer_id, type: 'subscription', resourceId: row.id,
      recipients: [row.payer_id], student_id: row.student_id, from_plan_id: row.plan_id, to_plan_id: m.plan_id,
    });
  }
}

// Bajada programada: scheduled_* = la fase pendiente del Schedule adjunto (o nada). stripe_schedule_id sigue
// mientras el Schedule esté adjunto, aunque ya no tenga nada pendiente.
async function syncSchedule(client, sub) {
  const schedule = sub.schedule ? await stripe.subscriptionSchedules.retrieve(idOf(sub.schedule)) : null;
  const attached = ['active', 'not_started'].includes(schedule?.status) ? schedule.id : null;
  const next = pendingPhase(schedule);
  await client.query(
    `UPDATE subscriptions SET stripe_schedule_id = $2, scheduled_plan_id = $3, scheduled_discipline_ids = $4,
                              scheduled_at = $5
      WHERE stripe_subscription_id = $1`,
    [sub.id, attached, next?.metadata.plan_id ?? null, next ? disciplineIds(next.metadata) : null, ts(next?.start_date)]);
}

// subscription_schedule.*: se relee la suscripción, que dice qué Schedule tiene adjunto ahora.
async function onSchedule(client, obj) {
  const schedule = await stripe.subscriptionSchedules.retrieve(obj.id);
  const subId = idOf(schedule.subscription) ?? idOf(schedule.released_subscription);
  if (!subId) return;
  await syncSchedule(client, await stripe.subscriptions.retrieve(subId));
}

// Impagada (B10.6): solo en la transición a unpaid, no en cada evento. El pagador paga el recibo open en Stripe.
async function unpaidNotice(client, kind, row, sub, extra = {}) {
  const inv = await stripe.invoices.retrieve(idOf(sub.latest_invoice));
  await notice(client, {
    action: `notice.${kind}_unpaid`, actorId: row.payer_id, type: kind,
    resourceId: row.id, recipients: [row.payer_id], student_id: row.student_id, ...extra,
    amount_cents: inv.amount_due, hosted_invoice_url: inv.hosted_invoice_url,
  });
}

// Seguro (B10.3). Sin revoke_coverage: perder la cobertura de riesgo impide reservar pero no cancela reservas.
async function onInsuranceChange(client, sub) {
  const payer = await payerOf(client, sub.customer);
  if (!payer || payer !== sub.metadata.payer_id) {
    throw new Error(`seguro ${sub.id}: el cliente ${idOf(sub.customer)} no es el pagador ${sub.metadata.payer_id}`);
  }
  const { rows: [was] } = await client.query(
    `SELECT status FROM insurances WHERE stripe_subscription_id = $1 FOR UPDATE`, [sub.id]);
  const row = await upsertInsurance(client, sub);
  // El primer año no llegó a pagarse (incomplete_expired): sin cobertura de riesgo, aviso al pagador.
  if (STATUS[sub.status] === 'cancelled' && (was?.status ?? 'incomplete') === 'incomplete') {
    await notice(client, {
      action: 'notice.insurance_not_paid', actorId: payer, type: 'insurance', resourceId: row.id,
      recipients: [payer], student_id: row.student_id, reason: 'not_paid',
    });
  }
  if (STATUS[sub.status] === 'unpaid' && was?.status !== 'unpaid') {
    await unpaidNotice(client, 'insurance', row, sub);
  }
}

// Aviso de renovación del seguro: invoice.upcoming, 30 días antes (Dashboard: Upcoming renewal events).
// Fija precio y tramo (edad de hoy) o, en los casos de CONTEXT § Seguro, deja que termine sin renovarse.
async function onUpcoming(client, inv) {
  const subId = inv.parent?.subscription_details?.subscription;
  const { rows: [i] } = await client.query(
    `SELECT i.id, i.student_id, i.payer_id, i.stripe_subscription_id, i.current_period_end,
            (SELECT s.payer_id FROM subscriptions s WHERE s.student_id = i.student_id AND s.status IN ${LIVE}) AS sub_payer,
            EXISTS (SELECT 1 FROM guardianships g WHERE g.minor_id = i.student_id)
              AND p.birth_date + interval '18 years' <= i.current_period_end AS turns_18,
            CASE WHEN p.birth_date > CURRENT_DATE - interval '18 years' THEN 'minor' ELSE 'adult' END AS bracket
       FROM insurances i JOIN profiles p ON p.id = i.student_id
      WHERE i.stripe_subscription_id = $1 AND i.status IN ${LIVE} AND NOT i.cancel_at_period_end`, [subId]);
  if (!i) return; // cuota, otra app de la cuenta o un seguro que ya no renueva
  const s = await insuranceSettings(client);
  // El aviso va al pagador actual de la suscripción (CONTEXT § Seguro y cambio de pagador).
  const recipients = [...new Set([i.payer_id, i.sub_payer].filter(Boolean))];
  // Hijo que cumple 18 antes de renovar: se decide en el aviso, haya reclamado o no (plan B10.3).
  const reason = s.insurance_enabled !== true ? 'disabled'
    : !i.sub_payer ? 'subscription_cancelled'
      : i.sub_payer !== i.payer_id ? 'payer_changed'
        : i.turns_18 ? 'turns_18' : null;
  if (reason) return insuranceWontRenew(client, i, reason, recipients);

  const price = s[`insurance_stripe_price_${i.bracket}`];
  const item = (await stripe.subscriptions.retrieve(subId)).items.data[0];
  if (item.price.id !== price) {
    await stripe.subscriptions.update(subId, { items: [{ id: item.id, price }], proration_behavior: 'none' });
  }
  await notice(client, {
    action: 'notice.insurance_renewal', actorId: i.payer_id, type: 'insurance', resourceId: i.id, recipients,
    student_id: i.student_id, bracket: i.bracket, amount_cents: s[`insurance_price_${i.bracket}_cents`],
    renews_at: i.current_period_end,
  });
}

// --- Recibos (B10.1) ---

async function syncInvoice(client, invoiceId) {
  const inv = await stripe.invoices.retrieve(invoiceId, { expand: ['payments.data.payment.payment_intent'] });
  const subId = inv.parent?.subscription_details?.subscription;
  if (!subId) return null; // Kaizen no emite recibos sueltos
  const owner = async () => (await client.query(
    `SELECT id, student_id, payer_id, 'subscription' AS kind FROM subscriptions WHERE stripe_subscription_id = $1
     UNION ALL
     SELECT id, student_id, payer_id, 'insurance' FROM insurances WHERE stripe_subscription_id = $1`, [subId])).rows[0];
  let s = await owner();
  // El seguro factura al crearse, a veces antes de que se confirme su fila: se crea desde Stripe.
  if (!s && inv.parent.subscription_details.metadata?.kind === 'insurance') {
    await onInsuranceChange(client, await stripe.subscriptions.retrieve(subId));
    s = await owner();
  }
  // Recibo de una sucesora sin fila (B11): primer evento de D, hace el traspaso.
  if (!s) {
    const pc = await paidChange(client, 'stripe_subscription_id', subId);
    if (pc && await transferPayer(client, pc)) s = await owner();
  }
  if (!s) return null; // el de la cuota lo guarda checkout.session.completed
  const err = inv.payments?.data?.map((p) => p.payment.payment_intent?.last_payment_error?.message).find(Boolean);
  const period = inv.lines.data[0]?.period;
  const { rows: [row] } = await client.query(
    `INSERT INTO invoices (student_id, payer_id, subscription_id, stripe_invoice_id, status, currency,
                           amount_due_cents, amount_paid_cents, paid_at, attempt_count, next_payment_attempt,
                           last_payment_error, hosted_invoice_url, invoice_pdf, period_start, period_end, insurance_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       status = EXCLUDED.status, amount_due_cents = EXCLUDED.amount_due_cents,
       amount_paid_cents = EXCLUDED.amount_paid_cents, paid_at = EXCLUDED.paid_at,
       attempt_count = EXCLUDED.attempt_count, next_payment_attempt = EXCLUDED.next_payment_attempt,
       last_payment_error = COALESCE(EXCLUDED.last_payment_error, invoices.last_payment_error),
       hosted_invoice_url = EXCLUDED.hosted_invoice_url, invoice_pdf = EXCLUDED.invoice_pdf
     RETURNING id, payer_id, insurance_id, attempt_count, next_payment_attempt, last_payment_error`,
    [s.student_id, s.payer_id, s.kind === 'subscription' ? s.id : null, inv.id, inv.status, inv.currency, inv.amount_due, inv.amount_paid,
      ts(inv.status_transitions?.paid_at), inv.attempt_count, ts(inv.next_payment_attempt), err ?? null,
      inv.hosted_invoice_url, inv.invoice_pdf, ts(period?.start), ts(period?.end), s.kind === 'insurance' ? s.id : null]);
  return { ...row, billing_reason: inv.billing_reason };
}

async function onInvoice(client, obj, event) {
  const row = await syncInvoice(client, obj.id);
  // Cobro fallido: no quita acceso (la suscripción pasa a past_due); aviso solo al pagador, nunca al hijo.
  // Solo el primer intento (B11): los reintentos no avisan y, si se agotan, avisa el paso a unpaid (2 emails, no 9).
  // Primer cobro del seguro: el pagador está en pantalla (3DS o rechazo); si no llega a pagarse, avisa la caducidad.
  // Prorrateo de una subida (B10.5): quien la pide está en pantalla (402) y el recibo se anula.
  const onScreen = (row?.insurance_id && row.billing_reason === 'subscription_create')
    || row?.billing_reason === 'subscription_update';
  if (row && event.type === 'invoice.payment_failed' && !onScreen && row.attempt_count === 1) {
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
  'customer.subscription.created': onSubscriptionChange, // el seguro nace en servidor (la cuota, en el Checkout)
  'customer.subscription.updated': onSubscriptionChange,
  'customer.subscription.deleted': onSubscriptionChange,
  'invoice.finalized': onInvoice,
  'invoice.paid': onInvoice,
  'invoice.payment_failed': onInvoice,
  'invoice.voided': onInvoice, // subida rechazada o pending update caducado
  'invoice.upcoming': onUpcoming,
  'charge.refunded': onRisk,
  'charge.dispute.created': onRisk,
  'radar.early_fraud_warning.created': onRisk,
  // Bajada programada (B10.5)
  'subscription_schedule.created': onSchedule,
  'subscription_schedule.updated': onSchedule,
  'subscription_schedule.released': onSchedule,
  'subscription_schedule.canceled': onSchedule,
  'subscription_schedule.completed': onSchedule,
};
export const HANDLED_EVENTS = Object.keys(HANDLERS);
