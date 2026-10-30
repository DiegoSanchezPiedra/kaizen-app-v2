// src/routes/sessions.js — calendario de la academia (CONTEXT § Clases y sesiones). Ver no exige perfil completo.
// El profesor ve sus sesiones en /professor/sessions. Se monta antes que attendance.js, que cierra /sessions a profesor y admin.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { listCalendar } from '../services/sessions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

// GET /sessions/calendar?from=&to=&discipline_id=&profile_id= (profile_id: solo admin) → { sessions }
router.get(
  '/calendar',
  requireAuth,
  requireRole('alumno', 'tutor', 'admin'),
  (req, res, next) => (req.query.profile_id !== undefined && !UUID_RE.test(req.query.profile_id)
    ? next(httpError(400, 'invalid_field', 'profile_id debe ser un uuid', { field: 'profile_id' })) : next()),
  withRlsContext(async (req, client) => ({ sessions: await listCalendar(client, req.user, req.query) }))
);

export default router;
