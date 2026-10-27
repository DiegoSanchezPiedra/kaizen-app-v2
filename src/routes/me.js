// src/routes/me.js
import { Router } from 'express';
import { httpError } from '../lib/errors.js';
import { requireAuth, withRlsContext } from '../middleware/auth.js';
import { getProfileStatus } from '../services/profile.js';
import {
  AGREEMENT_TYPES,
  CURRENT_AGREEMENT_VERSIONS,
} from '../config/agreements.js';

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
const HEALTH_FIELDS = [
  'injuries',
  'conditions',
  'previous_experience',
  'previous_discipline',
  'medication',
  'allergies',
  'emergency_contact_name',
  'emergency_contact_phone',
];

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
  withRlsContext(async (req, client) => {
    const body = req.body;
    const provided = HEALTH_FIELDS.filter((k) =>
      Object.prototype.hasOwnProperty.call(body, k)
    );

    // Upsert: si existe fila, UPDATE solo de los campos proporcionados;
    // si no existe, INSERT con los proporcionados (el resto NULL).
    // ON CONFLICT (profile_id) DO UPDATE.
    const columns = ['profile_id', ...provided];
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const values = [req.user.id, ...provided.map((k) => body[k])];

    const updateSet = provided
      .map((k) => `${k} = EXCLUDED.${k}`)
      .join(', ');

    const sql = `
      INSERT INTO student_health_info (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (profile_id) DO UPDATE SET ${updateSet}
      RETURNING *
    `;

    const result = await client.query(sql, values);
    return { health: result.rows[0] };
  })
);

// ------------------------------------------------------------
// POST /me/agreements
// Firma (registra) un agreement para el alumno autenticado.
// Body: { type, version }
// Valida: type ∈ AGREEMENT_TYPES, version === versión vigente.
// Registra ip y user_agent.
// 409 si ya existe (profile_id, type, version) firmado.
// ------------------------------------------------------------
function validateAgreement(req, res, next) {
  const { type, version } = req.body ?? {};

  if (!type || !AGREEMENT_TYPES.includes(type)) {
    return next(
      httpError(400, 'invalid_type', 'Tipo de agreement inválido', {
        allowed: AGREEMENT_TYPES,
      })
    );
  }

  if (!version || version !== CURRENT_AGREEMENT_VERSIONS[type]) {
    return next(
      httpError(400, 'invalid_version', 'Versión de agreement no vigente', {
        expected: CURRENT_AGREEMENT_VERSIONS[type],
      })
    );
  }
  return next();
}

router.post(
  '/agreements',
  requireAuth,
  validateAgreement,
  withRlsContext(async (req, client) => {
    const { type, version } = req.body;

    const ip = req.ip ?? null;
    const userAgent = req.get('user-agent') ?? null;

    const result = await client.query(
      `INSERT INTO user_agreements
         (id, profile_id, type, version, ip, user_agent)
       VALUES
         ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (profile_id, type, version) DO NOTHING
       RETURNING id, type, version, signed_at`,
      [
        crypto.randomUUID(),
        req.user.id,
        type,
        version,
        ip,
        userAgent,
      ]
    );

    if (result.rows.length === 0) {
      throw httpError(409, 'agreement_already_signed', 'Agreement ya firmado', {
        type,
        version,
      });
    }

    return { agreement: result.rows[0] };
  })
);

export default router;