// src/middleware/auth.js
import { appPool } from '../config/database.js';
import { verifyToken } from '../services/jwt.js';

// Verifica JWT y deja req.user = { id, role }
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Falta Bearer token' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized', message: 'Token inválido o expirado' });
  }
}

// Restringe por rol: requireRole('admin') o requireRole('admin','profesor')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Rol insuficiente' });
    }
    next();
  };
}

// Abre transacción en appPool con SET LOCAL para RLS.
// Uso: router.get('/x', requireAuth, withRlsContext(async (req, client) => { ... }))
export function withRlsContext(handler) {
  return async (req, res, next) => {
    if (!req.user) return next(Object.assign(new Error('withRlsContext requiere requireAuth'), { status: 500 }));
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [req.user.id]);
      await client.query(`SELECT set_config('app.current_role', $1, true)`, [req.user.role]);
      const result = await handler(req, client);
      await client.query('COMMIT');
      if (result !== undefined) res.json(result);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  };
}