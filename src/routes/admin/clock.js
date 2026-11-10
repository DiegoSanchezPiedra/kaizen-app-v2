// src/routes/admin/clock.js — registro de jornada en el panel (B31; CONTEXT § Registro de jornada). Solo admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { withRls } from '../../db/rls.js';
import { invalid } from '../../services/catalog.js';
import {
  setEmployment, getMonth, adminCorrection, noticeCorrected, resolveCorrection, exportCsv,
} from '../../services/clock.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// PUT /admin/profiles/:id/employment { employment: 'employee' | 'self_employed' } → { profile_id, employment }
router.put('/profiles/:id/employment', withRlsContext((req, client) => setEmployment(client, {
  profileId: req.params.id, employment: req.body?.employment, actorId: req.user.id })));

// GET /admin/clock?profile_id&month → como GET /me/clock
router.get('/clock', withRlsContext((req, client) =>
  getMonth(client, { profileId: req.query.profile_id, month: req.query.month })));

// GET /admin/clock/export?profile_id&month&format=csv → text/csv (UTF-8 con BOM)
router.get('/clock/export', async (req, res, next) => {
  try {
    if (req.query.format !== 'csv') throw invalid('format', 'format debe ser csv');
    const { month, csv } = await withRls({ uid: req.user.id, role: req.user.role }, (client) =>
      exportCsv(client, { profileId: req.query.profile_id, month: req.query.month }));
    res.set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="registro-jornada-${month}-${req.query.profile_id}.csv"`)
      .send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /admin/clock/corrections { profile_id, event_id?, kind?, at?, reason } → 201 corrección aplicada; aviso al profesor.
router.post('/clock/corrections', async (req, res, next) => {
  try {
    const c = await withRls({ uid: req.user.id, role: req.user.role }, (client) => adminCorrection(client, { actorId: req.user.id, body: req.body }));
    await noticeCorrected(c, req.body.profile_id, req.user.id);
    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

// POST /admin/clock/corrections/:id/apply → corrección; …/reject { reason } → corrección
for (const [path, status] of [['apply', 'applied'], ['reject', 'rejected']]) {
  router.post(`/clock/corrections/:id/${path}`, withRlsContext((req, client) => resolveCorrection(client, {
    id: req.params.id, status, body: req.body, actorId: req.user.id })));
}

export default router;
