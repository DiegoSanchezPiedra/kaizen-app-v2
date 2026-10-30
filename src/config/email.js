// src/config/email.js — avisos por email (B10.6). Se valida al arrancar.
import 'dotenv/config';
import path from 'node:path';

export const EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT || 'log';
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Hasta verificar el dominio (paso de producción): el remitente de pruebas de Resend.
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Kaizen <onboarding@resend.dev>';
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || null; // buzón de la academia
export const EMAIL_LOG_PATH = path.resolve(process.env.EMAIL_LOG_PATH || './storage/emails.log');

if (!['log', 'resend'].includes(EMAIL_TRANSPORT)) {
  throw new Error(`[email] EMAIL_TRANSPORT debe ser log o resend (es ${EMAIL_TRANSPORT})`);
}
if (EMAIL_TRANSPORT === 'resend' && !RESEND_API_KEY) throw new Error('[email] Falta RESEND_API_KEY en .env');
