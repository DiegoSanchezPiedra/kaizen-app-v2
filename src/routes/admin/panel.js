// src/routes/admin/panel.js — lecturas del panel (B19.1): ajustes, auditoría, avisos de la academia y entregas fallidas;
// y el top de los rankings.
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { getSettings, listAudit, listNotices, listFailedDeliveries, getHome } from '../../services/panel.js';
import { updateRankingSettings } from '../../services/progress.js';
import { countAudience, createCommunique, listCommuniques, withdrawCommunique } from '../../services/communiques.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// GET /admin/home → { trained, students, attendance, sessions, next }: el Inicio en vivo (B23)
router.get('/home', withRlsContext((req, client) => getHome(client)));
// GET /admin/settings → { checkin, discipline_changes, pause, rankings }: lo que devuelven los cuatro PUT
router.get('/settings', withRlsContext((req, client) => getSettings(client)));
// PUT /admin/settings/rankings { top } → { settings: { top } }: puestos de los dos rankings (entero de 1 a 100)
router.put('/settings/rankings', withRlsContext(async (req, client) => ({
  settings: await updateRankingSettings(client, req.body ?? {}, req.user.id),
})));
// GET /admin/audit?action&actor_id&resource_type&resource_id&from&to&limit&offset → { rows, total, limit, offset } (sin notice.*)
router.get('/audit', withRlsContext((req, client) => listAudit(client, req.query)));
// GET /admin/notices?limit&offset → los notice.* con algún admin entre sus destinatarios
router.get('/notices', withRlsContext((req, client) => listNotices(client, req.query)));
// GET /admin/notice-deliveries?from&limit&offset → solo las failed
router.get('/notice-deliveries', withRlsContext((req, client) => listFailedDeliveries(client, req.query)));

// Comunicados (ADR 0030). Escriben con el servicePool (destinatarios y outbox); este router ya exige admin.
// GET  /admin/communiques?limit&offset → { rows, total, limit, offset } (cada fila con seen)
router.get('/communiques', withRlsContext((req, client) => listCommuniques(client, req.query)));
// GET  /admin/communiques/audience?audience&discipline_ids=1,2 → { app, email }: la vista previa antes de enviar
router.get('/communiques/audience', async (req, res, next) => {
  try { res.json(await countAudience(req.query)); } catch (err) { next(err); }
});
// POST /admin/communiques { title, body, audience, discipline_ids?, channels } → 201 el comunicado
router.post('/communiques', async (req, res, next) => {
  try { res.status(201).json(await createCommunique(req.user.id, req.body ?? {})); } catch (err) { next(err); }
});
// POST /admin/communiques/:id/withdraw → { withdrawn_at }; 404, 409 communique_withdrawn
router.post('/communiques/:id/withdraw', async (req, res, next) => {
  try { res.json(await withdrawCommunique(req.user.id, req.params.id)); } catch (err) { next(err); }
});

export default router;
