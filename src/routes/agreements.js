// src/routes/agreements.js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withRls } from '../db/rls.js';
import { httpError } from '../lib/errors.js';
import { AGREEMENT_TYPES } from '../config/agreements.js';
import { getCurrentDocument } from '../services/agreements.js';
import { readFile } from '../services/storage.js';

const router = Router();

// GET /agreements/:type/current — sirve el PDF vigente del tipo.
// Auth: requireAuth (el documento no es secreto pero no se expone a anónimos).
router.get(
  '/:type/current',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    if (!AGREEMENT_TYPES.includes(type)) {
      throw httpError(404, 'unknown_agreement_type', 'Tipo desconocido', { allowed: AGREEMENT_TYPES });
    }
    const doc = await withRls({ uid: req.user.id, role: req.user.role }, (client) =>
      getCurrentDocument(client, type)
    );
    if (!doc) throw httpError(404, 'no_current_document', 'No hay documento vigente', { type });

    res.type(doc.mime_type);
    res.set('X-Agreement-Type', type);
    res.set('X-Agreement-Version', doc.version);
    res.send(await readFile(doc.storage_path));
  })
);

export default router;
