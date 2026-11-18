// src/services/communiques.js — comunicados del admin (ADR 0030; CONTEXT § Avisos, «Comunicado»).
// Los destinatarios se fijan al enviar: una fila en communique_views por persona (ventana en la app) y, por email, una
// entrega por persona en el outbox (notice(), ADR 0008). Escribe el servicePool: notice_recipients() y notice_deliveries
// no son del app_user; la ruta ya exige el rol admin. El usuario lee y marca los suyos con su client RLS.
import { servicePool } from '../config/database.js';
import { httpError } from '../lib/errors.js';
import { invalid } from './catalog.js';
import { notice } from './notices.js';
import { pagination } from './reports.js';
import { IN_DISCIPLINE } from './users.js';

const AUDIENCES = ['all', 'members', 'trainers'];
const CHANNELS = ['app', 'email', 'whatsapp'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^\d{1,18}$/;
export const WINDOW_DAYS = 30;

// Por persona: app (tiene cuenta) y email (además email y adulto: al hijo con acceso solo le sale la ventana).
// Socios = alumnos con suscripción en vigor; cada uno cuenta como notice_recipients(): sus tutores y él si tiene acceso.
// La regla de disciplina es la de Usuarios (IN_DISCIPLINE, con $1 por cada disciplina pedida).
const AUDIENCE_SQL = `
  WITH members AS (
    SELECT p.id FROM profiles p
     WHERE $1 = 'members'
       AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.student_id = p.id AND s.status IN ('active', 'past_due'))
       AND ($2::bigint[] IS NULL
            OR EXISTS (SELECT 1 FROM unnest($2::bigint[]) x(did) WHERE ${IN_DISCIPLINE.replaceAll('$1', 'x.did')}))),
  people AS (
    SELECT unnest(notice_recipients(id, 'notice.communique')) AS id FROM members
    UNION SELECT user_id FROM user_roles WHERE $1 = 'trainers' AND role = 'profesor'
    UNION SELECT profile_id FROM auth_credentials WHERE $1 = 'all')
  SELECT c.profile_id AS id, c.email IS NOT NULL AND NOT is_minor(c.profile_id) AS email
    FROM people JOIN auth_credentials c ON c.profile_id = people.id
   WHERE c.disabled_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = c.profile_id AND r.role = 'admin')`;

function parseAudience({ audience, discipline_ids: ids }) {
  if (!AUDIENCES.includes(audience)) throw invalid('audience', 'Elige a quién va');
  if (ids === undefined || ids === null || ids === '' || (Array.isArray(ids) && ids.length === 0)) return { audience, ids: null };
  // En la query string llegan como "1,2".
  const list = typeof ids === 'string' ? ids.split(',') : ids;
  if (audience !== 'members' || !Array.isArray(list) || list.length > 50 || !list.every((v) => ID_RE.test(String(v)))) {
    throw invalid('discipline_ids', 'Las disciplinas no son válidas');
  }
  return { audience, ids: list.map(String) };
}

const audienceOf = async (db, { audience, ids }) => (await db.query(AUDIENCE_SQL, [audience, ids])).rows;

/** Vista previa: cuántos verán la ventana y cuántos recibirán el email. */
export async function countAudience(query) {
  const rows = await audienceOf(servicePool, parseAudience(query));
  return { app: rows.length, email: rows.filter((r) => r.email).length };
}

const text = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max;

/** Envía un comunicado: fija los destinatarios y encola los emails, todo en una transacción. */
export async function createCommunique(adminId, body = {}) {
  if (!text(body.title, 80)) throw invalid('title', 'El título es obligatorio y tiene como mucho 80 caracteres');
  if (!text(body.body, 1000)) throw invalid('body', 'El texto es obligatorio y tiene como mucho 1000 caracteres');
  const { channels } = body;
  if (!Array.isArray(channels) || !channels.length || !channels.every((c) => CHANNELS.includes(c))
      || new Set(channels).size !== channels.length) {
    throw invalid('channels', 'Elige al menos un canal');
  }
  const aud = parseAudience(body);
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    const people = channels.some((c) => c !== 'whatsapp') ? await audienceOf(db, aud) : [];
    const app = channels.includes('app') ? people.map((r) => r.id) : [];
    const email = channels.includes('email') ? people.filter((r) => r.email).map((r) => r.id) : [];
    const { rows: [c] } = await db.query(
      `INSERT INTO communiques (title, body, audience, discipline_ids, channels, app_count, email_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [body.title.trim(), body.body.trim(), aud.audience, aud.ids, channels, app.length, email.length, adminId]);
    await db.query(
      `INSERT INTO communique_views (communique_id, profile_id) SELECT $1, unnest($2::uuid[])`, [c.id, app]);
    if (email.length) {
      await notice(db, { action: 'notice.communique', actorId: adminId, type: 'communique', resourceId: c.id, recipients: email });
    }
    await db.query('COMMIT');
    return { ...c, seen: 0 };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Historial del admin (client RLS), del más reciente al más antiguo, con cuántos han visto la ventana. */
export async function listCommuniques(client, page) {
  const { limit, offset } = pagination(page);
  const { rows } = await client.query(
    `SELECT c.*, (SELECT count(*)::int FROM communique_views v WHERE v.communique_id = c.id AND v.seen_at IS NOT NULL) AS seen,
            count(*) OVER ()::int AS total
       FROM communiques c ORDER BY c.created_at DESC, c.id LIMIT $1 OFFSET $2`, [limit, offset]);
  const total = rows[0]?.total ?? (await client.query('SELECT count(*)::int AS total FROM communiques')).rows[0].total;
  for (const r of rows) delete r.total;
  return { rows, total, limit, offset };
}

/** Retirar: la ventana deja de salir y los emails aún pendientes se saltan. Lo ya enviado no se deshace. */
export async function withdrawCommunique(adminId, id) {
  if (!UUID_RE.test(String(id))) throw httpError(404, 'communique_not_found', 'Comunicado no encontrado');
  const db = await servicePool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [c] } = await db.query('SELECT withdrawn_at FROM communiques WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw httpError(404, 'communique_not_found', 'Comunicado no encontrado');
    if (c.withdrawn_at) throw httpError(409, 'communique_withdrawn', 'Este comunicado ya está retirado');
    const { rows: [row] } = await db.query(
      `UPDATE communiques SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1 RETURNING withdrawn_at`, [id, adminId]);
    await db.query(
      `UPDATE notice_deliveries d SET status = 'skipped', last_error = 'withdrawn'
         FROM audit_log a
        WHERE a.id = d.audit_id AND a.action = 'notice.communique' AND a.resource_id = $1 AND d.status = 'pending'`, [id]);
    await db.query('COMMIT');
    return { withdrawn_at: row.withdrawn_at };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Ventanas pendientes del usuario (client RLS): sin ver, no retiradas y de menos de 30 días; la más antigua primero. */
export async function pendingFor(client) {
  const { rows } = await client.query(
    `SELECT c.id, c.title, c.body, c.created_at
       FROM communique_views v JOIN communiques c ON c.id = v.communique_id
      WHERE v.profile_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid AND v.seen_at IS NULL
        AND c.withdrawn_at IS NULL AND 'app' = ANY (c.channels)
        AND c.created_at > now() - interval '${WINDOW_DAYS} days'
      ORDER BY c.created_at, c.id`);
  return { communiques: rows };
}

/** «Entendido»: marca la ventana como vista (idempotente; la RLS solo deja la propia). */
export async function markSeen(client, { id } = {}) {
  if (!UUID_RE.test(String(id))) throw invalid('id', 'Comunicado no válido');
  const { rowCount } = await client.query(
    `UPDATE communique_views SET seen_at = COALESCE(seen_at, now())
      WHERE communique_id = $1 AND profile_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid`, [id]);
  if (!rowCount) throw httpError(404, 'communique_not_found', 'Comunicado no encontrado');
  return { status: 204, body: null };
}
