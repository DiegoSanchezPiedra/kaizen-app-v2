// src/middleware/mfa.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { MFA_TOKEN_EXPIRES_IN } from '../config/mfa.js';

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
 * Middleware: exige Authorization: Bearer <mfa_token> con claim mfa: 'pending'.
 * Deja req.mfa = { userId, role }.
 * Rechaza JWT normales (sin mfa: 'pending') con 401.
 */
export function requireMfaToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized', code: 'missing_token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.mfa !== 'pending' || !payload.sub) {
      return res
        .status(401)
        .json({ error: 'unauthorized', code: 'invalid_mfa_token' });
    }
    req.mfa = { userId: payload.sub, role: payload.role };
    return next();
  } catch {
    return res
      .status(401)
      .json({ error: 'unauthorized', code: 'invalid_mfa_token' });
  }
}

/**
 * Variante para aceptar el mfa_token en body (POST /auth/mfa/verify).
 * Lee req.body.mfa_token, valida y deja req.mfa = { userId, role }.
 */
export function requireMfaTokenFromBody(req, res, next) {
  const token = req.body && req.body.mfa_token;
  if (!token || typeof token !== 'string') {
    return res
      .status(400)
      .json({ error: 'bad_request', code: 'missing_mfa_token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.mfa !== 'pending' || !payload.sub) {
      return res
        .status(401)
        .json({ error: 'unauthorized', code: 'invalid_mfa_token' });
    }
    req.mfa = { userId: payload.sub, role: payload.role };
    return next();
  } catch {
    return res
      .status(401)
      .json({ error: 'unauthorized', code: 'invalid_mfa_token' });
  }
}