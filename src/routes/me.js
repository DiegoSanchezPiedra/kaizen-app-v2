// src/routes/me.js
import { Router } from 'express';
import { httpError } from '../lib/errors.js';
import { requireAuth, requireRole, withRlsContext } from '../middleware/auth.js';
import {
  getProfileStatus,
  upsertHealthInfo,
  HEALTH_FIELDS,
  assertGuardianOf,
  listChildren,
  createChild,
  updateChild,
  CHILD_FIELDS,
} from '../services/profile.js';
import { signAgreement } from '../services/agreements.js';
import { getMyProfile, updateMyProfile, VISIBLE_FIELDS, SOCIAL_NETWORKS } from '../services/profiles.js';
import { getProgress } from '../services/progress.js';
import { isValidPastDate } from '../services/auth.js';

const router = Router();

// profile_id (opcional, body o query): hijo por el que actúa un tutor vinculado.
// Sin él, el sujeto es el propio usuario. La RLS decide si el tutor puede.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSubject(req, res, next) {
  const id = req.body?.profile_id ?? req.query?.profile_id;
  if (id !== undefined && !UUID_RE.test(id)) {
    return next(httpError(400, 'invalid_profile_id', 'profile_id debe ser un uuid'));
  }
  return next();
}

// ------------------------------------------------------------
// GET /me/profile-status?profile_id=
// Devuelve el estado de completitud del perfil del alumno (o de su hijo).
// Útil para que el frontend pinte el onboarding sin provocar 403.
// Respuesta: { ok, missing?, risk_cover? } (risk_cover: cobertura de riesgo del alumno, B10.3)
// ------------------------------------------------------------
router.get(
  '/profile-status',
  requireAuth,
  validateSubject,
  withRlsContext(async (req, client) => {
    const subject = req.query.profile_id;
    if (!subject || subject === req.user.id) {
      return getProfileStatus(client, req.user.id, req.user.role);
    }
    await assertGuardianOf(client, subject);
    return getProfileStatus(client, subject, 'alumno');
  })
);

// ------------------------------------------------------------
// POST /me/health
// Upsert de student_health_info para el alumno autenticado o su hijo.
// Body: { profile_id?, injuries?, conditions?, previous_experience?,
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
  validateSubject,
  validateHealth,
  withRlsContext(async (req, client) => {
    try {
      return { health: await upsertHealthInfo(client, req.body.profile_id ?? req.user.id, req.body) };
    } catch (err) {
      // 42501 = violación de política RLS (no es tutor vigente del sujeto).
      if (err.code === '42501') throw httpError(403, 'not_guardian', 'No eres tutor de este perfil');
      throw err;
    }
  })
);

// ------------------------------------------------------------
// POST /me/agreements
// Firma (registra) un agreement para el alumno autenticado.
// Body: { type, version, profile_id? }
// profile_id (opcional): menor por el que firma un tutor vinculado; la RLS
// de user_agreements decide si procede. signed_by es siempre el autenticado.
// Valida (en el servicio): type conocido, version === versión vigente.
// Registra ip y user_agent.
// 409 si ya existe (profile_id, type, version) firmado.
// ------------------------------------------------------------

router.post(
  '/agreements',
  requireAuth,
  validateSubject,
  withRlsContext(async (req, client) => {
    try {
      return {
        agreement: await signAgreement(client, {
          profileId: req.body?.profile_id ?? req.user.id,
          signedBy: req.user.id,
          type: req.body?.type,
          version: req.body?.version,
          ip: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        }),
      };
    } catch (err) {
      // 42501 = violación de política RLS (no es tutor vinculado, o el sujeto no es menor).
      if (err.code === '42501') throw httpError(403, 'not_allowed_to_sign', 'No puedes firmar por este perfil');
      throw err;
    }
  })
);

// ------------------------------------------------------------
// Cuenta familiar (ADR 0002): el tutor da de alta y gestiona a sus hijos.
// GET   /me/children      → [{ id, display_name, birth_date, pending_claim }]
// POST  /me/children      Body: { display_name, birth_date }  (menor de 18)
// PATCH /me/children/:id  Body: { display_name?, birth_date? }
// pending_claim = cumplió 18 sin reclamar su perfil: solo lectura (D16).
// ------------------------------------------------------------
function validateChild(req, res, next) {
  const body = req.body ?? {};
  const provided = CHILD_FIELDS.filter((k) => Object.hasOwn(body, k));
  if (req.method === 'POST' && provided.length !== CHILD_FIELDS.length) {
    return next(httpError(400, 'invalid_payload', 'display_name y birth_date requeridos'));
  }
  if (provided.length === 0) {
    return next(httpError(400, 'no_fields', 'Ningún campo válido en el body.', { allowed: CHILD_FIELDS }));
  }
  if (provided.includes('display_name') && (typeof body.display_name !== 'string' || !body.display_name.trim())) {
    return next(httpError(400, 'invalid_field_type', 'Campo inválido: display_name', { field: 'display_name' }));
  }
  if (provided.includes('birth_date') && !isValidPastDate(body.birth_date)) {
    return next(httpError(400, 'invalid_birth_date', 'birth_date (YYYY-MM-DD, pasada) requerido'));
  }
  if (req.params.id !== undefined && !UUID_RE.test(req.params.id)) {
    return next(httpError(400, 'invalid_profile_id', 'id debe ser un uuid'));
  }
  return next();
}

router.get(
  '/children',
  requireAuth,
  withRlsContext(async (req, client) => ({ children: await listChildren(client, req.user.id) }))
);

router.post(
  '/children',
  requireAuth,
  validateChild,
  withRlsContext(async (req, client) => ({
    status: 201,
    body: {
      child: await createChild(client, {
        displayName: req.body.display_name.trim(),
        birthDate: req.body.birth_date,
      }),
    },
  }))
);

router.patch(
  '/children/:id',
  requireAuth,
  validateChild,
  withRlsContext(async (req, client) => ({
    child: await updateChild(client, req.params.id, req.body),
  }))
);

// ------------------------------------------------------------
// Perfil público propio (B13). Sin profile_id: un tutor nunca edita el perfil público de un hijo.
// GET   /me/profile → { is_public, eligible, visible_fields, bio, social_links }
// PATCH /me/profile { is_public?, visible_fields?, bio?, social_links? } → igual; 403 not_eligible
// ------------------------------------------------------------
const PROFILE_FIELDS = ['is_public', 'visible_fields', 'bio', 'social_links'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUrl = (v) => typeof v === 'string' && v.length <= 200 && v.startsWith('https://') && URL.canParse(v);
const PROFILE_CHECKS = {
  is_public: (v) => typeof v === 'boolean',
  visible_fields: (v) => isPlainObject(v)
    && Object.entries(v).every(([k, b]) => VISIBLE_FIELDS.includes(k) && typeof b === 'boolean'),
  bio: (v) => v === null || (typeof v === 'string' && v.length <= 500),
  social_links: (v) => v === null || (isPlainObject(v)
    && Object.entries(v).every(([k, url]) => SOCIAL_NETWORKS.includes(k) && isUrl(url))),
};

function validateProfile(req, res, next) {
  const body = req.body ?? {};
  const bad = Object.keys(body).find((k) => !PROFILE_FIELDS.includes(k) || !PROFILE_CHECKS[k](body[k]));
  if (bad) return next(httpError(400, 'invalid_field', `Campo inválido: ${bad}`, { field: bad }));
  return next();
}

router.get(
  '/profile',
  requireAuth,
  withRlsContext(async (req, client) => getMyProfile(client, req.user.id))
);

router.patch(
  '/profile',
  requireAuth,
  validateProfile,
  withRlsContext(async (req, client) => updateMyProfile(client, req.user.id, req.body ?? {}))
);

// ------------------------------------------------------------
// GET /me/progress?profile_id=&month=YYYY-MM (B14): racha, badges y horas del mes por disciplina.
// Del propio alumno, de un hijo (tutor vinculado) o de cualquiera (admin); si no, 403 not_guardian.
// ------------------------------------------------------------
router.get(
  '/progress',
  requireAuth,
  validateSubject,
  withRlsContext(async (req, client) =>
    getProgress(client, { studentId: req.query.profile_id ?? req.user.id, month: req.query.month }))
);

// ------------------------------------------------------------
// POST /me/push-subscriptions { endpoint, keys: { p256dh, auth } } → 201 (B15, ADR 0011)
// DELETE /me/push-subscriptions { endpoint } → 204, exista o no (no se distingue el ajeno)
// Solo alumno y tutor. El alta pasa el endpoint al usuario actual (móvil compartido).
// ------------------------------------------------------------
// Frontera de confianza contra el SSRF del worker: https a un push service conocido, sin puerto ni usuario.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/,
  /\.push\.apple\.com$/];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const keyOf = (v, bytes) => typeof v === 'string' && B64URL.test(v) && Buffer.from(v, 'base64url').length === bytes;

function validPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

function validatePushSubscription(req, res, next) {
  const { endpoint, keys } = req.body ?? {};
  if (!validPushEndpoint(endpoint)) return next(httpError(400, 'invalid_field', 'Campo inválido: endpoint', { field: 'endpoint' }));
  if (req.method === 'DELETE') return next();
  // p256dh: punto P-256 sin comprimir (65 bytes); auth: 16 bytes.
  const bad = !keyOf(keys?.p256dh, 65) ? 'keys.p256dh' : !keyOf(keys?.auth, 16) ? 'keys.auth' : null;
  if (bad) return next(httpError(400, 'invalid_field', `Campo inválido: ${bad}`, { field: bad }));
  return next();
}

router.post(
  '/push-subscriptions',
  requireAuth,
  requireRole('alumno', 'tutor'),
  validatePushSubscription,
  withRlsContext(async (req, client) => {
    const { endpoint, keys } = req.body;
    await client.query(`SELECT save_push_subscription($1, $2, $3)`, [endpoint, keys.p256dh, keys.auth]);
    return { status: 201, body: { ok: true } };
  })
);

router.delete(
  '/push-subscriptions',
  requireAuth,
  requireRole('alumno', 'tutor'),
  validatePushSubscription,
  withRlsContext(async (req, client) => {
    await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [req.body.endpoint]);
    return { status: 204, body: null };
  })
);

export default router;