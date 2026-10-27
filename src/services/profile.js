// src/services/profile.js
import { httpError } from '../lib/errors.js';
import { getCurrentVersions } from './agreements.js';
import { AGREEMENT_TYPES as types } from '../config/agreements.js';

/**
 * Devuelve el estado de completitud del perfil de un alumno.
 *
 * Contrato:
 *   { ok: true }
 *   | { ok: false, missing: string[] }
 *
 * `missing` puede contener:
 *   - 'display_name'      → profiles.display_name vacío o NULL
 *   - 'health_info'       → no existe fila en student_health_info
 *   - 'emergency_contact' → falta emergency_contact_name o _phone
 *   - 'waiver' / 'data_protection' / 'rights_of_image'
 *                         → falta user_agreements en la versión vigente
 *
 * Reglas (ver §5 "Salud y consentimientos (B4.5)"):
 *   1. display_name no vacío.
 *   2. Fila en student_health_info con emergency_contact_name y
 *      emergency_contact_phone no nulos. El resto de campos clínicos
 *      puede estar vacío.
 *   3. user_agreements para CADA uno de los 3 tipos en su versión vigente.
 *
 * Recibe el `client` de la transacción RLS que abrió quien orquesta.
 * Si el rol no es 'alumno', el helper no aplica (los admins/profesores no necesitan health info para operar);
 * devuelve { ok: true } sin tocar BD.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} profileId  UUID del perfil (req.user.id)
 * @param {string} role       Rol del JWT ('alumno' | 'profesor' | 'admin')
 * @returns {Promise<{ ok: boolean, missing?: string[] }>}
 */
export async function getProfileStatus(client, profileId, role) {
  if (!profileId) {
    throw httpError(500, 'internal_error', 'getProfileStatus: profileId requerido');
  }
  if (!role) {
    throw httpError(500, 'internal_error', 'getProfileStatus: role requerido');
  }

  // El helper solo aplica a alumnos. Admin/profesor operan sin health info.
  if (role !== 'alumno') {
    return { ok: true };
  }

  const versions = await getCurrentVersions(client);

  const { rows } = await client.query(
    `SELECT p.display_name,
            h.profile_id IS NOT NULL AS has_health,
            h.emergency_contact_name,
            h.emergency_contact_phone,
            ARRAY(
              SELECT ua.type FROM user_agreements ua
               WHERE ua.profile_id = p.id
                 -- Adulto: solo firma propia. Menor: firma de un tutor (CONTEXT.md, firma por representación).
                 AND (ua.signed_by = p.id)
                     = (p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years')
                 AND (ua.type, ua.version) = ANY (
                   SELECT * FROM unnest($2::text[], $3::text[])
                 )
            ) AS signed
       FROM profiles p
       LEFT JOIN student_health_info h ON h.profile_id = p.id
      WHERE p.id = $1`,
    // Tipo sin vigente → versión NULL → nunca firmado: queda en `missing` (falla cerrado).
    [profileId, types, types.map((t) => versions[t] ?? null)]
  );
  const r = rows[0];

  const missing = [];
  if (!r?.display_name || r.display_name.trim() === '') missing.push('display_name');
  if (!r?.has_health) missing.push('health_info');
  else if (!r.emergency_contact_name || !r.emergency_contact_phone) missing.push('emergency_contact');
  for (const type of types) {
    if (!r?.signed.includes(type)) missing.push(type);
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
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
