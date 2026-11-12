// src/routes/billing.js — contratar y portal. Paga el propio alumno adulto o un tutor por su hijo (CONTEXT § Pagador).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext, blockMinor } from '../middleware/auth.js';
import { requireCompleteProfile } from '../middleware/requireCompleteProfile.js';
import { httpError } from '../lib/errors.js';
import {
  createCheckout, createPortalSession, getSubscription, changePlan, cancelScheduledChange, changeDiscipline,
  getPayerChange, assertNewPayer, payerChangeCheckout, requestPause, endPause, liveSubscriptionId,
} from '../services/billing.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
// B32: un menor con acceso propio no paga, no pausa ni ve la cuota (403 minor_restricted).
router.use(requireAuth, requireRole('alumno', 'tutor'), blockMinor);

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

// POST /billing/checkout { plan_id, discipline_ids?, profile_id? } → 201 { url } (página de pago de Stripe).
// Un campo desconocido → 400 (también uno retirado, B28): no se ignora en silencio.
const CHECKOUT_FIELDS = ['plan_id', 'discipline_ids', 'profile_id'];
const checkoutFields = (req, res, next) => {
  const bad = Object.keys(req.body ?? {}).find((k) => !CHECKOUT_FIELDS.includes(k));
  if (bad === undefined) return next();
  return next(httpError(400, 'invalid_field', `Campo desconocido: ${bad}`, { field: bad }));
};
router.post('/checkout', checkoutFields, checkSubject, withRlsContext(async (req, client) => ({
  status: 201,
  body: await createCheckout(client, {
    payerId: req.user.id,
    studentId: req.body.profile_id ?? req.user.id,
    planId: req.body.plan_id,
    disciplineIds: req.body.discipline_ids,
  }),
}), { guards: [requireCompleteProfile] }));

// --- Cambio de plan y de disciplina (B10.5). Quién puede, lo decide el servicio por la suscripción. ---

router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

// GET /billing/subscription?profile_id= → { id, status, plan, disciplines, current_period_end, cancel_at_period_end,
//   scheduled_change, discipline_changes_left, payer_change, pause, pause_settings }
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

// --- Pausa (B30): la pide el pagador por la suscripción viva del alumno (profile_id; sin él, quien llama). ---
const pauseSubject = (req, res, next) => {
  const id = req.body?.profile_id ?? req.query.profile_id;
  if (id === undefined || UUID_RE.test(id)) return next();
  return next(httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' }));
};
const pauseOf = async (req, client) =>
  liveSubscriptionId(client, req.body?.profile_id ?? req.query.profile_id ?? req.user.id);

// POST /billing/pause { profile_id?, months } → 201 { id, status: 'scheduled', months, starts_at, ends_at, price_cents,
//   exempt, cancelled_bookings }. Empieza en la siguiente fecha de cobro.
router.post('/pause', pauseSubject, withRlsContext(async (req, client) => requestPause(client, {
  id: await pauseOf(req, client), actorId: req.user.id, isAdmin: false, months: req.body?.months,
})));

// DELETE /billing/pause { profile_id? } (o ?profile_id=) → 200 { id, status: 'cancelled', ends_at } si no había empezado
//   (anulada); { id, status: 'active', ends_at } si ya había empezado (vuelve en la siguiente fecha de cobro).
router.delete('/pause', pauseSubject, withRlsContext(async (req, client) => endPause(client, {
  id: await pauseOf(req, client), actorId: req.user.id, isAdmin: false,
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
