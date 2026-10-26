// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { appPool } from '../config/database.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ error: 'unauthorized', code: 'missing_token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Un mfa_token NO sirve para rutas protegidas normales.
    if (payload.mfa === 'pending') {
      return res
        .status(401)
        .json({ error: 'unauthorized', code: 'invalid_token' });
    }
    if (!payload.sub || !payload.role) {
      return res
        .status(401)
        .json({ error: 'unauthorized', code: 'invalid_token' });
    }
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return res
      .status(401)
      .json({ error: 'unauthorized', code: 'invalid_token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: 'forbidden', code: 'insufficient_role' });
    }
    return next();
  };
}

export function withRlsContext(handler) {
  return async (req, res, next) => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
        req.user.id,
      ]);
      await client.query(`SELECT set_config('app.current_role', $1, true)`, [
        req.user.role,
      ]);
      const result = await handler(req, client);
      await client.query('COMMIT');
      if (result !== undefined) res.json(result);
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignora
      }
      return next(err);
    } finally {
      client.release();
    }
  };
}