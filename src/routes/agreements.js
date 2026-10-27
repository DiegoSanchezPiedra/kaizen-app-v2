// src/routes/agreements.js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { withRls } from '../db/rls.js';
import { getCurrentVersions } from '../services/agreements.js';

const router = Router();

// ------------------------------------------------------------
// GET /agreements/:type/current
// Sirve el documento vigente del tipo indicado.
//
// B4.5: placeholder text/plain. B4.5.1 lo sustituye por la lectura
// del PDF publicado desde AGREEMENTS_STORAGE_PATH, sin cambiar la firma.
//
// Auth: requireAuth (el alumno debe estar logueado para firmar;
// el documento no es secreto pero no lo exponemos a anónimos).
// ------------------------------------------------------------
router.get(
  '/:type/current',
  requireAuth,
  async (req, res, next) => {
    try {
      const { type } = req.params;
      const versions = await withRls(
        { uid: req.user.id, role: req.user.role },
        (client) => getCurrentVersions(client)
      );

      if (!Object.hasOwn(versions, type)) {
        return res.status(404).json({
          error: 'not_found',
          code: 'unknown_agreement_type',
          allowed: Object.keys(versions),
        });
      }

      const version = versions[type];

      // Placeholder B4.5 — B4.5.1 sirve el PDF real.
      res.type('text/plain; charset=utf-8');
      res.set('X-Agreement-Type', type);
      res.set('X-Agreement-Version', version);
      res.send(
        `Kaizen App — ${type} v${version}\n\n` +
        `Placeholder de B4.5. El documento real se sirve desde B4.5.1, ` +
        `cuando el admin pueda subirlo desde el panel.\n`
      );
    } catch (err) {
      next(err);
    }
  }
);

export default router;