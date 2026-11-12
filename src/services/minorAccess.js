// src/services/minorAccess.js — acceso propio del menor (B32, ADR 0026). Lo da, cambia y quita cualquier tutor vinculado;
// las reglas (tutor vigente y adulto, email desde los 14, aviso a los demás tutores) viven en las funciones SQL de la 061.
import { httpError } from '../lib/errors.js';
import { hashPassword } from './password.js';
import { assertStrongPassword } from './auth.js';
import { assertGuardianOf } from './profile.js';
import { getMyProfile } from './profiles.js';

// Versión del texto informativo que el tutor acepta al activar el acceso (el frontend la muestra y la manda).
export const MINOR_ACCESS_NOTICE_VERSION = '1.0';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/; // sin '@': nunca tiene forma de email (como el CHECK de la 061)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ACCESS_FIELDS = ['password', 'email', 'can_book'];

const SQL_ERRORS = {
  not_guardian: [403, 'No eres tutor de este perfil'],
  email_requires_14: [400, 'Por debajo de 14 años, el acceso propio no lleva email'],
  access_not_found: [404, 'No tiene acceso propio'],
};
const TAKEN = {
  auth_credentials_pkey: ['access_exists', 'Ya tiene acceso propio'],
  auth_credentials_username_key: ['username_taken', 'Ese usuario ya existe'],
  auth_credentials_email_key: ['email_taken', 'email already registered'],
};

async function call(client, sql, params) {
  try {
    await client.query(sql, params);
  } catch (err) {
    if (err.code === '23505' && TAKEN[err.constraint]) throw httpError(409, ...TAKEN[err.constraint]);
    const known = SQL_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1]);
    throw err;
  }
}

const invalid = (field, message) => httpError(400, 'invalid_field', message, { field });

function username(v) {
  const u = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(u)) {
    throw httpError(400, 'invalid_username', 'Usuario de 3 a 30 letras, números, punto, guion o guion bajo (no un email)');
  }
  return u;
}

function email(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > 254 || !EMAIL_RE.test(v.trim())) throw invalid('email', 'email inválido');
  return v.trim();
}

/** Credenciales del hijo como las ve su tutor (la RLS se las deja leer), o null. */
export async function accessOf(client, minorId) {
  const { rows: [a] } = await client.query(
    `SELECT username, email, can_book FROM auth_credentials WHERE profile_id = $1`, [minorId]);
  return a ?? null;
}

/** POST /me/children/:id/access { username, password, email?, notice_version } → 201 { access }. */
export async function grantAccess(client, minorId, body, ip) {
  const u = username(body.username);
  assertStrongPassword(body.password);
  const mail = body.email === undefined ? null : email(body.email);
  if (body.notice_version !== MINOR_ACCESS_NOTICE_VERSION) {
    throw invalid('notice_version', `notice_version debe ser la del texto vigente (${MINOR_ACCESS_NOTICE_VERSION})`);
  }
  await call(client, `SELECT grant_minor_access($1, $2, $3, $4, $5, $6)`,
    [minorId, u, await hashPassword(body.password), mail, ip ?? null, body.notice_version]);
  return { status: 201, body: { access: await accessOf(client, minorId) } };
}

/** PATCH /me/children/:id/access { password?, email?, can_book? } → { access }. La contraseña nueva cierra sus sesiones. */
export async function updateAccess(client, minorId, body) {
  const bad = Object.keys(body).find((k) => !ACCESS_FIELDS.includes(k));
  if (bad) throw invalid(bad, `Campo desconocido: ${bad}`);
  if (!ACCESS_FIELDS.some((k) => Object.hasOwn(body, k))) throw httpError(400, 'no_fields', 'Ningún campo válido en el body.');
  if (Object.hasOwn(body, 'password')) assertStrongPassword(body.password);
  if (Object.hasOwn(body, 'can_book') && typeof body.can_book !== 'boolean') throw invalid('can_book', 'can_book debe ser booleano');
  const setEmail = Object.hasOwn(body, 'email');
  await call(client, `SELECT update_minor_access($1, $2, $3, $4, $5)`, [minorId,
    Object.hasOwn(body, 'password') ? await hashPassword(body.password) : null, setEmail, setEmail ? email(body.email) : null,
    body.can_book ?? null]);
  return { access: await accessOf(client, minorId) };
}

/** DELETE /me/children/:id/access → 204. Su sesión abierta deja de valer al momento. */
export async function revokeAccess(client, minorId) {
  await call(client, `SELECT revoke_minor_access($1)`, [minorId]);
  return { status: 204, body: null };
}

/** PATCH /me/children/:id/profile { is_public?, visible_fields? } (validado) → como GET /me/profile, del hijo. */
export async function setChildVisibility(client, minorId, body) {
  await assertGuardianOf(client, minorId);
  await client.query(
    `UPDATE profiles SET is_public = COALESCE($2, is_public),
            visible_fields = CASE WHEN $3::jsonb IS NULL THEN visible_fields ELSE COALESCE(visible_fields, '{}') || $3 END
      WHERE id = $1`, [minorId, body.is_public ?? null, body.visible_fields ?? null]);
  return getMyProfile(client, minorId);
}
