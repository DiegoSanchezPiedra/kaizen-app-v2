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
import { hashPassword, verifyPassword } from '../src/services/password.js';
import {
  setupMfa,
  verifyAndEnableMfa,
  verifyMfaCode,
  getMfaStatus,
  getMfaStatusWithClient,
} from '../src/services/mfa.js';
import { encrypt, decrypt } from '../src/services/crypto.js';
import * as OTPAuth from 'otpauth';
import { MFA_TOTP_ISSUER } from '../src/config/mfa.js';

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
    // Borramos en orden seguro.
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

async function currentTotpFor(profileId) {
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
  return totp.generate();
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
    const res = await setupMfa(adminProfileId, 'admin', ADMIN_EMAIL);
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
    const res = await setupMfa(adminProfileId, 'admin', ADMIN_EMAIL);
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
      () => verifyAndEnableMfa(adminProfileId, 'admin', '000000'),
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
    const res = await verifyAndEnableMfa(adminProfileId, 'admin', code);
    assert(res.enabled === true, 'enabled != true');
    const { rows } = await servicePool.query(
      `SELECT mfa_enabled FROM user_mfa WHERE user_id = $1`,
      [adminProfileId]
    );
    assert(rows[0].mfa_enabled === true, 'mfa_enabled != true');
  });

  // 5) setupMfa con mfa_enabled=true → 409 mfa_already_enabled
  await run('setupMfa: con mfa_enabled=true → 409 mfa_already_enabled', async () => {
    await assertRejects(
      () => setupMfa(adminProfileId, 'admin', ADMIN_EMAIL),
      (e) => e.status === 409 && e.code === 'mfa_already_enabled',
      'debía rechazar con 409 mfa_already_enabled'
    );
  });

  // 6) getMfaStatus / getMfaStatusWithClient devuelven enabled=true
  await run('getMfaStatus + getMfaStatusWithClient → enabled=true', async () => {
    const a = await getMfaStatus(adminProfileId, 'admin');
    assert(a.enabled === true, 'getMfaStatus.enabled != true');
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [adminProfileId]);
      await client.query(`SELECT set_config('app.current_role', $1, true)`, ['admin']);
      const b = await getMfaStatusWithClient(client, adminProfileId);
      await client.query('COMMIT');
      assert(b.enabled === true, 'getMfaStatusWithClient.enabled != true');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // 7) verifyMfaCode con TOTP correcto → true
  await run('verifyMfaCode: TOTP correcto → true', async () => {
    const code = await currentTotpFor(adminProfileId);
    const ok = await verifyMfaCode(adminProfileId, 'admin', code);
    assert(ok === true, 'verifyMfaCode TOTP devolvió false');
  });

  // 8) verifyMfaCode con TOTP incorrecto → false
  await run('verifyMfaCode: TOTP incorrecto → false', async () => {
    const ok = await verifyMfaCode(adminProfileId, 'admin', '000000');
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

    const fresh = await setupMfa(adminProfileId, 'admin', ADMIN_EMAIL);
    const code = await currentTotpFor(adminProfileId);
    await verifyAndEnableMfa(adminProfileId, 'admin', code);

    const recovery = fresh.recovery_codes[0];
    const first = await verifyMfaCode(adminProfileId, 'admin', recovery);
    assert(first === true, 'primer uso del recovery code debería ser true');

    const second = await verifyMfaCode(adminProfileId, 'admin', recovery);
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

      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [otherId]);
        await client.query(`SELECT set_config('app.current_role', $1, true)`, ['alumno']);
        const { rows } = await client.query(
          `SELECT * FROM user_mfa WHERE user_id = $1`,
          [adminProfileId]
        );
        await client.query('COMMIT');
        assert(rows.length === 0, `alumno ve ${rows.length} filas de user_mfa del admin`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

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
// Main
// ---------------------------------------------------------------------------

let exitCode = 0;

try {
  await createTestAdmin();
  console.log(`Admin de prueba creado: ${ADMIN_EMAIL} (${adminProfileId})`);
  await main();
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