// src/routes/clock.js — registro de jornada del propio profesor (B31; CONTEXT § Registro de jornada).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { withRls } from '../db/rls.js';
import { clockIn, getMonth, requestCorrection, noticeCorrectionRequested } from '../services/clock.js';

const router = Router();
router.use(requireAuth, requireRole('profesor'));

// GET /me/clock?month=YYYY-MM → { profile, month, state, total_seconds, days, events, corrections }
router.get('/', withRlsContext((req, client) => getMonth(client, { profileId: req.user.id, month: req.query.month })));

// POST /me/clock { kind, code? } → 201 { event, state }. code: el QR de la tablet. Hora del servidor.
router.post('/', withRlsContext(async (req, client) => ({
  status: 201, body: await clockIn(client, { profileId: req.user.id, body: req.body }),
})));

// POST /me/clock/corrections { event_id?, kind?, at?, reason } → 201 corrección pendiente; aviso al panel tras el COMMIT.
router.post('/corrections', async (req, res, next) => {
  try {
    const c = await withRls({ uid: req.user.id, role: req.user.role }, (client) => requestCorrection(client, { profileId: req.user.id, body: req.body }));
    await noticeCorrectionRequested(c, req.user.id);
    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

export default router;
