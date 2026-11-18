// Crea (o reinvita) el primer admin del staging vaciado, con la invitación de 72 h de siempre (ADR 0028, kind 'invite'),
// sin enviar email: imprime el enlace. Uso: npm run staging:admin -- <email> "<Nombre>"
// Si el email ya existe sin contraseña ni Google, invalida las invitaciones vivas y crea otra. No toca a quien ya entra.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const fail = (msg) => { console.error(`staging:admin: ${msg}`); process.exit(1); };
const url = new URL(process.env.DATABASE_URL_SERVICE ?? 'x://');
if (url.pathname !== '/kaizen_staging' || url.port !== '5433') fail('DATABASE_URL_SERVICE no apunta a kaizen_staging (:5433): me niego');
const [emailArg, nameArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const name = nameArg?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || name.length > 100) fail('uso: npm run staging:admin -- <email> "<Nombre>"');

const token = randomBytes(32).toString('base64url');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
try {
  await db.query('BEGIN');
  const { rows: [c] } = await db.query(
    `SELECT c.profile_id, c.password_hash IS NOT NULL OR c.google_sub IS NOT NULL AS active,
            (SELECT array_agg(role::text) FROM user_roles WHERE user_id = c.profile_id) AS roles
       FROM auth_credentials c WHERE c.email = $1`, [email]);
  let id = c?.profile_id;
  if (c) {
    if (c.active) throw new Error('ese email ya tiene contraseña o Google: no se toca');
    if (!c.roles?.includes('admin') || c.roles.length > 1) throw new Error(`ese email existe con otro rol (${c.roles ?? 'ninguno'}): no se toca`);
  } else {
    id = randomUUID();
    await db.query(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [id, name]);
    await db.query(`INSERT INTO auth_credentials (profile_id, email, email_verified) VALUES ($1, $2, false)`, [id, email]);
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [id]);
  }
  await db.query(`UPDATE password_resets SET used_at = now() WHERE profile_id = $1 AND used_at IS NULL`, [id]);
  await db.query(
    `INSERT INTO password_resets (profile_id, token_hash, expires_at, kind) VALUES ($1, $2, now() + interval '72 hours', 'invite')`,
    [id, createHash('sha256').update(token).digest('hex')]);
  // actor_id es NOT NULL: el propio admin; solo ids, nunca el email.
  await db.query(
    `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes) VALUES (gen_random_uuid(), $1, $2, 'profile', $3, $4)`,
    [id, c ? 'profile.invite' : 'profile.create', id, { role: 'admin', via: 'staging:admin' }]);
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  fail(e.message);
} finally {
  await db.end();
}
console.log(`Invitación de admin para ${email} (vale 72 h, una vez):\n${process.env.APP_URL}/reset-password?token=${token}&invite=1`);
