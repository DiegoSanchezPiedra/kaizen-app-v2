import crypto from 'node:crypto';
import { servicePool } from '../config/database.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { verifyGoogleIdToken } from './google.js';

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

// ---------------------------------------------------------------------------
// registerLocal — SIN CAMBIOS (sigue firmando token; un registro nuevo
// no puede tener MFA).
// ---------------------------------------------------------------------------
export async function registerLocal({ email, password, displayName, birthDate }) {
  if (!email || !password) {
    throw httpError(400, 'invalid_payload', 'email and password required');
  }
  // Fecha real y pasada; el menor lo determina getProfileStatus.
  const born = /^\d{4}-\d{2}-\d{2}$/.test(birthDate ?? '') ? new Date(birthDate) : null;
  if (!born || Number.isNaN(born.getTime()) || born.toISOString().slice(0, 10) !== birthDate || born > new Date()) {
    throw httpError(400, 'invalid_birth_date', 'birthDate (YYYY-MM-DD, pasada) requerido');
  }
  if (password.length < 8) {
    throw httpError(400, 'weak_password', 'password too short');
  }
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
export async function loginLocal({ email, password }) {
  if (!email || !password) {
    throw httpError(400, 'invalid_payload', 'email and password required');
  }
  const cred = await findCredentialsByEmail(email);
  if (!cred || !cred.password_hash) {
    throw httpError(401, 'invalid_credentials', 'invalid credentials');
  }
  const ok = await verifyPassword(cred.password_hash, password);
  if (!ok) {
    throw httpError(401, 'invalid_credentials', 'invalid credentials');
  }
  const { rows } = await servicePool.query(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY id LIMIT 1`,
    [cred.profile_id]
  );
  const role = rows[0]?.role ?? 'alumno';
  return { profileId: cred.profile_id, email: cred.email, role };
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