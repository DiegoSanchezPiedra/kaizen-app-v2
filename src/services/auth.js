// src/services/auth.js
import { appPool } from '../config/database.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { verifyGoogleIdToken } from './google.js';

// Crea profile + auth_credentials + user_roles en una transacción
async function createUser({ email, passwordHash, googleSub, displayName, emailVerified = false }) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');

    const profileId = crypto.randomUUID();

    await client.query(
      `INSERT INTO profiles (id, display_name) VALUES ($1, $2)`,
      [profileId, displayName || email.split('@')[0]]
    );

    await client.query(
      `INSERT INTO auth_credentials (profile_id, email, password_hash, google_sub, email_verified)
       VALUES ($1, $2, $3, $4, $5)`,
      [profileId, email.toLowerCase(), passwordHash, googleSub, emailVerified]
    );

    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`,
      [profileId]
    );

    await client.query('COMMIT');
    return { id: profileId, email: email.toLowerCase(), role: 'alumno' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findCredentialsByEmail(email) {
  const { rows } = await appPool.query(
    `SELECT ac.profile_id, ac.email, ac.password_hash, ac.google_sub,
            ur.role
     FROM auth_credentials ac
     JOIN user_roles ur ON ur.user_id = ac.profile_id
     WHERE ac.email = $1`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function findCredentialsByGoogleSub(sub) {
  const { rows } = await appPool.query(
    `SELECT ac.profile_id, ac.email, ac.password_hash, ac.google_sub,
            ur.role
     FROM auth_credentials ac
     JOIN user_roles ur ON ur.user_id = ac.profile_id
     WHERE ac.google_sub = $1`,
    [sub]
  );
  return rows[0] || null;
}

export async function registerLocal({ email, password, displayName }) {
  if (!email || !password) {
    throw Object.assign(new Error('email y password obligatorios'), { status: 400 });
  }
  if (password.length < 8) {
    throw Object.assign(new Error('password mínimo 8 caracteres'), { status: 400, code: 'weak_password' });
  }

  const existing = await findCredentialsByEmail(email);
  if (existing) {
    throw Object.assign(new Error('email ya registrado'), { status: 409, code: 'email_taken' });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash, displayName });
  const token = signToken({ sub: user.id, role: user.role });
  return { token, user };
}

export async function loginLocal({ email, password }) {
  const creds = await findCredentialsByEmail(email);
  if (!creds || !creds.password_hash) {
    throw Object.assign(new Error('credenciales inválidas'), { status: 401, code: 'invalid_credentials' });
  }
  const ok = await verifyPassword(creds.password_hash, password);
  if (!ok) {
    throw Object.assign(new Error('credenciales inválidas'), { status: 401, code: 'invalid_credentials' });
  }
  const token = signToken({ sub: creds.profile_id, role: creds.role });
  return { token, user: { id: creds.profile_id, email: creds.email, role: creds.role } };
}

export async function loginGoogle({ idToken }) {
  const g = await verifyGoogleIdToken(idToken);

  // 1. Ya vinculado por google_sub → login
  const bySub = await findCredentialsByGoogleSub(g.sub);
  if (bySub) {
    const token = signToken({ sub: bySub.profile_id, role: bySub.role });
    return { token, user: { id: bySub.profile_id, email: bySub.email, role: bySub.role } };
  }

  // 2. Email existe sin google_sub → NO vincular automáticamente
  const byEmail = await findCredentialsByEmail(g.email);
  if (byEmail) {
    throw Object.assign(
      new Error('Ya existe una cuenta con este email. Inicia sesión con tu contraseña y vincula Google desde tu perfil.'),
      { status: 409, code: 'link_required' }
    );
  }

  // 3. Usuario nuevo → crear con password_hash NULL
  const user = await createUser({
    email: g.email,
    passwordHash: null,
    googleSub: g.sub,
    emailVerified: g.emailVerified,
  });
  const token = signToken({ sub: user.id, role: user.role });
  return { token, user };
}