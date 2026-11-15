// src/config/corporate.js — dominio del correo corporativo de los profesores (ADR 0028). Se valida al arrancar.
// Fuera de producción, sin la variable no se valida el dominio; en producción es obligatoria.
import 'dotenv/config';

export const CORPORATE_EMAIL_DOMAIN = (process.env.CORPORATE_EMAIL_DOMAIN || '').trim().replace(/^@/, '').toLowerCase() || null;

if (process.env.NODE_ENV === 'production' && !CORPORATE_EMAIL_DOMAIN) {
  throw new Error('[corporate] Falta CORPORATE_EMAIL_DOMAIN: en producción es obligatoria');
}
if (CORPORATE_EMAIL_DOMAIN && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(CORPORATE_EMAIL_DOMAIN)) {
  throw new Error(`[corporate] CORPORATE_EMAIL_DOMAIN no es un dominio (es ${CORPORATE_EMAIL_DOMAIN})`);
}

/** Exacto tras la última '@', sin distinguir mayúsculas y sin subdominios: `a@x.academia.test` no es corporativo. */
export const isCorporateEmail = (email) =>
  !!CORPORATE_EMAIL_DOMAIN && typeof email === 'string' && email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase() === CORPORATE_EMAIL_DOMAIN;
