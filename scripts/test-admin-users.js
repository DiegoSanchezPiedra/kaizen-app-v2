// ADR 0032: beta cerrada. Alta de alumnos, tutores y admins por el admin (POST /admin/users, /:id/invite), registro cerrado
// por REGISTRATION_OPEN y dar el rol admin sin MFA. La app entera sobre la BD efímera (with-temp-db); el email va al log.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kz-adminusers-')), 'emails.log');
Object.assign(process.env, { CORPORATE_EMAIL_DOMAIN: 'academia.test', EMAIL_TRANSPORT: 'log', EMAIL_LOG_PATH: logPath });
await import('dotenv/config');
const { servicePool, closePools } = await import('../src/config/database.js');
const { startApp } = await import('./lib/app-server.js');
const { signToken } = await import('../src/services/jwt.js');
const { loginGoogle } = await import('../src/services/auth.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params).then((r) => r.rows);
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const tag = `adu${crypto.randomBytes(3).toString('hex')}`;
const mail = (k) => `${k}-${tag}@kz.test`;
const PASS = 'clave-segura-1';
const people = { admin: 'admin', ana: 'alumno', tutor: 'tutor', prof: 'profesor' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, yearsAgo(30)]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [U[k], mail(`base-${k}`)]);
}

const app = await startApp();
const tok = (k) => signToken({ sub: U[k], role: people[k] });
const http = (method, url, who, body) => app.http(method, url, { token: who && tok(who), body });
const create = (body, who = 'admin') => http('POST', '/admin/users', who, body);
const adult = (k, role = 'alumno', extra = {}) => ({ email: mail(k), display_name: `Nuevo ${k}`, role, birth_date: yearsAgo(25), ...extra });
const tokenOf = (url) => new URL(url).searchParams.get('token');
const accept = (url, password = PASS) => http('POST', '/auth/password/reset', null, { token: tokenOf(url), password });
const login = (email) => http('POST', '/auth/login', null, { email, password: PASS });
const audit = async (action, id) => (await q(`SELECT actor_id, resource_type, changes FROM audit_log WHERE action = $1 AND resource_id = $2`, [action, id]))[0];
const code = (r) => r.body?.code;
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
};

try {
  const made = {};
  await run('alta de alumno, tutor y admin: 201, rol, permiso de hijos solo al tutor, invitación 72 h y audit sin email', async () => {
    for (const role of ['alumno', 'tutor', 'admin']) {
      const r = await create(adult(role, role, { email: `  ${role.toUpperCase()}-${tag}@Kz.Test ` }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      made[role] = r.body;
      const p = r.body.profile;
      assert.deepEqual([p.role, p.email, p.display_name, p.has_password, p.can_create_children], [role, mail(role), `Nuevo ${role}`, false, role === 'tutor']);
      assert.match(r.body.invite_url, /\/reset-password\?token=[\w-]{43}&invite=1$/);
      const [inv] = await q(`SELECT token_hash, kind, extract(epoch FROM expires_at - now()) / 3600 AS hours FROM password_resets WHERE profile_id = $1`, [p.id]);
      assert.deepEqual([inv.token_hash, inv.kind], [crypto.createHash('sha256').update(tokenOf(r.body.invite_url)).digest('hex'), 'invite']);
      assert.ok(inv.hours > 71.9 && inv.hours <= 72);
      const a = await audit('profile.create', p.id);
      assert.deepEqual([a.actor_id, a.resource_type, a.changes], [U.admin, 'profile', { role }]);
      assert.ok(!JSON.stringify(a).includes(tag), 'el audit no lleva el email');
    }
  });

  await run('la ficha dice invite_pending hasta que acepta; el invitado elige contraseña, verifica el email y entra', async () => {
    const get = async (id) => (await http('GET', `/admin/profiles/${id}`, 'admin')).body.profile;
    for (const role of ['alumno', 'tutor', 'admin']) {
      const { profile, invite_url: url } = made[role];
      assert.equal((await get(profile.id)).invite_pending, true);
      assert.equal((await login(mail(role))).status, 401, 'sin contraseña no entra');
      assert.equal((await accept(url)).status, 204);
      const l = await login(mail(role));
      assert.deepEqual([l.status, l.body.user.role, l.body.user.id], [200, role, profile.id]);
      assert.equal((await q(`SELECT email_verified FROM auth_credentials WHERE profile_id = $1`, [profile.id]))[0].email_verified, true);
      assert.equal((await get(profile.id)).invite_pending, false);
    }
    assert.equal((await get(U.ana)).invite_pending, false, 'los de siempre ya tienen contraseña');
  });

  await run('el email de la invitación sale con el mismo enlace (sin «como profesor»)', async () => {
    const r = await create(adult('mailed'));
    let entry;
    for (let i = 0; i < 40 && !entry; i++) {
      entry = fs.readFileSync(logPath, 'utf8').split('--- ').find((e) => e.includes(`Para: ${mail('mailed')}\n`));
      if (!entry) await new Promise((res) => setTimeout(res, 25));
    }
    assert.ok(entry?.includes(r.body.invite_url), 'el enlace del email es el de la respuesta');
    assert.ok(!entry.includes('como profesor'));
  });

  await run('la respuesta no se cachea', async () => {
    const res = await fetch(`${app.base}/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok('admin')}` },
      body: JSON.stringify(adult('nocache')) });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  await run('alumno, tutor y profesor → 403 al crear y al reinvitar', async () => {
    for (const who of ['ana', 'tutor', 'prof']) {
      assert.deepEqual([(await create(adult('x403'), who)).status, code(await create(adult('x403'), who))], [403, 'insufficient_role'], who);
      assert.equal((await http('POST', `/admin/users/${U.ana}/invite`, who)).status, 403, who);
    }
    assert.equal((await create(adult('x403'), null)).status, 401);
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email = $1`, [mail('x403')])).length, 0);
  });

  await run('SQL: un alumno no llama a las funciones de alta', async () => {
    const { withRls } = await import('../src/db/rls.js');
    for (const sql of [`SELECT admin_create_user(gen_random_uuid(), 'a@b.test', 'A', NULL, 'admin', 'h')`, `SELECT admin_user_invite($1, 'h')`]) {
      await assert.rejects(withRls({ uid: U.ana, role: 'alumno' }, (c) => c.query(sql, sql.includes('$1') ? [U.ana] : [])), (e) => e.code === '42501');
    }
  });

  await run('validación: email repetido 409, menor de 18, rol profesor o inválido, dominio corporativo, sin fecha, nombre y correo', async () => {
    const before = (await q(`SELECT count(*)::int AS n FROM profiles`))[0].n;
    for (const email of [mail('alumno'), mail('alumno').toUpperCase()]) {
      const r = await create(adult('dup', 'alumno', { email }));
      assert.deepEqual([r.status, code(r)], [409, 'email_taken'], email);
    }
    const bad = [
      [adult('v1', 'alumno', { birth_date: yearsAgo(17) }), 400, 'invalid_birth_date'],
      [adult('v2', 'tutor', { birth_date: yearsAgo(12) }), 400, 'invalid_birth_date'],
      [adult('v3', 'alumno', { birth_date: undefined }), 400, 'invalid_birth_date'],
      [adult('v4', 'tutor', { birth_date: '1990-02-31' }), 400, 'invalid_birth_date'],
      [adult('v5', 'alumno', { birth_date: '2999-01-01' }), 400, 'invalid_birth_date'],
      [adult('v6', 'profesor'), 400, 'invalid_field'],
      [adult('v7', 'jefe'), 400, 'invalid_field'],
      [adult('v8', undefined, { role: undefined }), 400, 'invalid_field'],
      [adult('v9', 'alumno', { display_name: '  ' }), 400, 'invalid_field'],
      [adult('v10', 'alumno', { email: 'sin-arroba' }), 400, 'invalid_field'],
      [adult('v11', 'alumno', { email: `v11-${tag}@academia.test` }), 409, 'email_domain_reserved'],
      [adult('v12', 'admin', { email: `v12-${tag}@Academia.Test` }), 409, 'email_domain_reserved'],
    ];
    for (const [body, status, c] of bad) {
      const r = await create(body);
      assert.deepEqual([r.status, code(r)], [status, c], JSON.stringify(body));
    }
    assert.equal((await q(`SELECT count(*)::int AS n FROM profiles`))[0].n, before, 'no queda ningún perfil a medias');
    assert.equal((await create(adult('adminsinfecha', 'admin', { birth_date: undefined }))).status, 201, 'para el admin la fecha es opcional');
  });

  await run('reinvitar: 200 con enlace nuevo, el anterior deja de valer; activo, profesor, hijo y desactivado → 409; 404', async () => {
    const c = await create(adult('inv'));
    const id = c.body.profile.id;
    const r = await http('POST', `/admin/users/${id}/invite`, 'admin');
    assert.equal(r.status, 200);
    assert.notEqual(r.body.invite_url, c.body.invite_url);
    assert.deepEqual(await audit('profile.invite', id), { actor_id: U.admin, resource_type: 'profile', changes: {} });
    assert.equal(code(await accept(c.body.invite_url)), 'invalid_reset_token');
    assert.equal((await accept(r.body.invite_url)).status, 204);
    const post = (uid) => http('POST', `/admin/users/${uid}/invite`, 'admin');
    assert.deepEqual([(await post(id)).status, code(await post(id))], [409, 'already_active'], 'ya entró');
    assert.equal(code(await post(U.ana)), 'already_active');
    assert.equal(code(await post(U.prof)), 'already_active', 'el profesor del test tiene contraseña');
    const trainer = crypto.randomUUID();
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, 't')`, [trainer]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'profesor')`, [trainer]);
    await q(`INSERT INTO auth_credentials (profile_id, email, email_verified) VALUES ($1, $2, false)`, [trainer, mail('trainer')]);
    assert.deepEqual([(await post(trainer)).status, code(await post(trainer))], [409, 'not_invitable'], 'los profesores van por /admin/trainers');
    const kid = crypto.randomUUID();
    await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, 'k', $2)`, [kid, yearsAgo(9)]);
    assert.equal(code(await post(kid)), 'not_invitable');
    const off = (await create(adult('off'))).body.profile.id;
    await q(`UPDATE auth_credentials SET disabled_at = now() WHERE profile_id = $1`, [off]);
    assert.equal(code(await post(off)), 'not_invitable');
    assert.equal(code(await post(crypto.randomUUID())), 'profile_not_found');
    assert.equal((await post(crypto.randomUUID())).status, 404);
    assert.equal(code(await post('nope')), 'invalid_id');
  });

  await run('reinvitar: límite por usuario (email-bombing) → 429 a la sexta', async () => {
    const id = (await create(adult('bomb'))).body.profile.id;
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await http('POST', `/admin/users/${id}/invite`, 'admin')).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  });

  await run('registro: abierto fuera de producción; cerrado en producción (403 signup_closed); REGISTRATION_OPEN manda', async () => {
    const reg = (k) => http('POST', '/auth/register', null, { email: mail(k), password: PASS, displayName: k, birthDate: yearsAgo(30) });
    await withEnv({ NODE_ENV: undefined, REGISTRATION_OPEN: undefined }, async () => assert.equal((await reg('reg-dev')).status, 201));
    await withEnv({ NODE_ENV: 'production', REGISTRATION_OPEN: undefined }, async () => {
      const r = await reg('reg-prod');
      assert.deepEqual([r.status, code(r)], [403, 'signup_closed']);
      assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email = $1`, [mail('reg-prod')])).length, 0);
    });
    await withEnv({ NODE_ENV: 'production', REGISTRATION_OPEN: 'true' }, async () => assert.equal((await reg('reg-open')).status, 201));
    await withEnv({ NODE_ENV: undefined, REGISTRATION_OPEN: 'false' }, async () => assert.equal(code(await reg('reg-off')), 'signup_closed'));
    // El login de siempre sigue con el registro cerrado.
    await withEnv({ NODE_ENV: 'production' }, async () => assert.equal((await login(mail('reg-dev'))).status, 200));
  });

  await run('Google: cuenta nueva cerrada → 403 signup_closed; la ya vinculada sigue entrando; abierto la crea', async () => {
    const verify = (email, sub) => async () => ({ email, sub, name: 'G' });
    await withEnv({ NODE_ENV: 'production', REGISTRATION_OPEN: undefined }, async () => {
      await assert.rejects(loginGoogle({ idToken: 't', verify: verify(mail('g-new'), `sub-new-${tag}`) }), (e) => [e.status, e.code].join() === '403,signup_closed');
      assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email = $1`, [mail('g-new')])).length, 0);
      await q(`UPDATE auth_credentials SET google_sub = $2 WHERE profile_id = $1`, [U.ana, `sub-ana-${tag}`]);
      const r = await loginGoogle({ idToken: 't', verify: verify(mail('base-ana'), `sub-ana-${tag}`) });
      assert.equal(r.profileId, U.ana);
    });
    await withEnv({ NODE_ENV: 'production', REGISTRATION_OPEN: 'true' }, async () => {
      assert.equal((await loginGoogle({ idToken: 't', verify: verify(mail('g-new'), `sub-new-${tag}`) })).role, 'alumno');
    });
  });

  await run('dar el rol admin no pide doble factor ni código', async () => {
    const r = await http('PUT', `/admin/profiles/${U.tutor}/role`, 'admin', { role: 'admin' });
    assert.deepEqual([r.status, r.body.profile.role], [200, 'admin']);
    assert.deepEqual((await audit('profile.role_change', U.tutor)).changes, { from: 'tutor', to: 'admin' });
  });

  await run('profesores: crear, reinvitar y cambiar el correo devuelven invite_url', async () => {
    const c = await http('POST', '/admin/trainers', 'admin', { email: `t-${tag}@academia.test`, display_name: 'T' });
    assert.equal(c.status, 201);
    assert.match(c.body.invite_url, /&invite=1$/);
    const i = await http('POST', `/admin/trainers/${c.body.trainer.id}/invite`, 'admin');
    assert.deepEqual([i.status, typeof i.body.invite_url], [200, 'string']);
  });
} finally {
  await app.close();
  await closePools();
}
if (failed) { console.error(`\n${failed} test(s) fallaron`); process.exit(1); }
console.log('\nTodos los tests OK');
