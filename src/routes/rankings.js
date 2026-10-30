// src/routes/rankings.js — ranking mensual por disciplina (B14). Cualquier perfil con sesión, sin perfil completo.
import { Router } from 'express';
import { requireAuth, withRlsContext } from '../middleware/auth.js';
import { parseId } from '../services/catalog.js';
import { getRanking } from '../services/progress.js';

const router = Router();
router.use(requireAuth);
router.param('disciplineId', (req, res, next, v) => {
  try { parseId(v); next(); } catch (err) { next(err); }
});

// GET /rankings/:disciplineId?month=&limit=&offset= → { discipline, month, rows, total, limit, offset }
router.get('/:disciplineId', withRlsContext(async (req, client) =>
  getRanking(client, { ...req.query, disciplineId: req.params.disciplineId })));

export default router;
