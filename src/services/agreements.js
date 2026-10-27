// src/services/agreements.js
import crypto from 'node:crypto';
import { httpError } from '../lib/errors.js';
import { AGREEMENT_TYPES, VERSION_RE } from '../config/agreements.js';
import { saveFile, deleteFile } from './storage.js';

const CURRENT = 'published_at IS NOT NULL AND retired_at IS NULL';

/**
 * Versiones vigentes `{ [type]: version }`. Única fuente para rutas y servicios.
 * Un tipo sin documento publicado no aparece (nadie puede firmarlo).
 */
export async function getCurrentVersions(client) {
  const { rows } = await client.query(
    `SELECT type, version FROM agreement_documents WHERE ${CURRENT}`
  );
  return Object.fromEntries(rows.map((r) => [r.type, r.version]));
}

/** Documento vigente de un tipo (o undefined). */
export async function getCurrentDocument(client, type) {
  const { rows } = await client.query(
    `SELECT id, type, version, storage_path, mime_type FROM agreement_documents
      WHERE type = $1 AND ${CURRENT}`,
    [type]
  );
  return rows[0];
}

export async function listDocuments(client) {
  const { rows } = await client.query(
    `SELECT id, type, version, checksum, created_at, published_at, retired_at,
            CASE WHEN retired_at IS NOT NULL THEN 'retired'
                 WHEN published_at IS NOT NULL THEN 'published'
                 ELSE 'created' END AS status
       FROM agreement_documents ORDER BY type, created_at DESC`
  );
  return rows;
}

/** Sube un PDF como borrador. 400 si tipo/versión/PDF inválidos, 409 si (tipo, versión) existe. */
export async function createDocument(client, { type, version, buffer }) {
  if (!AGREEMENT_TYPES.includes(type)) {
    throw httpError(400, 'invalid_type', 'Tipo de agreement inválido', { allowed: AGREEMENT_TYPES });
  }
  if (!VERSION_RE.test(version ?? '')) {
    throw httpError(400, 'invalid_version', 'Versión inválida. Formato esperado: X.Y');
  }
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw httpError(400, 'invalid_file', 'Se esperaba un PDF (Content-Type: application/pdf)');
  }

  const id = crypto.randomUUID();
  const name = `${id}.pdf`;
  const checksum = await saveFile(name, buffer);
  try {
    const { rows } = await client.query(
      `INSERT INTO agreement_documents (id, type, version, storage_path, checksum)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, version) DO NOTHING
       RETURNING id, type, version, checksum, created_at`,
      [id, type, version, name, checksum]
    );
    if (rows.length === 0) {
      const { rows: [prev] } = await client.query(
        `SELECT checksum FROM agreement_documents WHERE type = $1 AND version = $2`,
        [type, version]
      );
      throw prev?.checksum === checksum
        ? httpError(409, 'duplicate_document', 'Documento ya subido', { type, version })
        : httpError(409, 'version_exists_different_content', 'La versión existe con otro contenido', { type, version });
    }
    return rows[0];
  } catch (err) {
    await deleteFile(name);
    throw err;
  }
}

/**
 * Publica un borrador: retira el vigente anterior del mismo tipo y audita.
 * 404 si no existe, 409 si ya estaba publicado o retirado.
 */
export async function publishDocument(client, { id, actorId }) {
  const { rows: [doc] } = await client.query(
    `SELECT id, type, version, published_at FROM agreement_documents WHERE id = $1 FOR UPDATE`,
    [id]
  );
  if (!doc) throw httpError(404, 'document_not_found', 'Documento no encontrado');
  if (doc.published_at) throw httpError(409, 'already_published', 'Documento ya publicado o retirado');

  // Serializa publicaciones concurrentes del mismo tipo (índice único parcial).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agreement:${doc.type}`]);
  const { rows: retired } = await client.query(
    `UPDATE agreement_documents SET retired_at = CURRENT_TIMESTAMP
      WHERE type = $1 AND ${CURRENT} RETURNING version`,
    [doc.type]
  );
  const { rows: [published] } = await client.query(
    `UPDATE agreement_documents SET published_at = CURRENT_TIMESTAMP, published_by = $2
      WHERE id = $1 RETURNING id, type, version, published_at`,
    [id, actorId]
  );
  await client.query(
    `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
     VALUES ($1, $2, 'agreement_document.publish', 'agreement_document', $3, $4)`,
    [crypto.randomUUID(), actorId, id, { type: doc.type, version: doc.version, retired: retired[0]?.version ?? null }]
  );
  return published;
}

/**
 * Firma un agreement en la versión vigente. 400 si tipo/versión inválidos,
 * 409 si ya estaba firmado.
 */
export async function signAgreement(client, { profileId, type, version, ip, userAgent }) {
  const versions = await getCurrentVersions(client);

  if (!AGREEMENT_TYPES.includes(type)) {
    throw httpError(400, 'invalid_type', 'Tipo de agreement inválido', {
      allowed: AGREEMENT_TYPES,
    });
  }
  if (!versions[type]) {
    throw httpError(409, 'no_current_document', 'No hay documento vigente para este tipo', { type });
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
