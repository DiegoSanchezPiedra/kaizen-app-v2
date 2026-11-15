// src/routes/admin/trainers.js — alta de profesores por el admin (ADR 0028). Solo admin. Los emails salen tras el COMMIT.
import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { httpError } from '../../lib/errors.js';
import { withRls } from '../../db/rls.js';
import { trainerInviteLimit } from '../../middleware/rateLimit.js';
import { createTrainer, inviteTrainer, updateTrainer, setTrainerDisabled, sendInvite } from '../../services/trainers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

const run = (req, fn) => withRls({ uid: req.user.id, role: req.user.role }, fn);
const reply = (status) => (handler) => asyncHandler(async (req, res) => {
  const { trainer, invite } = await handler(req);
  if (invite) sendInvite(invite); // sin await: un fallo de envío no deshace el cambio (el admin reenvía)
  res.status(status).json({ trainer });
});

// POST /admin/trainers { email, display_name, employment? } → 201 { trainer }; 400 email_domain_not_allowed | invalid_field; 409 email_taken
router.post('/trainers', reply(201)((req) => run(req, (c) => createTrainer(c, req.body))));

// POST /admin/trainers/:id/invite → 204 (invalida la anterior); 5 por profesor y hora
router.post('/trainers/:id/invite', trainerInviteLimit, asyncHandler(async (req, res) => {
  const { invite } = await run(req, (c) => inviteTrainer(c, { id: req.params.id }));
  sendInvite(invite);
  res.status(204).end();
}));

// PATCH /admin/trainers/:id { display_name?, employment?, email? } → { trainer }; con email nuevo, reinvita
const emailLimit = (req, res, next) => (req.body?.email !== undefined ? trainerInviteLimit(req, res, next) : next());
router.patch('/trainers/:id', emailLimit, reply(200)((req) => run(req, (c) => updateTrainer(c, { id: req.params.id, body: req.body ?? {} }))));

// POST /admin/trainers/:id/deactivate → { trainer }; 409 trainer_has_sessions | same_state
router.post('/trainers/:id/deactivate', reply(200)((req) => run(req, (c) => setTrainerDisabled(c, { id: req.params.id, disabled: true }))));
router.post('/trainers/:id/reactivate', reply(200)((req) => run(req, (c) => setTrainerDisabled(c, { id: req.params.id, disabled: false }))));

export default router;
