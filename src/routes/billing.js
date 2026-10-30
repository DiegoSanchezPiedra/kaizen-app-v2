// src/routes/billing.js — contratar y portal. Paga el propio alumno adulto o un tutor por su hijo (CONTEXT § Pagador).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';
import { httpError } from '../lib/errors.js';
import {
  createCheckout, createPortalSession, contractInsurance, getInsurance,
  getSubscription, changePlan, cancelScheduledChange, changeDiscipline,
  getPayerChange, assertNewPayer, payerChangeCheckout,
} from '../services/billing.js';

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

// --- Cambio de plan y de disciplina (B10.5). Quién puede, lo decide el servicio por la suscripción. ---

router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

// GET /billing/subscription?profile_id= → { id, status, plan, disciplines, current_period_end, cancel_at_period_end,
//   scheduled_change, discipline_changes_left, payer_change }
router.get('/subscription', (req, res, next) => (req.query.profile_id === undefined || UUID_RE.test(req.query.profile_id)
  ? next() : next(httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' }))),
withRlsContext(async (req, client) => getSubscription(client, { studentId: req.query.profile_id ?? req.user.id })));

// POST /billing/subscriptions/:id/plan { plan_id, discipline_ids } →
//   subida 200 { change: 'upgrade', status: 'applied' | 'requires_action', client_secret? } (stripe.handleNextAction)
//   bajada 202 { change: 'downgrade', scheduled_at }
router.post('/subscriptions/:id/plan', withRlsContext(async (req, client) => changePlan(client, {
  id: req.params.id, actorId: req.user.id, isAdmin: false, planId: req.body?.plan_id, disciplineIds: req.body?.discipline_ids,
})));

// DELETE /billing/subscriptions/:id/plan/scheduled → 204 (anula la bajada programada)
router.delete('/subscriptions/:id/plan/scheduled', withRlsContext(async (req, client) => {
  await cancelScheduledChange(client, { id: req.params.id, actorId: req.user.id, isAdmin: false });
  return { status: 204, body: undefined };
}));

// POST /billing/subscriptions/:id/disciplines { from_id, to_id } → { disciplines, changes_left, free }
router.post('/subscriptions/:id/disciplines', withRlsContext(async (req, client) => changeDiscipline(client, {
  id: req.params.id, actorId: req.user.id, isAdmin: false, fromId: req.body?.from_id, toId: req.body?.to_id,
})));

// --- Cambio de pagador (B11): el nuevo pagador abre el enlace del aviso en la app y paga aquí. ---

// GET /billing/payer-changes/:id → { id, status, student, plan, price_cents, disciplines, starts_at, deadline }
router.get('/payer-changes/:id', withRlsContext(async (req, client) => getPayerChange(client, { id: req.params.id })));

// Sujeto de requireCompleteProfile = el alumno del cambio. Antes, el 403 not_new_payer (también al tutor desvinculado).
const asNewPayer = async (req, client) => {
  const pc = await assertNewPayer(client, { id: req.params.id, userId: req.user.id });
  req.body = { profile_id: pc.student_id };
};

// POST /billing/payer-changes/:id/checkout → { url } (Checkout de 0 € hoy; cobra desde el fin del periodo en curso)
router.post('/payer-changes/:id/checkout', withRlsContext(async (req, client) =>
  payerChangeCheckout(client, { id: req.params.id, payerId: req.user.id }), { guards: [asNewPayer, requireCompleteProfile] }));

// POST /billing/portal → { url }
router.post('/portal', withRlsContext(async (req, client) => createPortalSession(client, req.user.id)));

export default router;
