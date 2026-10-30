// src/services/push.js — envío de un push a un dispositivo (B15): web-push (aes128gcm + VAPID) o, en local,
// al log (consola + fichero). Devuelve el estado del dispositivo; nunca lanza.
import fs from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';
import { PUSH_TRANSPORT, PUSH_LOG_PATH } from '../config/push.js';

// gone: el dispositivo ya no existe (borrarlo); transient: red, 429, 5xx (reintentar); permanent: el resto.
const classify = (code) => {
  if (code === 404 || code === 410) return 'gone';
  if (!code || code === 429 || code >= 500) return 'transient';
  return 'permanent';
};

/** @returns {Promise<{ status: 'sent' | 'gone' | 'transient' | 'permanent', error?: string }>} */
async function webpushSend({ subscription, payload, ttl, topic }) {
  try {
    // Las claves VAPID ya las fijó config/push.js.
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: ttl, topic, timeout: 15_000 });
    return { status: 'sent' };
  } catch (err) {
    const status = classify(err.statusCode);
    return { status, error: err.statusCode ? `push ${err.statusCode}` : `red: ${err.message}` };
  }
}

async function log({ subscription, payload, ttl, topic }) {
  const entry = `--- ${new Date().toISOString()} [${topic}] TTL ${ttl}s\nA: ${subscription.endpoint}\n`
    + `${JSON.stringify(payload, null, 2)}\n\n`;
  console.log(`[push] ${payload.title}`);
  await fs.mkdir(path.dirname(PUSH_LOG_PATH), { recursive: true });
  await fs.appendFile(PUSH_LOG_PATH, entry);
  return { status: 'sent' };
}

export const send = PUSH_TRANSPORT === 'webpush' ? webpushSend : log;
