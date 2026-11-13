// src/services/profiles.js — perfil público (B13; CONTEXT § Perfil público, ADR 0010).
// Todo con el client RLS: lo ajeno se lee solo por la vista public_profiles, nunca por profiles ni servicePool.
import { httpError } from '../lib/errors.js';
import { audit } from './catalog.js';

// B14: ranking no es columna de la ficha (decide salir en los rankings); achievements, NULL si no se enseña.
export const VISIBLE_FIELDS = ['bio', 'social_links', 'disciplines', 'member_since', 'ranking', 'achievements', 'photo'];
export const SOCIAL_NETWORKS = ['instagram', 'tiktok', 'youtube', 'web'];
const CARD = `SELECT id, display_name, role, bio, social_links, disciplines, member_since, achievements, avatar
                FROM public_profiles`;

const notFound = () => httpError(404, 'profile_not_found', 'Perfil no encontrado');
// Un campo oculto no aparece (la vista lo da NULL).
const card = (row) => {
  for (const k of [...VISIBLE_FIELDS, 'avatar']) if (row[k] === null) delete row[k]; // avatar: la columna del campo photo
  return row;
};

/** Ficha pública. Uno que no existe y uno que no es público dan el mismo 404. */
export async function getPublicProfile(client, id) {
  const { rows: [row] } = await client.query(`${CARD} WHERE id = $1`, [id]);
  if (!row) throw notFound();
  return card(row);
}

/** Lo guardado del propio perfil, con `eligible` (can_be_public, la regla de la vista) y los 6 flags siempre presentes. */
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
  const has = (k) => Object.hasOwn(body, k);
  // B32: su visibilidad y sus redes, desde la edad de consentimiento (minor_consent_age); antes, su tutor.
  if (has('is_public') || has('visible_fields') || has('social_links')) {
    const { rows: [p] } = await client.query(
      `SELECT birth_date > CURRENT_DATE - make_interval(years => minor_consent_age()) AS young FROM profiles WHERE id = $1`, [id]);
    if (p?.young) throw httpError(403, 'minor_restricted', 'Tu perfil público lo decide tu tutor');
  }
  if (body.is_public === true && !(await getMyProfile(client, id)).eligible) {
    throw httpError(403, 'not_eligible', 'Este perfil no puede ser público');
  }
  await client.query(
    `UPDATE profiles SET
       is_public = COALESCE($2, is_public),
       visible_fields = CASE WHEN $3::jsonb IS NULL THEN visible_fields ELSE COALESCE(visible_fields, '{}') || $3 END,
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
