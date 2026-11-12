// B18.0: mis datos (GET/PATCH /me), ficha de salud (GET /me/health), recuperar contraseña (025) y el calendario
// de un hijo con profile_id. Como app_user por HTTP con un express en memoria y JWT firmados (como test:calendar).
// Los emails van al log de un fichero propio: de ahí sale el token, que en la BD solo está como hash.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const LOG = path.join(os.tmpdir(), `kaizen-test-account-${process.pid}.log`);
process.env.EMAIL_TRANSPORT = 'log';
process.env.EMAIL_LOG_PATH = LOG;
await import('dotenv/config');
const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { signToken } = await import('../src/services/jwt.js');
const { hashPassword } = await import('../src/services/password.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: authRouter } = await import('../src/routes/auth.js');
const { default: meRouter } = await import('../src/routes/me.js');
const { default: sessionsRouter } = await import('../src/routes/sessions.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

const tag = `tacc${crypto.randomBytes(3).toString('hex')}`;
// [rol, fecha de nacimiento]
const people = {
  parent: ['alumno', yearsAgo(40)], child: ['alumno', yearsAgo(10)], other: ['alumno', yearsAgo(30)],
  tutor: ['tutor', yearsAgo(45)], google: ['alumno', null], prof: ['profesor', null],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, [role, birth]] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $3), ($2, $3)`, [U.parent, U.tutor, U.child]);
const email = (k) => `${tag}-${k}@test.local`;
await servicePool.query(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, $3)`,
  [U.parent, email('parent'), await hashPassword('vieja-1234')]);
await servicePool.query(`INSERT INTO auth_credentials (profile_id, email, google_sub, email_verified) VALUES ($1, $2, $3, true)`,
  [U.google, email('google'), `gsub-${tag}`]);

// El hijo, cubierto (lo paga el padre) y con una reserva en una sesión.
const disc = (await servicePool.query(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [tag])).rows[0].id;
const plan = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, 1) RETURNING id`, [tag])).rows[0].id;
const sub = crypto.randomUUID();
await servicePool.query(
  `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
   VALUES ($1, $2, $3, $4, 'active', $5)`, [sub, U.child, U.parent, plan, `sub_test_${sub}`]);
await servicePool.query(`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [sub, disc]);
const session = (await servicePool.query(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, location, status)
   VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 60 min', 60, 10, 'tatami 1', 'scheduled')
   RETURNING id`, [disc, U.prof])).rows[0].id;
const booking = (await servicePool.query(
  `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
  [session, U.child, U.parent])).rows[0].id;

// Cada petición con su IP (X-Forwarded-For): el rate limiting (B20) no es lo que se prueba aquí; ver test-ratelimit.js.
const app = express().set('trust proxy', true).use(express.json()).use('/auth', authRouter).use('/me', meRouter).use('/sessions', sessionsRouter)
  .use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let reqs = 0;
const http = async (method, url, who, body) => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++reqs % 250}` };
  if (who) headers.authorization = `Bearer ${signToken({ sub: U[who], role: people[who][0] })}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const code = (r) => r.body?.code ?? r.body?.error?.code ?? r.body?.error;
const expectError = (r, status, c) => assert.deepEqual([r.status, code(r)], [status, c]);

// Tokens enviados a un email (el envío no se espera en la ruta: se reintenta la lectura un poco).
const tokensFor = async (to, atLeast) => {
  for (let i = 0; i < 40; i++) {
    const log = await fs.readFile(LOG, 'utf8').catch(() => '');
    const tokens = log.split('\n--- ').filter((e) => e.includes(`Para: ${to}\n`))
      .map((e) => e.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/)[1]);
    if (tokens.length >= atLeast) return tokens;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`sin ${atLeast} emails para ${to}`);
};
const forgot = (e) => http('POST', '/auth/password/forgot', null, { email: e });
const reset = (token, password) => http('POST', '/auth/password/reset', null, { token, password });
const login = (e, password) => http('POST', '/auth/login', null, { email: e, password });

const realError = console.error; // el errorHandler registra cada 4xx esperado

try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));
  // ---------- GET/PATCH /me ----------
  await run('GET /me: mis datos con email y has_password', async () => {
    const r = await http('GET', '/me', 'parent');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: U.parent, role: 'alumno', display_name: `${tag}-parent`, email: email('parent'),
      username: null, birth_date: people.parent[1], has_password: true, avatar: null, minor: null });
    const g = await http('GET', '/me', 'google');
    assert.deepEqual([g.body.birth_date, g.body.has_password], [null, false]);
    expectError(await http('GET', '/me'), 401, 'missing_token');
  });
  await run('PATCH /me: nombre vacío 400, sin campos 400, nombre recortado', async () => {
    expectError(await http('PATCH', '/me', 'parent', { display_name: '  ' }), 400, 'invalid_field_type');
    expectError(await http('PATCH', '/me', 'parent', {}), 400, 'no_fields');
    const r = await http('PATCH', '/me', 'parent', { display_name: `  ${tag}-nuevo ` });
    assert.equal(r.status, 200);
    assert.equal(r.body.display_name, `${tag}-nuevo`);
  });
  await run('PATCH /me birth_date: inválida, menor, solo si estaba vacía (409)', async () => {
    expectError(await http('PATCH', '/me', 'google', { birth_date: '2000-02-30' }), 400, 'invalid_birth_date');
    expectError(await http('PATCH', '/me', 'google', { birth_date: yearsAgo(17) }), 400, 'minor_cannot_register');
    const r = await http('PATCH', '/me', 'google', { birth_date: '1990-05-01', display_name: `${tag}-g` });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.birth_date, r.body.display_name], ['1990-05-01', `${tag}-g`]);
    expectError(await http('PATCH', '/me', 'google', { birth_date: '1991-05-01' }), 409, 'birth_date_already_set');
    expectError(await http('PATCH', '/me', 'parent', { birth_date: '1980-01-01' }), 409, 'birth_date_already_set');
    // El 409 no deja a medias el nombre.
    expectError(await http('PATCH', '/me', 'google', { birth_date: '1991-05-01', display_name: 'x' }), 409,
      'birth_date_already_set');
    assert.equal((await http('GET', '/me', 'google')).body.display_name, `${tag}-g`);
  });

  // ---------- GET /me/health ----------
  await run('GET /me/health: propia, de un hijo, null sin ficha y 403 de un perfil ajeno', async () => {
    assert.deepEqual((await http('GET', '/me/health', 'parent')).body, { health: null });
    assert.equal((await http('POST', '/me/health', 'parent', { allergies: 'polen' })).status, 200);
    assert.equal((await http('POST', '/me/health', 'parent', { profile_id: U.child, injuries: 'rodilla' })).status, 200);
    const own = await http('GET', '/me/health', 'parent');
    assert.deepEqual([own.status, own.body.health.profile_id, own.body.health.allergies], [200, U.parent, 'polen']);
    const kid = await http('GET', `/me/health?profile_id=${U.child}`, 'parent');
    assert.deepEqual([kid.status, kid.body.health.profile_id, kid.body.health.injuries], [200, U.child, 'rodilla']);
    expectError(await http('GET', `/me/health?profile_id=${U.parent}`, 'other'), 403, 'not_guardian');
    expectError(await http('GET', `/me/health?profile_id=${U.child}`, 'other'), 403, 'not_guardian');
    expectError(await http('GET', '/me/health?profile_id=nope', 'parent'), 400, 'invalid_profile_id');
  });

  // ---------- Recuperar contraseña ----------
  await run('forgot: 204 con un email inexistente, sin email ni fila', async () => {
    assert.equal((await forgot(`${tag}-nadie@test.local`)).status, 204);
    assert.equal((await http('POST', '/auth/password/forgot', null, {})).status, 204);
    await assert.rejects(tokensFor(`${tag}-nadie@test.local`, 1));
  });
  let first;
  let second;
  await run('forgot: email con el enlace; en la BD solo el SHA-256 y 1 h; app_user no ve la tabla', async () => {
    assert.equal((await forgot(email('parent'))).status, 204);
    [first] = await tokensFor(email('parent'), 1);
    assert.equal(Buffer.from(first, 'base64url').length, 32);
    const { rows } = await servicePool.query(
      `SELECT to_jsonb(r) AS row, extract(epoch FROM expires_at - created_at) AS ttl FROM password_resets r WHERE profile_id = $1`,
      [U.parent]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].row.token_hash, sha256(first));
    assert.ok(!JSON.stringify(rows[0].row).includes(first));
    assert.equal(Number(rows[0].ttl), 3600);
    await assert.rejects(withRls({ uid: U.parent, role: 'alumno' }, (c) => c.query(`SELECT * FROM password_resets`)),
      (e) => e.code === '42501');
  });
  await run('pedir otro anula el anterior', async () => {
    assert.equal((await forgot(email('parent'))).status, 204);
    second = (await tokensFor(email('parent'), 2))[1];
    assert.notEqual(second, first);
    expectError(await reset(first, 'nueva-1234'), 400, 'invalid_reset_token');
  });
  await run('reset: weak_password, token inexistente y caducado', async () => {
    expectError(await reset(second, 'corta'), 400, 'weak_password');
    expectError(await reset('no-existe', 'nueva-1234'), 400, 'invalid_reset_token');
    expectError(await http('POST', '/auth/password/reset', null, { password: 'nueva-1234' }), 400, 'invalid_reset_token');
    await servicePool.query(`UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [sha256(second)]);
    expectError(await reset(second, 'nueva-1234'), 400, 'invalid_reset_token');
  });
  await run('reset: el token vale una vez y la contraseña nueva entra por /auth/login', async () => {
    assert.equal((await forgot(email('parent'))).status, 204);
    const third = (await tokensFor(email('parent'), 3))[2];
    assert.equal((await reset(third, 'nueva-1234')).status, 204);
    expectError(await reset(third, 'otra-12345'), 400, 'invalid_reset_token');
    assert.equal((await login(email('parent'), 'nueva-1234')).status, 200);
    expectError(await login(email('parent'), 'vieja-1234'), 401, 'invalid_credentials');
  });
  await run('un perfil solo con Google se pone contraseña', async () => {
    assert.equal((await forgot(email('google'))).status, 204);
    const [t] = await tokensFor(email('google'), 1);
    assert.equal((await reset(t, 'google-1234')).status, 204);
    assert.equal((await login(email('google'), 'google-1234')).status, 200);
    assert.equal((await http('GET', '/me', 'google')).body.has_password, true);
  });

  // ---------- Calendario con profile_id ----------
  const q = `from=${new Date().toISOString().slice(0, 10)}`;
  await run('calendario: un alumno con un hijo lo pide con su profile_id y ve covered y booking planos', async () => {
    const r = await http('GET', `/sessions/calendar?${q}&profile_id=${U.child}`, 'parent');
    assert.equal(r.status, 200);
    const s = r.body.sessions.find((x) => x.id === session);
    assert.deepEqual([s.covered, s.booking], [true, { id: booking, status: 'confirmed' }]);
    // Sin profile_id, el suyo (no cubierto, sin reserva).
    const own = (await http('GET', `/sessions/calendar?${q}`, 'parent')).body.sessions.find((x) => x.id === session);
    assert.deepEqual([own.covered, own.booking], [false, null]);
  });
  await run('calendario: un tutor con profile_id, plano; sin él, por hijo', async () => {
    const r = await http('GET', `/sessions/calendar?${q}&profile_id=${U.child}`, 'tutor');
    assert.equal(r.body.sessions.find((x) => x.id === session).covered, true);
    const all = await http('GET', `/sessions/calendar?${q}`, 'tutor');
    assert.equal(all.body.sessions.find((x) => x.id === session).covered[U.child], true);
  });
  await run('calendario: con un profile_id ajeno, 403 not_guardian', async () => {
    expectError(await http('GET', `/sessions/calendar?${q}&profile_id=${U.child}`, 'other'), 403, 'not_guardian');
    expectError(await http('GET', `/sessions/calendar?${q}&profile_id=${U.other}`, 'parent'), 403, 'not_guardian');
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM bookings WHERE id = $1`, [booking]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1`, [session]);
  await servicePool.query(`DELETE FROM subscription_disciplines WHERE subscription_id = $1`, [sub]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = $1`, [sub]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await fs.rm(LOG, { force: true });
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
