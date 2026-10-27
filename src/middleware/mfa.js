// src/middleware/mfa.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { MFA_TOKEN_EXPIRES_IN } from '../config/mfa.js';
import { httpError } from '../lib/errors.js';

/**
 * Firma un mfa_token de corta vida.
 * Payload: { sub: profileId, mfa: 'pending', role: <role> }
 */
export function signMfaToken({ sub, role }) {
  return jwt.sign({ sub, role, mfa: 'pending' }, JWT_SECRET, {
    expiresIn: MFA_TOKEN_EXPIRES_IN,
  });
}

/**
 * Verifica un mfa_token y deja req.mfa = { userId, role }.
 * Rechaza JWT normales (sin mfa: 'pending') con 401.
 */
function checkMfaToken(token, req, next) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.mfa !== 'pending' || !payload.sub) {
      return next(httpError(401, 'invalid_mfa_token', 'invalid mfa token'));
    }
    req.mfa = { userId: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(httpError(401, 'invalid_mfa_token', 'invalid mfa token'));
  }
}

/** Middleware: exige Authorization: Bearer <mfa_token> con claim mfa: 'pending'. */
export function requireMfaToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(httpError(401, 'missing_token', 'missing token'));
  }
  return checkMfaToken(token, req, next);
}

/** Variante para aceptar el mfa_token en body (POST /auth/mfa/verify). */
export function requireMfaTokenFromBody(req, res, next) {
  const token = req.body && req.body.mfa_token;
  if (!token || typeof token !== 'string') {
    return next(httpError(400, 'missing_mfa_token', 'mfa_token required'));
  }
  return checkMfaToken(token, req, next);
}
