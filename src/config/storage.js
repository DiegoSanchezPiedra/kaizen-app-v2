// src/config/storage.js
import fs from 'node:fs';
import path from 'node:path';

export const AGREEMENTS_STORAGE_PATH = path.resolve(
  process.env.AGREEMENTS_STORAGE_PATH || './storage/agreements'
);

fs.mkdirSync(AGREEMENTS_STORAGE_PATH, { recursive: true });
