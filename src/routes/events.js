// src/routes/events.js — eventos (B21.0). Los ve cualquiera con sesión; se inscriben el alumno y el tutor por sus hijos
// (el admin inscribe invitados en /admin); la lista la pasan el profesor del evento y el admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext, requireCanBook } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import {
  listEvents, getEvent, registerEvent, cancelRegistration, markEventAttendance,
} from '../services/events.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (req, res, next, id) => (UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

const router = Router();
router.use(requireAuth);
router.param('id', uuidParam);
router.param('profileId', uuidParam);

// GET /events?profile_id&registered → { events }
router.get('/', withRlsContext(async (req, client) => ({ events: await listEvents(client, req.user, req.query) })));

// DELETE /events/registrations/:id → 204 (antes que /:id). Sin guard: un perfil incompleto puede cancelar.
router.delete('/registrations/:id', requireRole('alumno', 'tutor'), requireCanBook, withRlsContext(async (req, client) => {
  await cancelRegistration(client, req.params.id);
  return { status: 204, body: null };
}));

// GET /events/:id?profile_id → { event }
router.get('/:id', withRlsContext(async (req, client) => ({
  event: await getEvent(client, req.user, req.params.id, req.query.profile_id),
})));

// POST /events/:id/registrations { profile_id? } → 201 { registration[, url] }. El perfil completo (sujeto y actor) lo
// comprueba register_event, con el mismo `missing` que requireCompleteProfile. B32: el menor, solo gratis y con el permiso
// de reservar (403 minor_restricted).
router.post('/:id/registrations', requireRole('alumno', 'tutor'), requireCanBook, withRlsContext(async (req, client) => {
  const profileId = req.body?.profile_id;
  if (profileId !== undefined && !UUID_RE.test(profileId)) {
    throw httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' });
  }
  return { status: 201, body: await registerEvent(client, {
    eventId: req.params.id, subjectId: profileId ?? req.user.id, actorId: req.user.id, minor: !!req.user.minor,
  }) };
}));

// PUT /events/:id/attendance/:profileId { present } → { profile_id, present }
router.put('/:id/attendance/:profileId', requireRole('profesor', 'admin'), withRlsContext((req, client) =>
  markEventAttendance(client, { eventId: req.params.id, profileId: req.params.profileId, present: req.body?.present })));

export default router;
