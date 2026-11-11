// src/routes/admin/panel.js — lecturas del panel (B19.1): ajustes, auditoría, avisos de la academia y entregas fallidas.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { getSettings, listAudit, listNotices, listFailedDeliveries, getHome } from '../../services/panel.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// GET /admin/home → { trained, students, attendance, sessions, next }: el Inicio en vivo (B23)
router.get('/home', withRlsContext((req, client) => getHome(client)));
// GET /admin/settings → { checkin, discipline_changes, pause }: lo que devuelven los tres PUT
router.get('/settings', withRlsContext((req, client) => getSettings(client)));
// GET /admin/audit?action&actor_id&resource_type&resource_id&from&to&limit&offset → { rows, total, limit, offset } (sin notice.*)
router.get('/audit', withRlsContext((req, client) => listAudit(client, req.query)));
// GET /admin/notices?limit&offset → los notice.* con algún admin entre sus destinatarios
router.get('/notices', withRlsContext((req, client) => listNotices(client, req.query)));
// GET /admin/notice-deliveries?from&limit&offset → solo las failed
router.get('/notice-deliveries', withRlsContext((req, client) => listFailedDeliveries(client, req.query)));

export default router;
