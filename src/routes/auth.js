// src/routes/auth.js
import { Router } from 'express';

import { httpError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authLimit, forgotLimit, loginAccountLimit } from '../middleware/rateLimit.js';
import { withRls } from '../db/rls.js';
import { registerLocal, loginLocal, loginGoogle, requestPasswordReset, resetPassword } from '../services/auth.js';
import { signToken } from '../services/jwt.js';
import {
  assertMfaReauth,
  readOwnPasswordHash,
  prepareMfaSetup,
  setupMfa,
  verifyAndEnableMfa,
  verifyMfaCode,
  getMfaStatus,
} from '../services/mfa.js';
import {
  requireAuth,
  requireRole,
  withRlsContext,
} from '../middleware/auth.js';
import {
  requireMfaTokenFromBody,
  signMfaToken,
} from '../middleware/mfa.js';

const router = Router();

// ---------------------------------------------------------------------------
// Registro / login
// ---------------------------------------------------------------------------

router.post('/register', authLimit, async (req, res, next) => {
  try {
    const { email, password, displayName, birthDate } = req.body || {};
    const result = await registerLocal({ email, password, displayName, birthDate });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/login { email, password }: `email` es el email o el usuario (B32); límite por IP y por cuenta.
router.post('/login', authLimit, loginAccountLimit, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { profileId, email: userEmail, role } = await loginLocal({
      email,
      password,
    });

    const { enabled: mfaEnabled } = await withRls({ uid: profileId, role }, (client) =>
      getMfaStatus(client, profileId),
    );
    if (mfaEnabled) {
      const mfaToken = signMfaToken({ sub: profileId, role });
      return res.status(200).json({ mfa_required: true, mfa_token: mfaToken });
    }

    const token = signToken({ sub: profileId, role });
    return res
      .status(200)
      .json({ token, user: { id: profileId, email: userEmail, role } });
  } catch (err) {
    next(err);
  }
});

router.post('/google', authLimit, async (req, res, next) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) {
      throw httpError(400, 'invalid_payload', 'id_token obligatorio');
    }
    const { profileId, email: userEmail, role } = await loginGoogle({
      idToken: id_token,
    });

    const { enabled: mfaEnabled } = await withRls({ uid: profileId, role }, (client) =>
      getMfaStatus(client, profileId),
    );
    if (mfaEnabled) {
      const mfaToken = signMfaToken({ sub: profileId, role });
      return res.status(200).json({ mfa_required: true, mfa_token: mfaToken });
    }

    const token = signToken({ sub: profileId, role });
    return res
      .status(200)
      .json({ token, user: { id: profileId, email: userEmail, role } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Recuperar contraseña (B18.0). Sin sesión. El rate limit, en B20.
// POST /auth/password/forgot { email }           → 204 siempre (no revela si existe)
// POST /auth/password/reset  { token, password } → 204; 400 invalid_reset_token | weak_password
// ---------------------------------------------------------------------------

router.post('/password/forgot', forgotLimit, asyncHandler(async (req, res) => {
  await requestPasswordReset(req.body?.email);
  res.status(204).end();
}));

router.post('/password/reset', authLimit, asyncHandler(async (req, res) => {
  await resetPassword({ token: req.body?.token, password: req.body?.password });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// /auth/me (protegida)
// ---------------------------------------------------------------------------

router.get(
  '/me',
  requireAuth,
  withRlsContext(async (req, client) => {
    const { rows } = await client.query(
      `SELECT current_setting('app.current_user_id', true) AS uid,
              current_setting('app.current_role', true) AS role`
    );
    const { enabled } = await getMfaStatus(client, req.user.id);
    return {
      user: req.user,
      mfa_enabled: enabled,
      rls_context: rows[0],
    };
  })
);

// ---------------------------------------------------------------------------
// MFA admin
// ---------------------------------------------------------------------------

// POST /auth/mfa/setup { password } → 201 { otpauth_uri, recovery_codes }. Sin contraseña (solo Google), un login de
// hace ≤ 10 min. 400 invalid_field | wrong_password; 403 reauth_required; 409 mfa_already_enabled. Con el límite del login.
// POST /auth/mfa/activate { code } → { enabled, token }: como cambiar la contraseña (ADR 0020), cierra las demás sesiones.
router.post(
  '/mfa/setup',
  requireAuth,
  requireRole('admin'),
  authLimit,
  // argon2 antes de abrir la transacción: no retener la conexión durante el hashing.
  // label: identificador legible para el QR; el frontend puede pedir el email aparte.
  asyncHandler(async (req, res, next) => {
    const hash = await withRls({ uid: req.user.id, role: req.user.role }, readOwnPasswordHash);
    await assertMfaReauth(hash, { password: req.body?.password, tokenIat: req.user.iat });
    req.mfaSetup = await prepareMfaSetup(req.user.id, req.user.id);
    next();
  }),
  withRlsContext(async (req, client) => ({
    status: 201,
    body: await setupMfa(client, req.user.id, req.mfaSetup),
  }))
);

router.post(
  '/mfa/activate',
  requireAuth,
  requireRole('admin'),
  withRlsContext(async (req, client) => {
    const { iat } = await verifyAndEnableMfa(client, req.user.id, req.body?.code);
    return { enabled: true, token: signToken({ sub: req.user.id, role: req.user.role, iat, mfa: req.user.mfa }) };
  })
);

router.post(
  '/mfa/verify',
  authLimit,
  requireMfaTokenFromBody,
  async (req, res, next) => {
    try {
      const { code } = req.body || {};
      const ok = await withRls({ uid: req.mfa.userId, role: req.mfa.role }, (client) =>
        verifyMfaCode(client, req.mfa.userId, code),
      );
      if (!ok) {
        throw httpError(401, 'invalid_mfa_code', 'invalid mfa code');
      }
      const token = signToken({ sub: req.mfa.userId, role: req.mfa.role, mfa: true });
      return res
        .status(200)
        .json({ token, user: { id: req.mfa.userId, role: req.mfa.role } });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;