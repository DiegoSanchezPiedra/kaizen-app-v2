// src/config/mfa.js
import 'dotenv/config';

const raw = process.env.MFA_ENCRYPTION_KEY;
if (!raw) {
  throw new Error('MFA_ENCRYPTION_KEY is required (32 bytes, base64 or hex)');
}

// Acepta base64 (44 chars con padding) o hex (64 chars). Normaliza a Buffer 32 B.
function decodeKey(value) {
  const trimmed = value.trim();

  // hex
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // base64 (con o sin padding)
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    // sigue abajo
  }

  throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex)');
}

const key = decodeKey(raw);
if (key.length !== 32) {
  throw new Error('MFA_ENCRYPTION_KEY must be exactly 32 bytes');
}

export const MFA_ENCRYPTION_KEY = key;
export const MFA_TOKEN_EXPIRES_IN = process.env.MFA_TOKEN_EXPIRES_IN || '5m';
export const MFA_TOTP_ISSUER = process.env.MFA_TOTP_ISSUER || 'Kaizen App';
export const MFA_RECOVERY_CODE_COUNT = Number.parseInt(
  process.env.MFA_RECOVERY_CODE_COUNT || '10',
  10,
);