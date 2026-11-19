// ADR 0033: varios roles por cuenta con un rol activo. Login (último rol o prioridad), POST /auth/role, requireAuth con
// roles, asignar y quitar roles (POST/DELETE /admin/profiles/:id/roles), la lista sin duplicados y que un profesor no
// reserva lo que imparte él. La app entera sobre la BD efímera (with-temp-db).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

await import('dotenv/config');
const { servicePool, closePools } = await import('../src/config/database.js');
const { startApp } = await import('./lib/app-server.js');
const { signToken } = await import('../src/services/jwt.js');
const { loginGoogle } = await import('../src/services/auth.js');
const { hashPassword } = await import('../src/services/password.js');
const { withRls } = await import('../src/db/rls.js');
const { bookSession } = await import('../src/services/bookings.js');
const { assertMfaReauth } = await import('../src/services/mfa.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params).then((r) => r.rows);
const tag = `mr${crypto.randomBytes(3).toString('hex')}`;
const mail = (k) => `${k}-${tag}@kz.test`;
const PASS = 'clave-segura-1';
const HASH = await hashPassword(PASS);

// key → roles; el primero es el rol del token por defecto de la prueba. `kid`: un hijo sin acceso propio.
const people = {
  admin: ['admin'],
  dual: ['alumno', 'profesor'], // profesor que también entrena
  adm2: ['alumno', 'admin'],
  trio: ['alumno', 'tutor'],
  stu: ['alumno'], stu2: ['alumno'], stu3: ['alumno'], tut: ['tutor'], prof: ['profesor'], prof2: ['profesor'],
  subbed: ['alumno', 'tutor'], // alumno con suscripción viva
  kid: ['alumno'],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const tenYearsAgo = new Date(Date.now() - 10 * 365.25 * 864e5).toISOString().slice(0, 10);
for (const [k, roles] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${tag}-${k}`, k === 'kid' ? tenYearsAgo : '1990-01-01']);
  for (const role of roles) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (k !== 'kid') {
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash, google_sub) VALUES ($1, $2, $3, $4)`,
      [U[k], mail(k), HASH, `g-${tag}-${k}`]);
  }
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tut, U.kid]);
const plan = (await q(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`, [`T-MR-${tag}`]))[0].id;
const subscribe = (k, suffix) => q(
  `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
   VALUES (gen_random_uuid(), $1, $1, $2, 'active', $3)`, [U[k], plan, `sub_test_${tag}_${suffix}`]);
await subscribe('subbed', 'subbed');

const app = await startApp();
const tok = (k, role, extra) => signToken({ sub: U[k], role, ...extra });
const http = (method, url, who, body, role = people[who]?.[0]) => app.http(method, url, { token: who && tok(who, role), body });
const login = (k) => app.http('POST', '/auth/login', { body: { email: mail(k), password: PASS } });
const switchTo = (k, from, role, extra) => app.http('POST', '/auth/role', { token: tok(k, from, extra), body: { role } });
const add = (id, role, who = 'admin') => http('POST', `/admin/profiles/${id}/roles`, who, { role });
const del = (id, role, who = 'admin') => http('DELETE', `/admin/profiles/${id}/roles/${role}`, who);
const outcome = (r) => [r.status, r.body?.code];
const rolesOf = async (k) => (await q(`SELECT role::text FROM user_roles WHERE user_id = $1 ORDER BY role`, [U[k]])).map((r) => r.role);
const lastRole = async (k) => (await q(`SELECT last_role::text AS r FROM profiles WHERE id = $1`, [U[k]]))[0].r;
const resetLast = (k) => q(`UPDATE profiles SET last_role = NULL WHERE id = $1`, [U[k]]);
const audit = (action, id) => q(`SELECT actor_id, changes FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at`, [action, id]);

try {
  await run('login: sin último rol entra con el de mayor prioridad (admin > profesor > tutor > alumno)', async () => {
    const dual = await login('dual');
    assert.deepEqual([dual.status, dual.body.user.role, jwt.decode(dual.body.token).role], [200, 'profesor', 'profesor']);
    assert.equal((await login('adm2')).body.user.role, 'admin');
    assert.equal((await login('trio')).body.user.role, 'tutor');
    assert.equal((await login('stu')).body.user.role, 'alumno');
  });

  await run('login: entra con el último rol usado si sigue asignado; si ya no, por prioridad', async () => {
    await q(`UPDATE profiles SET last_role = 'alumno' WHERE id = $1`, [U.dual]);
    assert.equal((await login('dual')).body.user.role, 'alumno');
    await q(`UPDATE profiles SET last_role = 'tutor' WHERE id = $1`, [U.dual]); // no lo tiene
    assert.equal((await login('dual')).body.user.role, 'profesor');
    await resetLast('dual');
  });

  await run('login con doble factor: el mfa_token lleva el rol elegido', async () => {
    await q(`INSERT INTO user_mfa (id, user_id, mfa_enabled) VALUES (gen_random_uuid(), $1, true)`, [U.adm2]);
    await q(`UPDATE profiles SET last_role = 'alumno' WHERE id = $1`, [U.adm2]);
    const r = await login('adm2');
    assert.equal(r.body.mfa_required, true);
    assert.equal(jwt.decode(r.body.mfa_token).role, 'alumno');
    await resetLast('adm2');
    assert.equal(jwt.decode((await login('adm2')).body.mfa_token).role, 'admin');
    await q(`DELETE FROM user_mfa WHERE user_id = $1`, [U.adm2]);
  });

  await run('Google: profesor+alumno no entra (ADR 0028); admin+alumno entra con el último rol o el de prioridad', async () => {
    const verify = (k) => async () => ({ email: mail(k), sub: `g-${tag}-${k}`, name: k });
    await assert.rejects(loginGoogle({ idToken: 'x', verify: verify('dual') }), (e) => e.status === 403 && e.code === 'google_login_not_allowed');
    const g = await loginGoogle({ idToken: 'x', verify: verify('adm2') });
    assert.deepEqual([g.profileId, g.role], [U.adm2, 'admin']);
    await q(`UPDATE profiles SET last_role = 'alumno' WHERE id = $1`, [U.adm2]);
    assert.equal((await loginGoogle({ idToken: 'x', verify: verify('adm2') })).role, 'alumno');
    await resetLast('adm2');
  });

  await run('/auth/me trae roles por prioridad y role es el activo; RLS usa el activo', async () => {
    const r = await http('GET', '/auth/me', 'dual', undefined, 'alumno');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.user.role, r.body.user.roles, r.body.rls_context.role], ['alumno', ['profesor', 'alumno'], 'alumno']);
    const p = await http('GET', '/auth/me', 'dual', undefined, 'profesor');
    assert.deepEqual([p.body.user.role, p.body.rls_context.role], ['profesor', 'profesor']);
    assert.deepEqual((await http('GET', '/me', 'dual', undefined, 'alumno')).body.roles, ['profesor', 'alumno']);
  });

  await run('POST /auth/role: token nuevo con el rol, guarda last_role y la ruta del rol pasa', async () => {
    const before = await http('GET', '/professor/sessions', 'dual', undefined, 'alumno');
    assert.deepEqual(outcome(before), [403, 'insufficient_role']);
    const r = await switchTo('dual', 'alumno', 'profesor');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.user, { id: U.dual, email: mail('dual'), role: 'profesor' });
    assert.equal(jwt.decode(r.body.token).role, 'profesor');
    assert.equal(await lastRole('dual'), 'profesor');
    const via = await app.http('GET', '/professor/sessions', { token: r.body.token });
    assert.equal(via.status, 200, JSON.stringify(via.body));
    const back = await switchTo('dual', 'profesor', 'alumno');
    assert.deepEqual([back.body.user.role, await lastRole('dual')], ['alumno', 'alumno']);
    await resetLast('dual');
  });

  await run('POST /auth/role conserva el iat (no renueva la sesión); con ese iat ya caducado → 401 reauth_required y last_role guardado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = now - 20 * 60;
    const r = await switchTo('adm2', 'alumno', 'admin', { iat: old });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(jwt.decode(r.body.token).iat, old);
    // un token de hace 20 min no satisface la reautenticación del MFA de una cuenta solo-Google (assertMfaReauth)
    await assert.rejects(assertMfaReauth(null, { tokenIat: jwt.decode(r.body.token).iat }), { code: 'reauth_required' });
    await resetLast('adm2');
    const stale = await switchTo('adm2', 'alumno', 'admin', { iat: now - 13 * 3600 }); // admin dura 12 h
    assert.deepEqual(outcome(stale), [401, 'reauth_required']);
    assert.equal(stale.body.token, undefined);
    assert.equal(await lastRole('adm2'), 'admin');
    assert.equal((await login('adm2')).body.user.role, 'admin'); // el próximo login entra con ese rol
    const ok = await switchTo('trio', 'alumno', 'tutor', { iat: now - 13 * 3600 }); // tutor dura 7 d
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    await resetLast('adm2');
    await resetLast('trio');
  });

  await run('POST /auth/role: un rol no asignado → 403 role_not_assigned (escalada alumno → admin); inválido 400; sin token 401', async () => {
    for (const role of ['admin', 'tutor']) {
      assert.deepEqual(outcome(await switchTo('stu', 'alumno', role)), [403, 'role_not_assigned'], role);
    }
    assert.equal(await lastRole('stu'), null);
    for (const role of ['root', undefined, 7]) {
      assert.deepEqual(outcome(await switchTo('stu', 'alumno', role)), [400, 'invalid_field'], String(role));
    }
    assert.equal((await app.http('POST', '/auth/role', { body: { role: 'alumno' } })).status, 401);
    // un token que dice ser admin sin serlo no sirve ni para cambiar
    assert.deepEqual(outcome(await switchTo('stu', 'admin', 'alumno')), [401, 'role_revoked']);
  });

  await run('requireAuth: un token con un rol que ya no tiene → 401 role_revoked; requireRole mira el activo', async () => {
    assert.deepEqual(outcome(await http('GET', '/auth/me', 'stu', undefined, 'tutor')), [401, 'role_revoked']);
    assert.deepEqual(outcome(await http('GET', '/admin/profiles?limit=1', 'adm2', undefined, 'alumno')), [403, 'insufficient_role']);
    assert.equal((await http('GET', '/admin/profiles?limit=1', 'adm2', undefined, 'admin')).status, 200);
  });

  await run('POST /auth/role conserva el doble factor del token y recalcula la caducidad por rol', async () => {
    const ttl = (t) => { const d = jwt.decode(t); return d.exp - d.iat; };
    const withMfa = await switchTo('adm2', 'alumno', 'admin', { mfa: true });
    assert.deepEqual(jwt.decode(withMfa.body.token).amr, ['mfa']);
    assert.equal(ttl(withMfa.body.token), 12 * 3600);
    assert.equal(jwt.decode((await switchTo('adm2', 'alumno', 'admin')).body.token).amr, undefined);
    const back = await switchTo('adm2', 'admin', 'alumno', { mfa: true });
    assert.deepEqual(jwt.decode(back.body.token).amr, ['mfa']);
    assert.notEqual(ttl(back.body.token), 12 * 3600);
    await resetLast('adm2');
  });

  await run('asignar: tutor y admin a un adulto; audit; sale en la ficha y vale para su cambio y su siguiente login', async () => {
    for (const role of ['tutor', 'admin']) {
      const r = await add(U.stu, role);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.profile.role, undefined, 'la ficha ya no lleva role');
    }
    assert.deepEqual(await rolesOf('stu'), ['admin', 'alumno', 'tutor']);
    const f = await http('GET', `/admin/profiles/${U.stu}`, 'admin');
    assert.deepEqual(f.body.profile.roles, ['admin', 'tutor', 'alumno']);
    assert.deepEqual((await audit('profile.role_add', U.stu)).map((a) => [a.actor_id, a.changes]),
      [[U.admin, { role: 'tutor' }], [U.admin, { role: 'admin' }]]);
    assert.equal((await switchTo('stu', 'alumno', 'admin')).status, 200);
    assert.equal((await login('stu')).body.user.role, 'admin');
    await resetLast('stu');
  });

  await run('asignar: ya lo tiene 409; profesor 409 trainer_role_locked; rol inválido 400; perfil inexistente 404', async () => {
    assert.deepEqual(outcome(await add(U.stu, 'alumno')), [409, 'role_already_assigned']);
    assert.deepEqual(outcome(await add(U.stu2, 'profesor')), [409, 'trainer_role_locked']);
    assert.deepEqual(outcome(await del(U.prof, 'profesor')), [409, 'trainer_role_locked']);
    assert.deepEqual(outcome(await add(U.stu2, 'jefe')), [400, 'invalid_field']);
    assert.equal((await add(crypto.randomUUID(), 'tutor')).status, 404);
    assert.equal((await add('no-es-uuid', 'tutor')).status, 400);
    assert.deepEqual(await rolesOf('stu2'), ['alumno']);
  });

  await run('a un profesor sí se le dan y quitan alumno, tutor o admin (ADR 0033)', async () => {
    assert.equal((await add(U.prof, 'alumno')).status, 200);
    assert.deepEqual(await rolesOf('prof'), ['alumno', 'profesor']);
    assert.equal((await del(U.prof, 'alumno')).status, 200);
    assert.deepEqual(await rolesOf('prof'), ['profesor']);
  });

  await run('un hijo (sin acceso propio) solo es alumno: 409 child_role_locked al dar y al quitar', async () => {
    assert.deepEqual(outcome(await add(U.kid, 'tutor')), [409, 'child_role_locked']);
    assert.deepEqual(outcome(await del(U.kid, 'alumno')), [409, 'child_role_locked']);
    assert.deepEqual(await rolesOf('kid'), ['alumno']);
  });

  await run('el admin no toca sus propios roles: 409 self_role_locked', async () => {
    for (const r of [await add(U.admin, 'alumno'), await del(U.admin, 'admin'), await del(U.admin, 'alumno')]) {
      assert.deepEqual(outcome(r), [409, 'self_role_locked']);
    }
    assert.deepEqual(await rolesOf('admin'), ['admin']);
  });

  await run('quitar: admin nunca (409 admin_role_locked); uno que no tiene 404 role_not_assigned; el último 409 last_role', async () => {
    assert.deepEqual(outcome(await del(U.stu, 'admin')), [409, 'admin_role_locked']);
    assert.deepEqual(outcome(await del(U.stu2, 'tutor')), [404, 'role_not_assigned']);
    assert.deepEqual(outcome(await del(U.stu2, 'alumno')), [409, 'last_role']);
    assert.deepEqual(outcome(await del(U.stu2, 'jefe')), [400, 'invalid_field']);
    assert.deepEqual(await rolesOf('stu2'), ['alumno']);
  });

  await run('quitar alumno con suscripción viva 409 student_has_subscription; quitar tutor sí, con audit y matando su token', async () => {
    assert.deepEqual(outcome(await del(U.subbed, 'alumno')), [409, 'student_has_subscription']);
    assert.deepEqual(await rolesOf('subbed'), ['alumno', 'tutor']);
    const r = await del(U.subbed, 'tutor');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.profile.roles, ['alumno']);
    assert.deepEqual((await audit('profile.role_remove', U.subbed)).map((a) => a.changes), [{ role: 'tutor' }]);
    assert.deepEqual(outcome(await http('GET', '/auth/me', 'subbed', undefined, 'tutor')), [401, 'role_revoked']);
    assert.equal((await http('GET', '/auth/me', 'subbed', undefined, 'alumno')).status, 200);
    // sin suscripción viva sí se quita alumno
    await add(U.stu3, 'tutor');
    assert.equal((await del(U.stu3, 'alumno')).status, 200);
    assert.deepEqual(await rolesOf('stu3'), ['tutor']);
  });

  await run('solo el admin asigna y quita: alumno, tutor y profesor → 403; sin token 401', async () => {
    for (const who of ['stu2', 'tut', 'prof']) {
      assert.deepEqual(outcome(await add(U.stu2, 'tutor', who)), [403, 'insufficient_role'], who);
      assert.equal((await del(U.stu3, 'tutor', who)).status, 403, who);
    }
    assert.equal((await add(U.stu2, 'tutor', null)).status, 401);
  });

  await run('el PUT /role de antes ya no existe', async () => {
    assert.ok([404, 405].includes((await http('PUT', `/admin/profiles/${U.stu2}/role`, 'admin', { role: 'tutor' })).status));
  });

  await run('lista: un perfil con varios roles sale una vez, con roles por prioridad y sin role; total y filtro sin duplicar', async () => {
    const list = await http('GET', `/admin/profiles?q=${tag}&limit=100`, 'admin');
    assert.equal(list.status, 200);
    const ids = list.body.profiles.map((p) => p.id);
    assert.equal(ids.length, Object.keys(people).length);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(list.body.total, ids.length);
    const byId = Object.fromEntries(list.body.profiles.map((p) => [p.id, p]));
    assert.deepEqual(byId[U.dual].roles, ['profesor', 'alumno']);
    assert.deepEqual(byId[U.stu].roles, ['admin', 'tutor', 'alumno']);
    assert.ok(list.body.profiles.every((p) => p.role === undefined && p.roles.length > 0));
    // `estado` solo para quien es alumno, aunque tenga más roles
    assert.equal(byId[U.tut].estado, null);
    assert.notEqual(byId[U.dual].estado, null);
    assert.notEqual(byId[U.subbed].estado, null);
    for (const [role, expected] of [['profesor', ['dual', 'prof', 'prof2']], ['admin', ['admin', 'adm2', 'stu']]]) {
      const f = await http('GET', `/admin/profiles?q=${tag}&role=${role}&limit=100`, 'admin');
      assert.deepEqual(f.body.profiles.map((p) => p.id).sort(), expected.map((k) => U[k]).sort(), role);
      assert.equal(f.body.total, expected.length);
    }
    const page = await http('GET', `/admin/profiles?q=${tag}&limit=1&offset=3`, 'admin');
    assert.deepEqual([page.body.profiles.length, page.body.total], [1, ids.length]);
    assert.equal((await http('GET', '/admin/profiles/stats', 'admin')).status, 200);
  });

  await run('reloj: un profesor que también es alumno es profesor (not_professor solo si no lo es)', async () => {
    const emp = (id) => http('PUT', `/admin/profiles/${id}/employment`, 'admin', { employment: 'employee' });
    const ok = await emp(U.dual);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(outcome(await emp(U.stu2)), [409, 'not_professor']);
  });

  await run('un profesor no reserva una sesión que imparte él (409 own_session), pero sí otra', async () => {
    const disc = (await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`T-MR-${tag}`]))[0].id;
    await subscribe('dual', 'dual');
    const session = async (trainer, offset) => (await q(
      `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
       VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '60 min', 60, 5, 'scheduled') RETURNING id`,
      [disc, U[trainer], offset]))[0].id;
    const own = await session('dual', '2 days');
    const other = await session('prof2', '3 days');
    const book = (sessionId, studentId, role = 'alumno', uid = studentId) =>
      withRls({ uid, role }, (c) => bookSession(c, { sessionId, studentId }));
    await assert.rejects(book(own, U.dual), (e) => e.status === 409 && e.code === 'own_session');
    await assert.rejects(book(own, U.dual, 'admin', U.admin), (e) => e.status === 409 && e.code === 'own_session'); // ni el admin por él
    assert.equal((await q(`SELECT 1 FROM bookings WHERE session_id = $1`, [own])).length, 0);
    assert.equal((await book(other, U.dual)).status, 'confirmed');
  });
} finally {
  await app.close();
  await closePools();
}
if (failed) { console.error(`\n${failed} test(s) fallaron`); process.exit(1); }
console.log('\nOK');
