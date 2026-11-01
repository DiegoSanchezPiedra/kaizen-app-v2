// src/services/profile.js
import crypto from 'node:crypto';
import { httpError } from '../lib/errors.js';

/**
 * Estado del perfil completo de un alumno o tutor (CONTEXT § Perfil completo) y su cobertura de riesgo.
 *
 * Contrato:
 *   { ok: true, risk_cover?: boolean }
 *   | { ok: false, missing: string[], risk_cover?: boolean }
 *
 * `missing`: 'display_name', 'health_info', 'emergency_contact', 'data_protection', 'rights_of_image'
 * (función SQL profile_missing, la misma que usa la promoción). El `waiver` no cuenta: es cobertura de riesgo,
 * requisito aparte para reservar (B10.3); `risk_cover` solo sale para el alumno (un tutor no entrena).
 *
 * Recibe el `client` de la transacción RLS que abrió quien orquesta.
 * Admin y profesor siempre están completos: devuelve { ok: true } sin tocar BD.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} profileId  UUID del perfil (req.user.id)
 * @param {string} role       Rol del JWT ('alumno' | 'tutor' | 'profesor' | 'admin')
 * @returns {Promise<{ ok: boolean, missing?: string[], risk_cover?: boolean }>}
 */
export async function getProfileStatus(client, profileId, role) {
  if (!profileId) {
    throw httpError(500, 'internal_error', 'getProfileStatus: profileId requerido');
  }
  if (!role) {
    throw httpError(500, 'internal_error', 'getProfileStatus: role requerido');
  }

  // Solo aplica a alumnos y tutores. Admin/profesor operan sin health info.
  if (role !== 'alumno' && role !== 'tutor') {
    return { ok: true };
  }

  const { rows: [r] } = await client.query(
    `SELECT profile_missing($1) AS missing, has_risk_cover($1) AS risk_cover`, [profileId]);
  // Perfil inexistente (NULL): incompleto.
  const missing = r.missing ?? ['display_name'];

  // D11: el tutor solo necesita display_name + su propio data_protection.
  if (role === 'tutor') {
    const required = missing.filter((m) => TUTOR_REQUIRED.includes(m));
    return required.length === 0 ? { ok: true } : { ok: false, missing: required };
  }
  return missing.length === 0
    ? { ok: true, risk_cover: r.risk_cover }
    : { ok: false, missing, risk_cover: r.risk_cover };
}

const TUTOR_REQUIRED = ['display_name', 'data_protection'];

/** Mis datos (B18.0): la RLS deja leer el propio perfil y la propia fila de auth_credentials. */
export async function getMe(client, user) {
  const { rows } = await client.query(
    `SELECT p.id, $2::text AS role, p.display_name, c.email, p.birth_date::text AS birth_date,
            c.password_hash IS NOT NULL AS has_password
       FROM profiles p LEFT JOIN auth_credentials c ON c.profile_id = p.id
      WHERE p.id = $1`,
    [user.id, user.role]
  );
  if (!rows[0]) throw httpError(404, 'profile_not_found', 'Perfil no encontrado');
  return rows[0];
}

/** display_name y/o birth_date propios; birth_date solo si estaba vacía. Validar antes (adulto). */
export async function updateMe(client, id, { displayName, birthDate }) {
  const { rowCount } = await client.query(
    `UPDATE profiles SET display_name = COALESCE($2, display_name), birth_date = COALESCE($3::date, birth_date)
      WHERE id = $1 AND ($3::date IS NULL OR birth_date IS NULL)`,
    [id, displayName ?? null, birthDate ?? null]
  );
  if (!rowCount) throw httpError(409, 'birth_date_already_set', 'La fecha de nacimiento ya está puesta');
}

/** 403 si el usuario del contexto RLS no es tutor vigente (sujeto menor) de `profileId`. */
export async function assertGuardianOf(client, profileId) {
  const { rows } = await client.query(`SELECT is_guardian_of($1) AS ok`, [profileId]);
  if (!rows[0].ok) throw httpError(403, 'not_guardian', 'No eres tutor de este perfil');
}

// birth_date::text: pg convierte `date` a Date local y en JSON sale el día anterior en UTC.
const CHILD_COLUMNS = `id, display_name, birth_date::text AS birth_date, NOT is_guardian_of(id) AS pending_claim`;

/** Hijos del tutor, incluidos los que cumplieron 18 sin reclamar su perfil (pending_claim, D16). */
export async function listChildren(client, tutorId) {
  const { rows } = await client.query(
    `SELECT ${CHILD_COLUMNS}
       FROM guardianships g JOIN profiles p ON p.id = g.minor_id
      WHERE g.tutor_id = $1
      ORDER BY p.birth_date, p.id`,
    [tutorId]
  );
  return rows;
}

/** Alta de un hijo vinculado al usuario del contexto RLS (función SQL create_child). */
export async function createChild(client, { displayName, birthDate }) {
  const id = crypto.randomUUID();
  try {
    await client.query(`SELECT create_child($1, $2, $3)`, [id, displayName, birthDate]);
  } catch (err) {
    if (err.code === '22023') throw httpError(400, 'child_must_be_minor', 'El hijo debe ser menor de 18');
    if (err.code === '42501') throw httpError(403, 'minor_cannot_create_child', 'Solo un adulto puede dar de alta hijos');
    throw err;
  }
  const { rows } = await client.query(`SELECT ${CHILD_COLUMNS} FROM profiles WHERE id = $1`, [id]);
  return rows[0];
}

export const CHILD_FIELDS = ['display_name', 'birth_date'];

/** Edita display_name / birth_date de un hijo menor. Validar `fields` antes. */
export async function updateChild(client, id, fields) {
  const provided = CHILD_FIELDS.filter((k) => Object.hasOwn(fields, k));
  try {
    const { rows } = await client.query(
      `UPDATE profiles SET ${provided.map((k, i) => `${k} = $${i + 2}`).join(', ')}
        WHERE id = $1 AND is_guardian_of(id)
        RETURNING ${CHILD_COLUMNS}`,
      [id, ...provided.map((k) => fields[k])]
    );
    if (!rows[0]) throw httpError(404, 'child_not_found', 'Hijo no encontrado');
    return rows[0];
  } catch (err) {
    // 42501 = el WITH CHECK de profiles_update_guardian: la nueva fecha lo haría adulto.
    if (err.code === '42501') throw httpError(400, 'child_must_be_minor', 'El hijo debe ser menor de 18');
    throw err;
  }
}

export const HEALTH_FIELDS = [
  'injuries',
  'conditions',
  'previous_experience',
  'previous_discipline',
  'medication',
  'allergies',
  'emergency_contact_name',
  'emergency_contact_phone',
];

/** Ficha de salud (los campos de HEALTH_FIELDS) o null. Comprobar antes que es propia o de un hijo. */
export async function getHealthInfo(client, profileId) {
  const { rows } = await client.query(
    `SELECT profile_id, ${HEALTH_FIELDS.join(', ')}, updated_at FROM student_health_info WHERE profile_id = $1`,
    [profileId]
  );
  return rows[0] ?? null;
}

/**
 * Upsert de student_health_info: solo toca los campos presentes en `input`
 * (los nombres salen de HEALTH_FIELDS, nunca del input). Validar antes.
 */
export async function upsertHealthInfo(client, profileId, input) {
  const provided = HEALTH_FIELDS.filter((k) => Object.hasOwn(input, k));
  const columns = ['profile_id', ...provided];
  const result = await client.query(
    `INSERT INTO student_health_info (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (profile_id) DO UPDATE SET ${provided.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}
     RETURNING profile_id, ${HEALTH_FIELDS.join(', ')}, updated_at`,
    [profileId, ...provided.map((k) => input[k])]
  );
  return result.rows[0];
}
