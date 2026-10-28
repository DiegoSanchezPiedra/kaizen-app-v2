// src/routes/professor.js — el profesor ve solo las sesiones que imparte (la RLS lo garantiza además).
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { listTrainerSessions, getTrainerSession } from '../services/sessions.js';
import { getSessionHealth } from '../services/attendance.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth, requireRole('profesor'));

router.param('id', (req, res, next, id) =>
  UUID_RE.test(id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')));

router.get('/sessions', withRlsContext(async (req, client) => ({
  sessions: await listTrainerSessions(client, req.user.id, req.query),
})));
router.get('/sessions/:id', withRlsContext(async (req, client) => ({
  session: await getTrainerSession(client, req.user.id, req.params.id),
})));
// Ficha de salud de los alumnos con reserva, solo de sus sesiones de hoy; la BD lo restringe y audita.
router.get('/sessions/:id/health', withRlsContext(async (req, client) => ({
  students: await getSessionHealth(client, req.params.id),
})));

export default router;
