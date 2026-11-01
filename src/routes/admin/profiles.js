// src/routes/admin/profiles.js — usuarios y roles (B19.0) y despublicar un perfil público (B13). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { unpublishProfile } from '../../services/profiles.js';
import { listProfiles, getProfile, changeRole, addGuardian, removeGuardian } from '../../services/users.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkId = (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.param('id', checkId);
router.param('tutorId', checkId);

// GET /admin/profiles?q&role&limit&offset → { profiles, total, limit, offset }
router.get('/profiles', withRlsContext((req, client) => listProfiles(client, req.query)));

// GET /admin/profiles/:id → { profile, status, guardians, children, subscription, insurance } (sin birth_date ni salud)
router.get('/profiles/:id', withRlsContext((req, client) => getProfile(client, { id: req.params.id, actorId: req.user.id })));

// PUT /admin/profiles/:id/role { role } → { profile } (audit_log profile.role_change)
router.put('/profiles/:id/role', withRlsContext((req, client) =>
  changeRole(client, { id: req.params.id, role: req.body?.role, actorId: req.user.id })));

// POST /admin/profiles/:id/guardians { tutor_id } → 201 { guardians }; DELETE …/guardians/:tutorId → 204
router.post('/profiles/:id/guardians', withRlsContext((req, client) =>
  addGuardian(client, { id: req.params.id, tutorId: req.body?.tutor_id, actorId: req.user.id })));
router.delete('/profiles/:id/guardians/:tutorId', withRlsContext((req, client) =>
  removeGuardian(client, { id: req.params.id, tutorId: req.params.tutorId, actorId: req.user.id })));

// POST /admin/profiles/:id/unpublish → { id, is_public: false } (idempotente; audit_log profile.unpublish)
router.post('/profiles/:id/unpublish', withRlsContext(async (req, client) =>
  unpublishProfile(client, { id: req.params.id, actorId: req.user.id })));

export default router;
