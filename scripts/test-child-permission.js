// Crear hijos es un permiso por usuario que concede un admin (migración 062). La app entera sobre la BD efímera.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { startApp } from './lib/app-server.js';
import { signToken } from '../src/services/jwt.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const q = (text, params) => servicePool.query(text, params).then((r) => r.rows);
const tag = `cp${crypto.randomBytes(3).toString('hex')}`;
const P = {};
for (const [k, role, years] of [['admin', 'admin', 35], ['tutor', 'alumno', 40], ['other', 'alumno', 38]]) {
  [{ id: P[k] }] = await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [`${tag}-${k}`, yearsAgo(years)]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [P[k], role]);
  await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [P[k], `${tag}-${k}@test.local`]);
}
const app = await startApp();
const tok = Object.fromEntries(Object.entries(P).map(([k, id]) => [k, signToken({ sub: id, role: k === 'admin' ? 'admin' : 'alumno' })]));
const http = (who, method, url, body) => app.http(method, url, { token: tok[who], body });
const child = (n) => ({ display_name: `${tag}-hijo${n}`, birth_date: yearsAgo(8) });
const grant = (who, id, enabled) => http(who, 'PUT', `/admin/profiles/${id}/can-create-children`, { enabled });
const count = async () => +(await q(`SELECT count(*) FROM guardianships WHERE tutor_id = $1`, [P.tutor]))[0].count;

try {
  await run('sin permiso: 403 child_creation_not_allowed y no se crea nada', async () => {
    assert.equal((await http('tutor', 'GET', '/me')).body.can_create_children, false);
    const r = await http('tutor', 'POST', '/me/children', child(1));
    assert.deepEqual([r.status, r.body.code], [403, 'child_creation_not_allowed']);
    assert.equal(await count(), 0);
    assert.equal((await q(`SELECT 1 FROM profiles WHERE display_name = $1`, [`${tag}-hijo1`])).length, 0);
  });
  await run('un usuario no se concede el permiso: ni por el endpoint admin ni con UPDATE directo', async () => {
    assert.equal((await grant('tutor', P.tutor, true)).status, 403);
    assert.equal((await grant('other', P.other, true)).status, 403);
    await assert.rejects(withRls({ uid: P.tutor, role: 'alumno' }, (c) =>
      c.query(`UPDATE auth_credentials SET can_create_children = true WHERE profile_id = $1`, [P.tutor])), /permission denied/);
    await assert.rejects(withRls({ uid: P.tutor, role: 'alumno' }, (c) =>
      c.query(`SELECT set_can_create_children($1, true)`, [P.tutor])), (e) => e.code === '42501');
    assert.equal((await http('tutor', 'GET', '/me')).body.can_create_children, false);
  });
  await run('el admin concede: /me lo expone, 201, la ficha admin lo muestra y queda en audit_log', async () => {
    const bad = await http('admin', 'PUT', `/admin/profiles/${P.tutor}/can-create-children`, { enabled: 'si' });
    assert.deepEqual([bad.status, bad.body.code], [400, 'invalid_field']);
    const r = await grant('admin', P.tutor, true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.profile.can_create_children, true);
    assert.equal((await http('admin', 'GET', `/admin/profiles/${P.tutor}`)).body.profile.can_create_children, true);
    assert.equal((await http('tutor', 'GET', '/me')).body.can_create_children, true);
    assert.equal((await http('tutor', 'POST', '/me/children', child(2))).status, 201);
    const [a] = await q(`SELECT actor_id, resource_type, changes FROM audit_log
                          WHERE action = 'profile.can_create_children' AND resource_id = $1`, [P.tutor]);
    assert.equal(a.actor_id, P.admin);
    assert.deepEqual(a.changes, { can_create_children: true });
  });
  await run('al revocar: 403 al crear, pero los hijos existentes siguen listados', async () => {
    assert.equal((await grant('admin', P.tutor, false)).status, 200);
    const r = await http('tutor', 'POST', '/me/children', child(3));
    assert.deepEqual([r.status, r.body.code], [403, 'child_creation_not_allowed']);
    const kids = (await http('tutor', 'GET', '/me/children')).body.children;
    assert.deepEqual(kids.map((k) => k.display_name), [`${tag}-hijo2`]);
    assert.equal((await q(`SELECT count(*) FROM audit_log WHERE action = 'profile.can_create_children' AND resource_id = $1`, [P.tutor]))[0].count, '2');
  });
  await run('perfil sin credenciales: 404', async () => {
    const [{ id }] = await q(`INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`${tag}-x`]);
    assert.equal((await grant('admin', id, true)).status, 404);
  });
} finally {
  await app.close();
  await closePools();
}
if (failed) { console.error(`\n${failed} test(s) fallaron`); process.exit(1); }
console.log('\nTodos los tests OK');
