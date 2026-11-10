// B20: E2E del doble factor de B4 por HTTP, con la app entera en proceso (scripts/lib/app-server.js) y una BD efímera
// (npm run test:e2e-mfa la lanza con scripts/with-temp-db.js). Los códigos TOTP salen del otpauth_uri, como en una app de
// autenticación. Solo el admin se crea por SQL: no hay alta de admins por la API.
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import jwt from 'jsonwebtoken';
import { servicePool, closePools } from '../src/config/database.js';
import { hashPassword } from '../src/services/password.js';
import { startApp } from './lib/app-server.js';

const email = 'e2e-mfa@test.local';
const password = 'e2e-mfa-password-1234';
const { rows: [{ id }] } = await servicePool.query(
  `WITH p AS (INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), 'E2E MFA') RETURNING id),
        c AS (INSERT INTO auth_credentials (profile_id, email, password_hash, email_verified)
              SELECT id, $1, $2, true FROM p),
        r AS (INSERT INTO user_roles (user_id, role) SELECT id, 'admin' FROM p)
   SELECT id FROM p`, [email, await hashPassword(password)]);

const { http, close } = await startApp();
const realError = console.error;
console.error = () => {}; // el errorHandler registra cada 4xx esperado
const code = (r) => r.body?.code;
const login = () => http('POST', '/auth/login', { body: { email, password } });
const verify = (mfaToken, c) => http('POST', '/auth/mfa/verify', { body: { mfa_token: mfaToken, code: c } });

try {
  // 1. Login sin doble factor: token directo.
  let r = await login();
  assert.equal(r.status, 200);
  const token = r.body.token;
  assert.ok(token && !r.body.mfa_required);

  // 2. Setup: pide la contraseña.
  r = await http('POST', '/auth/mfa/setup', { token, body: {} });
  assert.deepEqual([r.status, code(r)], [400, 'invalid_field']);
  r = await http('POST', '/auth/mfa/setup', { token, body: { password: 'otra' } });
  assert.equal(code(r), 'wrong_password');
  r = await http('POST', '/auth/mfa/setup', { token, body: { password } });
  assert.equal(r.status, 201);
  const totp = OTPAuth.URI.parse(r.body.otpauth_uri);
  const recovery = r.body.recovery_codes;
  assert.ok(recovery.length > 0);

  // 3. Activar con un código: token nuevo; el anterior queda revocado.
  await new Promise((ok) => setTimeout(ok, 1100)); // el iat va en segundos: un token del mismo segundo que el cambio seguiría valiendo (ADR 0020)
  const activationCode = totp.generate();
  r = await http('POST', '/auth/mfa/activate', { token, body: { code: activationCode } });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal((await http('GET', '/auth/me', { token: r.body.token })).status, 200);
  assert.deepEqual(code(await http('GET', '/auth/me', { token })), 'session_revoked');

  // 4. Login pide el código; uno malo no entra; el TOTP da un token con amr mfa.
  r = await login();
  assert.equal(r.body.mfa_required, true);
  assert.equal(r.body.token, undefined);
  const mfaToken = r.body.mfa_token;
  assert.equal(code(await http('GET', '/auth/me', { token: mfaToken })), 'invalid_token');
  assert.deepEqual([(r = await verify(mfaToken, '000000')).status, code(r)], [401, 'invalid_mfa_code']);
  // Un TOTP es de un solo uso (B20): el paso de activar ya está gastado, así que el del paso siguiente (window 1).
  assert.equal(code(await verify(mfaToken, activationCode)), 'invalid_mfa_code');
  r = await verify(mfaToken, totp.generate({ timestamp: Date.now() + 30_000 }));
  assert.equal(r.status, 200);
  assert.deepEqual(jwt.decode(r.body.token).amr, ['mfa']);
  assert.equal((await http('GET', '/auth/me', { token: r.body.token })).status, 200);

  // 5. Un código de recuperación entra una sola vez.
  r = await verify((await login()).body.mfa_token, recovery[0]);
  assert.equal(r.status, 200);
  assert.deepEqual(jwt.decode(r.body.token).amr, ['mfa']);
  r = await verify((await login()).body.mfa_token, recovery[0]);
  assert.deepEqual([r.status, code(r)], [401, 'invalid_mfa_code']);
  r = await verify((await login()).body.mfa_token, recovery[1]);
  assert.equal(r.status, 200);

  console.log(`OK   E2E MFA: login → setup con contraseña → activar → código → amr mfa → recuperación de un uso (${id})`);
} catch (e) {
  realError('FAIL E2E MFA\n', e);
  process.exitCode = 1;
} finally {
  await close();
  await closePools();
}
