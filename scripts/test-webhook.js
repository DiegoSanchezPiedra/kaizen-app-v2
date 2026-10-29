// Webhook de Stripe (B10, B10.1, B10.3): firma e idempotencia por HTTP; handlers con objetos reales del sandbox.
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
  cancelSubscription, updateInsuranceSettings, changePlan, cancelScheduledChange, getSubscription,
} from '../src/services/billing.js';
import webhooksRouter from '../src/routes/webhooks.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

const people = {
  admin: 'admin', prof: 'profesor', alu: 'alumno', tutor: 'tutor', child: 'alumno', ins: 'alumno', ins2: 'alumno',
  pc: 'alumno', pc2: 'alumno', // B10.5
};
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

// Seguro (B10.3): parámetros globales; se guardan, se activan con precios de prueba y se restauran al final.
const savedSettings = await q(`SELECT key, value FROM academy_settings WHERE key LIKE 'insurance\\_%'`);
const insuranceAdmin = (body) => withRls({ uid: U.admin, role: 'admin' }, (c) => updateInsuranceSettings(c, body, U.admin));
const localIns = async (student) => (await q(`SELECT * FROM insurances WHERE student_id = $1 ORDER BY created_at DESC`, [U[student]]))[0];
const noticeOf = async (action, resourceId) =>
  (await q(`SELECT changes FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at`, [action, resourceId]))
    .map((r) => r.changes);

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

  let insCuota, ins;
  await run('checkout con seguro: nace la cuota y el seguro (2.ª suscripción anual, misma tarjeta) con su recibo', async () => {
    await insuranceAdmin({ price_adult_cents: 3000, price_minor_cents: 2000, enabled: true });
    const cus = await customer('ins', 'pm_card_visa');
    insCuota = await paidSub(cus, 'ins', 'ins', { insurance: 'true' });
    const e = completed(insCuota);
    await handleEvent(e);
    assert.equal((await localSub(insCuota.id)).status, 'active');
    ins = await localIns('ins');
    stripeSubs.push(ins.stripe_subscription_id);
    assert.deepEqual([ins.status, ins.payer_id, ins.bracket], ['active', U.ins, 'adult']);
    const st = await stripe.subscriptions.retrieve(ins.stripe_subscription_id);
    assert.deepEqual([st.customer, st.items.data[0].price.recurring.interval, st.items.data[0].price.unit_amount],
      [cus, 'year', 3000]);
    assert.equal((await q(`SELECT has_risk_cover($1) r`, [U.ins]))[0].r, true);
    await handleEvent(evt('invoice.paid', { id: st.latest_invoice, object: 'invoice' }));
    const [inv] = await q(`SELECT * FROM invoices WHERE stripe_invoice_id = $1`, [st.latest_invoice]);
    assert.deepEqual([inv.insurance_id, inv.subscription_id, inv.status, inv.amount_paid_cents], [ins.id, null, 'paid', 3000]);
    // Reprocesar el Checkout no crea otro seguro (idempotencyKey + upsert).
    await q(`DELETE FROM webhook_events WHERE id = $1`, [e.id]);
    await handleEvent(e);
    assert.equal((await q(`SELECT 1 FROM insurances WHERE student_id = $1`, [U.ins])).length, 1);
  });
  await run('seguro rechazado: la suscripción sigue, sin cobertura de riesgo; sin aviso por el recibo fallido, sí al caducar', async () => {
    const cus = await customer('ins2', 'pm_card_visa');
    const cuota = await paidSub(cus, 'ins2', 'ins2', { insurance: 'true' });
    // La tarjeta falla después del cobro de la cuota.
    const bad = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: cus });
    await stripe.customers.update(cus, { invoice_settings: { default_payment_method: bad.id } });
    await handleEvent(completed(cuota));
    assert.equal((await localSub(cuota.id)).status, 'active');
    const i = await localIns('ins2');
    stripeSubs.push(i.stripe_subscription_id);
    assert.equal(i.status, 'incomplete');
    assert.equal((await q(`SELECT has_risk_cover($1) r`, [U.ins2]))[0].r, false);
    const st = await stripe.subscriptions.retrieve(i.stripe_subscription_id);
    await handleEvent(evt('invoice.payment_failed', { id: st.latest_invoice, object: 'invoice' }));
    const [inv] = await q(`SELECT id, insurance_id FROM invoices WHERE stripe_invoice_id = $1`, [st.latest_invoice]);
    assert.equal(inv.insurance_id, i.id);
    assert.deepEqual(await noticeOf('notice.payment_failed', inv.id), [], 'primer cobro del seguro: sin aviso de cobro fallido');
    // A las 23 h Stripe la cancela (incomplete_expired); aquí, a mano.
    await stripe.subscriptions.cancel(i.stripe_subscription_id);
    await handleEvent(evt('customer.subscription.deleted', { id: i.stripe_subscription_id, object: 'subscription' }));
    assert.equal((await localIns('ins2')).status, 'cancelled');
    assert.deepEqual((await noticeOf('notice.insurance_not_paid', i.id)).map((n) => n.recipients), [[U.ins2]]);
  });
  await run('invoice.upcoming: fija el precio vigente del tramo y avisa; hijo que cumple 18 antes → no renueva', async () => {
    await insuranceAdmin({ price_adult_cents: 3500 });
    const upcoming = () => handleEvent(evt('invoice.upcoming', {
      object: 'invoice', parent: { subscription_details: { subscription: ins.stripe_subscription_id } } }));
    await upcoming();
    const st = await stripe.subscriptions.retrieve(ins.stripe_subscription_id);
    assert.equal(st.items.data[0].price.unit_amount, 3500);
    const [n] = await noticeOf('notice.insurance_renewal', ins.id);
    assert.deepEqual([n.bracket, n.amount_cents, n.recipients], ['adult', 3500, [U.ins]]);
    // Hijo de un tutor que cumple 18 antes de la renovación.
    await q(`UPDATE profiles SET birth_date = CURRENT_DATE - interval '18 years' + interval '30 days' WHERE id = $1`, [U.ins]);
    await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.ins]);
    await upcoming();
    assert.equal((await stripe.subscriptions.retrieve(ins.stripe_subscription_id)).cancel_at_period_end, true);
    assert.equal((await noticeOf('notice.insurance_wont_renew', ins.id))[0].reason, 'turns_18');
    await q(`DELETE FROM guardianships WHERE minor_id = $1`, [U.ins]);
    await q(`UPDATE profiles SET birth_date = NULL WHERE id = $1`, [U.ins]);
    await stripe.subscriptions.update(ins.stripe_subscription_id, { cancel_at_period_end: false });
    await handleEvent(evt('customer.subscription.updated', { id: ins.stripe_subscription_id, object: 'subscription' }));
    assert.equal((await localIns('ins')).cancel_at_period_end, false);
  });
  await run('baja de la cuota sin otra viva: el seguro sigue en vigor hasta el final de su año y no renueva', async () => {
    await q(`DELETE FROM audit_log WHERE action = 'notice.insurance_wont_renew' AND resource_id = $1`, [ins.id]);
    await stripe.subscriptions.cancel(insCuota.id);
    await handleEvent(evt('customer.subscription.deleted', { id: insCuota.id, object: 'subscription' }));
    assert.equal((await stripe.subscriptions.retrieve(ins.stripe_subscription_id)).cancel_at_period_end, true);
    await handleEvent(evt('customer.subscription.updated', { id: ins.stripe_subscription_id, object: 'subscription' }));
    const i = await localIns('ins');
    assert.deepEqual([i.status, i.cancel_at_period_end], ['active', true]);
    assert.equal((await q(`SELECT has_risk_cover($1) r`, [U.ins]))[0].r, true);
    assert.deepEqual((await noticeOf('notice.insurance_wont_renew', ins.id)).map((n) => n.reason), ['subscription_cancelled']);
    // Repetido: no avisa dos veces.
    await handleEvent(evt('customer.subscription.deleted', { id: insCuota.id, object: 'subscription' }));
    assert.equal((await noticeOf('notice.insurance_wont_renew', ins.id)).length, 1);
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
      assert.ok((await stripe.subscriptions.retrieve(pcSub.id)).pending_update, 'sigue pendiente del pago');
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
    const [n] = await noticeOf('notice.scheduled_change_discarded', pcRow.id);
    assert.deepEqual([n.recipients, n.plan_id], [[U.pc], same.id]);
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
  await q(`DELETE FROM insurances WHERE student_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM academy_settings WHERE key LIKE 'insurance\\_%'`);
  for (const { key, value } of savedSettings) await q(`INSERT INTO academy_settings (key, value) VALUES ($1, $2)`, [key, value]);
  await q(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM webhook_events WHERE id = ANY($1::text[])`, [eventIds]);
  for (const x of extraSessions) {
    await q(`DELETE FROM bookings WHERE session_id = $1`, [x]);
    await q(`DELETE FROM class_sessions WHERE id = $1`, [x]);
  }
  await q(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[plan.id, ...extraPlans]]);
  await q(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [[disc, ...extraDiscs]]);
  await q(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tutor]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
