// src/routes/admin/billing.js — baja de suscripciones (B11, adelantada a B10). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { cancelSubscription } from '../../services/billing.js';

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

export default router;
