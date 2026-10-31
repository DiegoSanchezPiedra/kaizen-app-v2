// src/routes/admin/sessions.js — ajuste de sesión (B7.1); sesión suelta, cancelar, recuperar y deshacer un ajuste (B6.1).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import {
  adjustSession, createSession, cancelSession, restoreSession, resetSession,
} from '../../services/sessions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

// → { session, sessions_changed, notified, promoted }
router.patch('/sessions/:id', withRlsContext((req, client) => adjustSession(client, { id: req.params.id, body: req.body ?? {} })));
router.post('/sessions', withRlsContext(async (req, client) => ({
  status: 201, body: { session: await createSession(client, { body: req.body ?? {}, actorId: req.user.id }) },
})));
// → { session, retroactive, cancelled_bookings, notified }
router.post('/sessions/:id/cancel', withRlsContext((req, client) => cancelSession(client, { id: req.params.id, body: req.body ?? {} })));
// → { session, notified }
router.post('/sessions/:id/restore', withRlsContext((req, client) => restoreSession(client, { id: req.params.id })));
// → { session, sessions_changed, notified, promoted }
router.post('/sessions/:id/reset', withRlsContext((req, client) => resetSession(client, { id: req.params.id, body: req.body ?? {} })));

export default router;
