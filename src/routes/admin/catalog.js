// src/routes/admin/catalog.js
import { Router } from 'express';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import {
  parseId, listDisciplines, createDiscipline, updateDiscipline,
  listPlans, createPlan, updatePlan, getEligibleDisciplines, setEligibleDisciplines,
} from '../../services/catalog.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Valida :id antes de abrir transacción.
router.param('id', (req, res, next, id) => {
  try { parseId(id); next(); } catch (err) { next(err); }
});

router.get('/disciplines', withRlsContext(async (req, client) => ({
  disciplines: await listDisciplines(client),
})));
router.post('/disciplines', withRlsContext(async (req, client) => ({
  status: 201, body: { discipline: await createDiscipline(client, req.body ?? {}) },
})));
router.patch('/disciplines/:id', withRlsContext(async (req, client) => ({
  discipline: await updateDiscipline(client, { id: req.params.id, body: req.body ?? {}, actorId: req.user.id }),
})));

router.get('/plans', withRlsContext(async (req, client) => ({ plans: await listPlans(client) })));
router.post('/plans', withRlsContext(async (req, client) => ({
  status: 201, body: { plan: await createPlan(client, req.body ?? {}) },
})));
router.patch('/plans/:id', withRlsContext(async (req, client) => ({
  plan: await updatePlan(client, { id: req.params.id, body: req.body ?? {}, actorId: req.user.id }),
})));

router.get('/plans/:id/disciplines', withRlsContext(async (req, client) => ({
  discipline_ids: await getEligibleDisciplines(client, req.params.id),
})));
router.put('/plans/:id/disciplines', withRlsContext(async (req, client) => ({
  discipline_ids: await setEligibleDisciplines(client, {
    planId: req.params.id, ids: req.body?.discipline_ids, actorId: req.user.id,
  }),
})));

export default router;
