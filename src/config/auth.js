// src/config/auth.js
import 'dotenv/config';

export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET) throw new Error('[auth] Falta JWT_SECRET en .env');
if (!GOOGLE_CLIENT_ID) throw new Error('[auth] Falta GOOGLE_CLIENT_ID en .env');