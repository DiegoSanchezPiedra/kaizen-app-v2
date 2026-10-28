// src/routes/checkin.js — check-in desde el móvil del alumno o del tutor (CONTEXT § Asistencia).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { checkIn } from '../services/checkin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('alumno', 'tutor'));

// POST /checkin { code, booking_id? } → { status: 'checked_in', … } | { status: 'choose', candidates }
// Con varias reservas candidatas se repite con el booking_id elegido.
router.post('/', withRlsContext(async (req, client) => {
  const { code, booking_id: bookingId } = req.body ?? {};
  if (bookingId !== undefined && (typeof bookingId !== 'string' || !UUID_RE.test(bookingId))) {
    throw httpError(400, 'invalid_field', 'booking_id inválido', { field: 'booking_id' });
  }
  return checkIn(client, { code, bookingId });
}));

export default router;
