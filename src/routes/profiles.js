// src/routes/profiles.js — directorio y fichas públicas (B13). Cualquier perfil con sesión, sin perfil completo.
import { Router } from 'express';
import { requireAuth, withRlsContext } from '../middleware/auth.js';
import { httpError } from '../lib/errors.js';
import { listPublicProfiles, getPublicProfile } from '../services/profiles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth);
router.param('id', (req, res, next, v) => (UUID_RE.test(v) ? next() : next(httpError(400, 'invalid_id', 'id inválido'))));

// GET /profiles?q=&role=&discipline_id=&limit=&offset= → { profiles: [ficha], total, limit, offset }
router.get('/', withRlsContext(async (req, client) => listPublicProfiles(client, req.query)));

// GET /profiles/:id → { profile: ficha }; 404 profile_not_found (también si no es público)
router.get('/:id', withRlsContext(async (req, client) => ({ profile: await getPublicProfile(client, req.params.id) })));

export default router;
