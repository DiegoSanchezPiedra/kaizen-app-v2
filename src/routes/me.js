// src/routes/me.js
import { Router } from 'express';
import { httpError } from '../lib/errors.js';
import { requireAuth, withRlsContext } from '../middleware/auth.js';
import { getProfileStatus, upsertHealthInfo, HEALTH_FIELDS } from '../services/profile.js';
import { signAgreement } from '../services/agreements.js';

const router = Router();

// ------------------------------------------------------------
// GET /me/profile-status
// Devuelve el estado de completitud del perfil del alumno.
// Útil para que el frontend pinte el onboarding sin provocar 403.
// Respuesta: { ok: true } | { ok: false, missing: [...] }
// ------------------------------------------------------------
router.get(
  '/profile-status',
  requireAuth,
  withRlsContext((req, client) =>
    getProfileStatus(client, req.user.id, req.user.role)
  )
);

// ------------------------------------------------------------
// POST /me/health
// Upsert de student_health_info para el alumno autenticado.
// Body: { injuries?, conditions?, previous_experience?,
//         previous_discipline?, medication?, allergies?,
//         emergency_contact_name?, emergency_contact_phone? }
// Todos opcionales. requireCompleteProfile exige emergency_contact_*.
// ------------------------------------------------------------
// Validación fuera de la transacción (antes de pedir conexión).
function validateHealth(req, res, next) {
  const body = req.body ?? {};
  const provided = HEALTH_FIELDS.filter((k) =>
    Object.prototype.hasOwnProperty.call(body, k)
  );

  if (provided.length === 0) {
    return next(
      httpError(400, 'no_fields', 'Ningún campo válido en el body.', {
        allowed: HEALTH_FIELDS,
      })
    );
  }

  // Validación básica: strings o null. Nada de arrays/objetos.
  const bad = provided.find((k) => body[k] !== null && typeof body[k] !== 'string');
  if (bad) {
    return next(
      httpError(400, 'invalid_field_type', `Campo inválido: ${bad}`, { field: bad })
    );
  }
  return next();
}

router.post(
  '/health',
  requireAuth,
  validateHealth,
  withRlsContext(async (req, client) => ({
    health: await upsertHealthInfo(client, req.user.id, req.body),
  }))
);

// ------------------------------------------------------------
// POST /me/agreements
// Firma (registra) un agreement para el alumno autenticado.
// Body: { type, version }
// Valida (en el servicio): type conocido, version === versión vigente.
// Registra ip y user_agent.
// 409 si ya existe (profile_id, type, version) firmado.
// ------------------------------------------------------------
router.post(
  '/agreements',
  requireAuth,
  withRlsContext(async (req, client) => ({
    agreement: await signAgreement(client, {
      profileId: req.user.id,
      type: req.body?.type,
      version: req.body?.version,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }),
  }))
);

export default router;