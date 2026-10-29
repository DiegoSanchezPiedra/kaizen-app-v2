// Webhook de Stripe (B10, B10.1): firma e idempotencia por HTTP; handlers con objetos reales del sandbox.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../src/config/stripe.js';
import { createPlan } from '../src/services/catalog.js';
import { handleEvent } from '../src/services/stripeWebhook.js';
import { cancelSubscription } from '../src/services/billing.js';
import webhooksRouter from '../src/routes/webhooks.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

const people = { admin: 'admin', prof: 'profesor', alu: 'alumno', tutor: 'tutor', child: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-wh`, k === 'child' ? '2016-05-05' : null]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.child]);
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
// Lo que deja un Checkout pagado: suscripción con el pedido en metadata.
const paidSub = async (cus, student, payer) => {
  const s = await stripe.subscriptions.create({
    customer: cus, items: [{ price }],
    metadata: { student_id: U[student], payer_id: U[payer], plan_id: plan.id, discipline_ids: String(disc) },
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

let sub1, raceSub, sess;
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
  await run('invoice.payment_failed: guarda intento y motivo; aviso solo al pagador (tutor), no al hijo', async () => {
    const s = await stripe.subscriptions.create({ customer: cusTutor, items: [{ price }] });
    stripeSubs.push(s.id);
    await q(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
             VALUES ($1, $2, $3, 'incomplete', $4)`, [U.child, U.tutor, plan.id, s.id]);
    await handleEvent(evt('invoice.payment_failed', { id: s.latest_invoice, object: 'invoice' }));
    const [inv] = await q(`SELECT * FROM invoices WHERE stripe_invoice_id = $1`, [s.latest_invoice]);
    assert.deepEqual([inv.status, inv.attempt_count, inv.last_payment_error, inv.payer_id, inv.student_id],
      ['open', 1, 'Your card was declined.', U.tutor, U.child]);
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.payment_failed' AND resource_id = $1`, [inv.id]);
    assert.deepEqual(n.changes.recipients, [U.tutor]);
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
    assert.deepEqual(actions, ['subscription.cancel_at_period_end', 'subscription.cancel_now']);
  });
} finally {
  server.close();
  for (const id of stripeSubs) {
    const s = await stripe.subscriptions.retrieve(id);
    if (s.status !== 'canceled') await stripe.subscriptions.cancel(id);
  }
  const ids = Object.values(U);
  const subs = (await q(`SELECT id FROM subscriptions WHERE student_id = ANY($1::uuid[])`, [ids])).map((r) => r.id);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
  if (sess) {
    await q(`DELETE FROM bookings WHERE session_id = $1`, [sess.id]);
    await q(`DELETE FROM class_sessions WHERE id = $1`, [sess.id]);
  }
  await q(`DELETE FROM invoices WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM webhook_events WHERE id = ANY($1::text[])`, [eventIds]);
  await q(`DELETE FROM plans WHERE id = $1`, [plan.id]);
  await q(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await q(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tutor]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
