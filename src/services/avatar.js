// src/services/avatar.js — foto de perfil (B24, ADR 0019). El fichero vive en disco con un nombre de 32 bytes
// aleatorios; profiles.avatar guarda ese nombre. Cambiar o quitar la foto borra el fichero viejo, después de confirmar
// el cambio en la base (si la transacción falla, el viejo sigue sirviendo y el nuevo queda huérfano, nunca al revés).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AVATARS_STORAGE_PATH } from '../config/storage.js';
import { httpError } from '../lib/errors.js';
import { servicePool } from '../config/database.js';
import { notice } from './notices.js';

export const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const AVATAR_MAX_BYTES = 1024 * 1024;
const NAME_RE = /^[0-9a-f]{64}\.(jpg|png|webp)$/;
const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// La firma de cada formato: lo que dice el navegador no basta.
const SIGNATURE = {
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

const file = (name) => path.join(AVATARS_STORAGE_PATH, name);
export const deleteAvatarFile = (name) => (name && NAME_RE.test(name) ? fs.rm(file(name), { force: true }) : undefined);

/** { body, type } del fichero o null si el nombre no es válido o no existe. */
export async function readAvatar(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null;
  const body = await fs.readFile(file(name)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  return body && { body, type: CONTENT_TYPE[name.split('.')[1]] };
}

/** Comprueba tipo y firma, y guarda el fichero con un nombre nuevo. Devuelve el nombre. */
export async function storeAvatar(buffer, type) {
  const ext = AVATAR_TYPES[type];
  if (!ext || !Buffer.isBuffer(buffer) || !SIGNATURE[ext](buffer)) {
    throw httpError(400, 'invalid_image', 'la foto tiene que ser JPEG, PNG o WebP');
  }
  const name = `${crypto.randomBytes(32).toString('hex')}.${ext}`;
  await fs.writeFile(file(name), buffer, { flag: 'wx' });
  return name;
}

/**
 * Pone (name) o quita (null) la foto de `subjectId` con la RLS de quien actúa (su perfil, el de un hijo o, el admin, el
 * de cualquiera) y lo anota. Devuelve el nombre viejo, que se borra tras el commit.
 */
export async function setAvatar(client, actorId, subjectId, name) {
  const { rows: [r] } = await client.query(
    `WITH old AS (SELECT avatar FROM profiles WHERE id = $1 FOR UPDATE)
     UPDATE profiles p SET avatar = $2 FROM old WHERE p.id = $1 RETURNING old.avatar AS old`, [subjectId, name]);
  if (!r) throw httpError(404, 'profile_not_found', 'Perfil no encontrado');
  await client.query(`SELECT write_audit($1, $2, 'profile', $3, '{}'::jsonb)`,
    [actorId, name ? 'profile.avatar_set' : 'profile.avatar_remove', subjectId]);
  return r.old;
}

/** El admin quita una foto inadecuada: aviso al dueño o, si es un menor (con acceso propio o sin él, B32), a sus tutores. */
export async function noticeAvatarRemoved(adminId, subjectId) {
  const { rows: [p] } = await servicePool.query(
    `SELECT p.display_name, EXISTS (SELECT 1 FROM auth_credentials c WHERE c.profile_id = p.id) AND NOT is_minor(p.id) AS own,
            ARRAY(SELECT tutor_id FROM guardianships WHERE minor_id = p.id) AS tutors
       FROM profiles p WHERE p.id = $1`, [subjectId]);
  await notice(servicePool, {
    action: 'notice.avatar_removed', actorId: adminId, type: 'profile', resourceId: subjectId,
    recipients: p.own ? [subjectId] : p.tutors, profile_name: p.display_name,
  });
}
