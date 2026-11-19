// src/routes/admin/profiles.js — usuarios y roles (B19.0) y despublicar un perfil público (B13). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { unpublishProfile } from '../../services/profiles.js';
import { withRls } from '../../db/rls.js';
import { adminGrantLimit, trainerInviteLimit } from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { sendInvite, inviteUrl } from '../../services/trainers.js';
import { setAvatar, deleteAvatarFile, noticeAvatarRemoved } from '../../services/avatar.js';
import { listProfiles, getProfileStats, getProfile, addRole, removeRole, adminCreateUser, inviteUser, setCanCreateChildren, addGuardian, removeGuardian } from '../../services/users.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkId = (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.param('id', checkId);
router.param('tutorId', checkId);

// GET /admin/profiles?q&role&discipline_id&plan_id&estado&limit&offset → { profiles, total, limit, offset }
router.get('/profiles', withRlsContext((req, client) => listProfiles(client, req.query)));

// GET /admin/profiles/stats?discipline_id → { activos, impago, inactivos } (antes de /:id)
router.get('/profiles/stats', withRlsContext((req, client) => getProfileStats(client, req.query)));

// GET /admin/profiles/:id → { profile, status, guardians, children, subscription } (sin birth_date ni salud)
router.get('/profiles/:id', withRlsContext((req, client) => getProfile(client, { id: req.params.id })));

// POST /admin/profiles/:id/roles { role } → { profile } (audit_log profile.role_add); DELETE …/roles/:role → { profile }
// (profile.role_remove). ADR 0033; sin doble factor (ADR 0032). 409 self_role_locked | trainer_role_locked | child_role_locked |
// role_already_assigned | admin_role_locked | student_has_subscription | last_role; 404 role_not_assigned.
// Dar admin, como mucho 10 veces cada 15 min por IP.
const grantLimit = (req, res, next) => (req.body?.role === 'admin' ? adminGrantLimit(req, res, next) : next());
router.post('/profiles/:id/roles', grantLimit, withRlsContext((req, client) => addRole(client, {
  id: req.params.id, role: req.body?.role, actorId: req.user.id })));
router.delete('/profiles/:id/roles/:role', withRlsContext((req, client) => removeRole(client, {
  id: req.params.id, role: req.params.role, actorId: req.user.id })));

// El email sale tras el COMMIT y sin await (un fallo de envío no deshace el alta: el admin copia el enlace o reinvita).
// El enlace va también en la respuesta, nunca en caché, ni en logs ni en audit.
const withInvite = (status, handler) => asyncHandler(async (req, res) => {
  const { invite, ...rest } = await withRls({ uid: req.user.id, role: req.user.role }, (client) => handler(req, client));
  sendInvite(invite);
  res.set('Cache-Control', 'no-store').status(status).json({ ...rest, invite_url: inviteUrl(invite.token) });
});

// POST /admin/users { email, display_name, role, birth_date } → 201 { profile, invite_url } (ADR 0032; alumno, tutor o admin;
// birth_date obligatoria salvo para el admin, y de adulto). 400 invalid_field | invalid_birth_date; 409 email_taken | email_domain_reserved
router.post('/users', withInvite(201, (req, client) => adminCreateUser(client, req.body ?? {})));

// POST /admin/users/:id/invite → 200 { invite_url } (invalida la anterior); solo quien nunca activó la cuenta: 409 already_active
// | not_invitable (menor, desactivado o profesor: ese, por /admin/trainers); 5 por perfil y hora
router.post('/users/:id/invite', trainerInviteLimit, withInvite(200, (req, client) => inviteUser(client, { id: req.params.id })));

// PUT /admin/profiles/:id/can-create-children { enabled } → { profile }: permiso de dar de alta hijos (audit_log)
router.put('/profiles/:id/can-create-children', withRlsContext((req, client) =>
  setCanCreateChildren(client, { id: req.params.id, enabled: req.body?.enabled })));

// POST /admin/profiles/:id/guardians { tutor_id } → 201 { guardians }; DELETE …/guardians/:tutorId → 204
router.post('/profiles/:id/guardians', withRlsContext((req, client) =>
  addGuardian(client, { id: req.params.id, tutorId: req.body?.tutor_id, actorId: req.user.id })));
router.delete('/profiles/:id/guardians/:tutorId', withRlsContext((req, client) =>
  removeGuardian(client, { id: req.params.id, tutorId: req.params.tutorId, actorId: req.user.id })));

// POST /admin/profiles/:id/unpublish → { id, is_public: false } (idempotente; audit_log profile.unpublish)
router.post('/profiles/:id/unpublish', withRlsContext(async (req, client) =>
  unpublishProfile(client, { id: req.params.id, actorId: req.user.id })));

// DELETE /admin/profiles/:id/avatar → 204: quita una foto inadecuada (B24). Aviso al dueño o a sus tutores, sin motivo.
router.delete('/profiles/:id/avatar', async (req, res, next) => {
  try {
    const old = await withRls({ uid: req.user.id, role: req.user.role }, (client) => setAvatar(client, req.user.id, req.params.id, null));
    await deleteAvatarFile(old);
    if (old) await noticeAvatarRemoved(req.user.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
