// src/routes/admin/profiles.js — despublicar un perfil público (B13). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { unpublishProfile } from '../../services/profiles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

// POST /admin/profiles/:id/unpublish → { id, is_public: false } (idempotente; audit_log profile.unpublish)
router.post('/profiles/:id/unpublish', withRlsContext(async (req, client) =>
  unpublishProfile(client, { id: req.params.id, actorId: req.user.id })));

export default router;
