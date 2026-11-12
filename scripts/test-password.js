// B24: cambiar la contraseña con la sesión iniciada (POST /me/password) y que cambiarla o restablecerla invalide los
// tokens emitidos antes (ADR 0020). Por HTTP con un express en memoria; fixtures que se borran al acabar.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { signToken } from '../src/services/jwt.js';
import { hashPassword } from '../src/services/password.js';
import { resetPassword } from '../src/services/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRouter from '../src/routes/auth.js';
import meRouter from '../src/routes/me.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tag = `tpw${crypto.randomBytes(3).toString('hex')}`;
const U = { ana: crypto.randomUUID(), goo: crypto.randomUUID() };
const email = (k) => `${tag}-${k}@kz.test`;
const realError = console.error;

const app = express().use(express.json()).use('/auth', authRouter).use('/me', meRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, token, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const login = async (password) => (await http('POST', '/auth/login', null, { email: email('ana'), password })).body.token;

try {
  await q(`INSERT INTO profiles (id, display_name) VALUES ($1, 'Ana'), ($2, 'Goo')`, [U.ana, U.goo]);
  await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, $3)`,
    [U.ana, email('ana'), await hashPassword('vieja-1234')]);
  await q(`INSERT INTO auth_credentials (profile_id, email, google_sub) VALUES ($1, $2, $3)`, [U.goo, email('goo'), `g-${tag}`]);
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('validación: falta la actual, la actual mal, la nueva corta → sin cambiar nada', async () => {
    const t = await login('vieja-1234');
    const bad = async (body, code, status = 400) => {
      const r = await http('POST', '/me/password', t, body);
      assert.deepEqual([r.status, r.body.code], [status, code], JSON.stringify(body));
    };
    await bad({ new_password: 'nueva-12345' }, 'invalid_field');
    await bad({ current_password: 'otra-1234', new_password: 'nueva-12345' }, 'wrong_password');
    await bad({ current_password: 'vieja-1234', new_password: 'corta' }, 'weak_password');
    assert.ok(await login('vieja-1234'), 'la contraseña sigue siendo la vieja');
    assert.equal((await http('GET', '/me', t)).status, 200, 'y la sesión sigue abierta');
  });

  await run('cuenta solo con Google: 409 no_password (se crea con el email de restablecer)', async () => {
    const t = signToken({ sub: U.goo, role: 'alumno' });
    const r = await http('POST', '/me/password', t, { current_password: 'x', new_password: 'nueva-12345' });
    assert.deepEqual([r.status, r.body.code], [409, 'no_password']);
  });

  await run('cambio: token nuevo que vale; el de antes y los de otros dispositivos → 401 session_revoked', async () => {
    const other = await login('vieja-1234');
    const mine = await login('vieja-1234');
    await sleep(1100); // el iat va en segundos: un token del mismo segundo que el cambio seguiría valiendo (ADR 0020)
    const r = await http('POST', '/me/password', mine, { current_password: 'vieja-1234', new_password: 'nueva-12345' });
    assert.equal(r.status, 200);
    assert.equal((await http('GET', '/me', r.body.token)).status, 200, 'la sesión que cambia sigue con su token nuevo');
    for (const t of [mine, other]) {
      const old = await http('GET', '/me', t);
      assert.deepEqual([old.status, old.body.code], [401, 'session_revoked']);
    }
    assert.equal((await http('POST', '/auth/login', null, { email: email('ana'), password: 'vieja-1234' })).status, 401);
    const fresh = await login('nueva-12345');
    assert.equal((await http('GET', '/me', fresh)).status, 200, 'entrar después del cambio vale');
    const [a] = (await q(`SELECT actor_id FROM audit_log WHERE action = 'auth.password_change' AND resource_id = $1`, [U.ana])).rows;
    assert.equal(a.actor_id, U.ana);
  });

  await run('restablecer con el email también cierra las sesiones abiertas', async () => {
    const t = await login('nueva-12345');
    await sleep(1100);
    const token = crypto.randomBytes(32).toString('base64url');
    await q(`SELECT create_password_reset($1, $2)`, [email('ana'), crypto.createHash('sha256').update(token).digest('hex')]);
    await resetPassword({ token, password: 'otra-12345' });
    const r = await http('GET', '/me', t);
    assert.deepEqual([r.status, r.body.code], [401, 'session_revoked']);
    assert.equal((await http('GET', '/me', await login('otra-12345'))).status, 200);
  });

  await run('sin credenciales cambiadas nunca, un token de antes sigue valiendo (desplegar no cierra sesiones)', async () => {
    assert.equal((await http('GET', '/me', signToken({ sub: U.goo, role: 'alumno' }))).status, 200);
  });
  // B32: la contraseña de un menor la pone y la restablece su tutor; el email de restablecer no sirve aunque lo tenga.
  await run('B32: un menor con email (14+) no restablece por email: create_password_reset no crea nada', async () => {
    U.teen = crypto.randomUUID();
    await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, 'Teen', CURRENT_DATE - interval '15 years')`, [U.teen]);
    await q(`INSERT INTO auth_credentials (profile_id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`,
      [U.teen, email('teen'), `${tag}-teen`]);
    const { rows: [r] } = await q(`SELECT create_password_reset($1, 'x') AS ok`, [email('teen')]);
    assert.equal(r.ok, false);
    assert.equal((await q(`SELECT 1 FROM password_resets WHERE profile_id = $1`, [U.teen])).rowCount, 0);
  });

  await run('B32: el menor cambia su contraseña con la sesión (sin email no se manda el aviso)', async () => {
    const t = signToken({ sub: U.teen, role: 'alumno' });
    await q(`UPDATE auth_credentials SET email = NULL, password_hash = $2 WHERE profile_id = $1`, [U.teen, await hashPassword('vieja-1234')]);
    await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.ana, U.teen]);
    const r = await http('POST', '/me/password', t, { current_password: 'vieja-1234', new_password: 'nueva-1234' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
} finally {
  console.error = realError;
  server.close();
  await q(`DELETE FROM audit_log WHERE resource_id = ANY($1::text[]) OR actor_id = ANY($2::uuid[])`, [Object.values(U), Object.values(U)]);
  await q(`DELETE FROM password_resets WHERE profile_id = ANY($1::uuid[])`, [Object.values(U)]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [Object.values(U)]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
