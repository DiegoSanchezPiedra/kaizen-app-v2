import crypto from 'node:crypto';
import { appPool, servicePool } from '../config/database.js';
import { APP_URL } from '../config/stripe.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { verifyGoogleIdToken } from './google.js';
import { send } from './email.js';
import { mail } from './notices.js';

// ---------------------------------------------------------------------------
// Lectura de credenciales SOLO para login (sin JWT todavía).
// Única excepción documentada al uso de servicePool. Ver contexto §5.
// ---------------------------------------------------------------------------
export async function findCredentialsByEmail(email) {
  const { rows } = await servicePool.query(
    `SELECT profile_id, email, password_hash, google_sub, email_verified
       FROM auth_credentials
      WHERE email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

// Un email con una '@' y un punto en el dominio (la verificación de verdad es la del ADR 0021).
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// B32: el menor entra con el usuario que eligió su tutor (en minúsculas y sin '@': no se confunde con un email).
async function findCredentialsByUsername(username) {
  const { rows } = await servicePool.query(
    `SELECT profile_id, email, password_hash FROM auth_credentials WHERE username = $1`, [username.trim().toLowerCase()]);
  return rows[0] ?? null;
}

export async function findCredentialsByGoogleSub(googleSub) {
  const { rows } = await servicePool.query(
    `SELECT profile_id, email, password_hash, google_sub, email_verified
       FROM auth_credentials
      WHERE google_sub = $1`,
    [googleSub]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// createUser — camino único para registro local y alta nueva vía Google.
// Genera profileId ANTES de la transacción y hace set_config dentro de
// la misma transacción appPool para satisfacer RLS Fase 1.
// ---------------------------------------------------------------------------
async function createUser({ email, passwordHash, googleSub, displayName, birthDate = null }) {
  const profileId = crypto.randomUUID();
  try {
    await withRls({ uid: profileId, role: 'alumno' }, async (client) => {
      await client.query(
        `INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
        [profileId, displayName ?? null, birthDate]
      );
      await client.query(
        `INSERT INTO auth_credentials
           (profile_id, email, password_hash, google_sub, email_verified)
         VALUES ($1, $2, $3, $4, $5)`,
        [profileId, email, passwordHash, googleSub, googleSub ? true : false]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`,
        [profileId]
      );
    });
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('email')) {
      throw httpError(409, 'email_taken', 'email already registered');
    }
    throw err;
  }

  const token = signToken({ sub: profileId, role: 'alumno' });
  return {
    token,
    user: { id: profileId, email, role: 'alumno' },
  };
}

// Fecha real (YYYY-MM-DD) y no futura.
export function isValidPastDate(value) {
  const born = /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? new Date(value) : null;
  return !!born && !Number.isNaN(born.getTime()) && born.toISOString().slice(0, 10) === value && born <= new Date();
}

// Mismo criterio que el SQL (birth_date <= CURRENT_DATE - 18 años). Las fechas ISO se comparan como texto.
export function isAdultBirthDate(value) {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return value <= cutoff.toISOString().slice(0, 10);
}

export function assertStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw httpError(400, 'weak_password', 'password too short');
  }
}

// ---------------------------------------------------------------------------
// registerLocal — sigue firmando token; un registro nuevo no puede tener MFA.
// Solo adultos: a los hijos los da de alta su tutor (ADR 0002).
// ---------------------------------------------------------------------------
export async function registerLocal({ email, password, displayName, birthDate }) {
  if (!email || !password) {
    throw httpError(400, 'invalid_payload', 'email and password required');
  }
  if (!isValidPastDate(birthDate)) {
    throw httpError(400, 'invalid_birth_date', 'birthDate (YYYY-MM-DD, pasada) requerido');
  }
  if (!isAdultBirthDate(birthDate)) {
    throw httpError(400, 'minor_cannot_register', 'solo pueden registrarse mayores de 18');
  }
  assertStrongPassword(password);
  const existing = await findCredentialsByEmail(email);
  if (existing) {
    throw httpError(409, 'email_taken', 'email already registered');
  }
  const passwordHash = await hashPassword(password);
  return createUser({ email, passwordHash, googleSub: null, displayName, birthDate });
}

// ---------------------------------------------------------------------------
// loginLocal — CAMBIO: no firma token. Devuelve { profileId, email, role }
// para que la ruta decida (JWT normal vs mfa_token).
// ---------------------------------------------------------------------------
let dummy;
const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(16).toString('hex')));

export async function loginLocal({ email, password }) {
  if (typeof email !== 'string' || !email || !password) {
    throw httpError(400, 'invalid_payload', 'email and password required');
  }
  // `email`: el email o el usuario (B32).
  const cred = email.includes('@') ? await findCredentialsByEmail(email) : await findCredentialsByUsername(email);
  // B32: sin cuenta también se verifica (contra un hash fijo): el tiempo no dice si el email o el usuario existen.
  const ok = await verifyPassword(cred?.password_hash ?? await dummyHash(), password);
  if (!cred?.password_hash || !ok) {
    throw httpError(401, 'invalid_credentials', 'invalid credentials');
  }
  const { rows } = await servicePool.query(
    `SELECT (SELECT role FROM user_roles WHERE user_id = $1 ORDER BY id LIMIT 1) AS role, is_minor($1) AS minor`,
    [cred.profile_id]
  );
  const role = rows[0]?.role ?? 'alumno';
  return { profileId: cred.profile_id, email: cred.email, role, minor: rows[0].minor };
}

// ---------------------------------------------------------------------------
// loginGoogle — CAMBIO: no firma token. Devuelve { profileId, email, role }.
// ---------------------------------------------------------------------------
export async function loginGoogle({ idToken }) {
  if (!idToken) {
    throw httpError(400, 'invalid_payload', 'idToken required');
  }
  const payload = await verifyGoogleIdToken(idToken);
  const email = payload.email;
  const googleSub = payload.sub;
  if (!email || !googleSub) {
    throw httpError(400, 'invalid_google_token', 'token missing email/sub');
  }

  const bySub = await findCredentialsByGoogleSub(googleSub);
  if (bySub) {
    const { rows } = await servicePool.query(
      `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY id LIMIT 1`,
      [bySub.profile_id]
    );
    const role = rows[0]?.role ?? 'alumno';
    return { profileId: bySub.profile_id, email: bySub.email, role };
  }

  const byEmail = await findCredentialsByEmail(email);
  if (byEmail) {
    // El email existe con password local y sin google_sub → no vincular automáticamente
    throw httpError(
      409,
      'link_required',
      'email already registered with password; log in locally to link Google'
    );
  }

  // Alta nueva vía Google: reusamos createUser (que sí devuelve token+user).
  // La ruta descartará el token si MFA aplica (no aplica: usuario nuevo).
  // Para mantener la simetría de loginLocal/loginGoogle, extraemos los campos.
  const created = await createUser({
    email,
    passwordHash: null,
    googleSub,
    displayName: payload.name ?? null,
  });
  return {
    profileId: created.user.id,
    email: created.user.email,
    role: created.user.role,
  };
}
// ---------------------------------------------------------------------------
// Recuperar contraseña (B18.0, migración 025). Sin sesión: las funciones SQL son SECURITY DEFINER y el
// appPool (app_user) solo puede llamarlas. En la BD, solo el SHA-256 del token.
// ---------------------------------------------------------------------------
const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Nunca revela si el email existe: no lanza por eso ni espera al envío (ni el tiempo ni un fallo lo delatan). */
export async function requestPasswordReset(email) {
  if (typeof email !== 'string' || !email) return;
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows: [r] } = await appPool.query(`SELECT create_password_reset($1, $2) AS ok`, [email, sha256(token)]);
  if (!r.ok) return;
  const url = `${APP_URL}/reset-password?token=${token}`;
  // Directo y no por el outbox: este compone al enviar y obligaría a guardar el token en claro.
  send({
    to: email,
    ...mail('Recupera tu contraseña de Kaizen', {}, [
      'Alguien (esperamos que tú) ha pedido una contraseña nueva para tu cuenta de Kaizen.',
      'El enlace vale durante 1 hora y una sola vez. Si no lo has pedido tú, ignora este email: tu contraseña no cambia.',
    ], ['Elegir contraseña nueva', url], 'Este es un email de servicio sobre tu cuenta en Kaizen.'),
    idempotencyKey: crypto.randomUUID(),
  }).catch((err) => console.error('[auth] email de recuperar contraseña:', err.message));
}

export async function resetPassword({ token, password }) {
  if (typeof token !== 'string' || !token) {
    throw httpError(400, 'invalid_reset_token', 'token inválido, caducado o ya usado');
  }
  assertStrongPassword(password);
  const passwordHash = await hashPassword(password);
  const { rows: [r] } = await appPool.query(`SELECT consume_password_reset($1, $2) AS ok`, [sha256(token), passwordHash]);
  if (!r.ok) throw httpError(400, 'invalid_reset_token', 'token inválido, caducado o ya usado');
}

// ---------------------------------------------------------------------------
// Cambiar la contraseña con la sesión iniciada (B24, ADR 0020). Pide la actual; una cuenta solo con Google la crea con
// el email de restablecer (409 no_password). Cierra las demás sesiones: devuelve el iat (hora de la base) del token nuevo.
// ---------------------------------------------------------------------------
export async function changePassword(client, userId, { current_password: current, new_password: next } = {}) {
  for (const [field, v] of [['current_password', current], ['new_password', next]]) {
    if (typeof v !== 'string' || !v) throw httpError(400, 'invalid_field', `${field} es obligatorio`, { field });
  }
  // own_password_hash(): app_user no lee password_hash (B20, B9); la función da solo la propia.
  const { rows: [cred] } = await client.query(
    `SELECT email, own_password_hash() AS password_hash FROM auth_credentials WHERE profile_id = $1`, [userId]);
  if (!cred?.password_hash) throw httpError(409, 'no_password', 'la cuenta no tiene contraseña: créala con el email de restablecer');
  if (!(await verifyPassword(cred.password_hash, current))) throw httpError(400, 'wrong_password', 'la contraseña actual no es correcta');
  assertStrongPassword(next);
  const { rows: [r] } = await client.query(
    `UPDATE auth_credentials SET password_hash = $2, credentials_changed_at = date_trunc('second', now())
      WHERE profile_id = $1 RETURNING extract(epoch FROM credentials_changed_at)::bigint AS iat`,
    [userId, await hashPassword(next)]);
  await client.query(`SELECT write_audit($1, 'auth.password_change', 'profile', $2, '{}'::jsonb)`, [userId, userId]);
  return { iat: Number(r.iat), email: cred.email };
}

/** Aviso de seguridad tras el cambio; directo, como el de recuperar (un fallo de envío no deshace el cambio). */
export function sendPasswordChanged(email) {
  if (!email) return; // B32: un menor sin email
  send({
    to: email,
    ...mail('Tu contraseña de Kaizen ha cambiado', {}, [
      'La contraseña de tu cuenta de Kaizen se acaba de cambiar y se han cerrado las sesiones abiertas en otros dispositivos.',
      'Si no has sido tú, recupera el acceso ahora con «He olvidado mi contraseña» y escríbenos.',
    ], ['Recuperar el acceso', `${APP_URL}/forgot-password`], 'Este es un email de servicio sobre tu cuenta en Kaizen.'),
    idempotencyKey: crypto.randomUUID(),
  }).catch((err) => console.error('[auth] email de contraseña cambiada:', err.message));
}
