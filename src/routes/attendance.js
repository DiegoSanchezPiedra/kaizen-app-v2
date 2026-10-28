// src/routes/attendance.js — pasar lista, cerrarla y corregirla (CONTEXT § Asistencia). Profesor de la
// sesión (sustituto incluido) y admin; las funciones SQL deciden si la sesión es suya.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { getAttendance, markAttendance, closeAttendance, correctAttendance } from '../services/attendance.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;

const router = Router();
router.use(requireAuth, requireRole('profesor', 'admin'));

for (const p of ['id', 'studentId']) {
  router.param(p, (req, res, next, v) =>
    UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', `${p} inválido`)));
}

const invalid = (field, msg) => httpError(400, 'invalid_field', msg, { field });

// GET /sessions/:id/attendance → { closed_at, students: [{ booking_id, student_id, display_name, status, … }] }
router.get('/:id/attendance', withRlsContext(async (req, client) => getAttendance(client, req.params.id)));

// PUT /sessions/:id/attendance/:studentId { present: boolean } — marcar o desmarcar antes del cierre.
router.put('/:id/attendance/:studentId', withRlsContext(async (req, client) => {
  if (typeof req.body?.present !== 'boolean') throw invalid('present', 'present debe ser booleano');
  return markAttendance(client, { sessionId: req.params.id, studentId: req.params.studentId, present: req.body.present });
}));

// POST /sessions/:id/attendance/close → { present, absent }
router.post('/:id/attendance/close', withRlsContext(async (req, client) => closeAttendance(client, req.params.id)));

// POST /sessions/:id/attendance/:studentId/correct { status: 'present'|'absent', reason }
router.post('/:id/attendance/:studentId/correct', withRlsContext(async (req, client) => {
  const { status, reason } = req.body ?? {};
  if (status !== 'present' && status !== 'absent') throw invalid('status', "status debe ser 'present' o 'absent'");
  if (typeof reason !== 'string' || !reason.trim() || reason.length > MAX_REASON) {
    throw invalid('reason', `reason requerido (máx. ${MAX_REASON} caracteres)`);
  }
  return { attendance: await correctAttendance(client, {
    sessionId: req.params.id, studentId: req.params.studentId, status, reason,
  }) };
}));

export default router;
