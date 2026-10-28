// src/services/checkin.js — tablets y check-in por QR (CONTEXT § Asistencia). Las reglas viven en las
// funciones SQL de la migración 011; aquí el QR (HMAC del tramo de tiempo) y los tokens de tablet.
import crypto from 'node:crypto';
import { appPool } from '../config/database.js';
import { JWT_SECRET } from '../config/auth.js';
import { httpError } from '../lib/errors.js';

const SQL_ERRORS = {
  invalid_link_code: [400, 'Código de vinculación inválido, caducado o ya usado'],
  device_not_found: [401, 'Tablet desconocida o revocada'],
  no_candidates: [404, 'No tienes reservas con el check-in abierto'],
  attendance_closed: [409, 'La lista ya está cerrada'],
};

async function callFn(client, sql, params) {
  try {
    return (await client.query(sql, params)).rows;
  } catch (err) {
    const known = err.code === 'P0001' && SQL_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1]);
    throw err;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const QR_KEY = crypto.createHmac('sha256', JWT_SECRET ?? '').update('checkin-qr').digest();
const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
const LINK_CODE_MINUTES = 15;

export const SETTINGS = {
  opens_minutes: 'checkin_opens_minutes', closes_minutes: 'checkin_closes_minutes', qr_seconds: 'checkin_qr_seconds',
};

// ── QR ───────────────────────────────────────────────────────────────────────

export const qrStep = (periodSec, now = Date.now()) => Math.floor(now / 1000 / periodSec);
export const qrCode = (step) => crypto.createHmac('sha256', QR_KEY).update(String(step)).digest('base64url').slice(0, 16);

// Vale el QR actual y el inmediatamente anterior.
export function verifyQr(code, periodSec, now = Date.now()) {
  if (typeof code !== 'string' || code.length !== 16) return false;
  const step = qrStep(periodSec, now);
  return [step, step - 1].some((s) => crypto.timingSafeEqual(Buffer.from(qrCode(s)), Buffer.from(code)));
}

// Periodo del QR (academy_settings) vía función definer: la tablet no tiene contexto RLS.
export async function qrPeriod(client = appPool) {
  const { rows: [r] } = await client.query(`SELECT checkin_qr_seconds() AS n`);
  return r.n;
}

// ── Tablets (admin) ──────────────────────────────────────────────────────────

const TABLET_COLUMNS = `id, name, link_expires_at, created_at, linked_at, last_seen_at, revoked_at`;

export async function createTablet(client, { name, actorId }) {
  const code = Array.from({ length: 8 }, () => LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)]).join('');
  const { rows: [t] } = await client.query(
    `INSERT INTO device_tokens (name, link_code_hash, link_expires_at, created_by)
     VALUES ($1, $2, now() + $3 * interval '1 minute', $4) RETURNING ${TABLET_COLUMNS}`,
    [name, sha256(code), LINK_CODE_MINUTES, actorId]);
  return { ...t, link_code: code }; // solo se muestra aquí
}

export async function listTablets(client) {
  return (await client.query(`SELECT ${TABLET_COLUMNS} FROM device_tokens ORDER BY created_at, id`)).rows;
}

export async function revokeTablet(client, id) {
  const { rows: [t] } = await client.query(
    `UPDATE device_tokens SET revoked_at = COALESCE(revoked_at, now()), link_code_hash = NULL, link_expires_at = NULL
      WHERE id = $1 RETURNING ${TABLET_COLUMNS}`, [id]);
  if (!t) throw httpError(404, 'tablet_not_found', 'Tablet no encontrada');
  return t;
}

export async function updateCheckinSettings(client, body) {
  for (const [field, key] of Object.entries(SETTINGS)) {
    if (body[field] === undefined) continue;
    if (!Number.isInteger(body[field]) || body[field] < 1 || body[field] > 1440) {
      throw httpError(400, 'invalid_field', `${field} debe ser un entero entre 1 y 1440`, { field });
    }
    await client.query(
      `INSERT INTO academy_settings (key, value) VALUES ($1, to_jsonb($2::integer))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, body[field]]);
  }
  const { rows } = await client.query(
    `SELECT key, value FROM academy_settings WHERE key = ANY($1)`, [Object.values(SETTINGS)]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(Object.entries(SETTINGS).map(([field, key]) => [field, byKey[key] ?? null]));
}

// ── Tablet (sin usuario) ─────────────────────────────────────────────────────

export async function linkTablet(code) {
  if (typeof code !== 'string' || !code.trim()) throw httpError(400, 'invalid_field', 'code requerido', { field: 'code' });
  const token = crypto.randomBytes(32).toString('base64url');
  await callFn(appPool, `SELECT link_tablet($1, $2)`, [sha256(code.trim().toUpperCase()), sha256(token)]);
  return { device_token: token }; // solo se devuelve aquí
}

export const tabletFeed = (token) => callFn(appPool, `SELECT * FROM tablet_feed($1)`, [sha256(token)]);

// ── Check-in (alumno / tutor) ────────────────────────────────────────────────

export async function checkIn(client, { code, bookingId }) {
  if (!verifyQr(code, await qrPeriod(client))) throw httpError(400, 'invalid_qr', 'QR inválido o caducado');
  const [r] = await callFn(client, `SELECT check_in($1) AS r`, [bookingId ?? null]);
  return r.r;
}
