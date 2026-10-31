// src/routes/admin/reports.js — informes del admin (B17; CONTEXT § Informes). Lectura por el client RLS.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { getSubscriptionStats, getSessionStats, getStudentStats } from '../../services/reports.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// GET /admin/reports/subscriptions?group=day|month&from&to → foto diaria; un día o mes sin foto, a null
router.get('/subscriptions', withRlsContext((req, client) => getSubscriptionStats(client, req.query)));
// GET /admin/reports/sessions?by=discipline|class&from&to&discipline_id[&limit&offset] → ocupación y asistencia
router.get('/sessions', withRlsContext((req, client) => getSessionStats(client, req.query)));
// GET /admin/reports/students?from&to&discipline_id&limit&offset → asistencia por alumno, por nombre
router.get('/students', withRlsContext((req, client) => getStudentStats(client, req.query)));

export default router;
