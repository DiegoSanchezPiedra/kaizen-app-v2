// src/config/email.js — avisos por email (B10.6). Se valida al arrancar.
import 'dotenv/config';
import path from 'node:path';

export const EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT || 'log';
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const BREVO_API_KEY = process.env.BREVO_API_KEY;
// Hasta verificar el dominio (paso de producción): el remitente de pruebas de Resend.
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Kaizen <onboarding@resend.dev>';
// Secreto compartido con el webhook de Brevo (cabecera x-brevo-secret, ADR 0029). Sin él, el endpoint responde 500.
export const BREVO_WEBHOOK_SECRET = process.env.BREVO_WEBHOOK_SECRET;
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || null; // buzón de la academia
export const EMAIL_LOG_PATH = path.resolve(process.env.EMAIL_LOG_PATH || './storage/emails.log');

if (!['log', 'resend', 'brevo'].includes(EMAIL_TRANSPORT)) {
  throw new Error(`[email] EMAIL_TRANSPORT debe ser log, resend o brevo (es ${EMAIL_TRANSPORT})`);
}
// Solo con Brevo: ahí el remitente de pruebas de Resend nunca vale. El staging con Resend lo usa a propósito.
if (EMAIL_TRANSPORT === 'brevo' && /@resend\.dev>?\s*$/.test(EMAIL_FROM)) {
  throw new Error('[email] EMAIL_FROM sigue siendo el remitente de pruebas de Resend: pon uno de tu dominio, validado en Brevo');
}
if (EMAIL_TRANSPORT === 'resend' && !RESEND_API_KEY) throw new Error('[email] Falta RESEND_API_KEY en .env');
if (EMAIL_TRANSPORT === 'brevo' && !BREVO_API_KEY) throw new Error('[email] Falta BREVO_API_KEY en .env');
