// src/services/mfa.js
import * as OTPAuth from 'otpauth';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

import { appPool } from '../config/database.js';
import {
  MFA_TOTP_ISSUER,
  MFA_RECOVERY_CODE_COUNT,
} from '../config/mfa.js';
import { encrypt, decrypt } from './crypto.js';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_CODE_LEN = 10;

function generateRecoveryCode() {
  const bytes = randomBytes(RECOVERY_CODE_LEN);
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LEN; i++) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return out;
}

async function hashRecoveryCode(code) {
  return argon2.hash(code, { type: argon2.argon2id });
}

async function verifyRecoveryCodeHash(code, hash) {
  try {
    return await argon2.verify(hash, code);
  } catch {
    return false;
  }
}

function buildTotp(secretBase32, label) {
  return new OTPAuth.TOTP({
    issuer: MFA_TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

async function findMfaRow(client, profileId) {
  const { rows } = await client.query(
    `SELECT user_id, totp_secret_encrypted, recovery_codes_encrypted,
            mfa_enabled, created_at, updated_at
       FROM user_mfa
      WHERE user_id = $1
      LIMIT 1`,
    [profileId],
  );
  return rows[0] || null;
}

/**
 * Abre transacción appPool con RLS self + rol real.
 * `role` debe venir del JWT (req.user.role) o del mfa_token en login.
 */
async function withRlsSelf(profileId, role, fn) {
  if (!profileId || !role) {
    const e = new Error('profileId and role required for RLS context');
    e.status = 500;
    e.code = 'rls_context_missing';
    throw e;
  }
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      profileId,
    ]);
    await client.query(`SELECT set_config('app.current_role', $1, true)`, [
      role,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignora
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export async function setupMfa(profileId, role, label) {
  if (!profileId) {
    const e = new Error('profileId required');
    e.status = 400;
    e.code = 'profile_id_required';
    throw e;
  }

  const secret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = secret.base32;
  const totp = buildTotp(secretBase32, label || profileId);
  const otpauthUri = totp.toString();

  const recoveryCodes = Array.from(
    { length: MFA_RECOVERY_CODE_COUNT },
    () => generateRecoveryCode(),
  );
  const recoveryHashes = await Promise.all(
    recoveryCodes.map((c) => hashRecoveryCode(c)),
  );

  const totpSecretEncrypted = encrypt(secretBase32);
  const recoveryCodesEncrypted = encrypt(JSON.stringify(recoveryHashes));

  await withRlsSelf(profileId, role, async (client) => {
    const existing = await findMfaRow(client, profileId);

    if (existing && existing.mfa_enabled === true) {
      const e = new Error('MFA already enabled');
      e.status = 409;
      e.code = 'mfa_already_enabled';
      throw e;
    }

    if (existing) {
      await client.query(
        `UPDATE user_mfa
            SET totp_secret_encrypted    = $1,
                recovery_codes_encrypted = $2,
                mfa_enabled              = false,
                updated_at               = CURRENT_TIMESTAMP
          WHERE user_id = $3`,
        [totpSecretEncrypted, recoveryCodesEncrypted, profileId],
      );
    } else {
      await client.query(
        `INSERT INTO user_mfa
           (id, user_id, totp_secret_encrypted, recovery_codes_encrypted, mfa_enabled)
         VALUES ($1, $2, $3, $4, false)`,
        [randomUUID(), profileId, totpSecretEncrypted, recoveryCodesEncrypted],
      );
    }
  });

  return {
    otpauth_uri: otpauthUri,
    recovery_codes: recoveryCodes,
  };
}

export async function verifyAndEnableMfa(profileId, role, code) {
  if (!profileId || !code) {
    const e = new Error('profileId and code required');
    e.status = 400;
    e.code = 'invalid_request';
    throw e;
  }

  return withRlsSelf(profileId, role, async (client) => {
    const row = await findMfaRow(client, profileId);
    if (!row) {
      const e = new Error('MFA not set up');
      e.status = 400;
      e.code = 'mfa_not_setup';
      throw e;
    }

    const secretBase32 = decrypt(row.totp_secret_encrypted);
    const totp = buildTotp(secretBase32, profileId);
    const delta = totp.validate({ token: String(code), window: 1 });
    if (delta === null) {
      const e = new Error('Invalid TOTP code');
      e.status = 400;
      e.code = 'invalid_totp';
      throw e;
    }

    await client.query(
      `UPDATE user_mfa
          SET mfa_enabled = true,
              updated_at  = CURRENT_TIMESTAMP
        WHERE user_id = $1`,
      [profileId],
    );

    return { enabled: true };
  });
}

export async function verifyMfaCode(profileId, role, code) {
  if (!profileId || !code) return false;

  return withRlsSelf(profileId, role, async (client) => {
    const row = await findMfaRow(client, profileId);
    if (!row || row.mfa_enabled !== true) return false;

    // 1) TOTP
    try {
      const secretBase32 = decrypt(row.totp_secret_encrypted);
      const totp = buildTotp(secretBase32, profileId);
      const delta = totp.validate({ token: String(code), window: 1 });
      if (delta !== null) return true;
    } catch {
      // secret corrupto: caemos a recovery
    }

    // 2) Recovery codes
    let hashes = [];
    try {
      hashes = JSON.parse(decrypt(row.recovery_codes_encrypted));
      if (!Array.isArray(hashes)) hashes = [];
    } catch {
      hashes = [];
    }

    for (let i = 0; i < hashes.length; i++) {
      const ok = await verifyRecoveryCodeHash(String(code), hashes[i]);
      if (ok) {
        const remaining = hashes.slice(0, i).concat(hashes.slice(i + 1));
        const encrypted = encrypt(JSON.stringify(remaining));
        await client.query(
          `UPDATE user_mfa
              SET recovery_codes_encrypted = $1,
                  updated_at               = CURRENT_TIMESTAMP
            WHERE user_id = $2`,
          [encrypted, profileId],
        );
        return true;
      }
    }

    return false;
  });
}

/**
 * Para /auth/me: usa el client que ya abrió withRlsContext.
 * No abre transacción nueva.
 */
export async function getMfaStatusWithClient(client, profileId) {
  if (!profileId) return { enabled: false };
  const row = await findMfaRow(client, profileId);
  return { enabled: row ? row.mfa_enabled === true : false };
}

/**
 * Para login: abre transacción propia (no hay withRlsContext aquí).
 */
export async function getMfaStatus(profileId, role) {
  if (!profileId) return { enabled: false };
  return withRlsSelf(profileId, role, async (client) => {
    const row = await findMfaRow(client, profileId);
    return { enabled: row ? row.mfa_enabled === true : false };
  });
}