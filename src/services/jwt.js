// src/services/jwt.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/auth.js';

export function signToken({ sub, role }) {
  return jwt.sign({ sub, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // lanza si inválido/expirado
}