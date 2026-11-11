// src/routes/admin/billing.js — bajas de suscripciones y cambio de pagador (B11), morosos (B10.2), cambio de plan y de
// disciplina (B10.5) y pausa (B30). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import {
  cancelSubscription, listOverduePayers,
  changePlan, cancelScheduledChange, changeDiscipline, updateDisciplineChangeSettings,
  requestPayerChange, cancelPayerChange, getPayerChange, listPayerChanges,
  requestPause, endPause, exemptPause, updatePauseSettings,
} from '../../services/billing.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

// POST /admin/subscriptions/:id/cancel-now → baja inmediata (pierde la cobertura al llegar el webhook)
router.post('/subscriptions/:id/cancel-now', withRlsContext(async (req, client) => ({
  subscription: await cancelSubscription(client, { id: req.params.id, atPeriodEnd: false, actorId: req.user.id }),
})));

// POST /admin/subscriptions/:id/cancel-at-period-end → sigue en vigor hasta el fin de su periodo
router.post('/subscriptions/:id/cancel-at-period-end', withRlsContext(async (req, client) => ({
  subscription: await cancelSubscription(client, { id: req.params.id, atPeriodEnd: true, actorId: req.user.id }),
})));

// POST /admin/subscriptions/:id/payer-change { payer_id } → 201 { id, status, new_payer_id, plan_id, discipline_ids,
//   starts_at, deadline }. Cambio de pagador (B11): el nuevo pagador paga desde la app antes de la fecha límite.
router.post('/subscriptions/:id/payer-change', withRlsContext(async (req, client) =>
  requestPayerChange(client, { id: req.params.id, payerId: req.body?.payer_id, actorId: req.user.id })));
// GET /admin/payer-changes?status&from&subscription_id&limit&offset → { rows, total, limit, offset }
router.get('/payer-changes', withRlsContext(async (req, client) => listPayerChanges(client, req.query)));
// GET /admin/payer-changes/:id → como GET /billing/payer-changes/:id (ese router no admite al admin)
router.get('/payer-changes/:id', withRlsContext(async (req, client) => getPayerChange(client, { id: req.params.id })));
// DELETE /admin/subscriptions/:id/payer-change → 204 (solo si aún no está pagado)
router.delete('/subscriptions/:id/payer-change', withRlsContext(async (req, client) => {
  await cancelPayerChange(client, { id: req.params.id, actorId: req.user.id });
  return { status: 204, body: undefined };
}));

// Cambio de plan y de disciplina (B10.5), como en /billing/subscriptions/:id/... El admin no paga:
// una subida que pide 3DS → 409 requires_payer_action y aviso al pagador.
router.post('/subscriptions/:id/plan', withRlsContext(async (req, client) => changePlan(client, {
  id: req.params.id, actorId: req.user.id, isAdmin: true, planId: req.body?.plan_id, disciplineIds: req.body?.discipline_ids,
})));
router.delete('/subscriptions/:id/plan/scheduled', withRlsContext(async (req, client) => {
  await cancelScheduledChange(client, { id: req.params.id, actorId: req.user.id, isAdmin: true });
  return { status: 204, body: undefined };
}));
router.post('/subscriptions/:id/disciplines', withRlsContext(async (req, client) => changeDiscipline(client, {
  id: req.params.id, actorId: req.user.id, isAdmin: true, fromId: req.body?.from_id, toId: req.body?.to_id,
})));

// Pausa (B30), como POST/DELETE /billing/pause pero por la suscripción: el admin la pide o la anula por el pagador.
router.post('/subscriptions/:id/pause', withRlsContext(async (req, client) => requestPause(client, {
  id: req.params.id, actorId: req.user.id, isAdmin: true, months: req.body?.months,
})));
router.delete('/subscriptions/:id/pause', withRlsContext(async (req, client) =>
  endPause(client, { id: req.params.id, actorId: req.user.id, isAdmin: true })));
// POST /admin/pauses/:id/exempt { reason } → la pausa ({ id, status, months, starts_at, ends_at, price_cents, exempt })
router.post('/pauses/:id/exempt', withRlsContext(async (req, client) =>
  exemptPause(client, { pauseId: req.params.id, actorId: req.user.id, reason: req.body?.reason })));
// PUT /admin/settings/pause { price_cents?, max_months?, per_year? } → valores vigentes (price_cents null = sin pausas)
router.put('/settings/pause', withRlsContext(async (req, client) => ({
  settings: await updatePauseSettings(client, req.body ?? {}, req.user.id),
})));

// PUT /admin/settings/discipline-changes { per_period } → cambios de disciplina por periodo (entero ≥ 0)
router.put('/settings/discipline-changes', withRlsContext(async (req, client) => ({
  settings: await updateDisciplineChangeSettings(client, req.body ?? {}, req.user.id),
})));

// GET /admin/billing/delinquents|grace?limit&offset → pagadores con algo unpaid / solo past_due (CONTEXT § Moroso)
for (const [path, list] of [['delinquents', 'delinquent'], ['grace', 'grace']]) {
  router.get(`/billing/${path}`, withRlsContext(async (req, client) => listOverduePayers(client, { limit: req.query.limit, offset: req.query.offset, list })));
}

export default router;
