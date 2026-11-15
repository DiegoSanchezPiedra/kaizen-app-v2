// src/services/trainers.js — alta, edición y baja de profesores por el admin (ADR 0028). Con el client RLS del admin:
// las escrituras son funciones SECURITY DEFINER (migración 064) que comprueban dentro que quien llama es admin y dejan el
// audit_log (solo ids, nunca el email). Los emails se mandan después del COMMIT, desde la ruta (`sendInvite`).
import crypto from 'node:crypto';
import { httpError } from '../lib/errors.js';
import { APP_URL } from '../config/stripe.js';
import { CORPORATE_EMAIL_DOMAIN } from '../config/corporate.js';
import { invalid } from './catalog.js';
import { assertNoTrainerDuties } from './sessions.js';
import { EMAIL_RE, sha256 } from './auth.js';
import { send } from './email.js';
import { mail } from './notices.js';

const EMPLOYMENTS = ['employee', 'self_employed'];
const SQL_ERRORS = {
  '42501': [403, 'insufficient_role', 'Solo el admin gestiona profesores'],
  trainer_not_found: [404, 'trainer_not_found', 'Profesor no encontrado'],
  trainer_disabled: [409, 'trainer_disabled', 'El profesor está desactivado: reactívalo antes'],
  same_email: [409, 'same_email', 'El profesor ya tiene ese correo'],
  same_state: [409, 'same_state', 'El profesor ya está en ese estado'],
};

async function call(client, sql, params) {
  try {
    await client.query(sql, params);
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('email')) throw httpError(409, 'email_taken', 'ese correo ya está registrado');
    const known = SQL_ERRORS[err.code === '42501' ? '42501' : err.message];
    if (known) throw httpError(...known);
    throw err;
  }
}

/** Correo en minúsculas, con forma de email y del dominio corporativo (si está fijado). */
function parseEmail(v) {
  if (typeof v !== 'string' || v.length > 254 || !EMAIL_RE.test(v.trim())) throw invalid('email', 'email debe ser un correo');
  const email = v.trim().toLowerCase();
  if (CORPORATE_EMAIL_DOMAIN && email.slice(email.lastIndexOf('@') + 1) !== CORPORATE_EMAIL_DOMAIN) {
    throw httpError(400, 'email_domain_not_allowed', `El correo tiene que ser de @${CORPORATE_EMAIL_DOMAIN}`);
  }
  return email;
}
const parseName = (v) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 100) throw invalid('display_name', 'display_name debe ser un texto de 1 a 100 caracteres');
  return v.trim();
};
const parseEmployment = (v) => {
  if (!EMPLOYMENTS.includes(v)) throw invalid('employment', 'employment debe ser employee o self_employed');
  return v;
};
const newToken = () => crypto.randomBytes(32).toString('base64url');

export async function getTrainer(client, id) {
  const { rows: [t] } = await client.query(
    `SELECT p.id, p.display_name, c.email, c.email_verified, COALESCE(c.has_password, false) AS has_password,
            c.disabled_at IS NOT NULL AS disabled, COALESCE(te.employment, 'self_employed') AS employment
       FROM profiles p JOIN user_roles r ON r.user_id = p.id AND r.role = 'profesor'
       JOIN auth_credentials c ON c.profile_id = p.id LEFT JOIN teacher_employment te ON te.profile_id = p.id
      WHERE p.id = $1`, [id]);
  if (!t) throw httpError(404, 'trainer_not_found', 'Profesor no encontrado');
  return t;
}

/** → { trainer, invite: { to, name, token } }: el token solo existe aquí y en el email. */
export async function createTrainer(client, { email, display_name: name, employment = 'self_employed' } = {}) {
  const e = parseEmail(email);
  const n = parseName(name);
  const emp = parseEmployment(employment);
  const id = crypto.randomUUID();
  const token = newToken();
  await call(client, `SELECT admin_create_trainer($1, $2, $3, $4, $5)`, [id, e, n, emp, sha256(token)]);
  return { trainer: await getTrainer(client, id), invite: { to: e, name: n, token } };
}

export async function inviteTrainer(client, { id }) {
  const token = newToken();
  await call(client, `SELECT create_trainer_invite($1, $2)`, [id, sha256(token)]);
  const { email, display_name: name } = await getTrainer(client, id);
  return { invite: { to: email, name, token } };
}

/** Nombre, tipo de relación y/o correo. Cambiar el correo anula contraseña y Google, cierra sesiones y reinvita. */
export async function updateTrainer(client, { id, body = {} }) {
  const { display_name: name, employment, email } = body;
  if (name === undefined && employment === undefined && email === undefined) {
    throw invalid('fields', 'fields debe contener display_name, employment o email');
  }
  const n = name === undefined ? null : parseName(name);
  const emp = employment === undefined ? null : parseEmployment(employment);
  const e = email === undefined ? null : parseEmail(email);
  if (n || emp) await call(client, `SELECT admin_update_trainer($1, $2, $3)`, [id, n, emp]);
  let invite = null;
  if (e) {
    const token = newToken();
    await call(client, `SELECT admin_set_trainer_email($1, $2, $3)`, [id, e, sha256(token)]);
    invite = { to: e, name: (await getTrainer(client, id)).display_name, token };
  }
  return { trainer: await getTrainer(client, id), invite };
}

export async function setTrainerDisabled(client, { id, disabled }) {
  await call(client, `SELECT admin_set_disabled($1, $2)`, [id, disabled]);
  // Después de marcarlo (con la fila bloqueada): si tiene clases o sesiones futuras, el throw deshace todo.
  if (disabled) await assertNoTrainerDuties(client, id);
  return { trainer: await getTrainer(client, id) };
}

/** Directo y no por el outbox (como recuperar contraseña): el outbox obligaría a guardar el token en claro. */
export function sendInvite({ to, name, token }) {
  const url = `${APP_URL}/reset-password?token=${token}&invite=1`;
  return send({
    to,
    ...mail('Te damos la bienvenida a Kaizen: elige tu contraseña', { payer: name }, [
      'La academia te ha dado de alta como profesor en Kaizen.',
      'Con este enlace eliges tu contraseña y entras. Vale durante 72 horas y una sola vez; si caduca, pide a administración que te lo reenvíe.',
    ], ['Elegir mi contraseña', url], 'Este es un email de servicio sobre tu cuenta en Kaizen.'),
    idempotencyKey: crypto.randomUUID(),
  }).catch((err) => console.error('[trainers] email de invitación:', err.message));
}
