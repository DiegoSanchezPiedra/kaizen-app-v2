// src/services/profile.js
import { appPool } from '../config/database.js';
import {
  AGREEMENT_TYPES,
  CURRENT_AGREEMENT_VERSIONS,
} from '../config/agreements.js';

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
 * Usa `appPool` + `withRlsContext`-style manual: abre transacción,
 * setea app.current_user_id y app.current_role, y todas las queries
 * van por el mismo `client`. Si el rol no es 'alumno', el helper no
 * aplica (los admins/profesores no necesitan health info para operar);
 * devuelve { ok: true } sin tocar BD.
 *
 * @param {string} profileId  UUID del perfil (req.user.id)
 * @param {string} role       Rol del JWT ('alumno' | 'profesor' | 'admin')
 * @returns {Promise<{ ok: boolean, missing?: string[] }>}
 */
export async function requireCompleteProfile(profileId, role) {
  if (!profileId) {
    const err = new Error('requireCompleteProfile: profileId requerido');
    err.status = 500;
    err.code = 'internal_error';
    throw err;
  }
  if (!role) {
    const err = new Error('requireCompleteProfile: role requerido');
    err.status = 500;
    err.code = 'internal_error';
    throw err;
  }

  // El helper solo aplica a alumnos. Admin/profesor operan sin health info.
  if (role !== 'alumno') {
    return { ok: true };
  }

  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL (con `true` = local a la transacción).
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true)`,
      [profileId]
    );
    await client.query(
      `SELECT set_config('app.current_role', $1, true)`,
      [role]
    );

    const missing = [];

    // 1. display_name
    const displayRes = await client.query(
      `SELECT display_name
         FROM profiles
        WHERE id = $1`,
      [profileId]
    );
    const displayName = displayRes.rows[0]?.display_name;
    if (!displayName || displayName.trim() === '') {
      missing.push('display_name');
    }

    // 2. health_info + emergency_contact
    const healthRes = await client.query(
      `SELECT emergency_contact_name, emergency_contact_phone
         FROM student_health_info
        WHERE profile_id = $1`,
      [profileId]
    );
    if (healthRes.rows.length === 0) {
      missing.push('health_info');
    } else {
      const h = healthRes.rows[0];
      if (!h.emergency_contact_name || !h.emergency_contact_phone) {
        missing.push('emergency_contact');
      }
    }

    // 3. agreements en versión vigente (una query, 3 tipos)
    const agreementRes = await client.query(
      `SELECT type
         FROM user_agreements
        WHERE profile_id = $1
          AND (type, version) = ANY (
            SELECT * FROM unnest($2::text[], $3::text[])
          )`,
      [
        profileId,
        AGREEMENT_TYPES,
        AGREEMENT_TYPES.map((t) => CURRENT_AGREEMENT_VERSIONS[t]),
      ]
    );
    const signedTypes = new Set(agreementRes.rows.map((r) => r.type));
    for (const type of AGREEMENT_TYPES) {
      if (!signedTypes.has(type)) {
        missing.push(type);
      }
    }

    await client.query('COMMIT');
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}