// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(httpError(401, 'missing_token', 'missing token'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Un mfa_token NO sirve para rutas protegidas normales.
    if (payload.mfa === 'pending' || !payload.sub || !payload.role) {
      return next(httpError(401, 'invalid_token', 'invalid token'));
    }
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(httpError(401, 'invalid_token', 'invalid token'));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(httpError(403, 'insufficient_role', 'insufficient role'));
    }
    return next();
  };
}

// Handler `(req, client)`: devuelve `body` (200) o `{ status, body }`; los errores se lanzan.
// Responde siempre tras el COMMIT. `guards` (req, client) corren dentro de la misma transacción.
export function withRlsContext(handler, { guards = [] } = {}) {
  return async (req, res, next) => {
    try {
      const result = await withRls({ uid: req.user.id, role: req.user.role }, async (client) => {
        for (const guard of guards) await guard(req, client);
        return handler(req, client);
      });
      const { status = 200, body } =
        typeof result?.status === 'number' && 'body' in result ? result : { body: result };
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  };
}
