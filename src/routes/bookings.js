// src/routes/bookings.js — reservas del alumno, del tutor por sus hijos y del admin por cualquiera.
// El profesor no reserva ni cancela (CONTEXT).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';
import { httpError } from '../lib/errors.js';
import { bookSession, cancelBooking, listBookings } from '../services/bookings.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('alumno', 'tutor', 'admin'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

// Antes de abrir transacción: requireCompleteProfile usa profile_id en SQL.
const uuidFields = (source, fields) => (req, res, next) => {
  const bad = fields.find((f) => req[source]?.[f] !== undefined && !UUID_RE.test(req[source][f]));
  return bad ? next(httpError(400, 'invalid_field', `${bad} debe ser un uuid`, { field: bad })) : next();
};

// GET /bookings?profile_id=&from=&to=
router.get('/', uuidFields('query', ['profile_id']), withRlsContext(async (req, client) => ({
  bookings: await listBookings(client, req.query),
})));

// POST /bookings { session_id, profile_id? } → 201 { booking } (status 'confirmed' o 'waitlisted')
router.post(
  '/',
  (req, res, next) => (req.body?.session_id === undefined
    ? next(httpError(400, 'invalid_field', 'session_id requerido', { field: 'session_id' })) : next()),
  uuidFields('body', ['session_id', 'profile_id']),
  withRlsContext(async (req, client) => ({
    status: 201,
    body: { booking: await bookSession(client, {
      sessionId: req.body.session_id, studentId: req.body.profile_id ?? req.user.id,
    }) },
  }), { guards: [requireCompleteProfile] })
);

// POST /bookings/:id/cancel — también sale de la espera. Sin guard: un perfil incompleto puede cancelar.
router.post('/:id/cancel', withRlsContext(async (req, client) => ({
  booking: await cancelBooking(client, req.params.id),
})));

export default router;
