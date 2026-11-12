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
  // B32 (ADR 0026): un hijo sin credenciales (acceso revocado) no tiene sesión; el menor con acceso lleva `minor`
  // ({ can_book, can_publish }) para los bloqueos de las rutas. La edad y el permiso, de la BD en cada petición.
  try {
    const { rows: [u] } = await withRls({ uid: payload.sub, role: 'alumno' }, (client) => client.query(
      `SELECT (SELECT role FROM user_roles WHERE user_id = $1) AS role,
              extract(epoch FROM c.credentials_changed_at)::bigint AS changed, c.profile_id IS NOT NULL AS creds,
              COALESCE(c.can_book, false) AS can_book,
              EXISTS (SELECT 1 FROM guardianships WHERE minor_id = $1) AS ward,
              p.birth_date > CURRENT_DATE - interval '18 years' AS minor,
              p.birth_date <= CURRENT_DATE - make_interval(years => minor_consent_age()) AS can_publish
         FROM (SELECT 1) one LEFT JOIN profiles p ON p.id = $1 LEFT JOIN auth_credentials c ON c.profile_id = $1`,
      [payload.sub]));
    if ((u.ward && !u.creds) || (u.changed !== null && !(payload.iat >= Number(u.changed)))) { // sin iat, también fuera
      return next(httpError(401, 'session_revoked', 'session revoked'));
    }
    req.user = { id: payload.sub, role: u.role ?? 'alumno', mfa: Array.isArray(payload.amr) && payload.amr.includes('mfa'),
      iat: payload.iat, minor: u.minor ? { can_book: u.can_book, can_publish: u.can_publish } : null };
  } catch (err) {
    return next(err);
  }
  return next();
}

const minorRestricted = () => httpError(403, 'minor_restricted', 'Esto lo hace tu tutor');

// B32: lo que un menor nunca hace con su acceso (pagos, pausas, firmas, salud, sus datos y su familia).
export function blockMinor(req, res, next) {
  return next(req.user?.minor ? minorRestricted() : undefined);
}

// B32: en un router con rutas de adulto (router.use, tras requireAuth), el menor queda fuera salvo en `allowed`
// ('MÉTODO /ruta', rutas sin parámetros): cerrado por defecto, una ruta nueva no se le abre sin añadirla.
export function minorAllowlist(allowed) {
  return (req, res, next) => next(!req.user?.minor || allowed.includes(`${req.method} ${req.path}`)
    ? undefined : minorRestricted());
}

// B32: reservar, cancelar e inscribirse; el menor sin el permiso de reservar, no (su tutor sí, por él).
export function requireCanBook(req, res, next) {
  return next(req.user?.minor && !req.user.minor.can_book ? minorRestricted() : undefined);
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
