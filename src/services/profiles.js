// src/services/profiles.js — perfil público y directorio (B13; CONTEXT § Perfil público y directorio, ADR 0010).
// Todo con el client RLS: lo ajeno se lee solo por la vista public_profiles, nunca por profiles ni servicePool.
import { httpError } from '../lib/errors.js';
import { invalid, audit } from './catalog.js';

export const VISIBLE_FIELDS = ['bio', 'social_links', 'disciplines', 'member_since'];
export const SOCIAL_NETWORKS = ['instagram', 'tiktok', 'youtube', 'web'];
const ROLES = ['alumno', 'profesor'];
const ID_RE = /^\d{1,18}$/;
const CARD = `SELECT id, display_name, role, bio, social_links, disciplines, member_since FROM public_profiles`;

const notFound = () => httpError(404, 'profile_not_found', 'Perfil no encontrado');
// Un campo oculto no aparece (la vista lo da NULL).
const card = (row) => {
  for (const k of VISIBLE_FIELDS) if (row[k] === null) delete row[k];
  return row;
};

/** Directorio: `{ profiles, total, limit, offset }`, por nombre. Los filtros miran solo lo que cada perfil enseña. */
export async function listPublicProfiles(client, { q, role, discipline_id: disciplineId, limit = 25, offset = 0 }) {
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) throw invalid('q', 'q debe ser un texto');
  if (role !== undefined && !ROLES.includes(role)) throw invalid('role', 'role debe ser alumno o profesor');
  if (disciplineId !== undefined && !ID_RE.test(String(disciplineId))) {
    throw invalid('discipline_id', 'discipline_id inválido');
  }
  const where = `WHERE ($1::text IS NULL OR display_name ILIKE '%' || $1 || '%')
                   AND ($2::text IS NULL OR role::text = $2)
                   AND ($3::bigint IS NULL OR disciplines @> jsonb_build_array(jsonb_build_object('id', $3::bigint)))`;
  const params = [q ? q.replace(/[\\%_]/g, '\\$&') : null, role ?? null, disciplineId ?? null];
  const { rows } = await client.query(`${CARD} ${where} ORDER BY display_name, id LIMIT $4 OFFSET $5`,
    [...params, limit, offset]);
  const { rows: [{ total }] } = await client.query(`SELECT count(*)::int AS total FROM public_profiles ${where}`, params);
  return { profiles: rows.map(card), total, limit, offset };
}

/** Ficha pública. Uno que no existe y uno que no es público dan el mismo 404. */
export async function getPublicProfile(client, id) {
  const { rows: [row] } = await client.query(`${CARD} WHERE id = $1`, [id]);
  if (!row) throw notFound();
  return card(row);
}

/** Lo guardado del propio perfil, con `eligible` (can_be_public, la regla de la vista) y los 4 flags siempre presentes. */
export async function getMyProfile(client, id) {
  const { rows: [row] } = await client.query(
    `SELECT COALESCE(is_public, false) AS is_public, can_be_public(id) AS eligible, visible_fields, bio, social_links
       FROM profiles WHERE id = $1`, [id]);
  if (!row) throw notFound();
  const flags = Object.fromEntries(VISIBLE_FIELDS.map((k) => [k, row.visible_fields?.[k] === true]));
  return { ...row, visible_fields: flags };
}

/** PATCH del propio perfil (body ya validado). `visible_fields` se fusiona con lo guardado. */
export async function updateMyProfile(client, id, body) {
  if (body.is_public === true && !(await getMyProfile(client, id)).eligible) {
    throw httpError(403, 'not_eligible', 'Este perfil no puede ser público');
  }
  const has = (k) => Object.hasOwn(body, k);
  await client.query(
    `UPDATE profiles SET
       is_public = COALESCE($2, is_public),
       visible_fields = COALESCE(visible_fields, '{}') || COALESCE($3::jsonb, '{}'),
       bio = CASE WHEN $4 THEN $5 ELSE bio END,
       social_links = CASE WHEN $6 THEN $7::jsonb ELSE social_links END
     WHERE id = $1`,
    [id, body.is_public ?? null, body.visible_fields ?? null, has('bio'), body.bio ?? null,
      has('social_links'), body.social_links ?? null]);
  return getMyProfile(client, id);
}

/** Despublicar (admin): `is_public = false` sin tocar el contenido. Idempotente; audita solo si cambia. */
export async function unpublishProfile(client, { id, actorId }) {
  const { rows: [row] } = await client.query(`SELECT is_public FROM profiles WHERE id = $1 FOR UPDATE`, [id]);
  if (!row) throw notFound();
  if (row.is_public) {
    await client.query(`UPDATE profiles SET is_public = false WHERE id = $1`, [id]);
    await audit(client, actorId, 'profile.unpublish', id, {});
  }
  return { id, is_public: false };
}
