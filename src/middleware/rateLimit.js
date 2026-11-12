// src/middleware/rateLimit.js — límite de peticiones por IP y ventana fija (B20): frena la fuerza bruta en el login,
// el MFA, el código de la tablet y el envío de emails de recuperar contraseña. Responde 429 rate_limited con Retry-After.
// La IP es req.ip: depende de `trust proxy` (TRUST_PROXY en src/index.js), o todos compartirían la del proxy.
// shortcut: contadores en la memoria del proceso; con varias instancias de la API, pasarlos a Postgres o Redis.
import { httpError } from '../lib/errors.js';

const SWEEP_AT = 10_000; // claves en memoria antes de barrer las caducadas

// `key`: qué se cuenta (por defecto, la IP); sin clave, la petición no cuenta.
export function rateLimit({ name, max, windowMs, now = Date.now, key = (req) => req.ip }) {
  const hits = new Map(); // clave → { count, reset }
  return (req, res, next) => {
    const k = key(req);
    if (typeof k !== 'string' || !k) return next();
    const t = now();
    if (hits.size >= SWEEP_AT) for (const [x, h] of hits) if (h.reset <= t) hits.delete(x);
    let h = hits.get(k);
    if (!h || h.reset <= t) hits.set(k, (h = { count: 0, reset: t + windowMs }));
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - t) / 1000)));
      return next(httpError(429, 'rate_limited', `Demasiadas peticiones (${name}); espera y vuelve a intentarlo`));
    }
    next();
  };
}

const MIN = 60_000;
export const authLimit = rateLimit({ name: 'auth', max: 30, windowMs: 15 * MIN });
// B32: el mismo límite por cuenta (email o usuario), aunque cambie la IP: frena adivinar la contraseña de un menor.
export const loginAccountLimit = rateLimit({ name: 'auth', max: 30, windowMs: 15 * MIN,
  key: (req) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined) });
export const forgotLimit = rateLimit({ name: 'password_forgot', max: 5, windowMs: 60 * MIN });
export const tabletLinkLimit = rateLimit({ name: 'tablet_link', max: 10, windowMs: 15 * MIN });
export const avatarLimit = rateLimit({ name: 'avatar', max: 20, windowMs: 60 * MIN });
// Dar el rol admin pide el código del doble factor: que no se adivine (B20, B3).
export const adminGrantLimit = rateLimit({ name: 'admin_grant', max: 10, windowMs: 15 * MIN });
export const agreementsAdminLimit = rateLimit({ name: 'admin_agreements', max: 60, windowMs: 15 * MIN });
