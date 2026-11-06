// src/config/storage.js
import fs from 'node:fs';
import path from 'node:path';

export const AGREEMENTS_STORAGE_PATH = path.resolve(
  process.env.AGREEMENTS_STORAGE_PATH || './storage/agreements'
);

fs.mkdirSync(AGREEMENTS_STORAGE_PATH, { recursive: true });

// Fotos de perfil (B24, ADR 0019): junto a los acuerdos (storage/avatars, en staging storage-staging/avatars).
export const AVATARS_STORAGE_PATH = path.resolve(
  process.env.AVATARS_STORAGE_PATH || path.join(path.dirname(AGREEMENTS_STORAGE_PATH), 'avatars')
);

fs.mkdirSync(AVATARS_STORAGE_PATH, { recursive: true });
