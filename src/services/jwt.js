// src/services/jwt.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN, ADMIN_JWT_EXPIRES_IN, MINOR_JWT_EXPIRES_IN } from '../config/auth.js';

// iat: la hora de la base al cambiar la contraseña (ADR 0020), para que el reloj del servidor no importe.
// mfa: la sesión entró con el doble factor (/auth/mfa/verify); dar el rol admin lo exige (B20, B3).
// minor: la sesión de un menor con acceso propio dura siempre 7 días (B32).
export function signToken({ sub, role, iat, mfa, minor }) {
  return jwt.sign({ sub, role, ...(iat && { iat }), ...(mfa && { amr: ['mfa'] }) }, JWT_SECRET,
    { expiresIn: minor ? MINOR_JWT_EXPIRES_IN : role === 'admin' ? ADMIN_JWT_EXPIRES_IN : JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // lanza si inválido/expirado
}