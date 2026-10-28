import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { stripe } from '../src/config/stripe.js';
import { createPlan, updatePlan } from '../src/services/catalog.js';
import { createCheckout, createPortalSession } from '../src/services/billing.js';

const sp = async (c, fn) => { // savepoint: un error SQL no aborta el resto de la transacción
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO t'); }
};
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const people = { admin: 'admin', prof: 'profesor', alu: 'alumno', other: 'alumno', tutor: 'tutor', child: 'alumno', child2: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-bill`, k.startsWith('child') ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3)`, [U.tutor, U.child, U.child2]);

const disc = (await servicePool.query(
  `INSERT INTO disciplines (name) VALUES ('T-Bill-A') RETURNING id`)).rows[0].id;
const plan = (await servicePool.query(
  `INSERT INTO plans (name, price_cents) VALUES ('T-Bill-all', 1000) RETURNING id`)).rows[0].id;
const sub = {};
for (const k of ['alu', 'child']) {
  sub[k] = crypto.randomUUID();
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [sub[k], U[k], k === 'child' ? U.tutor : U[k], plan, `sub_test_${sub[k]}`]);
}
const inv = crypto.randomUUID();
await servicePool.query(
  `INSERT INTO invoices (id, student_id, payer_id, subscription_id, stripe_invoice_id, status)
   VALUES ($1, $2, $3, $4, $5, 'paid')`, [inv, U.child, U.tutor, sub.child, `in_test_${inv}`]);
const { rows: [sess] } = await servicePool.query(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
   VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 60, 5, 'scheduled') RETURNING id`, [disc, U.prof]);
const { rows: [bk] } = await servicePool.query(
  `INSERT INTO bookings (id, session_id, student_id, booked_by, status)
   VALUES (gen_random_uuid(), $1, $2, $2, 'confirmed') RETURNING id`, [sess.id, U.alu]);

const setStatus = (id, status) => servicePool.query(`UPDATE subscriptions SET status = $2 WHERE id = $1`, [id, status]);
let synced, stripeSub, syncedSub;

// Checkout: K solo menores; B no elegible en el plan de 1.
const mkDisc = async (name, minors) => (await servicePool.query(
  `INSERT INTO disciplines (name, minors_only) VALUES ($1, $2) RETURNING id`, [name, minors])).rows[0].id;
const discK = await mkDisc('T-Bill-K', true);
const discB = await mkDisc('T-Bill-B', false);
const mkPlan = (body) => withRls({ uid: U.admin, role: 'admin' }, (c) =>
  createPlan(c, { name: `T-Bill-${body.tag}-${Date.now()}`, max_disciplines: null, price_cents: 1500, ...body, tag: undefined }));
const co = [
  await mkPlan({ tag: 'one', max_disciplines: 1 }), await mkPlan({ tag: 'kids', minors_only: true }),
  await mkPlan({ tag: 'free', price_cents: 0 }), await mkPlan({ tag: 'retired', is_active: false }),
];
const [coOne, coKids, coFree, coRetired] = co;
await servicePool.query(`INSERT INTO plan_disciplines (plan_id, discipline_id) VALUES ($1, $2), ($1, $3)`,
  [coOne.id, disc, discK]);
const customerOf = async (id) =>
  (await servicePool.query(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [id])).rows[0].stripe_customer_id;
const covers = async () => (await servicePool.query(`SELECT covers($1, $2) c`, [U.alu, disc])).rows[0].c;

try {
  await run('covers: en vigor = active + past_due; unpaid/cancelled no', async () => {
    for (const [status, expected] of [['active', true], ['past_due', true], ['unpaid', false], ['cancelled', false]]) {
      await setStatus(sub.alu, status);
      assert.equal(await covers(), expected, status);
    }
    await setStatus(sub.alu, 'active');
  });

  await run('una sola suscripción viva por alumno (unpaid cuenta como viva)', async () => {
    await setStatus(sub.alu, 'unpaid');
    const second = (id) => servicePool.query(
      `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
       VALUES ($1, $2, $2, $3, 'active', $4)`, [id, U.alu, plan, `sub_test_${id}`]);
    await assert.rejects(second(crypto.randomUUID()), (e) => e.constraint === 'subscriptions_one_live_idx');
    await setStatus(sub.alu, 'active');
  });

  await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
    const seen = async (table, id) => (await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;
    await run('RLS: suscripción y recibo del hijo los ven tutor, hijo y admin; no otro alumno ni profesor', async () => {
      for (const [who, expected] of [['tutor', true], ['child', true], ['admin', true], ['other', false], ['prof', false]]) {
        await as(c, U[who], people[who]);
        assert.equal(await seen('subscriptions', sub.child), expected, `sub ${who}`);
        assert.equal(await seen('invoices', inv), expected, `inv ${who}`);
      }
    });
    await run('app_user no escribe suscripciones, recibos ni webhook_events', async () => {
      await as(c, U.admin, 'admin');
      for (const q of [
        [`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [sub.alu]],
        [`DELETE FROM invoices WHERE id = $1`, [inv]],
        [`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [sub.alu, disc]],
        [`SELECT 1 FROM webhook_events`, []],
      ]) await sp(c, () => assert.rejects(c.query(...q), /permission denied/));
    });
    await run('el suscriptor sigue viendo su plan retirado; otro alumno no', async () => {
      await servicePool.query(`UPDATE plans SET is_active = false WHERE id = $1`, [plan]);
      await as(c, U.alu, 'alumno');
      assert.equal((await c.query(`SELECT 1 FROM plans WHERE id = $1`, [plan])).rowCount, 1);
      await as(c, U.other, 'alumno');
      assert.equal((await c.query(`SELECT 1 FROM plans WHERE id = $1`, [plan])).rowCount, 0);
      await servicePool.query(`UPDATE plans SET is_active = true WHERE id = $1`, [plan]);
    });
  }, { commit: false });

  await run('revoke_coverage: con cobertura no toca; sin ella cancela futuras con aviso', async () => {
    assert.equal((await servicePool.query(`SELECT revoke_coverage($1) n`, [U.alu])).rows[0].n, 0);
    await setStatus(sub.alu, 'unpaid');
    assert.equal((await servicePool.query(`SELECT revoke_coverage($1) n`, [U.alu])).rows[0].n, 1);
    const { rows: [b] } = await servicePool.query(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [bk.id]);
    assert.deepEqual([b.status, b.cancel_reason], ['cancelled', 'no_coverage']);
    const { rowCount } = await servicePool.query(
      `SELECT 1 FROM audit_log WHERE action = 'notice.no_coverage' AND resource_id = $1`, [bk.id]);
    assert.equal(rowCount, 1);
  });

  await run('checkout: retirado, 0 €, solo menores, nº y elegibles, suscripción viva', async () => {
    await withRls({ uid: U.other, role: 'alumno' }, async (c) => {
      const no = (body, status, code) => sp(c, () => assert.rejects(
        createCheckout(c, { payerId: U.other, studentId: U.other, ...body }), (e) => e.status === status && e.code === code));
      await no({ planId: coRetired.id }, 404, 'plan_not_found');
      await no({ planId: coFree.id }, 409, 'plan_not_purchasable');
      await no({ planId: coKids.id }, 409, 'plan_minors_only');
      await no({ planId: coOne.id, disciplineIds: [] }, 400, 'invalid_field');
      await no({ planId: coOne.id, disciplineIds: [disc, discB] }, 400, 'invalid_field');
      await no({ planId: coOne.id, disciplineIds: [discB] }, 409, 'discipline_not_eligible');
      await no({ planId: coOne.id, disciplineIds: [discK] }, 409, 'discipline_not_eligible'); // adulto, solo menores
    }, { commit: false });
    await withRls({ uid: U.alu, role: 'alumno' }, (c) => assert.rejects(
      createCheckout(c, { payerId: U.alu, studentId: U.alu, planId: coOne.id, disciplineIds: [disc] }),
      (e) => e.code === 'subscription_exists'), { commit: false });
  });
  await run('checkout: adulto se paga; cliente en el pagador reutilizado; metadatos del pedido', async () => {
    const go = () => withRls({ uid: U.other, role: 'alumno' }, (c) =>
      createCheckout(c, { payerId: U.other, studentId: U.other, planId: coOne.id, disciplineIds: [disc] }), { commit: false });
    assert.match((await go()).url, /^https:\/\/checkout\.stripe\.com\//);
    const cus = await customerOf(U.other);
    assert.match(cus, /^cus_/);
    await go();
    assert.equal(await customerOf(U.other), cus);
    const { data: [s] } = await stripe.checkout.sessions.list({ customer: cus, limit: 1 });
    assert.deepEqual([s.mode, s.client_reference_id, s.metadata],
      ['subscription', U.other, { student_id: U.other, payer_id: U.other, plan_id: coOne.id, discipline_ids: String(disc) }]);
  });
  await run('checkout: tutor paga el plan solo menores del hijo; el cliente es del tutor', async () => {
    await withRls({ uid: U.tutor, role: 'tutor' }, (c) =>
      createCheckout(c, { payerId: U.tutor, studentId: U.child2, planId: coKids.id }), { commit: false });
    assert.equal(await customerOf(U.child2), null);
    const { data: [s] } = await stripe.checkout.sessions.list({ customer: await customerOf(U.tutor), limit: 1 });
    assert.deepEqual([s.metadata.student_id, s.metadata.payer_id, s.metadata.discipline_ids], [U.child2, U.tutor, '']);
  });
  await run('portal: sin cliente → 404; con cliente → url de Stripe', async () => {
    await withRls({ uid: U.admin, role: 'admin' }, (c) => assert.rejects(
      createPortalSession(c, U.admin), (e) => e.code === 'no_billing_account'), { commit: false });
    const { url } = await withRls({ uid: U.other, role: 'alumno' }, (c) => createPortalSession(c, U.other), { commit: false });
    assert.match(url, /^https:\/\/billing\.stripe\.com\//);
  });

  // Plan ↔ Stripe contra el sandbox (llamadas reales).
  await run('sync plan: crea Product + Price mensual EUR IVA incluido', async () => {
    synced = await withRls({ uid: U.admin, role: 'admin' }, (c) =>
      createPlan(c, { name: `T-Bill-sync-${Date.now()}`, price_cents: 2500, max_disciplines: null }));
    const { rows: [{ stripe_price_id }] } = await servicePool.query(`SELECT stripe_price_id FROM plans WHERE id = $1`, [synced.id]);
    const price = await stripe.prices.retrieve(stripe_price_id, { expand: ['product'] });
    assert.deepEqual(
      [price.unit_amount, price.currency, price.recurring.interval, price.tax_behavior, price.active, price.product.name],
      [2500, 'eur', 'month', 'inclusive', true, synced.name]);
    // Suscriptor real en Stripe con tarjeta de prueba.
    const customer = await stripe.customers.create({
      payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } });
    stripeSub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: stripe_price_id }] });
    syncedSub = crypto.randomUUID();
    await servicePool.query(
      `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
       VALUES ($1, $2, $2, $3, 'active', $4)`, [syncedSub, U.other, synced.id, stripeSub.id]);
  });
  await run('sync plan: precio nuevo, suscriptores al nuevo sin prorrateo, viejo archivado; nombre; 0 € con suscriptores → 409', async () => {
    await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
      const priceOf = async () => (await c.query(`SELECT stripe_price_id p FROM plans WHERE id = $1`, [synced.id])).rows[0].p;
      const old = await priceOf();
      await updatePlan(c, { id: synced.id, body: { price_cents: 3000, name: `${synced.name}-r` }, actorId: U.admin });
      const now = await priceOf();
      assert.notEqual(now, old);
      assert.equal((await stripe.prices.retrieve(old)).active, false);
      const p = await stripe.prices.retrieve(now, { expand: ['product'] });
      assert.deepEqual([p.unit_amount, p.product.name], [3000, `${synced.name}-r`]);
      assert.equal((await stripe.subscriptions.retrieve(stripeSub.id)).items.data[0].price.id, now);
      await sp(c, () => assert.rejects(
        updatePlan(c, { id: synced.id, body: { price_cents: 0 }, actorId: U.admin }), (e) => e.status === 409));
      await updatePlan(c, { id: synced.id, body: { is_active: false }, actorId: U.admin });
      assert.equal((await stripe.prices.retrieve(now)).active, false);
    }, { commit: false });
  });
} finally {
  if (stripeSub) await stripe.subscriptions.cancel(stripeSub.id);
  if (syncedSub) await servicePool.query(`DELETE FROM subscriptions WHERE id = $1`, [syncedSub]);
  if (synced) {
    await servicePool.query(`DELETE FROM audit_log WHERE resource_id = $1`, [synced.id]);
    await servicePool.query(`DELETE FROM plans WHERE id = $1`, [synced.id]);
  }
  await servicePool.query(`DELETE FROM audit_log WHERE resource_id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM bookings WHERE id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1`, [sess.id]);
  await servicePool.query(`DELETE FROM invoices WHERE id = $1`, [inv]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  for (const p of co) await servicePool.query(`DELETE FROM plan_disciplines WHERE plan_id = $1`, [p.id]);
  await servicePool.query(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [co.map((p) => p.id)]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [[disc, discK, discB]]);
  await servicePool.query(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tutor]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [Object.values(U)]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
