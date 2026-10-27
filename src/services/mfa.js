// src/services/mfa.js
import * as OTPAuth from 'otpauth';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

import { httpError } from '../lib/errors.js';
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

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

// Cálculo pesado (argon2) sin BD: llamar ANTES de abrir la transacción RLS.
export async function prepareMfaSetup(profileId, label) {
  if (!profileId) {
    throw httpError(400, 'profile_id_required', 'profileId required');
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

  return {
    otpauth_uri: otpauthUri,
    recovery_codes: recoveryCodes,
    totpSecretEncrypted,
    recoveryCodesEncrypted,
  };
}

export async function setupMfa(client, profileId, prepared) {
  const { otpauth_uri, recovery_codes, totpSecretEncrypted, recoveryCodesEncrypted } = prepared;
  const existing = await findMfaRow(client, profileId);

  if (existing && existing.mfa_enabled === true) {
    throw httpError(409, 'mfa_already_enabled', 'MFA already enabled');
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

  return { otpauth_uri, recovery_codes };
}

export async function verifyAndEnableMfa(client, profileId, code) {
  if (!profileId || !code) {
    throw httpError(400, 'invalid_request', 'profileId and code required');
  }

  const row = await findMfaRow(client, profileId);
  if (!row) {
    throw httpError(400, 'mfa_not_setup', 'MFA not set up');
  }

  const secretBase32 = decrypt(row.totp_secret_encrypted);
  const totp = buildTotp(secretBase32, profileId);
  const delta = totp.validate({ token: String(code), window: 1 });
  if (delta === null) {
    throw httpError(400, 'invalid_totp', 'Invalid TOTP code');
  }

  await client.query(
    `UPDATE user_mfa
        SET mfa_enabled = true,
            updated_at  = CURRENT_TIMESTAMP
      WHERE user_id = $1`,
    [profileId],
  );

  return { enabled: true };
}

export async function verifyMfaCode(client, profileId, code) {
  if (!profileId || !code) return false;

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
}

export async function getMfaStatus(client, profileId) {
  if (!profileId) return { enabled: false };
  const row = await findMfaRow(client, profileId);
  return { enabled: row ? row.mfa_enabled === true : false };
}
