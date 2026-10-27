// src/services/storage.js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AGREEMENTS_STORAGE_PATH } from '../config/storage.js';

// basename: storage_path viene de BD pero nunca debe escapar del directorio.
const abs = (name) => path.join(AGREEMENTS_STORAGE_PATH, path.basename(name));

/** Guarda `buffer` como `name`; devuelve el SHA-256 hex. */
export async function saveFile(name, buffer) {
  await fs.writeFile(abs(name), buffer, { flag: 'wx' });
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export const readFile = (name) => fs.readFile(abs(name));

export const deleteFile = (name) => fs.rm(abs(name), { force: true });
