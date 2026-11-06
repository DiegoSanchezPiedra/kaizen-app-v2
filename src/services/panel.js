// src/services/panel.js — lecturas del panel admin (B19.1): ajustes, auditoría, avisos de la academia y entregas
// fallidas. Con el client RLS del admin. Nunca salud, edad ni fecha de nacimiento.
import { httpError } from '../lib/errors.js';
import { invalid } from './catalog.js';
import { dateParam } from './sessions.js';
import { pagination } from './reports.js';
import { getCheckinSettings } from './checkin.js';
import { getInsuranceSettings, getDisciplineChangeSettings } from './billing.js';
import { getProfileStats } from './users.js';

const TZ = 'Europe/Madrid';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Día de Madrid, ambos extremos incluidos (como el calendario y los informes).
const FROM_DAY = (p) => `($${p}::date IS NULL OR a.created_at >= $${p}::date::timestamp AT TIME ZONE '${TZ}')`;
const TO_DAY = (p) => `($${p}::date IS NULL OR a.created_at < ($${p}::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

const text = (v, field, max = 100) => {
  if (v !== undefined && (typeof v !== 'string' || !v || v.length > max)) throw invalid(field, `${field} debe ser un texto`);
  return v ?? null;
};

/** Los tres grupos de ajustes, tal cual los devuelven sus PUT. */
export async function getSettings(client) {
  return {
    checkin: await getCheckinSettings(client),
    insurance: await getInsuranceSettings(client),
    discipline_changes: await getDisciplineChangeSettings(client),
  };
}

/**
 * Auditoría sin avisos: `action` son prefijos separados por comas («session.,class.»), `from`/`to` días de Madrid.
 * Del más nuevo al más viejo.
 */
export async function listAudit(client, { action, actor_id: actorId, resource_type: type, resource_id: resourceId, from, to, ...page }) {
  const { limit, offset } = pagination(page);
  const prefixes = text(action, 'action', 200)?.split(',').filter(Boolean);
  if (action !== undefined && !prefixes.length) throw invalid('action', 'action debe tener algún prefijo');
  if (actorId !== undefined && !UUID_RE.test(actorId)) throw invalid('actor_id', 'actor_id inválido');
  const f = from === undefined ? null : dateParam(from, 'from');
  const t = to === undefined ? null : dateParam(to, 'to');
  if (f && t && t < f) throw httpError(400, 'invalid_range', 'to debe ser >= from');
  // starts_with, no LIKE: un `_` o `%` del prefijo no es un comodín.
  const where = `WHERE a.action NOT LIKE 'notice.%'
    AND ($1::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($1::text[]) p WHERE starts_with(a.action, p)))
    AND ($2::uuid IS NULL OR a.actor_id = $2) AND ($3::text IS NULL OR a.resource_type = $3)
    AND ($4::text IS NULL OR a.resource_id = $4) AND ${FROM_DAY(5)} AND ${TO_DAY(6)}`;
  const params = [prefixes ?? null, actorId ?? null, text(type, 'resource_type'), text(resourceId, 'resource_id'), f, t];
  const { rows } = await client.query(
    `SELECT a.id, a.created_at, a.action, jsonb_build_object('id', p.id, 'display_name', p.display_name) AS actor,
            a.resource_type, a.resource_id, a.changes
       FROM audit_log a LEFT JOIN profiles p ON p.id = a.actor_id
       ${where} ORDER BY a.created_at DESC, a.id LIMIT $7 OFFSET $8`, [...params, limit, offset]);
  const { rows: [{ total }] } = await client.query(`SELECT count(*)::int AS total FROM audit_log a ${where}`, params);
  return { rows, total, limit, offset };
}

/** Avisos de la academia: los `notice.*` con algún admin entre sus destinatarios; `details` es `changes` sin `recipients`. */
export async function listNotices(client, page) {
  const { limit, offset } = pagination(page);
  const where = `WHERE a.action LIKE 'notice.%' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(a.changes -> 'recipients', '[]')) r
        JOIN user_roles ur ON ur.user_id::text = r AND ur.role = 'admin')`;
  const { rows } = await client.query(
    `SELECT a.id, a.created_at, a.action, a.resource_type, a.resource_id, a.changes - 'recipients' AS details
       FROM audit_log a ${where} ORDER BY a.created_at DESC, a.id LIMIT $1 OFFSET $2`, [limit, offset]);
  const { rows: [{ total }] } = await client.query(`SELECT count(*)::int AS total FROM audit_log a ${where}`);
  return { rows, total, limit, offset };
}

/** Entregas fallidas (no se reintentan): `from` es un día de Madrid sobre created_at. */
export async function listFailedDeliveries(client, { from, ...page }) {
  const { limit, offset } = pagination(page);
  const params = [from === undefined ? null : dateParam(from, 'from')];
  const where = `WHERE d.status = 'failed'
    AND ($1::date IS NULL OR d.created_at >= $1::date::timestamp AT TIME ZONE '${TZ}')`;
  const { rows } = await client.query(
    `SELECT d.id, d.created_at, a.action, d.channel,
            jsonb_build_object('id', p.id, 'display_name', p.display_name) AS recipient, d.attempts, d.last_error
       FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id JOIN profiles p ON p.id = d.recipient_id
       ${where} ORDER BY d.created_at DESC, d.id LIMIT $2 OFFSET $3`, [...params, limit, offset]);
  const { rows: [{ total }] } = await client.query(`SELECT count(*)::int AS total FROM notice_deliveries d ${where}`, params);
  return { rows, total, limit, offset };
}

const HOME_SESSION = `SELECT s.id, s.starts_at, s.ends_at, jsonb_build_object('id', d.id, 'name', d.name) AS discipline,
         CASE WHEN tn.id IS NOT NULL THEN jsonb_build_object('id', tn.id, 'display_name', tn.display_name) END AS trainer,
         s.location, s.capacity, s.status,
         (SELECT count(*)::int FROM bookings b WHERE b.session_id = s.id AND b.status = 'confirmed') AS booked,
         (SELECT count(*)::int FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present
    FROM class_sessions s JOIN disciplines d ON d.id = s.discipline_id LEFT JOIN trainer_names tn ON tn.id = s.trainer_id`;
const MADRID_DAY = (offset) => `((now() AT TIME ZONE '${TZ}')::date + ${offset})::timestamp AT TIME ZONE '${TZ}'`;

/**
 * Inicio del admin (B23), en vivo: las cifras de ahora (academy_stats_now, solo admin), las de alumnos de Usuarios, las
 * asistencias de hoy y del mismo día de la semana pasada hasta esta misma hora, las sesiones de hoy con reservas y entradas, y la próxima
 * sesión programada que aún no ha empezado (para «Ahora» cuando no hay ninguna en curso).
 */
export async function getHome(client) {
  const { rows: [figures] } = await client.query(
    `SELECT active, past_due, unpaid, new_subscriptions, cancelled_subscriptions, mrr_cents FROM academy_stats_now()`);
  const students = await getProfileStats(client, {});
  const { rows: [attendance] } = await client.query(
    `SELECT count(*) FILTER (WHERE s.starts_at >= ${MADRID_DAY(0)} AND s.starts_at < ${MADRID_DAY(1)})::int AS today,
            count(*) FILTER (WHERE s.starts_at >= ${MADRID_DAY(-7)} AND s.starts_at < now() - interval '7 days')::int AS last_week
       FROM attendance a JOIN class_sessions s ON s.id = a.session_id
      WHERE a.status = 'present' AND s.status <> 'cancelled' AND s.starts_at >= ${MADRID_DAY(-7)}`);
  const { rows: sessions } = await client.query(
    `${HOME_SESSION} WHERE s.starts_at >= ${MADRID_DAY(0)} AND s.starts_at < ${MADRID_DAY(1)} ORDER BY s.starts_at, s.id`);
  const { rows: [next] } = await client.query(
    `${HOME_SESSION} WHERE s.status = 'scheduled' AND s.starts_at > now() ORDER BY s.starts_at, s.id LIMIT 1`);
  return { figures, students, attendance, sessions, next: next ?? null };
}
