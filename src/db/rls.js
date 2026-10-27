// src/db/rls.js
import { appPool } from '../config/database.js';
import { httpError } from '../lib/errors.js';

/**
 * Transacción con contexto RLS (app.current_user_id / app.current_role).
 * `commit: false` fuerza ROLLBACK al final (tests).
 */
export async function withRls({ uid, role }, fn, { pool = appPool, commit = true } = {}) {
  if (!uid || !role) {
    throw httpError(500, 'rls_context_missing', 'uid and role required for RLS context');
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_role', $2, true)`,
      [uid, role],
    );
    const result = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client?.release();
  }
}
