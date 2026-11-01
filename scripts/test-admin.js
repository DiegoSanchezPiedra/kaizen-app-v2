// B19.0: usuarios y roles del panel (GET /admin/profiles[/:id], PUT …/role, POST/DELETE …/guardians) y el rol de la
// base en requireAuth. Como app_user por HTTP con un express en memoria y JWT firmados (como test:account).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

await import('dotenv/config');
const { servicePool, closePools } = await import('../src/config/database.js');
const { signToken } = await import('../src/services/jwt.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: authRouter } = await import('../src/routes/auth.js');
const { default: adminProfilesRouter } = await import('../src/routes/admin/profiles.js');
const { default: professorRouter } = await import('../src/routes/professor.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);

const tag = `tadm${crypto.randomBytes(3).toString('hex')}`;
// [rol en user_roles (null = sin fila), fecha de nacimiento, con credenciales]
const people = {
  admin: ['admin', null, true], stu: ['alumno', yearsAgo(30), true], stu2: ['alumno', yearsAgo(25), true],
  prof: ['profesor', null, true], prof2: ['profesor', null, true], parent: ['alumno', yearsAgo(40), true],
  tutor2: ['tutor', yearsAgo(42), true], child: ['alumno', yearsAgo(10), false], child2: ['alumno', yearsAgo(8), false],
  grown: ['alumno', yearsAgo(19), false], norole: [null, yearsAgo(35), true],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
const email = (k) => `${tag}-${k}@test.local`;
for (const [k, [role, birth, creds]] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  if (role) await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (creds) {
    await servicePool.query(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`,
      [U[k], email(k)]);
  }
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3), ($1, $4)`,
  [U.parent, U.child, U.child2, U.grown]);
await servicePool.query(`INSERT INTO student_health_info (profile_id, injuries, allergies) VALUES ($1, 'rodilla', 'polen')`,
  [U.child]);

// stu se paga su cuota; el padre paga la del hijo. prof tiene una sesión futura.
const disc = (await servicePool.query(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [tag])).rows[0].id;
const plan = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, 1) RETURNING id`, [tag])).rows[0].id;
const subs = [];
for (const [student, payer] of [[U.stu, U.stu], [U.child, U.parent]]) {
  const id = crypto.randomUUID();
  subs.push(id);
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [id, student, payer, plan, `sub_test_${id}`]);
}
const session = (await servicePool.query(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, location, status)
   VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 60 min', 60, 10, 'tatami 1', 'scheduled')
   RETURNING id`, [disc, U.prof])).rows[0].id;

const app = express().use(express.json()).use('/auth', authRouter).use('/admin', adminProfilesRouter)
  .use('/professor', professorRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
// Token firmado con el rol que se pasa (por defecto el de la fixture): la API debe usar el de la base.
const tokens = {};
const tokenOf = (who, role = people[who][0] ?? 'alumno') => (tokens[`${who}:${role}`] ??= signToken({ sub: U[who], role }));
const http = async (method, url, who, body, role) => {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${tokenOf(who, role)}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const code = (r) => r.body?.code;
const expectError = (r, status, c) => assert.deepEqual([r.status, code(r)], [status, c]);
const lastAudit = async (action, id) => (await servicePool.query(
  `SELECT actor_id, resource_type, changes FROM audit_log WHERE action = $1 AND resource_id = $2
    ORDER BY created_at DESC LIMIT 1`, [action, id])).rows[0];
const realError = console.error;

try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));
  await run('lista: búsqueda por nombre, sin distinguir mayúsculas, por nombre', async () => {
    const r = await http('GET', `/admin/profiles?q=${tag.toUpperCase()}&limit=100`, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, ids.length);
    const names = r.body.profiles.map((p) => p.display_name);
    assert.deepEqual(names, [...names].sort());
  });
  await run('lista: búsqueda por email, filtro por rol y paginación', async () => {
    const byEmail = await http('GET', `/admin/profiles?q=${encodeURIComponent(email('tutor2'))}`, 'admin');
    assert.deepEqual(byEmail.body.profiles.map((p) => p.id), [U.tutor2]);
    const profs = await http('GET', `/admin/profiles?q=${tag}&role=profesor`, 'admin');
    assert.deepEqual(profs.body.profiles.map((p) => p.id).sort(), [U.prof, U.prof2].sort());
    const page = await http('GET', `/admin/profiles?q=${tag}&limit=2&offset=2`, 'admin');
    assert.deepEqual([page.body.profiles.length, page.body.total, page.body.limit, page.body.offset], [2, ids.length, 2, 2]);
    expectError(await http('GET', '/admin/profiles?role=jefe', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/profiles?limit=0', 'admin'), 400, 'invalid_pagination');
  });
  await run('lista: un hijo sin email, menor; el de 18 sin reclamar; cuota viva', async () => {
    const { profiles } = (await http('GET', `/admin/profiles?q=${tag}&limit=100`, 'admin')).body;
    const by = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const pick = (p) => [p.email, p.role, p.is_minor, p.pending_claim, p.subscription_status];
    assert.deepEqual(pick(by[U.child]), [null, 'alumno', true, false, 'active']);
    assert.deepEqual(pick(by[U.grown]), [null, 'alumno', false, true, null]);
    assert.deepEqual(pick(by[U.norole]), [email('norole'), 'alumno', false, false, null]);
    for (const p of profiles) assert.ok(!('birth_date' in p));
  });
  await run('ficha: el hijo con su pagador, sus tutores y su estado; sin birth_date ni salud', async () => {
    const r = await http('GET', `/admin/profiles/${U.child}`, 'admin');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['children', 'guardians', 'insurance', 'profile', 'status', 'subscription']);
    assert.equal(r.body.subscription.id, subs[1]);
    assert.deepEqual(r.body.subscription.payer, { id: U.parent, display_name: `${tag}-parent` });
    assert.equal(r.body.insurance, null);
    assert.deepEqual(r.body.guardians, [{ id: U.parent, display_name: `${tag}-parent`, email: email('parent') }]);
    assert.equal(typeof r.body.status.ok, 'boolean');
    const json = JSON.stringify(r.body);
    for (const k of ['birth_date', 'injuries', 'allergies', 'rodilla', 'polen', 'emergency_contact_name']) {
      assert.ok(!json.includes(k), `la ficha incluye ${k}`);
    }
    assert.deepEqual(Object.keys(r.body.profile).sort(), ['created_at', 'display_name', 'email', 'has_google',
      'has_password', 'id', 'is_minor', 'is_public', 'pending_claim', 'role']);
  });
  await run('ficha: el padre con sus hijos; status solo de un alumno; 404', async () => {
    const parent = (await http('GET', `/admin/profiles/${U.parent}`, 'admin')).body;
    assert.deepEqual(parent.children.map((c) => c.id).sort(), [U.child, U.child2, U.grown].sort());
    assert.equal(parent.children.find((c) => c.id === U.grown).pending_claim, true);
    assert.equal(parent.subscription, null);
    assert.equal((await http('GET', `/admin/profiles/${U.tutor2}`, 'admin')).body.status, null);
    expectError(await http('GET', `/admin/profiles/${crypto.randomUUID()}`, 'admin'), 404, 'profile_not_found');
    expectError(await http('GET', '/admin/profiles/nope', 'admin'), 400, 'invalid_id');
  });
  await run('rol: errores', async () => {
    const put = (who, role) => http('PUT', `/admin/profiles/${U[who]}/role`, 'admin', { role });
    expectError(await put('stu2', 'admin'), 400, 'invalid_field');
    expectError(await put('stu2', undefined), 400, 'invalid_field');
    expectError(await http('PUT', `/admin/profiles/${crypto.randomUUID()}/role`, 'admin', { role: 'tutor' }), 404,
      'profile_not_found');
    expectError(await put('stu2', 'alumno'), 409, 'same_role');
    expectError(await put('admin', 'alumno'), 409, 'admin_role_locked');
    expectError(await put('child', 'tutor'), 409, 'child_role_locked');
    expectError(await put('prof', 'alumno'), 409, 'trainer_has_sessions');
    expectError(await put('stu', 'profesor'), 409, 'student_has_subscription');
    expectError(await put('stu', 'tutor'), 409, 'student_has_subscription');
    assert.equal(await lastAudit('profile.role_change', U.stu), undefined);
  });
  await run('rol: un profesor degradado pierde /professor con el mismo token; queda en audit_log', async () => {
    assert.equal((await http('GET', '/professor/reports/sessions?by=discipline', 'prof2')).status, 200);
    const r = await http('PUT', `/admin/profiles/${U.prof2}/role`, 'admin', { role: 'alumno' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.profile.id, r.body.profile.role], [U.prof2, 'alumno']);
    expectError(await http('GET', '/professor/reports/sessions?by=discipline', 'prof2'), 403, 'insufficient_role');
    assert.equal((await http('GET', '/auth/me', 'prof2')).body.user.role, 'alumno');
    assert.deepEqual(await lastAudit('profile.role_change', U.prof2),
      { actor_id: U.admin, resource_type: 'profile', changes: { from: 'profesor', to: 'alumno' } });
  });
  await run('rol: un alumno ascendido entra en /professor con el mismo token', async () => {
    expectError(await http('GET', '/professor/sessions', 'stu2'), 403, 'insufficient_role');
    assert.equal((await http('PUT', `/admin/profiles/${U.stu2}/role`, 'admin', { role: 'profesor' })).status, 200);
    assert.equal((await http('GET', '/professor/sessions', 'stu2')).status, 200);
  });
  await run('rol: sin fila en user_roles actúa como alumno aunque el token diga admin', async () => {
    assert.equal((await http('GET', '/auth/me', 'norole', undefined, 'admin')).body.user.role, 'alumno');
    expectError(await http('GET', '/admin/profiles', 'norole', undefined, 'admin'), 403, 'insufficient_role');
    // Y se le puede dar un rol: la fila se crea.
    assert.equal((await http('PUT', `/admin/profiles/${U.norole}/role`, 'admin', { role: 'tutor' })).body.profile.role,
      'tutor');
  });
  await run('alumno y profesor → 403', async () => {
    expectError(await http('GET', '/admin/profiles', 'stu'), 403, 'insufficient_role');
    expectError(await http('GET', '/admin/profiles', 'prof'), 403, 'insufficient_role');
    expectError(await http('GET', '/admin/profiles', 'stu2', undefined, 'admin'), 403, 'insufficient_role');
  });
  await run('tutores: errores al vincular', async () => {
    const post = (who, tutor) => http('POST', `/admin/profiles/${U[who]}/guardians`, 'admin', { tutor_id: tutor });
    expectError(await post('child', 'nope'), 400, 'invalid_field');
    expectError(await http('POST', `/admin/profiles/${crypto.randomUUID()}/guardians`, 'admin', { tutor_id: U.tutor2 }),
      404, 'profile_not_found');
    expectError(await post('stu', U.tutor2), 409, 'not_a_child');
    expectError(await post('child', U.child2), 409, 'invalid_guardian');
    expectError(await post('child', crypto.randomUUID()), 409, 'invalid_guardian');
    expectError(await post('child', U.parent), 409, 'already_guardian');
  });
  await run('tutores: vincular y desvincular, con su audit_log', async () => {
    const r = await http('POST', `/admin/profiles/${U.child}/guardians`, 'admin', { tutor_id: U.tutor2 });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.guardians.map((g) => g.id).sort(), [U.parent, U.tutor2].sort());
    assert.deepEqual(await lastAudit('guardian.add', U.child),
      { actor_id: U.admin, resource_type: 'guardian', changes: { tutor_id: U.tutor2 } });
    const del = (who, tutor) => http('DELETE', `/admin/profiles/${U[who]}/guardians/${tutor}`, 'admin');
    expectError(await del('child', U.parent), 409, 'guardian_is_payer');
    expectError(await del('child2', U.parent), 409, 'last_guardian');
    expectError(await del('child', U.stu), 404, 'profile_not_found');
    expectError(await del('stu', U.parent), 409, 'not_a_child');
    assert.equal((await del('child', U.tutor2)).status, 204);
    assert.deepEqual(await lastAudit('guardian.remove', U.child),
      { actor_id: U.admin, resource_type: 'guardian', changes: { tutor_id: U.tutor2 } });
    const rows = (await servicePool.query(`SELECT tutor_id FROM guardianships WHERE minor_id = $1`, [U.child])).rows;
    assert.deepEqual(rows, [{ tutor_id: U.parent }]);
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM audit_log WHERE actor_id = $1`, [U.admin]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1`, [session]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
