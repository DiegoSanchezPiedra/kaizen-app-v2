// src/routes/admin/events.js — eventos del panel (B21.0): crear, cambiar, cancelar (con reembolsos), invitados y
// cancelar inscripciones. Los reembolsos se piden a Stripe después del COMMIT (services/events.js).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { httpError } from '../../lib/errors.js';
import {
  listAdminEvents, getAdminEvent, createEvent, updateEvent, cancelEvent, registerGuest, adminCancelRegistration,
} from '../../services/events.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

router.get('/events', withRlsContext((req, client) => listAdminEvents(client, req.query)));
router.post('/events', withRlsContext(async (req, client) => ({
  status: 201, body: { event: await createEvent(client, { body: req.body ?? {}, actorId: req.user.id }) },
})));
router.get('/events/:id', withRlsContext((req, client) => getAdminEvent(client, req.params.id)));
// → { event, notified }
router.patch('/events/:id', withRlsContext((req, client) =>
  updateEvent(client, { id: req.params.id, body: req.body ?? {}, actorId: req.user.id })));
// → { refunded, refund_failed, notified }
router.post('/events/:id/cancel', asyncHandler(async (req, res) => {
  res.json(await cancelEvent(req.user, { id: req.params.id, body: req.body ?? {} }));
}));
// Invitado → 201 { registration }
router.post('/events/:id/registrations', withRlsContext(async (req, client) => ({
  status: 201,
  body: { registration: await registerGuest(client, { eventId: req.params.id, body: req.body ?? {}, actorId: req.user.id }) },
})));
// { refund } → { registration }
router.post('/event-registrations/:id/cancel', asyncHandler(async (req, res) => {
  res.json(await adminCancelRegistration(req.user, { id: req.params.id, body: req.body ?? {} }));
}));

export default router;
