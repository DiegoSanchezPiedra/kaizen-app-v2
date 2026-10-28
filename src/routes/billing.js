// src/routes/billing.js — contratar y portal. Paga el propio alumno adulto o un tutor por su hijo (CONTEXT § Pagador).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';
import { httpError } from '../lib/errors.js';
import { createCheckout, createPortalSession } from '../services/billing.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('alumno', 'tutor'));

// Antes de abrir transacción: requireCompleteProfile usa profile_id en SQL.
// Sin profile_id el sujeto es quien llama, y solo un alumno se suscribe a sí mismo (el rol tutor no entrena).
const checkSubject = (req, res, next) => {
  const id = req.body?.profile_id;
  if (id !== undefined && !UUID_RE.test(id)) {
    return next(httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' }));
  }
  if ((id ?? req.user.id) === req.user.id && req.user.role !== 'alumno') {
    return next(httpError(403, 'not_a_student', 'Solo un alumno se suscribe a sí mismo'));
  }
  return next();
};

// POST /billing/checkout { plan_id, discipline_ids?, profile_id? } → 201 { url } (página de pago de Stripe)
router.post('/checkout', checkSubject, withRlsContext(async (req, client) => ({
  status: 201,
  body: await createCheckout(client, {
    payerId: req.user.id,
    studentId: req.body.profile_id ?? req.user.id,
    planId: req.body.plan_id,
    disciplineIds: req.body.discipline_ids,
  }),
}), { guards: [requireCompleteProfile] }));

// POST /billing/portal → { url }
router.post('/portal', withRlsContext(async (req, client) => createPortalSession(client, req.user.id)));

export default router;
