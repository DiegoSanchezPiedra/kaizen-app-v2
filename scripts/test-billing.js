import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';

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

const people = { admin: 'admin', prof: 'profesor', alu: 'alumno', other: 'alumno', tutor: 'tutor', child: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-bill`, k === 'child' ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.child]);

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
} finally {
  await servicePool.query(`DELETE FROM audit_log WHERE resource_id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM bookings WHERE id = $1`, [bk.id]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1`, [sess.id]);
  await servicePool.query(`DELETE FROM invoices WHERE id = $1`, [inv]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM guardianships WHERE minor_id = $1`, [U.child]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [Object.values(U)]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
