// src/routes/admin/checkin.js — tablets (vincular con código de un solo uso, revocar) y parámetros del
// check-in (CONTEXT § Asistencia). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { httpError } from '../../lib/errors.js';
import { createTablet, listTablets, revokeTablet, updateCheckinSettings } from '../../services/checkin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 100;

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

router.get('/tablets', withRlsContext(async (req, client) => ({ tablets: await listTablets(client) })));

// POST /admin/tablets { name } → { tablet: { …, link_code } }: el código se muestra solo aquí.
router.post('/tablets', withRlsContext(async (req, client) => {
  const name = req.body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) {
    throw httpError(400, 'invalid_field', `name requerido (máx. ${MAX_NAME} caracteres)`, { field: 'name' });
  }
  return { status: 201, body: { tablet: await createTablet(client, { name: name.trim(), actorId: req.user.id }) } };
}));

router.post('/tablets/:id/revoke', withRlsContext(async (req, client) => ({
  tablet: await revokeTablet(client, req.params.id),
})));

// PUT /admin/settings/checkin { opens_minutes?, closes_minutes?, qr_seconds? } → valores vigentes.
router.put('/settings/checkin', withRlsContext(async (req, client) => ({
  settings: await updateCheckinSettings(client, req.body ?? {}),
})));

export default router;
