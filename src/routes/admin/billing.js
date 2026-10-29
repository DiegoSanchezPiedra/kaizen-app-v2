// src/routes/admin/billing.js — baja de suscripciones (B11, adelantada a B10), parámetros del seguro (B10.3), morosos (B10.2)
// y cambio de plan y de disciplina (B10.5). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import {
  cancelSubscription, updateInsuranceSettings, listOverduePayers,
  changePlan, cancelScheduledChange, changeDiscipline, updateDisciplineChangeSettings,
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

// PUT /admin/settings/discipline-changes { per_period } → cambios de disciplina por periodo (entero ≥ 0)
router.put('/settings/discipline-changes', withRlsContext(async (req, client) => ({
  settings: await updateDisciplineChangeSettings(client, req.body ?? {}, req.user.id),
})));

// PUT /admin/settings/insurance { price_adult_cents?, price_minor_cents?, enabled? } → valores vigentes.
// Activar exige los dos precios; desactivar deja que los seguros vivos terminen sin renovarse.
router.put('/settings/insurance', withRlsContext(async (req, client) => ({
  settings: await updateInsuranceSettings(client, req.body ?? {}, req.user.id),
})));

// GET /admin/billing/delinquents|grace?limit&offset → pagadores con algo unpaid / solo past_due (CONTEXT § Moroso)
for (const [path, list] of [['delinquents', 'delinquent'], ['grace', 'grace']]) {
  router.get(`/billing/${path}`, withRlsContext(async (req, client) => listOverduePayers(client, { limit: req.query.limit, offset: req.query.offset, list })));
}

export default router;
