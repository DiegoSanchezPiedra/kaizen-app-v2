// src/services/users.js — usuarios y roles del panel admin (B19.0; CONTEXT § Cambiar el rol, Tutor).
// Con el client RLS del admin. Nunca devuelve birth_date ni salud: de la edad, solo is_minor y pending_claim.
import { httpError } from '../lib/errors.js';
import { invalid, audit } from './catalog.js';
import { getProfileStatus } from './profile.js';
import { getMfaStatus, verifyMfaCode } from './mfa.js';
import { getSubscription, affectedSql } from './billing.js';

const LIVE = `('active', 'past_due', 'unpaid')`;
const ROLES = ['alumno', 'tutor', 'profesor', 'admin'];
const SETTABLE = ['alumno', 'tutor', 'profesor', 'admin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^\d{1,18}$/;
const STATES = ['activo', 'impago', 'inactivo', 'sin_plan'];

const MINOR = `COALESCE(p.birth_date > CURRENT_DATE - interval '18 years', false)`;
// Hijo que cumplió 18 sin acceso propio (D16). Un hijo es un perfil sin credenciales con algún tutor (ADR 0002).
const PENDING_CLAIM = `(c.profile_id IS NULL AND NOT ${MINOR}
                        AND EXISTS (SELECT 1 FROM guardianships g WHERE g.minor_id = p.id))`;
const FROM = `FROM profiles p LEFT JOIN auth_credentials c ON c.profile_id = p.id
              LEFT JOIN user_roles r ON r.user_id = p.id`;
const ROLE = `COALESCE(r.role::text, 'alumno')`;

const notFound = () => httpError(404, 'profile_not_found', 'Perfil no encontrado');
const conflict = (code, message) => httpError(409, code, message);

// Alumno de la disciplina $1 (NULL = cualquiera) por su suscripción viva.
// shortcut: copia la regla de covers() (migrations/058) pero sobre la suscripción viva (covers solo mira la en vigor y
// así un impagado no sería de ninguna disciplina); unificar en una función común la próxima vez que se migre covers.
const IN_DISCIPLINE = `($1::bigint IS NULL OR EXISTS (
  SELECT 1 FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id JOIN disciplines d ON d.id = $1 AND d.is_active
   WHERE s.student_id = p.id AND s.status IN ${LIVE}
     AND (NOT (p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years') OR NOT pl.minors_only)
     AND in_age_range(p.birth_date, NULL, d.max_age, now())
     AND (d.is_open OR CASE WHEN pl.max_disciplines IS NULL
            THEN NOT EXISTS (SELECT 1 FROM plan_disciplines pd WHERE pd.plan_id = pl.id)
              OR EXISTS (SELECT 1 FROM plan_disciplines pd WHERE pd.plan_id = pl.id AND pd.discipline_id = d.id)
            ELSE EXISTS (SELECT 1 FROM subscription_disciplines sd WHERE sd.subscription_id = s.id AND sd.discipline_id = d.id)
          END)))`;

// Cada perfil con su plan (suscripción viva), última asistencia y estado (solo alumnos), el más fuerte:
// impago (sale en Cobros › Morosos: CONTEXT § Moroso) > inactivo (en vigor sin asistencia en 14 días) > activo > sin plan.
const PEOPLE = `${affectedSql('true')},
  impago AS (SELECT DISTINCT a.student_id FROM affected a JOIN payers USING (payer_id)),
  -- Una sola agregación: por perfil (LATERAL), la RLS hacía estimar 1 sesión y recorría todas por cada perfil.
  la AS MATERIALIZED (SELECT a.student_id, max(cs.starts_at) AS at FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
          WHERE a.status = 'present' AND cs.status <> 'cancelled' GROUP BY 1),
  people AS (
    SELECT p.id, p.display_name, p.avatar, c.email, ${ROLE} AS role, ${MINOR} AS is_minor, ${PENDING_CLAIM} AS pending_claim,
           p.created_at, ls.status AS subscription_status, ls.plan_id, ls.plan_name, la.at AS last_attendance_at,
           CASE WHEN ${ROLE} <> 'alumno' THEN NULL
                WHEN p.id IN (SELECT student_id FROM impago) THEN 'impago'
                WHEN ls.status IN ('active', 'past_due')
                  THEN CASE WHEN la.at >= now() - interval '14 days' THEN 'activo' ELSE 'inactivo' END
                ELSE 'sin_plan' END AS estado
      ${FROM}
      LEFT JOIN LATERAL (SELECT s.status, s.plan_id, pl.name AS plan_name
                           FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
                          WHERE s.student_id = p.id AND s.status IN ${LIVE} ORDER BY s.created_at DESC LIMIT 1) ls ON true
      LEFT JOIN la ON la.student_id = p.id
     WHERE ${IN_DISCIPLINE})`;

const idParam = (field, v) => {
  if (v === undefined) return null;
  if (typeof v !== 'string' || !ID_RE.test(v)) throw invalid(field, `${field} debe ser un id`);
  return v;
};

/**
 * Lista con búsqueda en nombre y email y filtros de rol, disciplina, plan y estado: `{ profiles, total, limit, offset }`,
 * por nombre. `estado=activo` incluye a los inactivos (son un subconjunto, como en los KPIs).
 */
export async function listProfiles(client, { q, role, discipline_id: disciplineId, plan_id: planId, estado, limit = 25, offset = 0 }) {
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) throw invalid('q', 'q debe ser un texto');
  if (role !== undefined && !ROLES.includes(role)) throw invalid('role', 'role debe ser alumno, tutor, profesor o admin');
  if (estado !== undefined && !STATES.includes(estado)) {
    throw invalid('estado', 'estado debe ser activo, impago, inactivo o sin_plan');
  }
  const where = `WHERE ($2::text IS NULL OR display_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
                   AND ($3::text IS NULL OR role = $3) AND ($4::bigint IS NULL OR plan_id = $4)
                   AND ($5::text IS NULL OR estado = $5 OR ($5 = 'activo' AND estado = 'inactivo'))`;
  const params = [idParam('discipline_id', disciplineId), q ? q.replace(/[\\%_]/g, '\\$&') : null, role ?? null,
    idParam('plan_id', planId), estado ?? null];
  const { rows } = await client.query(
    `WITH ${PEOPLE}
     SELECT id, display_name, avatar, email, role, is_minor, pending_claim, created_at, subscription_status, plan_id, plan_name,
            estado, last_attendance_at, count(*) OVER ()::int AS total
       FROM people ${where}
      ORDER BY display_name, id LIMIT $6 OFFSET $7`, [...params, limit, offset]);
  // Página fuera de rango: sin filas no llega el total de la ventana, se cuenta aparte.
  const total = rows[0]?.total ?? (offset === 0 ? 0
    : (await client.query(`WITH ${PEOPLE} SELECT count(*)::int AS total FROM people ${where}`, params)).rows[0].total);
  for (const r of rows) delete r.total;
  return { profiles: rows, total, limit, offset };
}

/** KPIs de Usuarios, solo alumnos: activos (en vigor y sin impago), impago e inactivos (subconjunto de activos). */
export async function getProfileStats(client, { discipline_id: disciplineId }) {
  const { rows: [stats] } = await client.query(
    `WITH ${PEOPLE}
     SELECT count(*) FILTER (WHERE estado IN ('activo', 'inactivo'))::int AS activos,
            count(*) FILTER (WHERE estado = 'impago')::int AS impago,
            count(*) FILTER (WHERE estado = 'inactivo')::int AS inactivos
       FROM people WHERE role = 'alumno'`, [idParam('discipline_id', disciplineId)]);
  return stats;
}

async function profileRow(client, id) {
  const { rows: [row] } = await client.query(
    `SELECT p.id, p.display_name, p.avatar, c.email, ${ROLE} AS role, p.created_at, ${MINOR} AS is_minor,
            ${PENDING_CLAIM} AS pending_claim, COALESCE(p.is_public, false) AS is_public,
            COALESCE(c.has_password, false) AS has_password,
            COALESCE(c.google_sub IS NOT NULL, false) AS has_google,
            COALESCE(c.can_create_children, false) AS can_create_children
       ${FROM} WHERE p.id = $1`, [id]);
  if (!row) throw notFound();
  return row;
}

async function listGuardians(client, minorId) {
  const { rows } = await client.query(
    `SELECT p.id, p.display_name, c.email
       FROM guardianships g JOIN profiles p ON p.id = g.tutor_id LEFT JOIN auth_credentials c ON c.profile_id = p.id
      WHERE g.minor_id = $1 ORDER BY p.display_name, p.id`, [minorId]);
  return rows;
}

const orNull = (promise, code) => promise.catch((err) => {
  if (err.code === code) return null;
  throw err;
});

async function payerOf(client, id) {
  const { rows: [payer] } = await client.query(
    `SELECT p.id, p.display_name FROM subscriptions t JOIN profiles p ON p.id = t.payer_id WHERE t.id = $1`, [id]);
  return payer;
}

/** Ficha: datos, estado del perfil (solo alumno), familia y cuota con su pagador. */
export async function getProfile(client, { id }) {
  const profile = await profileRow(client, id);
  const { rows: children } = await client.query(
    `SELECT p.id, p.display_name, ${PENDING_CLAIM} AS pending_claim
       FROM guardianships g JOIN profiles p ON p.id = g.minor_id LEFT JOIN auth_credentials c ON c.profile_id = p.id
      WHERE g.tutor_id = $1 ORDER BY p.display_name, p.id`, [id]);
  const subscription = await orNull(getSubscription(client, { studentId: id }), 'subscription_not_found');
  if (subscription) subscription.payer = await payerOf(client, subscription.id);
  return {
    profile,
    status: profile.role === 'alumno' ? await getProfileStatus(client, id, 'alumno') : null,
    guardians: await listGuardians(client, id),
    children,
    subscription,
  };
}

/**
 * Cambiar el rol entre alumno, tutor y profesor, o dar el de admin (CONTEXT § Cambiar el rol). Vale al momento
 * (requireAuth). Dar admin exige el doble factor del admin activado, una sesión que entró con él (mfaSession: un token
 * robado de antes de activarlo no basta) y su código en esta petición (B20, B3). Quitar admin no se hace desde la app.
 */
export async function changeRole(client, { id, role, actorId, mfaSession, mfaCode }) {
  if (!SETTABLE.includes(role)) throw invalid('role', 'role debe ser alumno, tutor, profesor o admin');
  const { rows: [p] } = await client.query(
    `SELECT ${ROLE} AS role, c.profile_id IS NOT NULL AND NOT ${MINOR} AS has_access ${FROM} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
  if (!p) throw notFound();
  if (p.role === 'admin') throw conflict('admin_role_locked', 'El rol admin no se quita desde la app');
  if (!p.has_access) throw conflict('child_role_locked', 'Un hijo siempre es alumno');
  if (p.role === role) throw conflict('same_role', 'El perfil ya tiene ese rol');
  if (p.role === 'profesor') {
    // Como la baja de un profesor: ni profesor habitual de una clase no retirada ni de una sesión futura.
    const { rows: [busy] } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM classes WHERE trainer_id = $1 AND (ends_on IS NULL OR ends_on >= CURRENT_DATE))
           OR EXISTS (SELECT 1 FROM class_sessions WHERE trainer_id = $1 AND starts_at > now() AND status <> 'cancelled')
           AS busy`, [id]);
    if (busy.busy) throw conflict('trainer_has_sessions', 'Es profesor de clases o sesiones futuras: reasígnalas antes');
  }
  if (p.role === 'alumno') {
    const { rows: [live] } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM subscriptions WHERE student_id = $1 AND status IN ${LIVE}) AS live`, [id]);
    if (live.live) throw conflict('student_has_subscription', 'Tiene una suscripción viva');
  }
  // El código, lo último: si algo más falla, no se ha probado (un código de recuperación no se gasta sin dar el rol).
  if (role === 'admin') {
    if (!(await getMfaStatus(client, actorId)).enabled) {
      throw httpError(403, 'mfa_required', 'Activa el doble factor para dar el rol de admin');
    }
    if (!mfaSession) throw httpError(403, 'mfa_login_required', 'Vuelve a entrar con el doble factor para dar el rol de admin');
    if (!(await verifyMfaCode(client, actorId, mfaCode))) throw httpError(403, 'invalid_mfa_code', 'El código no es correcto');
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`, [id, role]);
  await audit(client, actorId, 'profile.role_change', id, { from: p.role, to: role });
  return { profile: await profileRow(client, id) };
}

/** PUT /admin/profiles/:id/can-create-children { enabled } → { profile } (audit_log profile.can_create_children, en SQL). */
export async function setCanCreateChildren(client, { id, enabled }) {
  if (typeof enabled !== 'boolean') throw invalid('enabled', 'enabled debe ser booleano');
  try {
    await client.query(`SELECT set_can_create_children($1, $2)`, [id, enabled]);
  } catch (err) {
    if (err.code === 'P0002') throw notFound();
    throw err;
  }
  return { profile: await profileRow(client, id) };
}

// El sujeto de los tutores es un hijo: un perfil sin acceso propio.
async function lockChild(client, id) {
  const { rows: [p] } = await client.query(
    `SELECT c.profile_id IS NOT NULL AS has_access ${FROM} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
  if (!p) throw notFound();
  if (p.has_access) throw conflict('not_a_child', 'El perfil no es un hijo');
}

/** Vincular a un hijo cualquier adulto con acceso propio. */
export async function addGuardian(client, { id, tutorId, actorId }) {
  if (typeof tutorId !== 'string' || !UUID_RE.test(tutorId)) throw invalid('tutor_id', 'tutor_id debe ser un uuid');
  await lockChild(client, id);
  const { rows: [t] } = await client.query(
    `SELECT 1 ${FROM} WHERE p.id = $1 AND c.profile_id IS NOT NULL AND NOT ${MINOR}`, [tutorId]);
  if (!t) throw conflict('invalid_guardian', 'El tutor debe ser un adulto con acceso propio');
  const { rowCount } = await client.query(
    `INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [tutorId, id]);
  if (!rowCount) throw conflict('already_guardian', 'Ya es tutor de este hijo');
  await audit(client, actorId, 'guardian.add', id, { tutor_id: tutorId });
  return { status: 201, body: { guardians: await listGuardians(client, id) } };
}

/** Desvincular: nunca el último tutor ni quien paga la suscripción viva del hijo. */
export async function removeGuardian(client, { id, tutorId, actorId }) {
  await lockChild(client, id);
  const { rows: [g] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM guardianships WHERE minor_id = $1 AND tutor_id = $2) AS linked,
            (SELECT count(*)::int FROM guardianships WHERE minor_id = $1) AS n,
            EXISTS (SELECT 1 FROM subscriptions WHERE student_id = $1 AND payer_id = $2 AND status IN ${LIVE}) AS payer`,
    [id, tutorId]);
  if (!g.linked) throw httpError(404, 'profile_not_found', 'No es tutor de este hijo');
  if (g.n <= 1) throw conflict('last_guardian', 'El hijo se quedaría sin tutores');
  if (g.payer) throw conflict('guardian_is_payer', 'Paga la suscripción del hijo: cambia antes el pagador');
  await client.query(`DELETE FROM guardianships WHERE minor_id = $1 AND tutor_id = $2`, [id, tutorId]);
  await audit(client, actorId, 'guardian.remove', id, { tutor_id: tutorId });
  return { status: 204, body: undefined };
}
