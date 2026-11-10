#!/usr/bin/env node
// scripts/test-mfa.js
//
// Tests de MFA (B4). Destructivo: crea un admin de prueba con service_role
// y lo borra al final. SOLO LOCAL. Nunca producción.
//
// Uso: npm run test:mfa
// Salida: líneas "OK   <caso>" / "FAIL <caso> :: <motivo>", exit 0 si todo OK.

import crypto from 'node:crypto';

import { servicePool, appPool } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { hashPassword, verifyPassword } from '../src/services/password.js';
import {
  prepareMfaSetup,
  setupMfa,
  verifyAndEnableMfa,
  verifyMfaCode,
  getMfaStatus,
} from '../src/services/mfa.js';
import { encrypt, decrypt } from '../src/services/crypto.js';
import * as OTPAuth from 'otpauth';
import { MFA_TOTP_ISSUER } from '../src/config/mfa.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRouter from '../src/routes/auth.js';
import adminProfilesRouter from '../src/routes/admin/profiles.js';

// ---------------------------------------------------------------------------
// Runner mínimo
// ---------------------------------------------------------------------------

let okCount = 0;
let failCount = 0;

function ok(name) {
  okCount++;
  console.log(`OK   ${name}`);
}

function fail(name, err) {
  failCount++;
  const msg = err && err.message ? err.message : String(err);
  console.log(`FAIL ${name} :: ${msg}`);
}

async function run(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function assertRejects(promiseOrFn, predicate, msg) {
  let err;
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    err = e;
  }
  assert(err, `${msg || 'expected rejection'} (no throw)`);
  if (predicate) {
    assert(predicate(err), `${msg || 'unexpected error'} :: got ${err.code || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures: admin de prueba creado con service_role (BYPASSRLS)
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = `mfa-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@test.local`;
const ADMIN_PASSWORD = 'mfa-test-password-1234';
let adminProfileId = null;

async function createTestAdmin() {
  adminProfileId = crypto.randomUUID();
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const client = await servicePool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO profiles (id, display_name) VALUES ($1, $2)`,
      [adminProfileId, 'MFA test admin']
    );
    await client.query(
      `INSERT INTO auth_credentials
         (profile_id, email, password_hash, google_sub, email_verified)
       VALUES ($1, $2, $3, NULL, true)`,
      [adminProfileId, ADMIN_EMAIL, passwordHash]
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`,
      [adminProfileId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup() {
  if (!adminProfileId) return;
  const client = await servicePool.connect();
  try {
    await client.query('BEGIN');
    // user_mfa, auth_credentials, user_roles: ON DELETE CASCADE o RESTRICT
    // Borramos en este orden.
    await client.query(`DELETE FROM user_mfa WHERE user_id = $1`, [adminProfileId]);
    await client.query(`DELETE FROM auth_credentials WHERE profile_id = $1`, [adminProfileId]);
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [adminProfileId]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [adminProfileId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cleanup error:', err.message);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helper: generar TOTP válido desde la fila actual de user_mfa
// (usa servicePool porque necesitamos el secreto descifrado)
// ---------------------------------------------------------------------------

const asAdmin = (fn) => withRls({ uid: adminProfileId, role: 'admin' }, fn);

const setupAdmin = async () => {
  const prepared = await prepareMfaSetup(adminProfileId, ADMIN_EMAIL);
  return asAdmin((c) => setupMfa(c, adminProfileId, prepared));
};

// steps: 1 = el código del paso siguiente (validate lo acepta con window 1); sirve para un segundo código sin esperar.
async function currentTotpFor(profileId, steps = 0) {
  const { rows } = await servicePool.query(
    `SELECT totp_secret_encrypted FROM user_mfa WHERE user_id = $1`,
    [profileId]
  );
  assert(rows[0], 'no user_mfa row for admin');
  const secretBase32 = decrypt(rows[0].totp_secret_encrypted);
  const totp = new OTPAuth.TOTP({
    issuer: MFA_TOTP_ISSUER,
    label: profileId,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp: Date.now() + steps * 30_000 });
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Admin de prueba: ${ADMIN_EMAIL} (${adminProfileId || 'pending'})`);

  // 0) Sanity: crypto round-trip
  await run('crypto: encrypt/decrypt round-trip', async () => {
    const pt = 'hola-mundo-' + crypto.randomBytes(8).toString('hex');
    const ct = encrypt(pt);
    assert(ct !== pt, 'ciphertext == plaintext');
    assert(decrypt(ct) === pt, 'decrypt(encrypt(pt)) != pt');
  });

  await run('crypto: decrypt rechaza payload manipulado', async () => {
    const ct = encrypt('algo');
    const raw = Buffer.from(ct, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip último byte
    const tampered = raw.toString('base64');
    await assertRejects(() => decrypt(tampered), null, 'GCM debe fallar');
  });

  // 1) setupMfa genera fila con mfa_enabled = false
  await run('setupMfa: crea fila con mfa_enabled=false y devuelve codes', async () => {
    const res = await setupAdmin();
    assert(typeof res.otpauth_uri === 'string' && res.otpauth_uri.startsWith('otpauth://'), 'otpauth_uri inválido');
    assert(Array.isArray(res.recovery_codes) && res.recovery_codes.length > 0, 'recovery_codes vacío');
    for (const c of res.recovery_codes) {
      assert(typeof c === 'string' && c.length === 10, `recovery code len != 10: ${c}`);
    }
    const { rows } = await servicePool.query(
      `SELECT mfa_enabled FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    assert(rows[0], 'no user_mfa row');
    assert(rows[0].mfa_enabled === false, 'mfa_enabled debería ser false tras setup');
  });

  // 2) setupMfa segunda vez (sin verify) regenera
  await run('setupMfa: segunda vez sin verify regenera (sobrescribe)', async () => {
    const first = await servicePool.query(
      `SELECT totp_secret_encrypted FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    const res = await setupAdmin();
    assert(res.recovery_codes.length > 0, 'sin recovery codes');
    const second = await servicePool.query(
      `SELECT totp_secret_encrypted FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    assert(
      first.rows[0].totp_secret_encrypted !== second.rows[0].totp_secret_encrypted,
      'el secreto no se regeneró'
    );
  });

  // 3) verifyAndEnableMfa con TOTP incorrecto → 400 invalid_totp
  await run('verifyAndEnableMfa: TOTP incorrecto → invalid_totp', async () => {
    await assertRejects(
      () => asAdmin((c) => verifyAndEnableMfa(c, adminProfileId, '000000')),
      (e) => e.code === 'invalid_totp',
      'debía rechazar con invalid_totp'
    );
    const { rows } = await servicePool.query(
      `SELECT mfa_enabled FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    assert(rows[0].mfa_enabled === false, 'mfa_enabled no debería activarse');
  });

  // 4) verifyAndEnableMfa con TOTP correcto → mfa_enabled = true
  await run('verifyAndEnableMfa: TOTP correcto activa mfa_enabled', async () => {
    const code = await currentTotpFor(adminProfileId);
    const res = await asAdmin((c) => verifyAndEnableMfa(c, adminProfileId, code));
    assert(res.enabled === true, 'enabled != true');
    const { rows } = await servicePool.query(
      `SELECT mfa_enabled FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    assert(rows[0].mfa_enabled === true, 'mfa_enabled != true');
    const { rows: audit } = await servicePool.query(
      `SELECT actor_id, resource_type FROM audit_log WHERE action = 'auth.mfa_enable' AND resource_id = $1`,
      [adminProfileId]
    );
    assert(audit.length === 1 && audit[0].actor_id === adminProfileId && audit[0].resource_type === 'profile',
      `audit_log auth.mfa_enable: ${JSON.stringify(audit)}`);
  });

  // 5) setupMfa con mfa_enabled=true → 409 mfa_already_enabled
  await run('setupMfa: con mfa_enabled=true → 409 mfa_already_enabled', async () => {
    await assertRejects(
      () => setupAdmin(),
      (e) => e.status === 409 && e.code === 'mfa_already_enabled',
      'debía rechazar con 409 mfa_already_enabled'
    );
  });

  // 6) getMfaStatus devuelve enabled=true
  await run('getMfaStatus → enabled=true', async () => {
    const a = await asAdmin((c) => getMfaStatus(c, adminProfileId));
    assert(a.enabled === true, 'getMfaStatus.enabled != true');
  });

  // 7) verifyMfaCode con TOTP correcto → true
  // El de activar ya gastó el paso actual: el siguiente.
  await run('verifyMfaCode: TOTP correcto → true', async () => {
    const code = await currentTotpFor(adminProfileId, 1);
    const ok = await asAdmin((c) => verifyMfaCode(c, adminProfileId, code));
    assert(ok === true, 'verifyMfaCode TOTP devolvió false');
  });

  await run('B20: verifyMfaCode rechaza un TOTP ya usado y uno de un paso anterior', async () => {
    const used = await currentTotpFor(adminProfileId, 1);
    assert(await asAdmin((c) => verifyMfaCode(c, adminProfileId, used)) === false, 'el mismo código entró dos veces');
    const older = await currentTotpFor(adminProfileId);
    assert(await asAdmin((c) => verifyMfaCode(c, adminProfileId, older)) === false, 'un código de un paso anterior entró');
    const code = await currentTotpFor(adminProfileId);
    await assertRejects(() => asAdmin((c) => verifyAndEnableMfa(c, adminProfileId, code)),
      (e) => e.code === 'invalid_totp', 'activar con un paso ya usado');
  });

  // 8) verifyMfaCode con TOTP incorrecto → false
  await run('verifyMfaCode: TOTP incorrecto → false', async () => {
    const ok = await asAdmin((c) => verifyMfaCode(c, adminProfileId, '000000'));
    assert(ok === false, 'verifyMfaCode TOTP inválido devolvió true');
  });

  // 9) Recovery code: un solo uso, se consume
  await run('verifyMfaCode: recovery code funciona una vez y se consume', async () => {
    // Necesitamos los codes en claro. Como setup ya se ejecutó antes de
    // activar MFA, aquí regeneramos para tener codes frescos.
    // Pero setupMfa rechaza si mfa_enabled=true. Para este caso:
    //   a) ponemos mfa_enabled=false con service_role
    //   b) ejecutamos setupMfa (regenera)
    //   c) activamos con TOTP
    //   d) probamos un recovery code dos veces
    const client = await servicePool.connect();
    try {
      await client.query(
        `UPDATE user_mfa SET mfa_enabled = false WHERE user_id = $1`,
        [adminProfileId]
      );
    } finally {
      client.release();
    }

    const fresh = await setupAdmin();
    const code = await currentTotpFor(adminProfileId);
    await asAdmin((c) => verifyAndEnableMfa(c, adminProfileId, code));

    const recovery = fresh.recovery_codes[0];
    const first = await asAdmin((c) => verifyMfaCode(c, adminProfileId, recovery));
    assert(first === true, 'primer uso del recovery code debería ser true');

    const second = await asAdmin((c) => verifyMfaCode(c, adminProfileId, recovery));
    assert(second === false, 'segundo uso del recovery code debería ser false');

    // Quedan N-1 codes: verificamos que el array persistido bajó en 1
    const { rows } = await servicePool.query(
      `SELECT recovery_codes_encrypted FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    const remaining = JSON.parse(decrypt(rows[0].recovery_codes_encrypted));
    assert(Array.isArray(remaining), 'recovery_codes persistidos no son array');
    assert(
      remaining.length === fresh.recovery_codes.length - 1,
      `esperaba ${fresh.recovery_codes.length - 1} codes restantes, hay ${remaining.length}`
    );
  });

  // 10) RLS: un alumno no puede leer user_mfa de otro (via appPool + set_config)
  await run('RLS: alumno no puede leer user_mfa del admin', async () => {
    const otherId = crypto.randomUUID();
    const otherEmail = `mfa-test-other-${Date.now()}@test.local`;
    const otherHash = await hashPassword('otro-password-1234');
    const sc = await servicePool.connect();
    try {
      await sc.query('BEGIN');
      await sc.query(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [otherId, 'other']);
      await sc.query(
        `INSERT INTO auth_credentials (profile_id, email, password_hash, google_sub, email_verified)
         VALUES ($1, $2, $3, NULL, true)`,
        [otherId, otherEmail, otherHash]
      );
      await sc.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`, [otherId]);
      await sc.query('COMMIT');

      const { rows } = await withRls({ uid: otherId, role: 'alumno' }, (client) =>
        client.query(`SELECT * FROM user_mfa WHERE user_id = $1`, [adminProfileId]),
      );
      assert(rows.length === 0, `alumno ve ${rows.length} filas de user_mfa del admin`);

      // cleanup other
      const sc2 = await servicePool.connect();
      try {
        await sc2.query('BEGIN');
        await sc2.query(`DELETE FROM user_mfa WHERE user_id = $1`, [otherId]);
        await sc2.query(`DELETE FROM auth_credentials WHERE profile_id = $1`, [otherId]);
        await sc2.query(`DELETE FROM user_roles WHERE user_id = $1`, [otherId]);
        await sc2.query(`DELETE FROM profiles WHERE id = $1`, [otherId]);
        await sc2.query('COMMIT');
      } catch (err) {
        await sc2.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        sc2.release();
      }
    } catch (err) {
      await sc.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      sc.release();
    }
  });

  // 11) password helper sanity (no es de MFA, pero barato y confirma que
  //     el fixture del admin es válido)
  await run('fixture: admin password verifica con argon2', async () => {
    const { rows } = await servicePool.query(
      `SELECT password_hash FROM auth_credentials WHERE profile_id = $1`,
      [adminProfileId]
    );
    const ok2 = await verifyPassword(rows[0].password_hash, ADMIN_PASSWORD);
    assert(ok2 === true, 'argon2.verify del admin falló');
  });
}

// ---------------------------------------------------------------------------
// B19.0 (ADR 0016): el token del admin caduca a las 12 h, con y sin MFA; el resto a los 7 días.
// Por HTTP con un express en memoria. Al empezar borra el MFA del admin de prueba y lo activa por la API.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ttlHours = (token) => {
  const { iat, exp } = jwt.decode(token);
  return (exp - iat) / 3600;
};

async function httpCases() {
  const app = express().use(express.json()).use('/auth', authRouter).use('/admin', adminProfilesRouter)
    .use(errorHandler);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (method, url, { token, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = () => http('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  try {
    await servicePool.query(`DELETE FROM user_mfa WHERE user_id = $1`, [adminProfileId]);
    let token;
    await run('B19.0: un admin sin MFA entra con token de 12 h y usa /admin/*', async () => {
      const r = await login();
      assert(r.status === 200 && r.body.token, `login ${r.status}`);
      token = r.body.token;
      assert(ttlHours(token) === 12, `ttl ${ttlHours(token)} h`);
      const me = await http('GET', '/auth/me', { token });
      assert(me.body.mfa_enabled === false && me.body.user.role === 'admin', 'GET /auth/me');
      const list = await http('GET', '/admin/profiles?limit=1', { token });
      assert(list.status === 200 && typeof list.body.total === 'number', `GET /admin/profiles ${list.status}`);
    });
    await run('B20: empezar el MFA pide la contraseña actual (400 invalid_field | wrong_password)', async () => {
      const none = await http('POST', '/auth/mfa/setup', { token });
      assert(none.status === 400 && none.body.code === 'invalid_field', `sin contraseña ${none.status} ${none.body?.code}`);
      const bad = await http('POST', '/auth/mfa/setup', { token, body: { password: 'otra-cosa-1234' } });
      assert(bad.status === 400 && bad.body.code === 'wrong_password', `otra contraseña ${bad.status} ${bad.body?.code}`);
    });
    await run('B20: cuenta solo con Google: sin login reciente → 403 reauth_required; con él, sin contraseña', async () => {
      await servicePool.query(`UPDATE auth_credentials SET password_hash = NULL, google_sub = $2, credentials_changed_at = NULL
          WHERE profile_id = $1`, // sin la hora: el token de hace 11 min no es session_revoked
        [adminProfileId, `mfa-test-${adminProfileId}`]);
      try {
        const old = signToken({ sub: adminProfileId, role: 'admin', iat: Math.floor(Date.now() / 1000) - 11 * 60 });
        const r = await http('POST', '/auth/mfa/setup', { token: old });
        assert(r.status === 403 && r.body.code === 'reauth_required', `login de hace 11 min ${r.status} ${r.body?.code}`);
        const fresh = await http('POST', '/auth/mfa/setup', { token: signToken({ sub: adminProfileId, role: 'admin' }) });
        assert(fresh.status === 201, `login reciente ${fresh.status} ${fresh.body?.code}`);
      } finally {
        await servicePool.query(`UPDATE auth_credentials SET password_hash = $2, google_sub = NULL WHERE profile_id = $1`,
          [adminProfileId, await hashPassword(ADMIN_PASSWORD)]);
      }
    });
    await run('B20: activar el MFA cierra las demás sesiones (ADR 0020) y devuelve el token de esta', async () => {
      const other = (await login()).body.token;
      const s = await http('POST', '/auth/mfa/setup', { token, body: { password: ADMIN_PASSWORD } });
      assert(s.status === 201, `setup ${s.status} ${s.body?.code}`);
      await sleep(1100); // el iat va en segundos: un token del mismo segundo que el cambio seguiría valiendo (ADR 0020)
      const act = await http('POST', '/auth/mfa/activate', { token, body: { code: await currentTotpFor(adminProfileId) } });
      assert(act.status === 200 && act.body.enabled === true && act.body.token, `activate ${act.status} ${act.body?.code}`);
      for (const t of [token, other]) {
        const r = await http('GET', '/auth/me', { token: t });
        assert(r.status === 401 && r.body.code === 'session_revoked', `token anterior ${r.status} ${r.body?.code}`);
      }
      const me = await http('GET', '/auth/me', { token: act.body.token });
      assert(me.status === 200 && me.body.mfa_enabled === true, `token nuevo ${me.status}`);
      await servicePool.query(`DELETE FROM user_mfa WHERE user_id = $1`, [adminProfileId]);
      token = act.body.token;
    });
    await run('B19.0: con MFA, el token de /auth/mfa/verify también es de 12 h', async () => {
      const s = await http('POST', '/auth/mfa/setup', { token, body: { password: ADMIN_PASSWORD } });
      assert(s.status === 201, `setup ${s.status}`);
      const code = await currentTotpFor(adminProfileId);
      const act = await http('POST', '/auth/mfa/activate', { token, body: { code } });
      assert(act.status === 200, `activate ${act.status}`);
      const r = await login();
      assert(r.body.mfa_required === true, 'login sin mfa_required');
      const v = await http('POST', '/auth/mfa/verify', { body: { mfa_token: r.body.mfa_token, code: await currentTotpFor(adminProfileId, 1) } });
      assert(v.status === 200 && ttlHours(v.body.token) === 12, `verify ${v.status}`);
      assert((await http('GET', '/admin/profiles?limit=1', { token: v.body.token })).status === 200, '/admin con MFA');
    });
    await run('B19.0: alumno, tutor y profesor siguen a 7 días', async () => {
      for (const role of ['alumno', 'tutor', 'profesor']) {
        const ttl = ttlHours(signToken({ sub: adminProfileId, role }));
        assert(ttl === 7 * 24, `${role}: ${ttl} h`);
      }
    });
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let exitCode = 0;

try {
  await createTestAdmin();
  console.log(`Admin de prueba creado: ${ADMIN_EMAIL} (${adminProfileId})`);
  await main();
  await httpCases();
} catch (err) {
  console.error('ERROR FATAL:', err);
  exitCode = 1;
} finally {
  await cleanup();
  console.log(`\n${okCount} OK, ${failCount} FAIL`);
  if (failCount > 0) exitCode = 1;
  await servicePool.end().catch(() => {});
  await appPool.end().catch(() => {});
  process.exit(exitCode);
}