// src/config/push.js — push de avisos (B15, ADR 0011). Se valida al arrancar.
// Generar las claves: npx web-push generate-vapid-keys. Rotar = cambiar las dos y vaciar push_subscriptions.
import 'dotenv/config';
import path from 'node:path';
import webpush from 'web-push';
import { EMAIL_REPLY_TO } from './email.js';

export const PUSH_TRANSPORT = process.env.PUSH_TRANSPORT || 'log';
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (EMAIL_REPLY_TO && `mailto:${EMAIL_REPLY_TO}`);
export const PUSH_LOG_PATH = path.resolve(process.env.PUSH_LOG_PATH || './storage/push.log');

if (!['log', 'webpush'].includes(PUSH_TRANSPORT)) {
  throw new Error(`[push] PUSH_TRANSPORT debe ser log o webpush (es ${PUSH_TRANSPORT})`);
}
if (PUSH_TRANSPORT === 'webpush' && !(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)) {
  throw new Error('[push] Faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT (o EMAIL_REPLY_TO) en .env');
}
// Valida el formato de las claves y del subject (lanza si no valen).
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
