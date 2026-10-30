// src/routes/push.js — clave pública VAPID para suscribirse al push (B15). Cualquier perfil con sesión.
import { Router } from 'express';
import { httpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { VAPID_PUBLIC_KEY } from '../config/push.js';

const router = Router();

// GET /push/vapid-public-key → { key }; 503 push_disabled sin claves (PUSH_TRANSPORT=log).
router.get('/vapid-public-key', requireAuth, (req, res, next) => (VAPID_PUBLIC_KEY
  ? res.json({ key: VAPID_PUBLIC_KEY })
  : next(httpError(503, 'push_disabled', 'El push no está configurado'))));

export default router;
