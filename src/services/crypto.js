// src/services/crypto.js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MFA_ENCRYPTION_KEY } from '../config/mfa.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Cifra un string UTF-8.
 * Formato de salida: base64( iv (12 B) || authTag (16 B) || ciphertext ).
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt: plaintext must be a string');
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, MFA_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Descifra un string producido por encrypt().
 * Lanza si el payload está corrupto o manipulado.
 */
export function decrypt(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('decrypt: payload must be a non-empty string');
  }
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decrypt: payload too short');
  }
  const iv = raw.subarray(0, IV_LEN);
  const authTag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, MFA_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}