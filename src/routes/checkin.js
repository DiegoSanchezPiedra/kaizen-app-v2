// src/routes/checkin.js — check-in desde el móvil del alumno o del tutor (CONTEXT § Asistencia).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { checkIn } from '../services/checkin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('alumno', 'tutor'));

// POST /checkin { code, booking_ids? } → { status: 'done', results } | { status: 'choose', candidates }
// Idempotente: cada resultado lleva checked_in_at y already. Con varias candidatas se repite con las elegidas.
router.post('/', withRlsContext(async (req, client) => {
  const { code, booking_ids: bookingIds } = req.body ?? {};
  if (bookingIds !== undefined && !(Array.isArray(bookingIds) && bookingIds.length > 0 && bookingIds.length <= 20
    && bookingIds.every((id) => typeof id === 'string' && UUID_RE.test(id)))) {
    throw httpError(400, 'invalid_field', 'booking_ids inválido', { field: 'booking_ids' });
  }
  return checkIn(client, { code, bookingIds });
}));

export default router;
