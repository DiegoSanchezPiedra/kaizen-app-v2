// src/routes/avatars.js — GET /avatars/:name: la foto de perfil, sin token (ADR 0019: la URL es la credencial).
// Tipo fijo, nosniff y una CSP que no deja ejecutar nada; caché larga, porque cambiar la foto cambia el nombre.
import { Router } from 'express';
import { readAvatar } from '../services/avatar.js';
import { httpError } from '../lib/errors.js';

const router = Router();

router.get('/:name', async (req, res, next) => {
  try {
    const img = await readAvatar(req.params.name);
    if (!img) return next(httpError(404, 'avatar_not_found', 'foto no encontrada'));
    res.set({
      'Content-Type': img.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    return res.send(img.body);
  } catch (err) {
    return next(err);
  }
});

export default router;
