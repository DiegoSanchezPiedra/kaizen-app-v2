// src/services/agreements.js
import crypto from 'node:crypto';
import { httpError } from '../lib/errors.js';
import { CURRENT_AGREEMENT_VERSIONS } from '../config/agreements.js';

/**
 * Versiones vigentes `{ [type]: version }`. Única fuente para rutas y servicios.
 * B4.5.1: consultará `agreement_documents` con `client`.
 */
export async function getCurrentVersions(client) { // eslint-disable-line no-unused-vars
  return CURRENT_AGREEMENT_VERSIONS;
}

/**
 * Firma un agreement en la versión vigente. 400 si tipo/versión inválidos,
 * 409 si ya estaba firmado.
 */
export async function signAgreement(client, { profileId, type, version, ip, userAgent }) {
  const versions = await getCurrentVersions(client);

  if (!type || !Object.hasOwn(versions, type)) {
    throw httpError(400, 'invalid_type', 'Tipo de agreement inválido', {
      allowed: Object.keys(versions),
    });
  }
  if (!version || version !== versions[type]) {
    throw httpError(400, 'invalid_version', 'Versión de agreement no vigente', {
      expected: versions[type],
    });
  }

  const result = await client.query(
    `INSERT INTO user_agreements
       (id, profile_id, type, version, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id, type, version) DO NOTHING
     RETURNING id, type, version, signed_at`,
    [crypto.randomUUID(), profileId, type, version, ip, userAgent]
  );

  if (result.rows.length === 0) {
    throw httpError(409, 'agreement_already_signed', 'Agreement ya firmado', { type, version });
  }
  return result.rows[0];
}
