// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';

export async function requireAuth(req, res, next) {
  // Varios routers montados en el mismo prefijo (/admin, /sessions) lo repiten: una consulta por petición.
  if (req.user) return next();
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(httpError(401, 'missing_token', 'missing token'));
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return next(httpError(401, 'invalid_token', 'invalid token'));
  }
  // Un mfa_token NO sirve para rutas protegidas normales.
  if (payload.mfa === 'pending' || !payload.sub || !payload.role) {
    return next(httpError(401, 'invalid_token', 'invalid token'));
  }
  // B19: el rol es el de user_roles en cada petición, no el del token (un cambio de rol vale al momento).
  // Se lee con el contexto RLS del propio perfil (user_roles_select deja leer la fila propia); sin fila, alumno.
  // ADR 0020: un token emitido antes del último cambio de contraseña ya no vale (auth_credentials propia, también por RLS).
  try {
    const { rows: [u] } = await withRls({ uid: payload.sub, role: 'alumno' }, (client) => client.query(
      `SELECT (SELECT role FROM user_roles WHERE user_id = $1) AS role,
              (SELECT extract(epoch FROM credentials_changed_at)::bigint FROM auth_credentials WHERE profile_id = $1) AS changed`,
      [payload.sub]));
    if (u.changed !== null && !(payload.iat >= Number(u.changed))) { // sin iat, también fuera
      return next(httpError(401, 'session_revoked', 'session revoked'));
    }
    req.user = { id: payload.sub, role: u.role ?? 'alumno' };
  } catch (err) {
    return next(err);
  }
  return next();
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
