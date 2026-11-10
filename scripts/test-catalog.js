import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import {
  createDiscipline, updateDiscipline, listDisciplines, createPlan, updatePlan, listPlans,
  setEligibleDisciplines, listMedalThemes,
} from '../src/services/catalog.js';

const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);
const sp = async (c, fn) => { // savepoint: un error SQL no aborta el resto de la transacción
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO t'); }
};

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const admin = crypto.randomUUID();
const alumno = crypto.randomUUID();
await servicePool.query(`INSERT INTO profiles (id, display_name) VALUES ($1,'admin-t'),($2,'alumno-t')`, [admin, alumno]);
// Solo el webhook escribe suscripciones (012): el plan con suscriptor se crea fuera de la transacción RLS.
const subPlan = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ('T-Subscribed', 3000, 2) RETURNING id`)).rows[0].id;
const subId = crypto.randomUUID();
await servicePool.query(
  `INSERT INTO subscriptions (id, student_id, plan_id, status, payer_id, stripe_subscription_id)
   VALUES ($1,$2,$3,'active',$2,$4)`, [subId, alumno, subPlan, `sub_test_${subId}`]);
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

try {
  await withRls({ uid: admin, role: 'admin' }, async (c) => {
    let bjj, kids, open, kidsPlan;
    await run('admin crea disciplinas; id autogenerado (string)', async () => {
      bjj = await createDiscipline(c, { name: 'T-BJJ' });
      kids = await createDiscipline(c, { name: 'T-Kids', min_age: 5, max_age: 12 });
      assert.match(bjj.id, /^\d+$/);
      assert.deepEqual([bjj.min_age, bjj.max_age, kids.min_age, kids.max_age], [null, null, 5, 12]);
      await sp(c, () => rejects(createDiscipline(c, { name: 'T-BJJ' }), 409, 'name_taken'));
      await rejects(createDiscipline(c, { name: '' }), 400, 'invalid_field');
    });
    await run('rango de edad: enteros 0–99 o null, mínima ≤ máxima (también al cambiar solo una)', async () => {
      for (const bad of [{ min_age: -1 }, { max_age: 100 }, { min_age: 5.5 }, { max_age: '12' }, { min_age: 13, max_age: 12 }]) {
        await sp(c, () => rejects(createDiscipline(c, { name: 'T-Bad', ...bad }), 400, 'invalid_field'));
      }
      await sp(c, () => rejects(updateDiscipline(c, { id: kids.id, body: { min_age: 13 }, actorId: admin }), 400, 'invalid_field'));
      const d = await updateDiscipline(c, { id: kids.id, body: { min_age: null, max_age: 17 }, actorId: admin });
      assert.deepEqual([d.min_age, d.max_age], [null, 17]);
      await updateDiscipline(c, { id: kids.id, body: { min_age: 5, max_age: 12 }, actorId: admin });
    });
    await run('id explícito rechazado (GENERATED ALWAYS)', () => sp(c, () =>
      assert.rejects(c.query(`INSERT INTO disciplines (id, name) VALUES (999999, 'x')`), /non-DEFAULT/)));
    await run('validación de planes', async () => {
      await rejects(createPlan(c, { name: 'T-bad', price_cents: -1, max_disciplines: 1 }), 400, 'invalid_field');
      await rejects(createPlan(c, { name: 'T-bad', price_cents: 1, max_disciplines: 0 }), 400, 'invalid_field');
      await rejects(createPlan(c, { name: 'T-bad', price_cents: 1 }), 400, 'invalid_field'); // falta max_disciplines
      await rejects(createPlan(c, { name: 'T-bad', price_cents: 1, max_disciplines: 1, billing_period: 'yearly' }), 400, 'invalid_field');
    });
    await run('crea planes (1 y todas) con defaults', async () => {
      open = await createPlan(c, { name: 'T-Open', price_cents: 5000, max_disciplines: 2 });
      kidsPlan = await createPlan(c, { name: 'T-KidsPlan', price_cents: 3000, max_disciplines: null, minors_only: true });
      assert.equal(open.billing_period, 'monthly');
      assert.equal(open.is_active, true);
      assert.equal(kidsPlan.max_disciplines, null);
      assert.deepEqual(open.eligible_discipline_ids, []);
    });
    await run('elegibles: reemplazo, existencia, mínimo y plan solo menores con disciplina de adultos', async () => {
      const other = await createDiscipline(c, { name: 'T-MT' });
      assert.deepEqual(await setEligibleDisciplines(c, { planId: open.id, ids: [bjj.id, other.id], actorId: admin }), [bjj.id, other.id].sort((a, b) => a - b));
      await rejects(setEligibleDisciplines(c, { planId: open.id, ids: [bjj.id], actorId: admin }), 409, 'eligible_too_few');
      await rejects(setEligibleDisciplines(c, { planId: open.id, ids: [bjj.id, '999999999'], actorId: admin }), 400, 'unknown_discipline');
      // Un plan solo menores puede listar disciplinas de adultos (adolescentes en Muay Thai adultos).
      assert.deepEqual(await setEligibleDisciplines(c, { planId: kidsPlan.id, ids: [bjj.id], actorId: admin }), [bjj.id]);
      assert.deepEqual(await setEligibleDisciplines(c, { planId: kidsPlan.id, ids: [kids.id], actorId: admin }), [kids.id]);
      assert.deepEqual(await setEligibleDisciplines(c, { planId: open.id, ids: [], actorId: admin }), []);
    });
    await run('cambio de precio audita; retirar plan/disciplina; sin DELETE', async () => {
      const p = await updatePlan(c, { id: open.id, body: { price_cents: 6000 }, actorId: admin });
      assert.equal(p.price_cents, 6000);
      const { rows } = await c.query(`SELECT changes FROM audit_log WHERE action='plan.price_change' AND resource_id=$1`, [open.id]);
      assert.deepEqual(rows[0].changes, { from: 5000, to: 6000 });
      assert.equal((await updatePlan(c, { id: open.id, body: { is_active: false }, actorId: admin })).is_active, false);
      assert.equal((await updateDiscipline(c, { id: bjj.id, body: { is_active: false }, actorId: admin })).is_active, false);
      await rejects(updatePlan(c, { id: '999999999', body: { price_cents: 1 }, actorId: admin }), 404, 'plan_not_found');
      await rejects(updatePlan(c, { id: open.id, body: {}, actorId: admin }), 400, 'empty_patch');
      await sp(c, () => assert.rejects(c.query(`DELETE FROM plans WHERE id=$1`, [open.id]), /permission denied/));
      await sp(c, () => assert.rejects(c.query(`DELETE FROM disciplines WHERE id=$1`, [bjj.id]), /permission denied/));
    });
    await run('plan con suscripciones: max_disciplines/minors_only inmutables', async () => {
      const id = String(subPlan);
      await rejects(updatePlan(c, { id, body: { max_disciplines: 1 }, actorId: admin }), 409, 'plan_has_subscriptions');
      await rejects(updatePlan(c, { id, body: { minors_only: true }, actorId: admin }), 409, 'plan_has_subscriptions');
      await updatePlan(c, { id, body: { price_cents: 3500 }, actorId: admin }); // precio sí
    });

    await run('temática: una por disciplina activa (crear, reasignar, desactivar, reactivar) y lista de libres', async () => {
      await c.query(`UPDATE disciplines SET medal_theme = NULL`); // dentro de la transacción: aísla de los datos locales
      const holder = async (code) => (await listMedalThemes(c)).find((t) => t.code === code).discipline_id;
      const a = await createDiscipline(c, { name: 'T-Box', medal_theme: 'ippo' });
      assert.equal(a.medal_theme, 'ippo');
      assert.equal(await holder('ippo'), a.id);
      assert.equal(await holder('saiyan'), null);
      await sp(c, () => rejects(createDiscipline(c, { name: 'T-Box2', medal_theme: 'ippo' }), 409, 'theme_taken'));
      await sp(c, () => rejects(createDiscipline(c, { name: 'T-Box2', medal_theme: 'nope' }), 400, 'invalid_field'));
      const b = await createDiscipline(c, { name: 'T-Box2' });
      assert.equal(b.medal_theme, null);
      await sp(c, () => rejects(updateDiscipline(c, { id: b.id, body: { medal_theme: 'ippo' }, actorId: admin }), 409, 'theme_taken'));
      // Reasignar: se quita de A y se pone en B.
      assert.equal((await updateDiscipline(c, { id: a.id, body: { medal_theme: null }, actorId: admin })).medal_theme, null);
      assert.equal((await updateDiscipline(c, { id: b.id, body: { medal_theme: 'ippo' }, actorId: admin })).medal_theme, 'ippo');
      // Desactivar la libera (la desactivada la conserva) y reactivar con ella ocupada da theme_taken.
      assert.equal((await updateDiscipline(c, { id: b.id, body: { is_active: false }, actorId: admin })).medal_theme, 'ippo');
      assert.equal(await holder('ippo'), null);
      await createDiscipline(c, { name: 'T-Box3', medal_theme: 'ippo' });
      await sp(c, () => rejects(updateDiscipline(c, { id: b.id, body: { is_active: true }, actorId: admin }), 409, 'theme_taken'));
      assert.equal((await updateDiscipline(c, { id: b.id, body: { is_active: true, medal_theme: 'saiyan' }, actorId: admin })).medal_theme, 'saiyan');
    });

    await as(c, alumno, 'alumno');
    await run('alumno ve activos pero no retirados; no escribe', async () => {
      assert.ok(!(await listPlans(c)).some((p) => p.id === open.id));
      assert.ok((await listPlans(c)).some((p) => p.id === kidsPlan.id));
      assert.ok(!(await listDisciplines(c)).some((d) => d.id === bjj.id));
      await sp(c, () => assert.rejects(createDiscipline(c, { name: 'T-hack' }), /row-level security/));
      await sp(c, () => assert.rejects(createPlan(c, { name: 'T-hack', price_cents: 1, max_disciplines: 1 }), /row-level security/));
      await sp(c, async () => {
        const { rowCount } = await c.query(`UPDATE plans SET price_cents = 1 WHERE id=$1`, [kidsPlan.id]);
        assert.equal(rowCount, 0);
      });
      await sp(c, () => assert.rejects(c.query(`INSERT INTO plan_disciplines VALUES ($1,$2)`, [kidsPlan.id, kids.id]), /row-level security/));
    });
    await run('sin sesión no ve nada', async () => {
      await c.query(`SELECT set_config('app.current_user_id','',true)`);
      await c.query(`SELECT set_config('app.current_user_id', NULL, true)`);
      assert.equal((await c.query(`SELECT 1 FROM plans`)).rowCount, 0);
    });
    await as(c, admin, 'admin');
    await run('admin ve retirados', async () => {
      assert.ok((await listPlans(c)).some((p) => p.id === open.id));
    });
  }, { commit: false });
} finally {
  await servicePool.query(`DELETE FROM subscriptions WHERE id = $1`, [subId]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [subPlan]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[admin, alumno]]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
