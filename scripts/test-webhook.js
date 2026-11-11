// Webhook de Stripe (B10, B10.1): firma e idempotencia por HTTP; handlers con objetos reales del sandbox.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../src/config/stripe.js';
import { createPlan, updatePlan } from '../src/services/catalog.js';
import { handleEvent } from '../src/services/stripeWebhook.js';
import {
  cancelSubscription, changePlan, cancelScheduledChange, getSubscription,
  requestPayerChange, cancelPayerChange, requestPause, updatePauseSettings,
} from '../src/services/billing.js';
import { listAudit } from '../src/services/panel.js';
import webhooksRouter from '../src/routes/webhooks.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

const people = {
  admin: 'admin', prof: 'profesor', alu: 'alumno', tutor: 'tutor', child: 'alumno',
  pc: 'alumno', pc2: 'alumno', // B10.5
  unp: 'alumno', // B10.6
  kid: 'alumno', t1: 'tutor', t2: 'tutor', // B11: kid (menor) lo paga t1; t2, también vinculado
  pz: 'alumno', pz2: 'alumno', // B30
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-wh`, ['child', 'kid'].includes(k) ? '2016-05-05' : null]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($3, $4), ($5, $4)`, [U.tutor, U.child, U.t1, U.kid, U.t2]);
const [{ id: disc }] = await q(`INSERT INTO disciplines (name) VALUES ('T-Wh-A') RETURNING id`);
const plan = await withRls({ uid: U.admin, role: 'admin' }, (c) =>
  createPlan(c, { name: `T-Wh-one-${Date.now()}`, price_cents: 2000, max_disciplines: 1 }));
const [{ stripe_price_id: price }] = await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [plan.id]);

const customer = async (who, pm) => {
  const c = await stripe.customers.create({ payment_method: pm, invoice_settings: { default_payment_method: pm } });
  await q(`UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1`, [U[who], c.id]);
  return c.id;
};
const cusAlu = await customer('alu', 'pm_card_visa');
const cusTutor = await customer('tutor', 'pm_card_chargeCustomerFail');
const stripeSubs = [];
const savedPause = await q(`SELECT key, value FROM academy_settings WHERE key LIKE 'pause\\_%'`); // B30: se restauran al final
// Lo que deja un Checkout pagado: suscripción con el pedido en metadata.
const paidSub = async (cus, student, payer, extra = {}) => {
  const s = await stripe.subscriptions.create({
    customer: cus, items: [{ price }],
    metadata: { student_id: U[student], payer_id: U[payer], plan_id: plan.id, discipline_ids: String(disc), ...extra },
  });
  stripeSubs.push(s.id);
  return s;
};
const eventIds = [];
const evt = (type, object) => {
  const id = `evt_test_${crypto.randomUUID()}`;
  eventIds.push(id);
  return { id, type, data: { object } };
};
const completed = (sub, extra = {}) => evt('checkout.session.completed', {
  id: `cs_test_${crypto.randomUUID()}`, object: 'checkout.session', mode: 'subscription', payment_status: 'paid',
  subscription: sub.id, customer: sub.customer, ...extra,
});
const localSub = async (stripeId) => (await q(`SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`, [stripeId]))[0];
// Las altas, como las ve el admin en Auditoría (y en «Hoy en la academia» del Inicio).
const altasOf = (subId) => withRls({ uid: U.admin, role: 'admin' }, (c) =>
  listAudit(c, { action: 'subscription.create', resource_id: subId })).then((r) => r.rows);

// La ruta real sobre un puerto efímero.
const app = express();
app.use('/webhooks', webhooksRouter);
app.use(errorHandler);
const server = app.listen(0);
const url = `http://127.0.0.1:${server.address().port}/webhooks/stripe`;
const post = (payload, header) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(header && { 'stripe-signature': header }) }, body: payload,
});
const sign = (payload, secret = STRIPE_WEBHOOK_SECRET) => stripe.webhooks.generateTestHeaderString({ payload, secret });

const noticeOf = async (action, resourceId) =>
  (await q(`SELECT changes FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at`, [action, resourceId]))
    .map((r) => r.changes);
const deliveriesOf = (action, resourceId) => q(
  `SELECT d.recipient_id, d.channel FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id
    WHERE a.action = $1 AND a.resource_id = $2`, [action, resourceId]);
// Stripe pasa a unpaid al agotar los reintentos (ajuste de la cuenta); aquí se simula el estado al releer.
const asUnpaid = async (subId, fn) => {
  const { retrieve } = stripe.subscriptions;
  stripe.subscriptions.retrieve = async (...a) => {
    const s = await retrieve.apply(stripe.subscriptions, a);
    return a[0] === subId ? { ...s, status: 'unpaid' } : s;
  };
  try { await fn(); } finally { stripe.subscriptions.retrieve = retrieve; }
};

let sub1, raceSub, sess;
const extraPlans = [];
const extraDiscs = [];
const extraSessions = [];
try {
  await run('firma: sin cabecera, otro secreto o cuerpo alterado → 400 sin procesar', async () => {
    const payload = JSON.stringify(evt('kaizen.test', { object: 'test' }));
    assert.equal((await post(payload)).status, 400);
    assert.equal((await post(payload, sign(payload, 'whsec_otro'))).status, 400);
    assert.equal((await post(payload.replace('kaizen.test', 'kaizen.tamper'), sign(payload))).status, 400);
    assert.equal((await q(`SELECT 1 FROM webhook_events WHERE id = $1`, [JSON.parse(payload).id])).length, 0);
  });
  await run('firma válida → 200 processed; reenvío del mismo evento → 200 duplicate', async () => {
    const payload = JSON.stringify(evt('kaizen.test', { object: 'test' }));
    const r1 = await post(payload, sign(payload));
    assert.deepEqual([r1.status, (await r1.json()).result], [200, 'processed']);
    const r2 = await post(payload, sign(payload));
    assert.deepEqual([r2.status, (await r2.json()).result], [200, 'duplicate']);
  });

  await run('checkout.session.completed: nace la suscripción con disciplinas y su primer recibo', async () => {
    sub1 = await paidSub(cusAlu, 'alu', 'alu');
    await handleEvent(evt('checkout.session.completed', {
      id: 'cs_test_unpaid', object: 'checkout.session', mode: 'subscription', payment_status: 'unpaid',
      subscription: sub1.id, customer: cusAlu }));
    assert.equal(await localSub(sub1.id), undefined, 'unpaid no crea fila');
    const e = completed(sub1);
    assert.equal(await handleEvent(e), 'processed');
    const s = await localSub(sub1.id);
    assert.deepEqual([s.student_id, s.payer_id, s.plan_id, s.status], [U.alu, U.alu, plan.id, 'active']);
    assert.ok(s.current_period_end > s.current_period_start);
    assert.deepEqual((await q(`SELECT discipline_id FROM subscription_disciplines WHERE subscription_id = $1`, [s.id]))
      .map((r) => r.discipline_id), [disc]);
    const [inv] = await q(`SELECT * FROM invoices WHERE subscription_id = $1`, [s.id]);
    assert.deepEqual([inv.status, inv.amount_paid_cents, inv.currency, inv.payer_id], ['paid', 2000, 'eur', U.alu]);
    assert.ok(inv.hosted_invoice_url && inv.invoice_pdf && inv.paid_at);
    assert.equal(await handleEvent(e), 'duplicate');
    assert.equal((await q(`SELECT 1 FROM subscriptions WHERE student_id = $1`, [U.alu])).length, 1);
    const [alta, ...more] = await altasOf(s.id);
    assert.equal(more.length, 0, 'una sola alta, también con el evento repetido');
    assert.deepEqual([alta.actor.id, alta.resource_type, alta.changes],
      [U.alu, 'subscription', { student_id: U.alu, payer_id: U.alu, plan_id: String(plan.id) }]);
  });
  await run('el cliente de Stripe no es el pagador de metadata → error y nada guardado (Stripe reintenta)', async () => {
    const s = await paidSub(cusAlu, 'child', 'tutor');
    const e = completed(s);
    await assert.rejects(handleEvent(e), /no es el pagador/);
    assert.equal(await localSub(s.id), undefined);
    assert.equal((await q(`SELECT 1 FROM webhook_events WHERE id = $1`, [e.id])).length, 0);
    await stripe.subscriptions.cancel(s.id);
  });
  await run('suscripción de otra app de la cuenta (maat): checkout y trialing se ignoran sin error', async () => {
    const c = await stripe.customers.create({ name: 'cliente de maat' });
    const s = await stripe.subscriptions.create({ customer: c.id, items: [{ price }], trial_period_days: 7 });
    stripeSubs.push(s.id);
    assert.equal(await handleEvent(completed(s)), 'processed');
    assert.equal(await handleEvent(evt('customer.subscription.updated', { id: s.id })), 'processed');
    assert.equal(await localSub(s.id), undefined);
    await stripe.customers.del(c.id);
  });
  await run('carrera de checkouts: la segunda se cancela en Stripe, se reembolsa y se avisa a pagador y admin', async () => {
    raceSub = await paidSub(cusAlu, 'alu', 'alu');
    await handleEvent(completed(raceSub));
    assert.equal(await localSub(raceSub.id), undefined);
    assert.equal((await stripe.subscriptions.retrieve(raceSub.id)).status, 'canceled');
    const inv = await stripe.invoices.retrieve(raceSub.latest_invoice, { expand: ['payments.data.payment'] });
    const pi = inv.payments.data[0].payment.payment_intent;
    assert.equal((await stripe.refunds.list({ payment_intent: pi })).data[0].status, 'succeeded');
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.checkout_race_refunded' AND resource_id = $1`, [raceSub.id]);
    assert.ok(n.changes.recipients.includes(U.alu) && n.changes.recipients.includes(U.admin));
  });
  await run('charge.refunded: aviso al admin con la suscripción resuelta por el grafo de Stripe', async () => {
    const inv = await stripe.invoices.retrieve(raceSub.latest_invoice, { expand: ['payments.data.payment.payment_intent'] });
    const charge = await stripe.charges.retrieve(inv.payments.data[0].payment.payment_intent.latest_charge);
    await handleEvent(evt('charge.refunded', charge));
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.stripe_risk' AND resource_id = $1`, [charge.id]);
    assert.equal(n.changes.stripe_subscription_id, raceSub.id);
    assert.ok(n.changes.recipients.includes(U.admin));
  });
  await run('invoice.payment_failed: guarda intento y motivo; aviso solo al pagador (tutor) y solo en el primer intento', async () => {
    const s = await stripe.subscriptions.create({ customer: cusTutor, items: [{ price }] });
    stripeSubs.push(s.id);
    await q(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
             VALUES ($1, $2, $3, 'incomplete', $4)`, [U.child, U.tutor, plan.id, s.id]);
    await handleEvent(evt('invoice.payment_failed', { id: s.latest_invoice, object: 'invoice' }));
    const [inv] = await q(`SELECT * FROM invoices WHERE stripe_invoice_id = $1`, [s.latest_invoice]);
    assert.deepEqual([inv.status, inv.attempt_count, inv.last_payment_error, inv.payer_id, inv.student_id],
      ['open', 1, 'Your card was declined.', U.tutor, U.child]);
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.payment_failed' AND resource_id = $1`, [inv.id]);
    assert.deepEqual([n.changes.recipients, n.changes.maintenance], [[U.tutor], false]);
    // Reintento automático fallido (B11): sin aviso; si se agotan, avisa el paso a unpaid. Solo los reintentos
    // automáticos suben attempt_count (un pago manual no): se simula al releer el recibo.
    const { retrieve } = stripe.invoices;
    stripe.invoices.retrieve = async (...a) => ({ ...(await retrieve.apply(stripe.invoices, a)), attempt_count: 2 });
    try {
      await handleEvent(evt('invoice.payment_failed', { id: s.latest_invoice, object: 'invoice' }));
    } finally { stripe.invoices.retrieve = retrieve; }
    assert.equal((await q(`SELECT attempt_count FROM invoices WHERE id = $1`, [inv.id]))[0].attempt_count, 2);
    assert.equal((await q(`SELECT 1 FROM audit_log WHERE action = 'notice.payment_failed' AND resource_id = $1`, [inv.id])).length, 1);
  });
  await run('baja en Stripe → customer.subscription.deleted: cancelled y reservas futuras canceladas sin cobertura', async () => {
    [sess] = await q(
      `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
       VALUES ($1, $2, now() + interval '3 days', now() + interval '3 days 1 hour', 60, 5, 'scheduled') RETURNING id`,
      [disc, U.prof]);
    const [bk] = await q(`INSERT INTO bookings (id, session_id, student_id, booked_by, status)
                          VALUES (gen_random_uuid(), $1, $2, $2, 'confirmed') RETURNING id`, [sess.id, U.alu]);
    await handleEvent(evt('customer.subscription.updated', { id: sub1.id, object: 'subscription' }));
    assert.equal((await q(`SELECT status FROM bookings WHERE id = $1`, [bk.id]))[0].status, 'confirmed', 'active no revoca');
    await stripe.subscriptions.cancel(sub1.id);
    await handleEvent(evt('customer.subscription.deleted', { id: sub1.id, object: 'subscription' }));
    const s = await localSub(sub1.id);
    assert.equal(s.status, 'cancelled');
    assert.ok(s.cancelled_at);
    const [b] = await q(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [bk.id]);
    assert.deepEqual([b.status, b.cancel_reason], ['cancelled', 'no_coverage']);
  });
  await run('baja admin: a fin de periodo sigue en vigor; inmediata cancela; ya cancelada → 409; audita', async () => {
    const s = await paidSub(cusAlu, 'alu', 'alu'); // la anterior ya está cancelada: no hay suscripción viva
    await handleEvent(completed(s));
    const { id } = await localSub(s.id);
    const admin = (fn) => withRls({ uid: U.admin, role: 'admin' }, fn);
    const end = await admin((c) => cancelSubscription(c, { id, atPeriodEnd: true, actorId: U.admin }));
    assert.deepEqual([end.stripe_status, end.cancel_at_period_end], ['active', true]);
    await handleEvent(evt('customer.subscription.updated', { id: s.id, object: 'subscription' }));
    const mid = await localSub(s.id);
    assert.deepEqual([mid.status, mid.cancel_at_period_end], ['active', true]);
    assert.equal((await admin((c) => cancelSubscription(c, { id, atPeriodEnd: false, actorId: U.admin }))).stripe_status, 'canceled');
    // Repetida antes de que llegue el webhook (fila local aún active): 409, no el resource_missing de Stripe.
    await assert.rejects(admin((c) => cancelSubscription(c, { id, atPeriodEnd: false, actorId: U.admin })),
      (e) => e.status === 409 && e.code === 'subscription_cancelled');
    await handleEvent(evt('customer.subscription.deleted', { id: s.id, object: 'subscription' }));
    assert.equal((await localSub(s.id)).status, 'cancelled');
    await assert.rejects(admin((c) => cancelSubscription(c, { id, atPeriodEnd: false, actorId: U.admin })),
      (e) => e.status === 409 && e.code === 'subscription_cancelled');
    await assert.rejects(admin((c) => cancelSubscription(c, { id: crypto.randomUUID(), atPeriodEnd: false, actorId: U.admin })),
      (e) => e.status === 404);
    const actions = (await q(`SELECT action FROM audit_log WHERE resource_id = $1 ORDER BY created_at`, [id])).map((r) => r.action);
    assert.deepEqual(actions, ['subscription.create', 'subscription.cancel_at_period_end', 'notice.subscription_cancelled',
      'subscription.cancel_now', 'notice.subscription_cancelled']);
    // B10.6: aviso al pagador con la fecha de fin (fin de periodo o ahora), sin bajada descartada.
    const [atEnd, now] = await noticeOf('notice.subscription_cancelled', id);
    assert.deepEqual([atEnd.recipients, atEnd.discarded_plan_id], [[U.alu], null]);
    assert.ok(new Date(atEnd.ends_at) > new Date(Date.now() + 86400_000) && new Date(now.ends_at) <= new Date());
  });

  // --- B10.5: cambio de plan. Subida = pending update; bajada = Schedule; el webhook aplica la metadata. ---
  const mkPlan = async (tag, body) => {
    const p = await withRls({ uid: U.admin, role: 'admin' }, (c) => createPlan(c, { name: `T-Wh-${tag}-${Date.now()}`, ...body }));
    extraPlans.push(p.id);
    return p;
  };
  const up = await mkPlan('two', { price_cents: 3000, max_disciplines: 2 });
  const top = await mkPlan('all', { price_cents: 4000, max_disciplines: null });
  const down = await mkPlan('cheap', { price_cents: 1000, max_disciplines: 1 });
  const kids = await mkPlan('kids', { price_cents: 2500, max_disciplines: null, minors_only: true });
  const same = await mkPlan('same', { price_cents: 1000, max_disciplines: 1 }); // mismo precio que down = bajada
  const [{ id: discB }] = await q(`INSERT INTO disciplines (name) VALUES ('T-Wh-B') RETURNING id`);
  const [{ id: discC }] = await q(`INSERT INTO disciplines (name) VALUES ('T-Wh-C') RETURNING id`);
  extraDiscs.push(discB, discC);
  const asPc = (fn) => withRls({ uid: U.pc, role: 'alumno' }, fn);
  const asAdmin = (fn) => withRls({ uid: U.admin, role: 'admin' }, fn);
  const change = (who, id, planId, disciplineIds = []) => withRls({ uid: U[who], role: people[who] },
    (c) => changePlan(c, { id, actorId: U[who], isAdmin: who === 'admin', planId, disciplineIds }));
  const updated = (subId) => handleEvent(evt('customer.subscription.updated', { id: subId, object: 'subscription' }));
  const discsOf = async (id) =>
    (await q(`SELECT discipline_id FROM subscription_disciplines WHERE subscription_id = $1 ORDER BY 1`, [id])).map((r) => r.discipline_id);
  const bookOn = async (discipline, student) => {
    const [x] = await q(
      `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
       VALUES ($1, $2, now() + $3 * interval '1 day', now() + $3 * interval '1 day' + interval '1 hour', 60, 5, 'scheduled')
       RETURNING id`, [discipline, U.prof, 4 + extraSessions.length]); // un día por sesión: el profesor no se solapa
    extraSessions.push(x.id);
    return (await q(`INSERT INTO bookings (id, session_id, student_id, booked_by, status)
                     VALUES (gen_random_uuid(), $1, $2, $2, 'confirmed') RETURNING id`, [x.id, student]))[0].id;
  };
  const bookingOf = async (id) => (await q(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [id]))[0];
  const setDefaultPm = async (cus, pm) => {
    const attached = await stripe.paymentMethods.attach(pm, { customer: cus });
    await stripe.customers.update(cus, { invoice_settings: { default_payment_method: attached.id } });
    return attached.id;
  };

  const cusPc = await customer('pc', 'pm_card_visa');
  const visaPc = (await stripe.customers.retrieve(cusPc)).invoice_settings.default_payment_method;
  const pcSub = await paidSub(cusPc, 'pc', 'pc');
  await handleEvent(completed(pcSub));
  const pcRow = await localSub(pcSub.id);

  await run('subida: pending update pagado; el webhook aplica plan y disciplinas y cancela lo que deja de cubrirse', async () => {
    const bk = await bookOn(disc, U.pc);
    assert.deepEqual((await change('pc', pcRow.id, up.id, [discB, discC])).body, { change: 'upgrade', status: 'applied' });
    const st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['latest_invoice'] });
    assert.deepEqual([st.items.data[0].price.id, st.metadata.plan_id, st.pending_update],
      [(await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [up.id]))[0].stripe_price_id, up.id, null]);
    assert.deepEqual([st.latest_invoice.billing_reason, st.latest_invoice.status], ['subscription_update', 'paid']);
    assert.ok(st.latest_invoice.amount_paid > 0, 'prorrateo cobrado');
    assert.equal((await localSub(pcSub.id)).plan_id, plan.id, 'local intacto hasta el webhook');
    await updated(pcSub.id);
    assert.equal((await localSub(pcSub.id)).plan_id, up.id);
    assert.deepEqual(await discsOf(pcRow.id), [discB, discC].sort());
    assert.deepEqual(Object.values(await bookingOf(bk)), ['cancelled', 'no_coverage']);
    assert.deepEqual(await noticeOf('notice.plan_downgraded', pcRow.id), [], 'subida: sin aviso de bajada');
  });

  await run('subida rechazada: 402 payment_failed, recibo anulado y nada cambia', async () => {
    await setDefaultPm(cusPc, 'pm_card_chargeCustomerFail');
    try {
      await assert.rejects(change('pc', pcRow.id, top.id), (e) => e.status === 402 && e.code === 'payment_failed');
      const st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['latest_invoice'] });
      assert.deepEqual([st.metadata.plan_id, st.pending_update, st.latest_invoice.status], [up.id, null, 'void']);
      await updated(pcSub.id);
      assert.equal((await localSub(pcSub.id)).plan_id, up.id);
      // El recibo fallido del prorrateo se guarda anulado y sin aviso de cobro fallido (el pagador está en pantalla).
      await handleEvent(evt('invoice.payment_failed', { id: st.latest_invoice.id, object: 'invoice' }));
      const [inv] = await q(`SELECT id, status FROM invoices WHERE stripe_invoice_id = $1`, [st.latest_invoice.id]);
      assert.equal(inv.status, 'void');
      assert.deepEqual(await noticeOf('notice.payment_failed', inv.id), []);
    } finally {
      await stripe.customers.update(cusPc, { invoice_settings: { default_payment_method: visaPc } });
    }
  });

  await run('subida con 3DS: el pagador recibe client_secret; el admin → 409 requires_payer_action y aviso al pagador', async () => {
    await setDefaultPm(cusPc, 'pm_card_threeDSecure2Required');
    try {
      const { body } = await change('pc', pcRow.id, top.id);
      assert.deepEqual([body.change, body.status], ['upgrade', 'requires_action']);
      assert.match(body.client_secret, /_secret_/);
      await assert.rejects(change('admin', pcRow.id, top.id), (e) => e.status === 409 && e.code === 'requires_payer_action');
      const [n] = await noticeOf('notice.upgrade_requires_action', pcRow.id);
      assert.deepEqual([n.recipients, n.plan_id], [[U.pc], top.id]);
      assert.match(n.hosted_invoice_url, /^https:\/\//);
      const { pending_update: pu } = await stripe.subscriptions.retrieve(pcSub.id);
      assert.ok(pu, 'sigue pendiente del pago');
      // B10.6: el email muestra la fecha límite y el importe.
      assert.deepEqual([new Date(n.expires_at).getTime(), n.from_plan_id, n.amount_cents > 0], [pu.expires_at * 1000, (await localSub(pcSub.id)).plan_id, true]);
      assert.deepEqual(await deliveriesOf('notice.upgrade_requires_action', pcRow.id), [{ recipient_id: U.pc, channel: 'email' }]);
      // Una bajada sustituye la subida a medias (Stripe no deja tocar el Schedule con un pending update).
      assert.equal((await change('pc', pcRow.id, down.id, [disc])).status, 202);
      const st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['latest_invoice'] });
      assert.deepEqual([st.pending_update, st.latest_invoice.status, !!st.schedule], [null, 'void', true]);
      await stripe.subscriptionSchedules.release(st.schedule);
    } finally {
      // Limpieza: anular el recibo descarta el pending update.
      const st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['latest_invoice'] });
      if (st.latest_invoice.status === 'open') await stripe.invoices.voidInvoice(st.latest_invoice.id);
      await stripe.customers.update(cusPc, { invoice_settings: { default_payment_method: visaPc } });
    }
    assert.equal((await stripe.subscriptions.retrieve(pcSub.id)).pending_update, null);
  });

  let scheduleId;
  await run('bajada: Schedule con la fase 2 desde fin de periodo → scheduled_*; otra la sustituye; DELETE la anula', async () => {
    const r = await change('pc', pcRow.id, down.id, [disc]);
    assert.equal(r.status, 202);
    const st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['schedule'] });
    scheduleId = st.schedule.id;
    const [p1, p2] = st.schedule.phases;
    assert.deepEqual([r.body.change, r.body.scheduled_at.getTime()], ['downgrade', p1.end_date * 1000]);
    assert.equal(p1.end_date, st.items.data[0].current_period_end);
    assert.deepEqual([p2.metadata.plan_id, p2.metadata.discipline_ids, st.schedule.end_behavior], [down.id, String(disc), 'release']);
    assert.equal(st.metadata.plan_id, up.id, 'la suscripción no cambia hasta la fase 2');
    await handleEvent(evt('subscription_schedule.updated', { id: scheduleId, object: 'subscription_schedule' }));
    let row = await localSub(pcSub.id);
    assert.deepEqual([row.plan_id, row.stripe_schedule_id, row.scheduled_plan_id, row.scheduled_discipline_ids, row.scheduled_at.getTime()],
      [up.id, scheduleId, down.id, [disc], p1.end_date * 1000]);
    // Otra bajada sustituye la fase 2 en el mismo Schedule.
    assert.equal((await change('admin', pcRow.id, plan.id, [discB])).status, 202);
    const again = await stripe.subscriptionSchedules.retrieve(scheduleId);
    assert.deepEqual([again.phases.length, again.phases[1].metadata.plan_id], [2, plan.id]);
    await handleEvent(evt('subscription_schedule.updated', { id: scheduleId, object: 'subscription_schedule' }));
    const got = await asPc((c) => getSubscription(c, { studentId: U.pc }));
    assert.deepEqual([got.plan.id, got.scheduled_change.plan_id, got.scheduled_change.discipline_ids], [up.id, plan.id, [String(discB)]]);
    // Anularla: se libera el Schedule.
    await asPc((c) => cancelScheduledChange(c, { id: pcRow.id, actorId: U.pc, isAdmin: false }));
    await handleEvent(evt('subscription_schedule.released', { id: scheduleId, object: 'subscription_schedule' }));
    row = await localSub(pcSub.id);
    assert.deepEqual([row.stripe_schedule_id, row.scheduled_plan_id, row.scheduled_discipline_ids, row.scheduled_at], [null, null, null, null]);
    await assert.rejects(asPc((c) => cancelScheduledChange(c, { id: pcRow.id, actorId: U.pc, isAdmin: false })),
      (e) => e.status === 404 && e.code === 'no_scheduled_change');
  });

  await run('subida con una bajada programada: libera el Schedule y aplica la subida', async () => {
    await change('pc', pcRow.id, down.id, [disc]);
    await change('pc', pcRow.id, top.id);
    const st = await stripe.subscriptions.retrieve(pcSub.id);
    assert.deepEqual([st.schedule, st.metadata.plan_id], [null, top.id]);
    await updated(pcSub.id);
    const row = await localSub(pcSub.id);
    assert.deepEqual([row.plan_id, row.stripe_schedule_id, row.scheduled_plan_id], [top.id, null, null]);
    assert.deepEqual(await discsOf(pcRow.id), [], '«todas»: sin disciplinas elegidas');
  });

  await run('bajada aplicada (cambio de fase simulado): plan y disciplinas de la metadata, revoke_coverage y aviso', async () => {
    const bk = await bookOn(discC, U.pc); // «todas» la cubre; el plan barato con disc no
    const st = await stripe.subscriptions.retrieve(pcSub.id);
    const [{ stripe_price_id: downPrice }] = await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [down.id]);
    // Lo que hace Stripe al entrar en la fase 2: Price y metadata de la fase.
    await stripe.subscriptions.update(pcSub.id, {
      items: [{ id: st.items.data[0].id, price: downPrice }], proration_behavior: 'none',
      metadata: { plan_id: down.id, discipline_ids: String(disc) },
    });
    await updated(pcSub.id);
    assert.equal((await localSub(pcSub.id)).plan_id, down.id);
    assert.deepEqual(await discsOf(pcRow.id), [disc]);
    assert.deepEqual(Object.values(await bookingOf(bk)), ['cancelled', 'no_coverage']);
    const [n] = await noticeOf('notice.plan_downgraded', pcRow.id);
    assert.deepEqual([n.recipients, n.from_plan_id, n.to_plan_id], [[U.pc], top.id, down.id]);
    // Repetido: plan_id ya coincide, no se aplica ni avisa otra vez.
    await updated(pcSub.id);
    assert.equal((await noticeOf('notice.plan_downgraded', pcRow.id)).length, 1);
  });

  const priceOf = async (planId) => (await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [planId]))[0].stripe_price_id;
  await run('cambio de precio con una bajada programada: el Price cambia en las fases del Schedule', async () => {
    assert.equal((await change('pc', pcRow.id, same.id, [discB])).status, 202, 'mismo precio = bajada');
    // El webhook rellena scheduled_plan_id, por el que la sincronización encuentra el Schedule.
    const sch = (await stripe.subscriptions.retrieve(pcSub.id)).schedule;
    await handleEvent(evt('subscription_schedule.created', { id: sch, object: 'subscription_schedule' }));
    assert.equal((await localSub(pcSub.id)).scheduled_plan_id, same.id);
    await asAdmin((c) => updatePlan(c, { id: same.id, body: { price_cents: 900 }, actorId: U.admin }));
    let st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['schedule'] });
    assert.deepEqual(st.schedule.phases.map((p) => p.items[0].price), [await priceOf(down.id), await priceOf(same.id)]);
    // Precio del plan actual: fase actual y suscripción, sin prorrateo; la pendiente se respeta.
    await asAdmin((c) => updatePlan(c, { id: down.id, body: { price_cents: 1100 }, actorId: U.admin }));
    st = await stripe.subscriptions.retrieve(pcSub.id, { expand: ['schedule'] });
    assert.deepEqual(st.schedule.phases.map((p) => p.items[0].price), [await priceOf(down.id), await priceOf(same.id)]);
    assert.equal(st.items.data[0].price.id, await priceOf(down.id));
    assert.equal(st.schedule.phases[1].metadata.plan_id, same.id);
    // Retirar el plan de destino no cancela la bajada programada.
    await asAdmin((c) => updatePlan(c, { id: same.id, body: { is_active: false }, actorId: U.admin }));
    assert.equal((await stripe.subscriptionSchedules.retrieve(st.schedule.id)).phases[1].items[0].price, await priceOf(same.id));
    await handleEvent(evt('subscription_schedule.updated', { id: st.schedule.id, object: 'subscription_schedule' }));
    assert.equal((await localSub(pcSub.id)).scheduled_plan_id, same.id);
  });

  await run('baja admin con una bajada programada: libera el Schedule, descarta la bajada y avisa al pagador', async () => {
    const { schedule } = await stripe.subscriptions.retrieve(pcSub.id);
    const end = await asAdmin((c) => cancelSubscription(c, { id: pcRow.id, atPeriodEnd: true, actorId: U.admin }));
    assert.deepEqual([end.stripe_status, end.cancel_at_period_end], ['active', true]);
    assert.equal((await stripe.subscriptionSchedules.retrieve(schedule)).status, 'released');
    // B10.6: subscription_cancelled sustituye a scheduled_change_discarded.
    assert.deepEqual(await noticeOf('notice.scheduled_change_discarded', pcRow.id), []);
    const [n] = await noticeOf('notice.subscription_cancelled', pcRow.id);
    assert.deepEqual([n.recipients, n.plan_id, n.discarded_plan_id], [[U.pc], down.id, same.id]);
    assert.equal(new Date(n.ends_at).getTime(), (await stripe.subscriptions.retrieve(pcSub.id)).cancel_at * 1000);
    assert.deepEqual(await deliveriesOf('notice.subscription_cancelled', pcRow.id), [{ recipient_id: U.pc, channel: 'email' }]);
    await updated(pcSub.id);
    const row = await localSub(pcSub.id);
    assert.deepEqual([row.cancel_at_period_end, row.stripe_schedule_id, row.scheduled_plan_id], [true, null, null]);
    await assert.rejects(change('pc', pcRow.id, up.id, [disc, discB]), (e) => e.status === 409 && e.code === 'cancel_scheduled');
  });

  await run('adulto en un plan solo menores: el cambio es inmediato aunque baje; deja saldo a favor', async () => {
    const cus = await customer('pc2', 'pm_card_visa');
    const [{ stripe_price_id: kidsPrice }] = await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [kids.id]);
    const s = await stripe.subscriptions.create({ customer: cus, items: [{ price: kidsPrice }],
      metadata: { student_id: U.pc2, payer_id: U.pc2, plan_id: kids.id, discipline_ids: '' } });
    stripeSubs.push(s.id);
    await handleEvent(completed(s));
    const row = await localSub(s.id);
    assert.equal(row.plan_id, kids.id);
    const r = await change('pc2', row.id, down.id, [disc]);
    assert.deepEqual([r.status, r.body.status], [200, 'applied']);
    await updated(s.id);
    assert.equal((await localSub(s.id)).plan_id, down.id);
    assert.ok((await stripe.customers.retrieve(cus)).balance < 0, 'saldo a favor, sin reembolso');
  });

  // --- B30: pausa. El cambio de fase se simula al releer el Schedule (current_phase); con el reloj, test:e2e-b30. ---
  await asAdmin((c) => updatePauseSettings(c, { price_cents: 700 }, U.admin));
  const cusPz = await customer('pz', 'pm_card_visa');
  const pzSub = await paidSub(cusPz, 'pz', 'pz');
  await handleEvent(completed(pzSub));
  const pzRow = await localSub(pzSub.id);
  const pauseOf = async (id) => (await q(`SELECT * FROM pauses WHERE id = $1`, [id]))[0];
  const asPz = (fn) => withRls({ uid: U.pz, role: 'alumno' }, fn);
  // Stripe al releer el Schedule, en la fase `i` (0 = la actual, 1 = mantenimiento, 2 = la vuelta).
  const inPhase = async (i, fn) => {
    const { retrieve } = stripe.subscriptionSchedules;
    stripe.subscriptionSchedules.retrieve = async (...a) => {
      const s = await retrieve.apply(stripe.subscriptionSchedules, a);
      const p = s.phases[i];
      return s.metadata?.kind === 'pause' ? { ...s, current_phase: { start_date: p.start_date, end_date: p.end_date } } : s;
    };
    try { await fn(); } finally { stripe.subscriptionSchedules.retrieve = retrieve; }
  };
  let pzPause;

  await run('pausa: el Schedule no se toma por bajada (sin scheduled_*); empieza → active y aviso; vuelve → completed y aviso', async () => {
    pzPause = (await asPz((c) => requestPause(c, { id: pzRow.id, actorId: U.pz, isAdmin: false, months: 1 }))).body;
    const sch = (await stripe.subscriptions.retrieve(pzSub.id)).schedule;
    await handleEvent(evt('subscription_schedule.created', { id: sch, object: 'subscription_schedule' }));
    let row = await localSub(pzSub.id);
    assert.deepEqual([row.stripe_schedule_id, row.scheduled_plan_id, row.scheduled_at], [sch, null, null]);
    assert.equal((await pauseOf(pzPause.id)).status, 'scheduled');
    assert.equal((await asPz((c) => getSubscription(c, { studentId: U.pz }))).scheduled_change, null);
    await inPhase(1, async () => {
      await updated(pzSub.id);
      await handleEvent(evt('subscription_schedule.updated', { id: sch, object: 'subscription_schedule' })); // repetido
    });
    assert.equal((await pauseOf(pzPause.id)).status, 'active');
    const started = await noticeOf('notice.pause_started', pzPause.id);
    assert.deepEqual([started.length, started[0].recipients, started[0].student_id, started[0].plan_id], [1, [U.pz], U.pz, plan.id]);
    assert.deepEqual(await deliveriesOf('notice.pause_started', pzPause.id), [{ recipient_id: U.pz, channel: 'email' }]);
    row = await localSub(pzSub.id);
    assert.deepEqual([row.status, row.plan_id, row.scheduled_plan_id], ['active', plan.id, null], 'la pausa no cambia plan ni estado');
    await inPhase(2, () => updated(pzSub.id));
    assert.equal((await pauseOf(pzPause.id)).status, 'completed');
    assert.equal((await noticeOf('notice.pause_ended', pzPause.id)).length, 1);
    await inPhase(2, () => updated(pzSub.id));
    assert.equal((await noticeOf('notice.pause_ended', pzPause.id)).length, 1, 'repetido: un solo aviso');
    assert.equal((await asPz((c) => getSubscription(c, { studentId: U.pz }))).pause, null);
  });

  await run('bajada sobre el Schedule de una pausa ya acabada: limpia su metadata y vuelve a ser una bajada', async () => {
    assert.equal((await change('pz', pzRow.id, down.id, [disc])).status, 202);
    const sch = (await stripe.subscriptions.retrieve(pzSub.id, { expand: ['schedule'] })).schedule;
    assert.deepEqual([sch.metadata, sch.phases.length], [{}, 2]);
    await handleEvent(evt('subscription_schedule.updated', { id: sch.id, object: 'subscription_schedule' }));
    assert.equal((await localSub(pzSub.id)).scheduled_plan_id, down.id);
    assert.equal((await pauseOf(pzPause.id)).status, 'completed', 'la pausa acabada no se toca');
    await asPz((c) => cancelScheduledChange(c, { id: pzRow.id, actorId: U.pz, isAdmin: false }));
    await handleEvent(evt('subscription_schedule.released', { id: sch.id, object: 'subscription_schedule' }));
  });

  await run('pausa anulada: el webhook de la liberación la confirma anulada', async () => {
    await q(`UPDATE pauses SET starts_at = starts_at - interval '1 year' WHERE id = $1`, [pzPause.id]); // fuera del año
    const p = (await asPz((c) => requestPause(c, { id: pzRow.id, actorId: U.pz, isAdmin: false, months: 1 }))).body;
    const sch = (await stripe.subscriptions.retrieve(pzSub.id)).schedule;
    // El webhook llega antes de que el endpoint escriba «anulada»: lo deduce de la liberación antes del inicio.
    await stripe.subscriptionSchedules.release(sch);
    await handleEvent(evt('subscription_schedule.released', { id: sch, object: 'subscription_schedule' }));
    assert.equal((await pauseOf(p.id)).status, 'cancelled');
    assert.deepEqual([(await localSub(pzSub.id)).stripe_schedule_id], [null]);
    await q(`UPDATE pauses SET starts_at = starts_at - interval '1 year' WHERE id = $1`, [p.id]);
  });

  await run('baja con una pausa programada: libera el Schedule, el aviso la da por anulada y el webhook la anula', async () => {
    const p = (await asPz((c) => requestPause(c, { id: pzRow.id, actorId: U.pz, isAdmin: false, months: 1 }))).body;
    const { schedule } = await stripe.subscriptions.retrieve(pzSub.id);
    await asAdmin((c) => cancelSubscription(c, { id: pzRow.id, atPeriodEnd: true, actorId: U.admin }));
    assert.equal((await stripe.subscriptionSchedules.retrieve(schedule)).status, 'released');
    const [n] = await noticeOf('notice.subscription_cancelled', pzRow.id);
    assert.deepEqual([n.discarded_plan_id, n.discarded_pause], [null, true]);
    await handleEvent(evt('subscription_schedule.released', { id: schedule, object: 'subscription_schedule' }));
    assert.equal((await pauseOf(p.id)).status, 'cancelled');
  });

  await run('baja a mitad de una pausa en curso: queda acabada en el fin de la suscripción', async () => {
    // Pausa en curso simulada: Schedule liberado a mitad de la fase de mantenimiento.
    const [p] = await q(
      `INSERT INTO pauses (subscription_id, starts_at, ends_at, months, price_cents, requested_by, status)
       VALUES ($1, now() - interval '10 days', now() + interval '50 days', 2, 700, $2, 'active') RETURNING id, ends_at`, [pzRow.id, U.pz]);
    const now = Math.floor(Date.now() / 1000);
    const released = { id: 'sub_sched_test', object: 'subscription_schedule', status: 'released', released_at: now,
      metadata: { kind: 'pause', pause_id: p.id }, subscription: null, released_subscription: pzSub.id, phases: [] };
    const { retrieve } = stripe.subscriptionSchedules;
    stripe.subscriptionSchedules.retrieve = async (id, ...a) => (id === released.id ? released : retrieve.call(stripe.subscriptionSchedules, id, ...a));
    try {
      await handleEvent(evt('subscription_schedule.released', { id: released.id, object: 'subscription_schedule' }));
    } finally { stripe.subscriptionSchedules.retrieve = retrieve; }
    const got = await pauseOf(p.id);
    const end = (await stripe.subscriptions.retrieve(pzSub.id)).items.data[0].current_period_end * 1000;
    assert.deepEqual([got.status, got.ends_at.getTime()], ['completed', Math.min(end, p.ends_at.getTime())]);
    assert.deepEqual(await noticeOf('notice.pause_ended', p.id), [], 'la baja ya avisa');
  });

  await run('cobro fallido de la cuota de mantenimiento: el aviso lo dice (maintenance), no «del plan»', async () => {
    const [{ value: maint }] = await q(`SELECT value #>> '{}' AS value FROM academy_settings WHERE key = 'pause_stripe_price'`);
    const s = await stripe.subscriptions.create({ customer: cusTutor, items: [{ price: maint }] });
    stripeSubs.push(s.id);
    await q(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
             VALUES ($1, $2, $3, 'incomplete', $4)`, [U.child, U.tutor, plan.id, s.id]);
    await handleEvent(evt('invoice.payment_failed', { id: s.latest_invoice, object: 'invoice' }));
    const [inv] = await q(`SELECT id FROM invoices WHERE stripe_invoice_id = $1`, [s.latest_invoice]);
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.payment_failed' AND resource_id = $1`, [inv.id]);
    assert.equal(n.changes.maintenance, true);
  });

  await run('cambio de precio del plan con una pausa programada: la vuelta (y la fase actual) al Price nuevo; la de mantenimiento no', async () => {
    const pzPlan = await mkPlan('pz', { price_cents: 2000, max_disciplines: 1 });
    const cus = await customer('pz2', 'pm_card_visa');
    const s = await stripe.subscriptions.create({ customer: cus, items: [{ price: await priceOf(pzPlan.id) }],
      metadata: { student_id: U.pz2, payer_id: U.pz2, plan_id: pzPlan.id, discipline_ids: String(disc) } });
    stripeSubs.push(s.id);
    await handleEvent(completed(s));
    const row = await localSub(s.id);
    await withRls({ uid: U.pz2, role: 'alumno' }, (c) => requestPause(c, { id: row.id, actorId: U.pz2, isAdmin: false, months: 2 }));
    const maint = (await stripe.subscriptions.retrieve(s.id, { expand: ['schedule'] })).schedule.phases[1].items[0].price;
    await asAdmin((c) => updatePlan(c, { id: pzPlan.id, body: { price_cents: 2200 }, actorId: U.admin }));
    const sch = (await stripe.subscriptions.retrieve(s.id, { expand: ['schedule'] })).schedule;
    const fresh = await priceOf(pzPlan.id);
    assert.deepEqual(sch.phases.map((x) => x.items[0].price), [fresh, maint, fresh]);
    assert.deepEqual([sch.metadata.kind, sch.phases[2].metadata.plan_id], ['pause', pzPlan.id]);
  });

  // --- B10.6: avisos nuevos ---
  await run('impagada: subscription_unpaid con el recibo y su entrega, solo en la transición a unpaid', async () => {
    const cus = await customer('unp', 'pm_card_visa');
    const s = await paidSub(cus, 'unp', 'unp');
    await handleEvent(completed(s));
    const row = await localSub(s.id);
    await asUnpaid(s.id, async () => {
      await updated(s.id);
      await updated(s.id); // otro evento ya en unpaid: sin aviso nuevo
    });
    assert.equal((await localSub(s.id)).status, 'unpaid');
    const ns = await noticeOf('notice.subscription_unpaid', row.id);
    assert.equal(ns.length, 1);
    const inv = await stripe.invoices.retrieve(s.latest_invoice);
    assert.deepEqual([ns[0].recipients, ns[0].plan_id, ns[0].amount_cents], [[U.unp], plan.id, inv.amount_due]);
    assert.match(ns[0].hosted_invoice_url, /^https:\/\/invoice\.stripe\.com\//); // el token cambia en cada lectura
    assert.deepEqual(await deliveriesOf('notice.subscription_unpaid', row.id), [{ recipient_id: U.unp, channel: 'email' }]);
    // Vuelve a active (pagó) y otra vez a unpaid: es otra transición.
    await updated(s.id);
    await asUnpaid(s.id, () => updated(s.id));
    assert.equal((await noticeOf('notice.subscription_unpaid', row.id)).length, 2);
  });

  // --- B11: bajas. Un recibo open de una suscripción cancelada sigue cobrándose: la baja inmediata lo anula. ---
  // Recibo open sin intento de cobro (auto_advance false), como el que deja un cobro fallido.
  const openInvoice = async (subId) => {
    const { customer: cus } = await stripe.subscriptions.retrieve(subId);
    await stripe.invoiceItems.create({ customer: cus, subscription: subId, amount: 500, currency: 'eur' });
    const inv = await stripe.invoices.create({ customer: cus, subscription: subId, auto_advance: false });
    return stripe.invoices.finalizeInvoice(inv.id, { auto_advance: false });
  };
  await run('baja inmediata de la suscripción: anula sus recibos open y el aviso lo dice', async () => {
    const s = (await q(`SELECT stripe_subscription_id, id FROM subscriptions WHERE student_id = $1`, [U.unp]))[0];
    const inv = await openInvoice(s.stripe_subscription_id);
    await asAdmin((c) => cancelSubscription(c, { id: s.id, atPeriodEnd: false, actorId: U.admin }));
    assert.equal((await stripe.invoices.retrieve(inv.id)).status, 'void');
    const [n] = await noticeOf('notice.subscription_cancelled', s.id);
    assert.equal(n.voided, 1);
  });

  // --- B11: cambio de pagador. D se simula cancelando la antigua en Stripe (como la fase de B10.5). ---
  const cusT1 = await customer('t1', 'pm_card_visa');
  const cusT2 = await customer('t2', 'pm_card_visa');
  const kidOld = await paidSub(cusT1, 'kid', 't1');
  await handleEvent(completed(kidOld));
  const kidRow = await localSub(kidOld.id);
  const pcOf = async (id) => (await q(`SELECT * FROM payer_changes WHERE id = $1`, [id]))[0];
  const requestPc = async (subId, payer) =>
    (await asAdmin((c) => requestPayerChange(c, { id: subId, payerId: U[payer], actorId: U.admin }))).body;
  // Lo que deja el Checkout del cambio pagado: la sucesora con anchor = D y el pedido en la metadata, sin cobro hoy.
  const successor = async (pc, cus, payer) => {
    const s = await stripe.subscriptions.create({
      customer: cus, items: [{ price: await priceOf(pc.plan_id) }],
      billing_cycle_anchor: Math.floor(pc.starts_at / 1000), proration_behavior: 'none',
      metadata: { student_id: U.kid, payer_id: U[payer], plan_id: pc.plan_id, discipline_ids: pc.discipline_ids.join(','),
        payer_change_id: pc.id },
    });
    stripeSubs.push(s.id);
    return s;
  };
  // El sondeo con test clock: el Checkout de 0 € llega como no_payment_required.
  const paidCheckout = (s) => handleEvent(completed(s, { payment_status: 'no_payment_required' }));
  // Renovación en D (simulada al releer): periodo nuevo desde startsAt.
  const asRenewed = async (subId, startsAt, fn) => {
    const start = Math.floor(startsAt / 1000);
    const { retrieve } = stripe.subscriptions;
    stripe.subscriptions.retrieve = async (...a) => {
      const st = await retrieve.apply(stripe.subscriptions, a);
      return a[0] !== subId ? st
        : { ...st, items: { ...st.items, data: [{ ...st.items.data[0], current_period_start: start, current_period_end: start + 30 * 86400 }] } };
    };
    try { await fn(); } finally { stripe.subscriptions.retrieve = retrieve; }
  };
  const liveOfKid = async () => (await q(`SELECT id FROM subscriptions WHERE student_id = $1 AND status IN ('active', 'past_due', 'unpaid')`, [U.kid])).length;
  let pc1, succ1, succ2;

  await run('Checkout del cambio pagado: paid, la antigua con cancel_at_period_end y su Schedule liberado, sin fila nueva', async () => {
    // Bajada programada antes de pedirlo: se traslada a la sucesora y su Schedule se libera al pagar.
    assert.equal((await change('t1', kidRow.id, down.id, [disc])).status, 202);
    pc1 = await requestPc(kidRow.id, 't2');
    assert.deepEqual([pc1.plan_id, pc1.discipline_ids], [down.id, [disc]]);
    succ1 = await successor(pc1, cusT2, 't2');
    await paidCheckout(succ1);
    const pc = await pcOf(pc1.id);
    assert.deepEqual([pc.status, pc.stripe_subscription_id], ['paid', succ1.id]);
    const st = await stripe.subscriptions.retrieve(kidOld.id);
    assert.deepEqual([st.status, st.cancel_at_period_end, st.schedule], ['active', true, null]);
    assert.equal(await localSub(succ1.id), undefined, 'la sucesora no tiene fila hasta el traspaso');
    const [n] = await noticeOf('notice.payer_change_paid', pc1.id);
    assert.deepEqual([n.recipients, n.from_plan_id, n.plan_id], [[U.t1, U.t2], plan.id, down.id]);
    // Antes de D, los eventos de la sucesora no hacen nada (la antigua sigue viva en Stripe).
    await handleEvent(evt('customer.subscription.created', { id: succ1.id, object: 'subscription' }));
    assert.deepEqual([await localSub(succ1.id), (await pcOf(pc1.id)).status], [undefined, 'paid']);
    // Repetido: nada. Otra sucesora del mismo cambio (dos Checkouts pagados): se cancela sin aviso.
    await paidCheckout(succ1);
    const dup = await successor(pc1, cusT2, 't2');
    await paidCheckout(dup);
    assert.equal((await stripe.subscriptions.retrieve(dup.id)).status, 'canceled');
    assert.deepEqual([(await pcOf(pc1.id)).stripe_subscription_id, await noticeOf('notice.payer_change_cancelled', pc1.id)], [succ1.id, []]);
  });

  await run('traspaso con la antigua primero: una sola fila y reservas intactas; repetido no cambia nada', async () => {
    const bk = await bookOn(disc, U.kid);
    await stripe.subscriptions.cancel(kidOld.id); // D
    await handleEvent(evt('customer.subscription.deleted', { id: kidOld.id, object: 'subscription' }));
    assert.equal((await localSub(kidOld.id)).status, 'cancelled');
    const row = await localSub(succ1.id);
    assert.deepEqual([row.payer_id, row.plan_id, row.status, row.current_period_end.getTime()],
      [U.t2, down.id, 'active', pc1.starts_at.getTime()]);
    assert.deepEqual(await discsOf(row.id), [disc]);
    assert.equal((await pcOf(pc1.id)).status, 'completed');
    assert.deepEqual(await altasOf(row.id), [], 'un traspaso no es un alta');
    assert.deepEqual(Object.values(await bookingOf(bk)), ['confirmed', null], 'la cobertura no se interrumpe');
    await handleEvent(evt('customer.subscription.deleted', { id: kidOld.id, object: 'subscription' }));
    await handleEvent(evt('customer.subscription.updated', { id: succ1.id, object: 'subscription' }));
    assert.equal(await liveOfKid(), 1);
  });

  await run('traspaso con la sucesora primero (su recibo)', async () => {
    const row1 = await localSub(succ1.id);
    const pc2 = await requestPc(row1.id, 't1'); // de vuelta a t1
    succ2 = await successor(pc2, cusT1, 't1');
    await paidCheckout(succ2);
    await stripe.subscriptions.cancel(succ1.id); // D
    const inv = await openInvoice(succ2.id);
    await handleEvent(evt('invoice.finalized', { id: inv.id, object: 'invoice' }));
    const row2 = await localSub(succ2.id);
    assert.deepEqual([row2.payer_id, (await localSub(succ1.id)).status, (await pcOf(pc2.id)).status], [U.t1, 'cancelled', 'completed']);
    assert.equal((await q(`SELECT subscription_id FROM invoices WHERE stripe_invoice_id = $1`, [inv.id]))[0].subscription_id, row2.id);
    await handleEvent(evt('customer.subscription.deleted', { id: succ1.id, object: 'subscription' }));
    assert.equal(await liveOfKid(), 1);
  });

  await run('sin pago a tiempo: la renovación de la antigua lo marca expired y avisa a admins, antiguo y nuevo', async () => {
    const row2 = await localSub(succ2.id);
    const pc3 = await requestPc(row2.id, 't2');
    await asRenewed(succ2.id, pc3.starts_at,
      () => handleEvent(evt('customer.subscription.updated', { id: succ2.id, object: 'subscription' })));
    assert.equal((await pcOf(pc3.id)).status, 'expired');
    const [n] = await noticeOf('notice.payer_change_expired', pc3.id);
    assert.deepEqual([n.recipients.includes(U.admin), n.recipients.slice(-2)], [true, [U.t1, U.t2]]);
    await handleEvent(evt('customer.subscription.updated', { id: succ2.id, object: 'subscription' }));
    assert.equal(await liveOfKid(), 1);
  });

  await run('carrera DELETE / pago: el Checkout pagado de un cambio anulado cancela su sucesora y avisa', async () => {
    const row2 = await localSub(succ2.id);
    const pc4 = await requestPc(row2.id, 't2');
    await asAdmin((c) => cancelPayerChange(c, { id: row2.id, actorId: U.admin }));
    const s = await successor(pc4, cusT2, 't2');
    await paidCheckout(s);
    assert.equal((await stripe.subscriptions.retrieve(s.id)).status, 'canceled');
    assert.equal((await pcOf(pc4.id)).status, 'cancelled');
    const ns = await noticeOf('notice.payer_change_cancelled', pc4.id);
    assert.deepEqual(ns.map((n) => [n.reason, n.recipients]), [['admin', [U.t2]], ['admin', [U.t2]]]);
    assert.deepEqual([await localSub(s.id), await liveOfKid()], [undefined, 1]);
  });

  await run('Checkout que llega tras la renovación: expired, la antigua sin baja y la sucesora reembolsada una vez', async () => {
    const row2 = await localSub(succ2.id);
    const pc6 = await requestPc(row2.id, 't2');
    // Sucesora que ya cobró su primer mes en D: sin anchor, cobra al crearse.
    const s = await stripe.subscriptions.create({ customer: cusT2, items: [{ price: await priceOf(pc6.plan_id) }],
      metadata: { student_id: U.kid, payer_id: U.t2, plan_id: pc6.plan_id, discipline_ids: pc6.discipline_ids.join(','),
        payer_change_id: pc6.id } });
    stripeSubs.push(s.id);
    await asRenewed(succ2.id, pc6.starts_at, async () => {
      await paidCheckout(s);
      await paidCheckout(s); // replay
    });
    const pc = await pcOf(pc6.id);
    assert.deepEqual([pc.status, pc.stripe_subscription_id], ['expired', s.id]);
    assert.equal((await stripe.subscriptions.retrieve(succ2.id)).cancel_at_period_end, false, 'la antigua sigue sin baja');
    assert.equal((await stripe.subscriptions.retrieve(s.id)).status, 'canceled');
    const inv = await stripe.invoices.retrieve(s.latest_invoice, { expand: ['payments.data.payment'] });
    const refunds = await stripe.refunds.list({ payment_intent: inv.payments.data[0].payment.payment_intent });
    assert.deepEqual([inv.amount_paid > 0, refunds.data.length, refunds.data[0].amount], [true, 1, inv.amount_paid]);
    const ns = await noticeOf('notice.payer_change_expired', pc6.id);
    assert.deepEqual(ns.map((n) => [n.refunded, n.recipients.slice(-2)]), [[inv.amount_paid, [U.t1, U.t2]]]);
    // La renovación de la antigua procesada después: nada que caducar.
    await asRenewed(succ2.id, pc6.starts_at,
      () => handleEvent(evt('customer.subscription.updated', { id: succ2.id, object: 'subscription' })));
    assert.deepEqual([(await noticeOf('notice.payer_change_expired', pc6.id)).length, await liveOfKid()], [1, 1]);
  });

  await run('baja de la antigua con el cambio pagado: la sucesora se cancela y se avisa a los dos pagadores', async () => {
    const row2 = await localSub(succ2.id);
    const pc5 = await requestPc(row2.id, 't2');
    const s = await successor(pc5, cusT2, 't2');
    await paidCheckout(s);
    assert.equal((await pcOf(pc5.id)).status, 'paid');
    await asAdmin((c) => cancelSubscription(c, { id: row2.id, atPeriodEnd: false, actorId: U.admin }));
    assert.equal((await stripe.subscriptions.retrieve(s.id)).status, 'canceled');
    const pc = await pcOf(pc5.id);
    assert.deepEqual([pc.status, pc.cancel_reason], ['cancelled', 'subscription_cancelled']);
    const [n] = await noticeOf('notice.payer_change_cancelled', pc5.id);
    assert.deepEqual(n.recipients, [U.t2, U.t1]);
    // El fin de la antigua no se toma por un traspaso.
    await handleEvent(evt('customer.subscription.deleted', { id: succ2.id, object: 'subscription' }));
    assert.deepEqual([await localSub(s.id), await liveOfKid()], [undefined, 0]);
  });
} finally {
  server.close();
  for (const id of stripeSubs) {
    const s = await stripe.subscriptions.retrieve(id);
    if (!['canceled', 'incomplete_expired'].includes(s.status)) await stripe.subscriptions.cancel(id);
  }
  const ids = Object.values(U);
  const subs = (await q(`SELECT id FROM subscriptions WHERE student_id = ANY($1::uuid[])`, [ids])).map((r) => r.id);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
  if (sess) {
    await q(`DELETE FROM bookings WHERE session_id = $1`, [sess.id]);
    await q(`DELETE FROM class_sessions WHERE id = $1`, [sess.id]);
  }
  await q(`DELETE FROM invoices WHERE student_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM payer_changes WHERE student_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM audit_log WHERE resource_id IN (SELECT id::text FROM pauses WHERE subscription_id = ANY($1::uuid[]))`, [subs]);
  await q(`DELETE FROM pauses WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM academy_settings WHERE key LIKE 'pause\\_%'`);
  for (const r of savedPause) await q(`INSERT INTO academy_settings (key, value) VALUES ($1, $2::jsonb)`, [r.key, JSON.stringify(r.value)]);
  await q(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM webhook_events WHERE id = ANY($1::text[])`, [eventIds]);
  for (const x of extraSessions) {
    await q(`DELETE FROM bookings WHERE session_id = $1`, [x]);
    await q(`DELETE FROM class_sessions WHERE id = $1`, [x]);
  }
  await q(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[plan.id, ...extraPlans]]);
  await q(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [[disc, ...extraDiscs]]);
  await q(`DELETE FROM guardianships WHERE tutor_id = ANY($1::uuid[])`, [[U.tutor, U.t1, U.t2]]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
