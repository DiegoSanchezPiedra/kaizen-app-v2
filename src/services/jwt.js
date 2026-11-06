// src/services/jwt.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN, ADMIN_JWT_EXPIRES_IN } from '../config/auth.js';

// iat: la hora de la base al cambiar la contraseña (ADR 0020), para que el reloj del servidor no importe.
export function signToken({ sub, role, iat }) {
  return jwt.sign({ sub, role, ...(iat && { iat }) }, JWT_SECRET, { expiresIn: role === 'admin' ? ADMIN_JWT_EXPIRES_IN : JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // lanza si inválido/expirado
}