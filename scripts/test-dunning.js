// B20: past_due → unpaid con un Stripe test clock. Una renovación que falla (pm_card_chargeCustomerFail) y el reloj
// avanzando hasta agotar los reintentos de la cuenta: en past_due las reservas siguen, en unpaid se cancelan sin cobertura.
// Los eventos son los reales del reloj (events.list) pasados a handleEvent, sin `stripe listen`. Solo sandbox.
// Requiere en el Dashboard (Ajustes > Facturación > Pagos de suscripciones fallidos): reintentos acabados → «marcar la suscripción como impagada».
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { stripe } from '../src/config/stripe.js';
import { createPlan } from '../src/services/catalog.js';
import { handleEvent } from '../src/services/stripeWebhook.js';

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !process.env.STRIPE_SECRET_KEY?.startsWith('rk_test_')) {
  throw new Error('test:dunning solo corre contra el sandbox de Stripe (sk_test_ / rk_test_)');
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const DAY = 86400;
const TYPES = ['customer.subscription.updated', 'invoice.finalized', 'invoice.payment_failed', 'invoice.paid'];

const U = { admin: crypto.randomUUID(), prof: crypto.randomUUID(), alu: crypto.randomUUID() };
for (const [k, role] of [['admin', 'admin'], ['prof', 'profesor'], ['alu', 'alumno']]) {
  await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [U[k], `${k}-dunning`]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
const [{ id: disc }] = await q(`INSERT INTO disciplines (name) VALUES ('T-Dun-A') RETURNING id`);
const plan = await withRls({ uid: U.admin, role: 'admin' }, (c) =>
  createPlan(c, { name: `T-Dun-${Date.now()}`, price_cents: 2000, max_disciplines: 1 }));
const [{ stripe_price_id: price }] = await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [plan.id]);

let clock, failed = false;
const eventIds = [];
const steps = [];
try {
  const t0 = Math.floor(Date.now() / 1000);
  clock = await stripe.testHelpers.testClocks.create({ frozen_time: t0, name: 'kaizen-dunning' });
  const cus = await stripe.customers.create({
    test_clock: clock.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' },
  });
  await q(`UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1`, [U.alu, cus.id]);
  const sub = await stripe.subscriptions.create({
    customer: cus.id, items: [{ price }],
    metadata: { student_id: U.alu, payer_id: U.alu, plan_id: plan.id, discipline_ids: String(disc) },
  });
  await handleEvent({
    id: `evt_test_${crypto.randomUUID()}`, type: 'checkout.session.completed',
    data: { object: { id: `cs_test_${crypto.randomUUID()}`, object: 'checkout.session', mode: 'subscription',
      payment_status: 'paid', subscription: sub.id, customer: cus.id } },
  });
  const local = async () => (await q(`SELECT status FROM subscriptions WHERE stripe_subscription_id = $1`, [sub.id]))[0].status;
  assert.equal(await local(), 'active');

  const [session] = await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
     VALUES ($1, $2, now() + interval '3 days', now() + interval '3 days 1 hour', 60, 5, 'scheduled') RETURNING id`,
    [disc, U.prof]);
  const [{ id: booking }] = await q(`INSERT INTO bookings (id, session_id, student_id, booked_by, status)
                                     VALUES (gen_random_uuid(), $1, $2, $2, 'confirmed') RETURNING id`, [session.id, U.alu]);
  const bookingOf = async () => (await q(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [booking]))[0];

  // La renovación ya no se puede cobrar.
  const bad = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: cus.id });
  await stripe.customers.update(cus.id, { invoice_settings: { default_payment_method: bad.id } });

  const advance = async (to) => {
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: to });
    for (let i = 0; i < 90; i++) { // el reloj tarda en estar «ready»; sus eventos, algo más
      await new Promise((r) => setTimeout(r, 2000));
      if ((await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready') break;
    }
    const events = [];
    for await (const e of stripe.events.list({ types: TYPES, created: { gte: t0 - 60 }, limit: 100 })) {
      if (e.data.object.customer === cus.id) events.push(e);
    }
    for (const e of events.sort((a, b) => a.created - b.created)) {
      eventIds.push(e.id);
      await handleEvent(e);
    }
  };

  const t = Date.now();
  // Fin del primer periodo (+1 mes): el cobro falla → past_due, en gracia.
  await advance(t0 + 33 * DAY);
  steps.push(['+33d', await local()]);
  assert.equal(await local(), 'past_due', 'la renovación fallida deja la suscripción en past_due');
  assert.equal((await bookingOf()).status, 'confirmed', 'en gracia (past_due) la reserva se conserva');

  // Reintentos de la cuenta, de 3 en 3 días hasta unpaid (tope: 6 semanas).
  let day = 33;
  while (await local() === 'past_due' && day < 75) {
    day += 3;
    await advance(t0 + day * DAY);
    steps.push([`+${day}d`, await local()]);
    if (await local() === 'past_due') assert.equal((await bookingOf()).status, 'confirmed', `past_due +${day}d conserva la reserva`);
  }
  const final = await local();
  assert.equal(final, 'unpaid', `los reintentos no llevaron a unpaid (${steps.map((s) => s.join(':')).join(' ')}): `
    + 'Dashboard > Ajustes > Facturación > Pagos de suscripciones fallidos > «Si fallan todos los reintentos»: marcar la suscripción como impagada');
  const b = await bookingOf();
  assert.deepEqual([b.status, b.cancel_reason], ['cancelled', 'no_coverage'], 'unpaid cancela la reserva sin cobertura');
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM audit_log a JOIN subscriptions s ON s.id::text = a.resource_id::text
                            WHERE a.action = 'notice.subscription_unpaid' AND s.student_id = $1`, [U.alu]);
  assert.equal(n, 1, 'un solo aviso de impago');
  console.log(`OK   past_due conserva la reserva; unpaid la cancela (${steps.map((s) => s.join(':')).join(' ')}; ${((Date.now() - t) / 1000).toFixed(0)} s)`);
} catch (e) {
  failed = true;
  console.error('FAIL test:dunning\n', e);
} finally {
  if (clock) await stripe.testHelpers.testClocks.del(clock.id); // borra también su cliente y su suscripción
  const ids = Object.values(U);
  const subs = (await q(`SELECT id FROM subscriptions WHERE student_id = $1`, [U.alu])).map((r) => r.id);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[]) OR resource_id::text = ANY($2::text[])`, [ids, subs]);
  await q(`DELETE FROM bookings WHERE student_id = $1`, [U.alu]);
  await q(`DELETE FROM class_sessions WHERE discipline_id = $1`, [disc]);
  await q(`DELETE FROM invoices WHERE student_id = $1`, [U.alu]);
  await q(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM webhook_events WHERE id = ANY($1::text[])`, [eventIds]);
  await q(`DELETE FROM plans WHERE id = $1`, [plan.id]);
  await q(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
if (!failed) console.log('todo OK');
process.exit(failed ? 1 : 0);
