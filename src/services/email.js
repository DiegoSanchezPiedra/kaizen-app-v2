// src/services/email.js — envío de un email (B10.6): Resend por fetch o, en local, al log (consola + fichero).
// Los errores llevan `transient`: red, 429 y 5xx se reintentan; el resto de 4xx no.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EMAIL_TRANSPORT, RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_LOG_PATH } from '../config/email.js';

const fail = (message, transient) => Object.assign(new Error(message), { transient });

/** @returns {Promise<{ id: string }>} id del proveedor */
async function resend({ to, subject, text, html, idempotencyKey }) {
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json',
        // Caída entre el envío y la marca: el reintento con la misma clave no manda otro email (24 h).
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [to], subject, text, html, ...(EMAIL_REPLY_TO && { reply_to: EMAIL_REPLY_TO }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw fail(`red: ${err.message}`, true);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`resend ${res.status}: ${body.message ?? res.statusText}`, res.status === 429 || res.status >= 500);
  return { id: body.id };
}

async function log({ to, subject, text, idempotencyKey }) {
  const entry = `--- ${new Date().toISOString()} [${idempotencyKey}]\nPara: ${to}\nAsunto: ${subject}\n\n${text}\n\n`;
  console.log(`[email] ${to}: ${subject}`);
  await fs.mkdir(path.dirname(EMAIL_LOG_PATH), { recursive: true });
  await fs.appendFile(EMAIL_LOG_PATH, entry);
  return { id: `log-${crypto.randomUUID()}` };
}

export const send = EMAIL_TRANSPORT === 'resend' ? resend : log;
