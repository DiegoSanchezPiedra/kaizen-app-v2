// src/routes/billing.js — contratar y portal. Paga el propio alumno adulto o un tutor por su hijo (CONTEXT § Pagador).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';
import { httpError } from '../lib/errors.js';
import { createCheckout, createPortalSession, contractInsurance, getInsurance } from '../services/billing.js';

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

// POST /billing/checkout { plan_id, discipline_ids?, profile_id?, insurance? } → 201 { url } (página de pago de Stripe)
// insurance: true = contratar el seguro tras el pago; sin él hace falta cobertura de riesgo (waiver firmado antes).
router.post('/checkout', checkSubject, withRlsContext(async (req, client) => ({
  status: 201,
  body: await createCheckout(client, {
    payerId: req.user.id,
    studentId: req.body.profile_id ?? req.user.id,
    planId: req.body.plan_id,
    disciplineIds: req.body.discipline_ids,
    insurance: req.body.insurance ?? false,
  }),
}), { guards: [requireCompleteProfile] }));

// POST /billing/insurance { profile_id? } → 201 { id, status, payment_status?, client_secret? }
// Contratar el seguro después (solo el pagador de la suscripción). client_secret → stripe.handleNextAction (3DS).
router.post('/insurance', checkSubject, withRlsContext(async (req, client) => ({
  status: 201,
  body: await contractInsurance(client, { payerId: req.user.id, studentId: req.body.profile_id ?? req.user.id }),
}), { guards: [requireCompleteProfile] }));

// GET /billing/insurance?profile_id= → { id, status, bracket, current_period_end, cancel_at_period_end, ... }
// Tras el Checkout con seguro, el pagador consulta aquí si el primer cobro pide 3DS.
router.get('/insurance', (req, res, next) => (req.query.profile_id === undefined || UUID_RE.test(req.query.profile_id)
  ? next() : next(httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' }))),
withRlsContext(async (req, client) => getInsurance(client, { userId: req.user.id, studentId: req.query.profile_id ?? req.user.id })));

// POST /billing/portal → { url }
router.post('/portal', withRlsContext(async (req, client) => createPortalSession(client, req.user.id)));

export default router;
