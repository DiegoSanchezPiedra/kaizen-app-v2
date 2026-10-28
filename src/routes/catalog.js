// src/routes/catalog.js — lectura del catálogo para cualquier perfil con sesión (RLS oculta los retirados).
import { Router } from 'express';
import { requireAuth, withRlsContext } from '../middleware/auth.js';
import { listDisciplines, listPlans } from '../services/catalog.js';

const router = Router();
router.get('/disciplines', requireAuth, withRlsContext(async (req, client) => ({
  disciplines: await listDisciplines(client),
})));
router.get('/plans', requireAuth, withRlsContext(async (req, client) => ({ plans: await listPlans(client) })));

export default router;
