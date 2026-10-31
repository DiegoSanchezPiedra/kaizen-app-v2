// src/routes/admin/classes.js
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { listClasses, createClass, updateClass, retireClass } from '../../services/classes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

router.get('/classes', withRlsContext(async (req, client) => ({
  classes: await listClasses(client, req.query),
})));
router.post('/classes', withRlsContext(async (req, client) => ({
  status: 201, body: { class: await createClass(client, { body: req.body ?? {}, actorId: req.user.id }) },
})));
// Cambio de clase (B7.1) → { class, sessions_changed, notified, promoted }.
router.patch('/classes/:id', withRlsContext((req, client) => updateClass(client, { id: req.params.id, body: req.body ?? {} })));
router.post('/classes/:id/retire', withRlsContext(async (req, client) => ({
  class: await retireClass(client, { id: req.params.id, date: req.body?.date }),
})));

export default router;
