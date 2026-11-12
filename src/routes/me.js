// src/routes/me.js
import express, { Router } from 'express';
import { httpError } from '../lib/errors.js';
import { requireAuth, requireRole, withRlsContext, blockMinor } from '../middleware/auth.js';
import {
  getProfileStatus,
  getMe,
  updateMe,
  getHealthInfo,
  upsertHealthInfo,
  HEALTH_FIELDS,
  assertGuardianOf,
  listChildren,
  createChild,
  updateChild,
  CHILD_FIELDS,
  setOwnEmail,
} from '../services/profile.js';
import { grantAccess, updateAccess, revokeAccess, setChildVisibility } from '../services/minorAccess.js';
import { signAgreement } from '../services/agreements.js';
import { getMyProfile, updateMyProfile, VISIBLE_FIELDS, SOCIAL_NETWORKS } from '../services/profiles.js';
import { getProgress, markMedalsSeen } from '../services/progress.js';
import { isValidPastDate, isAdultBirthDate, changePassword, sendPasswordChanged } from '../services/auth.js';
import { signToken } from '../services/jwt.js';
import { withRls } from '../db/rls.js';
import { storeAvatar, setAvatar, deleteAvatarFile, AVATAR_MAX_BYTES } from '../services/avatar.js';
import { authLimit, avatarLimit } from '../middleware/rateLimit.js';

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
// Mis datos (B18.0). Sin profile_id: un tutor edita a sus hijos en /me/children.
// GET   /me → { id, role, display_name, email, username, birth_date, has_password, avatar, minor }
//   minor (B32): null, o { can_book, can_publish } si es un menor con acceso propio.
// PATCH /me { display_name?, birth_date?, email? } → igual. birth_date solo si estaba vacía (alta con Google)
//   y de un adulto: 409 birth_date_already_set, 400 minor_cannot_register | invalid_birth_date.
//   email (B32, reclamar a los 18): solo si no tenía (409 email_already_set, email_taken). Un menor: 403 minor_restricted.
// ------------------------------------------------------------
const ME_FIELDS = [...CHILD_FIELDS, 'email'];
function validateMe(req, res, next) {
  const body = req.body ?? {};
  const provided = ME_FIELDS.filter((k) => Object.hasOwn(body, k));
  if (provided.length === 0) {
    return next(httpError(400, 'no_fields', 'Ningún campo válido en el body.', { allowed: ME_FIELDS }));
  }
  if (provided.includes('email') && (typeof body.email !== 'string' || body.email.length > 254
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim()))) {
    return next(httpError(400, 'invalid_field', 'Campo inválido: email', { field: 'email' }));
  }
  if (provided.includes('display_name') && (typeof body.display_name !== 'string' || !body.display_name.trim())) {
    return next(httpError(400, 'invalid_field_type', 'Campo inválido: display_name', { field: 'display_name' }));
  }
  if (provided.includes('birth_date')) {
    if (!isValidPastDate(body.birth_date)) {
      return next(httpError(400, 'invalid_birth_date', 'birth_date (YYYY-MM-DD, pasada) requerido'));
    }
    if (!isAdultBirthDate(body.birth_date)) {
      return next(httpError(400, 'minor_cannot_register', 'solo pueden registrarse mayores de 18'));
    }
  }
  return next();
}

router.get(
  '/',
  requireAuth,
  withRlsContext((req, client) => getMe(client, req.user))
);

router.patch(
  '/',
  requireAuth,
  blockMinor,
  validateMe,
  withRlsContext(async (req, client) => {
    if (req.body.email !== undefined) await setOwnEmail(client, req.body.email.trim());
    await updateMe(client, req.user.id, {
      displayName: req.body.display_name?.trim(),
      birthDate: req.body.birth_date,
    });
    return getMe(client, req.user);
  })
);

// ------------------------------------------------------------
// GET /me/profile-status?profile_id=
// Devuelve el estado de completitud del perfil del alumno (o de su hijo).
// Útil para que el frontend pinte el onboarding sin provocar 403.
// Respuesta: { ok, missing? }
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

// GET /me/health?profile_id= → { health } | { health: null } (B18.0): propia o de un hijo (403 not_guardian).
router.get(
  '/health',
  requireAuth,
  blockMinor,
  validateSubject,
  withRlsContext(async (req, client) => {
    const subject = req.query.profile_id ?? req.user.id;
    if (subject !== req.user.id) await assertGuardianOf(client, subject);
    return { health: await getHealthInfo(client, subject) };
  })
);

router.post(
  '/health',
  requireAuth,
  blockMinor,
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
  blockMinor,
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
  blockMinor,
  withRlsContext(async (req, client) => ({ children: await listChildren(client, req.user.id) }))
);

router.post(
  '/children',
  requireAuth,
  blockMinor,
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
  blockMinor,
  validateChild,
  withRlsContext(async (req, client) => ({
    child: await updateChild(client, req.params.id, req.body),
  }))
);

// ------------------------------------------------------------
// Acceso propio del hijo (B32, ADR 0026). Cualquier tutor vinculado; los demás reciben un aviso. 403 not_guardian.
// POST   /me/children/:id/access { username, password, email?, notice_version } → 201 { access }
//   400 invalid_username | weak_password | email_requires_14 | invalid_field (notice_version); 409 access_exists |
//   username_taken | email_taken. Queda el consentimiento: quién, cuándo, IP y versión del texto informativo.
// PATCH  /me/children/:id/access { password?, email?, can_book? } → { access }; 404 access_not_found
// DELETE /me/children/:id/access → 204; 404 access_not_found. Su sesión abierta cae al momento.
// PATCH  /me/children/:id/profile { is_public?, visible_fields? } → como GET /me/profile, del hijo
// access = { username, email, can_book }
// ------------------------------------------------------------
const childId = (req, res, next) => (UUID_RE.test(req.params.id)
  ? next() : next(httpError(400, 'invalid_profile_id', 'id debe ser un uuid')));

router.post('/children/:id/access', requireAuth, blockMinor, childId,
  withRlsContext((req, client) => grantAccess(client, req.params.id, req.body ?? {}, req.ip)));
router.patch('/children/:id/access', requireAuth, blockMinor, childId,
  withRlsContext((req, client) => updateAccess(client, req.params.id, req.body ?? {})));
router.delete('/children/:id/access', requireAuth, blockMinor, childId,
  withRlsContext((req, client) => revokeAccess(client, req.params.id)));

// ------------------------------------------------------------
// Perfil público propio (B13). Sin profile_id: un tutor nunca edita el perfil público de un hijo.
// GET   /me/profile → { is_public, eligible, visible_fields, bio, social_links }
// PATCH /me/profile { is_public?, visible_fields?, bio?, social_links? } → igual; 403 not_eligible
// B32: un menor de menos de 14 no cambia is_public ni visible_fields (403 minor_restricted): los decide su tutor.
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

const VISIBILITY = ['is_public', 'visible_fields'];
router.patch(
  '/children/:id/profile',
  requireAuth,
  blockMinor,
  childId,
  (req, res, next) => {
    const bad = Object.keys(req.body ?? {}).find((k) => !VISIBILITY.includes(k));
    return bad ? next(httpError(400, 'invalid_field', `Campo inválido: ${bad}`, { field: bad })) : validateProfile(req, res, next);
  },
  withRlsContext((req, client) => setChildVisibility(client, req.params.id, req.body ?? {}))
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

// POST /me/progress/seen { profile_id?, codes } → { codes }: quien mira ya celebró esas medallas de ese perfil.
router.post(
  '/progress/seen',
  requireAuth,
  validateSubject,
  withRlsContext(async (req, client) => markMedalsSeen(client, { studentId: req.body?.profile_id ?? req.user.id, codes: req.body?.codes }))
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

// ------------------------------------------------------------
// Contraseña (B24, ADR 0020). POST /me/password { current_password, new_password } → { token }: el token nuevo de esta
// sesión; los de antes (también los de otros dispositivos) dejan de valer. 400 invalid_field | wrong_password |
// weak_password; 409 no_password (cuenta solo con Google). Con el límite del login. Avisa por email.
// ------------------------------------------------------------
router.post(
  '/password',
  requireAuth,
  authLimit,
  withRlsContext(async (req, client) => {
    const { iat, email } = await changePassword(client, req.user.id, req.body ?? {});
    sendPasswordChanged(email);
    return { token: signToken({ sub: req.user.id, role: req.user.role, iat, mfa: req.user.mfa }) };
  }),
);

// ------------------------------------------------------------
// Foto de perfil (B24, ADR 0019). Con profile_id, la de un hijo del tutor (403 not_guardian si no lo es).
// PUT    /me/avatar[?profile_id] cuerpo crudo image/jpeg|png|webp, ≤ 1 MB → { avatar }; 400 invalid_image, 413 too_large
// DELETE /me/avatar[?profile_id] → 204 (también sin foto)
// El fichero viejo se borra después del COMMIT.
// ------------------------------------------------------------
const rawImage = (req, res, next) => express.raw({ type: () => true, limit: AVATAR_MAX_BYTES })(req, res, (err) =>
  next(err?.type === 'entity.too.large' ? httpError(413, 'too_large', 'la foto pasa de 1 MB') : err));

const avatarRoute = (put) => async (req, res, next) => {
  try {
    const subject = req.query.profile_id ?? req.user.id;
    const name = put ? await storeAvatar(req.body, req.get('content-type')?.split(';')[0].trim()) : null;
    let old;
    try {
      old = await withRls({ uid: req.user.id, role: req.user.role }, async (client) => {
        if (subject !== req.user.id) await assertGuardianOf(client, subject);
        const prev = await setAvatar(client, req.user.id, subject, name);
        await client.query(`SELECT minor_avatar_notice()`); // B32: el menor cambia su foto → aviso a sus tutores
        return prev;
      });
    } catch (err) {
      await deleteAvatarFile(name); // no llegó a la base: el nuevo sobra
      throw err;
    }
    await deleteAvatarFile(old);
    return put ? res.json({ avatar: name }) : res.status(204).end();
  } catch (err) {
    return next(err);
  }
};
router.put('/avatar', requireAuth, avatarLimit, validateSubject, rawImage, avatarRoute(true));
router.delete('/avatar', requireAuth, validateSubject, avatarRoute(false));

export default router;