// ADR 0033 (migración 073): varios roles por cuenta. Sobre la base efímera de with-temp-db (ya migrada): se baja la 073,
// se siembra un perfil sin fila de rol, se sube y se comprueban el backfill, la unicidad (user_id, role), set_last_role,
// las políticas de user_roles, register_event, public_profiles y public_disciplines con varios roles; luego el down
// (una fila por usuario, todo como en la 072) y el up de nuevo.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { servicePool, appPool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';

const migrate = (dir) => {
  const r = spawnSync('node_modules/.bin/node-pg-migrate', [dir, ...(dir === 'down' ? ['1'] : [])], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
};
const q = (sql, params) => servicePool.query(sql, params).then((r) => r.rows);
const ctx = (uid, role, fn) => withRls({ uid, role }, fn, { commit: false });
const denied = (p) => assert.rejects(p, (e) => e.code === '42501' || /row-level security/i.test(e.message));
const rolesOf = async (id) => (await q(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, [id])).map((r) => r.role);
// Lo que la 073 cambia y el down debe dejar como estaba: políticas, funciones y vistas.
const snapshot = async () => ({
  policies: await q(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'user_roles' ORDER BY policyname`),
  register: (await q(`SELECT pg_get_functiondef('register_event(uuid, uuid, boolean)'::regprocedure) AS d`))[0].d,
  notice: (await q(`SELECT pg_get_functiondef('enqueue_notice(uuid, uuid[], uuid)'::regprocedure) AS d`))[0].d,
  disciplines: (await q(`SELECT pg_get_functiondef('public_disciplines(uuid)'::regprocedure) AS d`))[0].d,
  view: (await q(`SELECT pg_get_viewdef('public_profiles'::regclass) AS d`))[0].d,
});

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const tag = `mr${crypto.randomBytes(3).toString('hex')}`;
const ids = Object.fromEntries(['sinfila', 'prof', 'admin', 'admin2', 'multi', 'multi2', 'soloadm', 'duo', 'nuevo', 'viewer'].map((k) => [k, crypto.randomUUID()]));
const adult = (k, extra = '') => q(
  `INSERT INTO profiles (id, display_name, birth_date${extra ? ', is_public' : ''}) VALUES ($1, $2, '1990-01-01'${extra ? ', true' : ''})`, [ids[k], `${tag}-${k}`]);
const email = (k) => q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [ids[k], `${tag}-${k}@kz.test`]);
const give = (k, ...roles) => Promise.all(roles.map((r) => q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [ids[k], r])));

try {
  migrate('down'); // 073 → 072
  const before = await snapshot();
  assert.equal((await q(`SELECT 1 FROM pg_attribute WHERE attrelid = 'profiles'::regclass AND attname = 'last_role'`)).length, 0);
  await adult('sinfila');
  await adult('prof'); await give('prof', 'profesor');
  migrate('up');

  await run('backfill: el perfil sin fila pasa a alumno y el que tenía una la conserva', async () => {
    assert.deepEqual(await rolesOf(ids.sinfila), ['alumno']);
    assert.deepEqual(await rolesOf(ids.prof), ['profesor']);
  });

  await run('unicidad: dos roles distintos sí, dos iguales no', async () => {
    await give('prof', 'alumno');
    assert.deepEqual(await rolesOf(ids.prof), ['alumno', 'profesor']);
    await assert.rejects(give('prof', 'alumno'), (e) => e.code === '23505');
    assert.equal((await q(`SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_key'`)).length, 0);
  });

  await run('set_last_role: guarda un rol asignado, rechaza uno que no lo es y solo toca la propia fila', async () => {
    await ctx(ids.prof, 'profesor', async (c) => {
      await c.query(`SELECT set_last_role('alumno')`);
      assert.equal((await c.query(`SELECT last_role FROM profiles WHERE id = $1`, [ids.prof])).rows[0].last_role, 'alumno');
    });
    await assert.rejects(ctx(ids.prof, 'profesor', (c) => c.query(`SELECT set_last_role('admin')`)), (e) => e.code === '42501');
    await ctx(ids.sinfila, 'alumno', async (c) => {
      await c.query(`SELECT set_last_role('alumno')`);
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM profiles WHERE last_role IS NOT NULL`)).rows[0].n, 1);
    });
    await assert.rejects(appPool.query(`UPDATE profiles SET last_role = 'admin' WHERE id = $1`, [ids.prof])); // sin permiso de columna
  });

  await run('register_event: un perfil alumno+profesor llega a buscar el evento; solo-profesor, no es alumno', async () => {
    const call = (uid) => ctx(uid, 'alumno', (c) => c.query(`SELECT register_event(gen_random_uuid(), $1, false)`, [uid]));
    await assert.rejects(call(ids.prof), (e) => e.message === 'event_not_found');
    await adult('duo'); await give('duo', 'profesor');
    await assert.rejects(call(ids.duo), (e) => e.message === 'not_a_student');
  });

  await run('enqueue_notice: un profesor o admin que también es alumno o tutor recibe el aviso; solo profesor o admin, no', async () => {
    await give('duo', 'alumno'); // duo ya era profesor (register_event)
    await adult('multi2'); await give('multi2', 'admin', 'tutor');
    await adult('soloadm'); await give('soloadm', 'admin');
    const aid = crypto.randomUUID();
    await q(`INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes) VALUES ($1, $2, 'notice.test', 'test', $3, '{}')`,
      [aid, ids.sinfila, tag]);
    const who = [ids.prof, ids.duo, ids.multi2, ids.soloadm, ids.sinfila];
    await q(`SELECT enqueue_notice($1, $2::uuid[], NULL)`, [aid, who]);
    const got = (await q(`SELECT recipient_id FROM notice_deliveries WHERE audit_id = $1`, [aid])).map((r) => r.recipient_id).sort();
    // prof: alumno+profesor (le tocó en la prueba de unicidad); sinfila: alumno; duo y multi2 con alumno o tutor; soloadm, no
    assert.deepEqual(got, [ids.prof, ids.duo, ids.multi2, ids.sinfila].sort());
  });

  await run('public_profiles: una fila por perfil con varios roles (profesor gana a alumno; alumno a tutor)', async () => {
    await adult('multi', 'public');
    await q(`UPDATE profiles SET visible_fields = '{"disciplines": true}' WHERE id = $1`, [ids.multi]);
    await email('multi'); await give('multi', 'tutor', 'alumno', 'profesor');
    await adult('nuevo', 'public'); await email('nuevo'); await give('nuevo', 'tutor', 'alumno');
    await adult('viewer'); await give('viewer', 'alumno');
    const rows = await ctx(ids.viewer, 'alumno', async (c) =>
      (await c.query(`SELECT id, role, disciplines FROM public_profiles WHERE id IN ($1, $2)`, [ids.multi, ids.nuevo])).rows);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.role]));
    assert.equal(rows.length, 2);
    assert.deepEqual([by[ids.multi], by[ids.nuevo]], ['profesor', 'alumno']);
  });

  await run('public_disciplines: una disciplina impartida sale una sola vez con varios roles', async () => {
    const [{ id: d }] = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-disc`]);
    await q(`INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, starts_on)
             VALUES ($1, $2, 1, '18:00', 60, 10, CURRENT_DATE)`, [d, ids.multi]);
    const [{ disciplines }] = await ctx(ids.viewer, 'alumno', async (c) =>
      (await c.query(`SELECT disciplines FROM public_profiles WHERE id = $1`, [ids.multi])).rows);
    assert.deepEqual(disciplines.map((x) => x.name), [`${tag}-disc`]);
  });

  await run('políticas: el admin da y quita roles ajenos, no los suyos ni la fila admin de otro', async () => {
    await adult('admin'); await give('admin', 'admin');
    await adult('admin2'); await give('admin2', 'admin', 'alumno');
    const admin = (fn) => ctx(ids.admin, 'admin', fn);
    await admin(async (c) => {
      assert.equal((await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'tutor')`, [ids.sinfila])).rowCount, 1);
      assert.equal((await c.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'tutor'`, [ids.sinfila])).rowCount, 1);
    });
    await denied(admin((c) => c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`, [ids.admin])));
    await admin(async (c) => {
      assert.equal((await c.query(`UPDATE user_roles SET role = 'tutor' WHERE user_id = $1 AND role = 'alumno'`, [ids.admin2])).rowCount, 1);
      assert.equal((await c.query(`UPDATE user_roles SET role = 'tutor' WHERE user_id = $1`, [ids.admin])).rowCount, 0, 'la propia, no');
      assert.equal((await c.query(`UPDATE user_roles SET role = 'alumno' WHERE user_id = $1 AND role = 'admin'`, [ids.admin2])).rowCount, 0, 'admin ajeno, no');
      assert.equal((await c.query(`DELETE FROM user_roles WHERE user_id = $1`, [ids.admin])).rowCount, 0);
      assert.equal((await c.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [ids.admin2])).rowCount, 0);
    });
  });

  await run('políticas: un no admin solo crea su primera fila y solo alumno', async () => {
    const [{ id }] = await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES (gen_random_uuid(), $1, '1990-01-01') RETURNING id`, [`${tag}-reg`]);
    const reg = (uid, role) => ctx(uid, 'alumno', (c) => c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [uid, role]));
    await denied(reg(id, 'admin'));
    await denied(reg(id, 'profesor'));
    await reg(id, 'alumno'); // el registro: primera fila
    await denied(reg(ids.sinfila, 'tutor')); // ya tiene una
    await denied(reg(ids.prof, 'admin'));
    await denied(ctx(ids.prof, 'profesor', (c) => c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`, [ids.viewer])));
  });

  migrate('down');
  await run('down: una fila por usuario con el rol de mayor prioridad y la constraint vieja', async () => {
    assert.deepEqual(await rolesOf(ids.multi), ['profesor']);
    assert.deepEqual(await rolesOf(ids.nuevo), ['tutor']);
    assert.deepEqual(await rolesOf(ids.prof), ['profesor']);
    assert.deepEqual(await rolesOf(ids.admin2), ['admin']);
    assert.equal((await q(`SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_key' AND contype = 'u'`)).length, 1);
    assert.equal((await q(`SELECT 1 FROM pg_attribute WHERE attrelid = 'profiles'::regclass AND attname = 'last_role' AND NOT attisdropped`)).length, 0);
    assert.equal((await q(`SELECT to_regprocedure('set_last_role(app_role)') AS f`))[0].f, null);
    assert.deepEqual(await snapshot(), before, 'políticas, register_event, public_disciplines y public_profiles como en la 072');
  });

  migrate('up');
  await run('up de nuevo: vuelven los varios roles', async () => {
    await give('multi', 'alumno');
    assert.deepEqual(await rolesOf(ids.multi), ['alumno', 'profesor']);
  });
} catch (e) {
  failed++;
  console.error('FAIL 073\n', e);
} finally {
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
