import crypto from 'node:crypto';
import { appPool, servicePool } from '../config/database.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { verifyGoogleIdToken } from './google.js';

// ---------------------------------------------------------------------------
// Helpers de error
// ---------------------------------------------------------------------------
function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

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
async function createUser({ email, passwordHash, googleSub, displayName }) {
  const profileId = crypto.randomUUID();
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true)`,
      [profileId]
    );
    await client.query(
      `SELECT set_config('app.current_role', 'alumno', true)`
    );

    await client.query(
      `INSERT INTO profiles (id, display_name) VALUES ($1, $2)`,
      [profileId, displayName ?? null]
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
    await client.query('COMMIT');

    const token = signToken({ sub: profileId, role: 'alumno' });
    return {
      token,
      user: { id: profileId, email, role: 'alumno' },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // email duplicado
    if (err.code === '23505' && String(err.constraint || '').includes('email')) {
      throw httpError(409, 'email_taken', 'email already registered');
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// registerLocal
// ---------------------------------------------------------------------------
export async function registerLocal({ email, password, displayName }) {
  if (!email || !password) {
    throw httpError(400, 'invalid_payload', 'email and password required');
  }
  if (password.length < 8) {
    throw httpError(400, 'weak_password', 'password too short');
  }
  const existing = await findCredentialsByEmail(email);
  if (existing) {
    throw httpError(409, 'email_taken', 'email already registered');
  }
  const passwordHash = await hashPassword(password);
  return createUser({ email, passwordHash, googleSub: null, displayName });
}

// ---------------------------------------------------------------------------
// loginLocal
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
  const token = signToken({ sub: cred.profile_id, role });
  return {
    token,
    user: { id: cred.profile_id, email: cred.email, role },
  };
}

// ---------------------------------------------------------------------------
// loginGoogle
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
    const token = signToken({ sub: bySub.profile_id, role });
    return {
      token,
      user: { id: bySub.profile_id, email: bySub.email, role },
    };
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

  return createUser({
    email,
    passwordHash: null,
    googleSub,
    displayName: payload.name ?? null,
  });
}
