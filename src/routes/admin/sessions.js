// src/routes/admin/sessions.js — ajuste de sesión (B7.1).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { adjustSession } from '../../services/sessions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

// → { session, sessions_changed, notified, promoted }
router.patch('/sessions/:id', withRlsContext((req, client) => adjustSession(client, { id: req.params.id, body: req.body ?? {} })));

export default router;
