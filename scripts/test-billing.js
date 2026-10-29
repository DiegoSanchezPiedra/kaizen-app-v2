import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { stripe } from '../src/config/stripe.js';
import { createPlan, updatePlan } from '../src/services/catalog.js';
import {
  createCheckout, createPortalSession, contractInsurance, getInsurance, updateInsuranceSettings, listOverduePayers,
  changePlan, changeDiscipline, getSubscription, updateDisciplineChangeSettings,
} from '../src/services/billing.js';

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

const people = {
  admin: 'admin', prof: 'profesor', alu: 'alumno', other: 'alumno', tutor: 'tutor', child: 'alumno', child2: 'alumno',
  pc: 'alumno', child3: 'alumno', tutor2: 'tutor', // B10.5
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-bill`, k.startsWith('child') ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3), ($1, $4), ($5, $4)`,
  [U.tutor, U.child, U.child2, U.child3, U.tutor2]);

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
const pcSessions = [];
let discD;

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

// Seguro (B10.3): parámetros globales; se guardan y se restauran al final.
const savedSettings = (await servicePool.query(
  `SELECT key, value FROM academy_settings WHERE key LIKE 'insurance\\_%'`)).rows;
const insuranceAdmin = (body) => withRls({ uid: U.admin, role: 'admin' }, (c) => updateInsuranceSettings(c, body, U.admin));
// Waiver vigente: el existente o uno de prueba (se borra al final).
let testWaiver = null;
if (!(await servicePool.query(`SELECT 1 FROM agreement_documents
     WHERE type = 'waiver' AND published_at IS NOT NULL AND retired_at IS NULL`)).rowCount) {
  testWaiver = (await servicePool.query(
    `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
     VALUES (gen_random_uuid(), 'waiver', '99.' || floor(random() * 1e6), 'test-billing.pdf', 'x', now()) RETURNING id`)).rows[0].id;
}
const signWaiver = (student, by = student) => servicePool.query(
  `INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
   SELECT gen_random_uuid(), $1, $2, 'waiver', version FROM agreement_documents
    WHERE type = 'waiver' AND published_at IS NOT NULL AND retired_at IS NULL`, [student, by]);
const stripeSubs = []; // del seguro y de la cuota real, se cancelan al final
const savedChanges = (await servicePool.query(
  `SELECT value FROM academy_settings WHERE key = 'discipline_changes_per_period'`)).rows[0]?.value;

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
  await run('checkout: sin cobertura de riesgo exige elegir; seguro desactivado → 409', async () => {
    await insuranceAdmin({ enabled: false });
    await withRls({ uid: U.other, role: 'alumno' }, async (c) => {
      const no = (body, code) => sp(c, () => assert.rejects(createCheckout(c,
        { payerId: U.other, studentId: U.other, planId: coOne.id, disciplineIds: [disc], ...body }), (e) => e.code === code));
      await no({}, 'risk_cover_required');
      await no({ insurance: true }, 'insurance_disabled');
      await no({ insurance: 'sí' }, 'invalid_field');
    }, { commit: false });
    await signWaiver(U.other);
    await signWaiver(U.child2, U.tutor);
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

  // Seguro contra el sandbox (llamadas reales).
  await run('seguro: activar exige los dos precios; Price anual EUR por tramo; precio nuevo archiva el viejo', async () => {
    await servicePool.query(`DELETE FROM academy_settings WHERE key LIKE 'insurance\\_%' AND key <> 'insurance_enabled'`);
    await assert.rejects(insuranceAdmin({ enabled: true }), (e) => e.code === 'insurance_prices_missing');
    await assert.rejects(insuranceAdmin({ price_adult_cents: 0 }), (e) => e.code === 'invalid_field');
    await assert.rejects(insuranceAdmin({ price_adult_cents: 4000, enabled: true }), (e) => e.code === 'insurance_prices_missing');
    assert.deepEqual(await insuranceAdmin({ price_adult_cents: 4000, price_minor_cents: 2500, enabled: true }),
      { enabled: true, price_adult_cents: 4000, price_minor_cents: 2500 });
    const priceOf = async (b) => (await servicePool.query(
      `SELECT value #>> '{}' v FROM academy_settings WHERE key = $1`, [`insurance_stripe_price_${b}`])).rows[0].v;
    const old = await priceOf('adult');
    const p = await stripe.prices.retrieve(old);
    assert.deepEqual([p.unit_amount, p.currency, p.recurring.interval, p.tax_behavior, p.metadata.bracket],
      [4000, 'eur', 'year', 'inclusive', 'adult']);
    await insuranceAdmin({ price_adult_cents: 4500 });
    assert.equal((await stripe.prices.retrieve(old)).active, false);
    assert.equal((await stripe.prices.retrieve(await priceOf('adult'))).unit_amount, 4500);
  });
  await run('checkout con seguro: el pedido lleva insurance en metadata', async () => {
    await withRls({ uid: U.other, role: 'alumno' }, (c) => createCheckout(c,
      { payerId: U.other, studentId: U.other, planId: coOne.id, disciplineIds: [disc], insurance: true }), { commit: false });
    const { data: [s] } = await stripe.checkout.sessions.list({ customer: await customerOf(U.other), limit: 1 });
    assert.equal(s.metadata.insurance, 'true');
  });
  let ins;
  await run('contratar seguro después: solo el pagador con suscripción viva; cobra con la tarjeta de la cuota', async () => {
    await withRls({ uid: U.other, role: 'alumno' }, (c) => assert.rejects(
      contractInsurance(c, { payerId: U.other, studentId: U.other }), (e) => e.code === 'subscription_required'), { commit: false });
    await withRls({ uid: U.admin, role: 'admin' }, (c) => assert.rejects(
      contractInsurance(c, { payerId: U.admin, studentId: U.child }), (e) => e.code === 'not_payer'), { commit: false });
    // Cuota real en Stripe para alu: cliente con tarjeta de prueba.
    const customer = await stripe.customers.create({
      payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } });
    const { rows: [{ stripe_price_id: price }] } = await servicePool.query(`SELECT stripe_price_id FROM plans WHERE id = $1`, [coOne.id]);
    const cuota = await stripe.subscriptions.create({ customer: customer.id, items: [{ price }],
      default_payment_method: customer.invoice_settings.default_payment_method });
    stripeSubs.push(cuota.id);
    await servicePool.query(`UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1`, [U.alu, customer.id]);
    await servicePool.query(`UPDATE subscriptions SET stripe_subscription_id = $2, status = 'active' WHERE id = $1`, [sub.alu, cuota.id]);

    const out = await withRls({ uid: U.alu, role: 'alumno' }, (c) =>
      contractInsurance(c, { payerId: U.alu, studentId: U.alu }), { commit: false });
    assert.equal(out.status, 'active');
    ins = (await servicePool.query(`SELECT * FROM insurances WHERE id = $1`, [out.id])).rows[0];
    stripeSubs.push(ins.stripe_subscription_id);
    assert.deepEqual([ins.student_id, ins.payer_id, ins.status, ins.bracket], [U.alu, U.alu, 'active', 'adult']);
    const st = await stripe.subscriptions.retrieve(ins.stripe_subscription_id);
    assert.deepEqual([st.items.data[0].price.recurring.interval, st.metadata.kind], ['year', 'insurance']);
    await withRls({ uid: U.alu, role: 'alumno' }, (c) => assert.rejects(
      contractInsurance(c, { payerId: U.alu, studentId: U.alu }), (e) => e.code === 'insurance_exists'), { commit: false });
    await withRls({ uid: U.alu, role: 'alumno' }, async (c) => {
      assert.equal((await getInsurance(c, { userId: U.alu, studentId: U.alu })).status, 'active');
    }, { commit: false });
  });
  await run('seguro: has_risk_cover = en vigor o waiver; RLS como los recibos', async () => {
    const rc = async () => (await servicePool.query(`SELECT has_risk_cover($1) r`, [U.alu])).rows[0].r;
    for (const [status, expected] of [['active', true], ['past_due', true], ['unpaid', false], ['cancelled', false]]) {
      await servicePool.query(`UPDATE insurances SET status = $2 WHERE id = $1`, [ins.id, status]);
      assert.equal(await rc(), expected, status);
    }
    await servicePool.query(`UPDATE insurances SET status = 'active' WHERE id = $1`, [ins.id]);
    await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
      for (const [who, expected] of [['alu', true], ['admin', true], ['other', false], ['prof', false]]) {
        await as(c, U[who], people[who]);
        assert.equal((await c.query(`SELECT 1 FROM insurances WHERE id = $1`, [ins.id])).rowCount, expected ? 1 : 0, who);
      }
      await as(c, U.admin, 'admin');
      await sp(c, () => assert.rejects(c.query(`UPDATE insurances SET status = 'active'`), /permission denied/));
    }, { commit: false });
  });
  await run('desactivar el seguro: los vivos no renuevan, con aviso al pagador', async () => {
    await insuranceAdmin({ enabled: false });
    assert.equal((await stripe.subscriptions.retrieve(ins.stripe_subscription_id)).cancel_at_period_end, true);
    const { rows } = await servicePool.query(
      `SELECT changes FROM audit_log WHERE action = 'notice.insurance_wont_renew' AND resource_id = $1`, [ins.id]);
    assert.deepEqual([rows.length, rows[0].changes.reason, rows[0].changes.recipients], [1, 'disabled', [U.alu]]);
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
  // B10.2: morosos y en gracia por pagador. Estados forzados en cada caso; se busca por payer_id (la BD puede tener más).
  const overdue = async (list, opts = {}, user = { uid: U.admin, role: 'admin' }) =>
    withRls(user, (c) => listOverduePayers(c, { list, ...opts }), { commit: false });
  const has = async (list, payer) => (await overdue(list, { limit: 100 })).payers.find((p) => p.payer_id === payer);
  const od = {}; // fixtures propios: 2.ª suscripción del tutor y seguro de alu
  od.sub2 = crypto.randomUUID();
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [od.sub2, U.child2, U.tutor, plan, `sub_test_${od.sub2}`]);
  sub.child2 = od.sub2; // lo borra el cleanup junto al resto
  od.ins = crypto.randomUUID();
  // El seguro real de B10.3 sigue vivo y chocaría con insurances_one_live_idx: aquí ya no se usa.
  await servicePool.query(`UPDATE insurances SET status = 'cancelled' WHERE student_id = $1`, [U.alu]);
  await servicePool.query(
    `INSERT INTO insurances (id, student_id, payer_id, status, bracket, stripe_subscription_id)
     VALUES ($1, $2, $2, 'active', 'adult', $3)`, [od.ins, U.alu, `sub_test_${od.ins}`]);
  const setIns = (status) => servicePool.query(`UPDATE insurances SET status = $2 WHERE id = $1`, [od.ins, status]);
  const reset = async () => {
    for (const k of ['alu', 'child', 'child2']) await setStatus(sub[k], 'active');
    await setIns('active');
    await servicePool.query(`DELETE FROM invoices WHERE id <> $1 AND student_id = ANY($2::uuid[])`, [inv, Object.values(U)]);
  };
  await run('morosos: suscripción unpaid; no sale en gracia', async () => {
    await reset(); await setStatus(sub.alu, 'unpaid');
    const p = await has('delinquent', U.alu);
    assert.deepEqual(p.items.map((i) => [i.kind, i.status]), [['subscription', 'unpaid']]);
    assert.equal(await has('grace', U.alu), undefined);
  });
  await run('morosos: solo el seguro unpaid también convierte en moroso', async () => {
    await reset(); await setIns('unpaid');
    const p = await has('delinquent', U.alu);
    assert.deepEqual(p.items.map((i) => [i.kind, i.status, i.label]), [['insurance', 'unpaid', 'adult']]);
  });
  await run('en gracia: past_due no es moroso; active no sale', async () => {
    await reset(); await setStatus(sub.alu, 'past_due');
    assert.equal(await has('delinquent', U.alu), undefined);
    assert.equal((await has('grace', U.alu)).items.length, 1);
    assert.equal(await has('grace', U.tutor), undefined);
  });
  await run('mixto: unpaid + past_due del mismo tutor → solo morosos, con ambos hijos', async () => {
    await reset(); await setStatus(sub.child, 'unpaid'); await setStatus(sub.child2, 'past_due');
    assert.deepEqual((await has('delinquent', U.tutor)).items.map((i) => i.status).sort(), ['past_due', 'unpaid']);
    assert.equal(await has('grace', U.tutor), undefined);
  });
  await run('tutor con dos hijos: uno past_due y otro active → en gracia con un solo item', async () => {
    await reset(); await setStatus(sub.child2, 'past_due');
    const p = await has('grace', U.tutor);
    assert.deepEqual(p.items.map((i) => i.student_id), [U.child2]);
  });
  await run('recibos pendientes: open sí (con intentos, error, url), paid no', async () => {
    await reset(); await setStatus(sub.child, 'past_due');
    const mk = (status) => servicePool.query(
      `INSERT INTO invoices (student_id, payer_id, subscription_id, stripe_invoice_id, status, amount_due_cents,
                             attempt_count, last_payment_error, hosted_invoice_url)
       VALUES ($1, $2, $3, $4, $5, 1000, 2, 'tarjeta rechazada', 'https://x/inv') RETURNING id`,
      [U.child, U.tutor, sub.child, `in_test_${crypto.randomUUID()}`, status]);
    const open = (await mk('open')).rows[0].id;
    await mk('paid');
    const p = await has('grace', U.tutor);
    assert.equal(p.invoices.length, 1);
    assert.deepEqual(
      [p.invoices[0].id, p.invoices[0].item_id, p.invoices[0].attempt_count, p.invoices[0].last_payment_error, p.invoices[0].hosted_invoice_url],
      [open, sub.child, 2, 'tarjeta rechazada', 'https://x/inv']);
  });
  await run('paginación: total, limit, offset; fuera de rango → 400', async () => {
    await reset(); await setStatus(sub.alu, 'past_due'); await setStatus(sub.child, 'past_due');
    const all = await overdue('grace', { limit: 100 });
    assert.ok(all.total >= 2 && all.payers.length === all.total);
    const page = await overdue('grace', { limit: 1, offset: 1 });
    assert.deepEqual([page.payers.length, page.total, page.limit, page.offset], [1, all.total, 1, 1]);
    assert.equal(page.payers[0].payer_id, all.payers[1].payer_id);
    assert.equal((await overdue('grace', { limit: 1, offset: 1000 })).payers.length, 0);
    for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 'x' }, { offset: -1 }]) {
      await assert.rejects(overdue('grace', bad), (e) => e.status === 400 && e.code === 'invalid_pagination');
    }
  });
  await run('RLS: quien no es admin no ve nada', async () => {
    await reset(); await setStatus(sub.alu, 'unpaid');
    for (const [uid, role] of [[U.prof, 'profesor'], [U.other, 'alumno']]) {
      assert.equal((await overdue('delinquent', {}, { uid, role })).total, 0);
    }
  });
  await reset();

  // B10.5: validaciones del cambio de plan (fallan antes de Stripe) y cambio de disciplina.
  // Los flujos con Stripe (subida, bajada, Schedule) están en test:webhook.
  discD = await mkDisc('T-Bill-D', false);
  const pc = {
    one: await mkPlan({ tag: 'pc-one', max_disciplines: 1, price_cents: 2000 }),
    two: await mkPlan({ tag: 'pc-two', max_disciplines: 2, price_cents: 3000 }),
  };
  co.push(pc.one, pc.two);
  const { rows: [{ stripe_price_id: pcPrice }] } = await servicePool.query(`SELECT stripe_price_id FROM plans WHERE id = $1`, [pc.one.id]);
  // Cuota real (el cambio de disciplina deja su espejo en la metadata de Stripe).
  const pcCus = await stripe.customers.create({
    payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } });
  const pcStripe = await stripe.subscriptions.create({ customer: pcCus.id, items: [{ price: pcPrice }],
    metadata: { student_id: U.pc, payer_id: U.pc, plan_id: pc.one.id, discipline_ids: String(disc) } });
  stripeSubs.push(pcStripe.id);
  const mkSub = async (key, student, payer, planId, stripeId, ids) => {
    sub[key] = crypto.randomUUID();
    await servicePool.query(
      `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id,
                                  current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, 'active', $5, now() - interval '1 day', now() + interval '29 days')`,
      [sub[key], student, payer, planId, stripeId]);
    for (const d of ids) await servicePool.query(`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [sub[key], d]);
  };
  await mkSub('pc', U.pc, U.pc, pc.one.id, pcStripe.id, [disc]);
  await mkSub('child3', U.child3, U.tutor, pc.one.id, `sub_test_${crypto.randomUUID()}`, [disc]);
  const setSub = (key, sql, params = []) => servicePool.query(`UPDATE subscriptions SET ${sql} WHERE id = $1`, [sub[key], ...params]);
  const asUser = (who, fn) => withRls({ uid: U[who], role: people[who] }, fn, { commit: false });
  const plan$ = (who, body) => asUser(who, (c) => changePlan(c, { id: sub.pc, actorId: U[who], isAdmin: who === 'admin', ...body }));
  const disc$ = (who, key, fromId, toId) => withRls({ uid: U[who], role: people[who] },
    (c) => changeDiscipline(c, { id: sub[key], actorId: U[who], isAdmin: who === 'admin', fromId, toId }));
  const fails = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);

  await run('cambio de plan: quién, estado, mismo plan y las validaciones del checkout', async () => {
    await fails(plan$('other', { planId: pc.two.id, disciplineIds: [disc, discB] }), 404, 'subscription_not_found'); // RLS
    await fails(asUser('tutor2', (c) => changePlan(c, { id: sub.child3, actorId: U.tutor2, isAdmin: false, planId: pc.two.id })),
      403, 'not_payer');
    await fails(plan$('pc', { planId: pc.one.id, disciplineIds: [disc] }), 409, 'same_plan');
    await fails(plan$('pc', { planId: coRetired.id }), 404, 'plan_not_found');
    await fails(plan$('admin', { planId: coKids.id }), 409, 'plan_minors_only');
    await fails(plan$('pc', { planId: pc.two.id, disciplineIds: [disc] }), 400, 'invalid_field');
    await fails(plan$('pc', { planId: pc.two.id, disciplineIds: [disc, discK] }), 409, 'discipline_not_eligible');
    await fails(plan$('pc', { planId: pc.two.id, disciplineIds: 'x' }), 400, 'invalid_field');
    await setSub('pc', `status = 'past_due'`);
    await fails(plan$('pc', { planId: pc.two.id, disciplineIds: [disc, discB] }), 409, 'subscription_not_active');
    await setSub('pc', `status = 'active', cancel_at_period_end = true`);
    await fails(plan$('admin', { planId: pc.two.id, disciplineIds: [disc, discB] }), 409, 'cancel_scheduled');
    await setSub('pc', `cancel_at_period_end = false`);
  });

  await run('cambio de disciplina: inmediato, cancela con discipline_change, espejo en Stripe; límite por periodo', async () => {
    const { rows: [s2] } = await servicePool.query(
      `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
       VALUES ($1, $2, now() + interval '3 days', now() + interval '3 days 1 hour', 60, 5, 'scheduled') RETURNING id`, [disc, U.prof]);
    pcSessions.push(s2.id);
    const { rows: [b] } = await servicePool.query(
      `INSERT INTO bookings (id, session_id, student_id, booked_by, status)
       VALUES (gen_random_uuid(), $1, $2, $2, 'confirmed') RETURNING id`, [s2.id, U.pc]);
    assert.deepEqual(await disc$('pc', 'pc', disc, discB), { disciplines: [discB], changes_left: 0, free: false });
    const { rows: [bk2] } = await servicePool.query(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [b.id]);
    assert.deepEqual([bk2.status, bk2.cancel_reason], ['cancelled', 'discipline_change']);
    const { rows: [n] } = await servicePool.query(
      `SELECT actor_id, changes FROM audit_log WHERE action = 'notice.discipline_change' AND resource_id = $1`, [b.id]);
    assert.deepEqual([n.actor_id, n.changes.recipients], [U.pc, [U.pc]]);
    assert.equal((await stripe.subscriptions.retrieve(pcStripe.id)).metadata.discipline_ids, String(discB));
    await assert.rejects(disc$('pc', 'pc', discB, disc), (e) => e.status === 409 && e.code === 'discipline_change_limit'
      && e.details.limit === 1 && e.details.used === 1 && Boolean(e.details.resets_at));
    const got = await asUser('pc', (c) => getSubscription(c, { studentId: U.pc }));
    assert.deepEqual([got.id, got.plan.id, got.disciplines.map((d) => d.id), got.discipline_changes_left, got.scheduled_change],
      [sub.pc, pc.one.id, [discB], 0, null]);
  });

  await run('cambio de disciplina gratis: la abandonada desactivada no cuenta para el límite', async () => {
    await servicePool.query(`UPDATE disciplines SET is_active = false WHERE id = $1`, [discB]);
    try {
      assert.deepEqual(await disc$('admin', 'pc', discB, discD), { disciplines: [discD], changes_left: 0, free: true });
    } finally {
      await servicePool.query(`UPDATE disciplines SET is_active = true WHERE id = $1`, [discB]);
    }
  });

  await run('límite 0: sin cambios salvo los gratis; per_period inválido → 400; solo admin', async () => {
    const admin = (body) => withRls({ uid: U.admin, role: 'admin' }, (c) => updateDisciplineChangeSettings(c, body, U.admin));
    for (const bad of [{ per_period: -1 }, { per_period: 1.5 }, { per_period: '1' }, {}]) {
      await fails(admin(bad), 400, 'invalid_field');
    }
    await assert.rejects(withRls({ uid: U.pc, role: 'alumno' }, (c) => updateDisciplineChangeSettings(c, { per_period: 3 }, U.pc)));
    assert.deepEqual(await admin({ per_period: 0 }), { per_period: 0 });
    await assert.rejects(disc$('tutor', 'child3', disc, discB), (e) => e.code === 'discipline_change_limit' && e.details.limit === 0);
    assert.equal((await asUser('tutor', (c) => getSubscription(c, { studentId: U.child3 }))).discipline_changes_left, 0);
    await admin({ per_period: 1 });
  });

  await run('cambio de disciplina: quién (tutor no pagador sí; otro alumno y profesor no) y errores', async () => {
    // tutor2 no paga pero es tutor vinculado: pasa el permiso y llega a las reglas.
    await fails(disc$('tutor2', 'child3', discB, disc), 409, 'discipline_not_chosen');
    await fails(disc$('other', 'child3', disc, discB), 404, 'subscription_not_found');
    await fails(disc$('prof', 'pc', discD, disc), 404, 'subscription_not_found');
    await fails(disc$('tutor', 'child3', disc, disc), 409, 'discipline_not_eligible'); // ya elegida
    await fails(disc$('pc', 'pc', discD, discK), 409, 'discipline_not_eligible'); // adulto, solo menores
    await fails(disc$('pc', 'pc', 'x', disc), 400, 'invalid_field');
    await fails(disc$('tutor', 'child', disc, discB), 409, 'plan_all_disciplines');
    await setSub('child3', `status = 'unpaid'`);
    await fails(disc$('tutor', 'child3', disc, discB), 409, 'subscription_not_in_force');
    await setSub('child3', `status = 'active'`);
  });
} finally {
  if (stripeSub) await stripe.subscriptions.cancel(stripeSub.id);
  for (const id of stripeSubs) await stripe.subscriptions.cancel(id).catch(() => {});
  await servicePool.query(`DELETE FROM academy_settings WHERE key LIKE 'insurance\\_%'`);
  for (const { key, value } of savedSettings) {
    await servicePool.query(`INSERT INTO academy_settings (key, value) VALUES ($1, $2)`, [key, value]);
  }
  await servicePool.query(`DELETE FROM audit_log WHERE resource_type = 'insurance' AND actor_id = ANY($1::uuid[])`, [Object.values(U)]);
  await servicePool.query(`DELETE FROM audit_log WHERE resource_id = ANY($1::text[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM audit_log WHERE action = 'settings.discipline_changes' AND actor_id = $1`, [U.admin]);
  await servicePool.query(`DELETE FROM academy_settings WHERE key = 'discipline_changes_per_period'`);
  if (savedChanges !== undefined) {
    await servicePool.query(`INSERT INTO academy_settings (key, value) VALUES ('discipline_changes_per_period', $1)`, [savedChanges]);
  }
  await servicePool.query(`DELETE FROM invoices WHERE student_id = ANY($1::uuid[])`, [Object.values(U)]);
  await servicePool.query(`DELETE FROM insurances WHERE student_id = ANY($1::uuid[])`, [Object.values(U)]);
  await servicePool.query(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [Object.values(U)]);
  if (testWaiver) await servicePool.query(`DELETE FROM agreement_documents WHERE id = $1`, [testWaiver]);
  if (syncedSub) await servicePool.query(`DELETE FROM subscriptions WHERE id = $1`, [syncedSub]);
  if (synced) {
    await servicePool.query(`DELETE FROM audit_log WHERE resource_id = $1`, [synced.id]);
    await servicePool.query(`DELETE FROM plans WHERE id = $1`, [synced.id]);
  }
  await servicePool.query(`DELETE FROM audit_log WHERE resource_id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM bookings WHERE id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1`, [sess.id]);
  await servicePool.query(`DELETE FROM audit_log WHERE resource_id IN (SELECT id::text FROM bookings WHERE session_id = ANY($1::uuid[]))`, [pcSessions]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [pcSessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [pcSessions]);
  await servicePool.query(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM invoices WHERE id = $1`, [inv]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  for (const p of co) await servicePool.query(`DELETE FROM plan_disciplines WHERE plan_id = $1`, [p.id]);
  await servicePool.query(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [co.map((p) => p.id)]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [[disc, discK, discB, discD].filter(Boolean)]);
  await servicePool.query(`DELETE FROM guardianships WHERE tutor_id = ANY($1::uuid[])`, [[U.tutor, U.tutor2]]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [Object.values(U)]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
