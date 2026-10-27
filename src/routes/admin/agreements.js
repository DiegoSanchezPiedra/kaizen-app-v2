// src/routes/admin/agreements.js
import express, { Router } from 'express';
import { httpError } from '../../lib/errors.js';
import { requireAuth, requireRole, withRlsContext } from '../../middleware/auth.js';
import { createDocument, listDocuments, publishDocument } from '../../services/agreements.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/documents', withRlsContext(async (req, client) => ({
  documents: await listDocuments(client),
})));

// Sube el PDF como cuerpo crudo: POST /admin/agreements/documents?type=waiver&version=1.1
// (Content-Type: application/pdf). Sin multipart para no añadir dependencia.
router.post(
  '/documents',
  express.raw({ type: 'application/pdf', limit: '10mb' }),
  withRlsContext(async (req, client) => ({
    status: 201,
    body: {
      document: await createDocument(client, {
        type: req.query.type,
        version: req.query.version,
        buffer: req.body,
      }),
    },
  }))
);

router.post(
  '/documents/:id/publish',
  (req, res, next) =>
    UUID_RE.test(req.params.id) ? next() : next(httpError(400, 'invalid_id', 'id inválido')),
  withRlsContext(async (req, client) => ({
    document: await publishDocument(client, { id: req.params.id, actorId: req.user.id }),
  }))
);

export default router;
