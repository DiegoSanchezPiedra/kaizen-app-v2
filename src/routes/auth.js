// src/routes/auth.js
import { Router } from 'express';

import { httpError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withRls } from '../db/rls.js';
import { registerLocal, loginLocal, loginGoogle } from '../services/auth.js';
import { signToken } from '../services/jwt.js';
import {
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

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    const result = await registerLocal({ email, password, displayName });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
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

router.post('/google', async (req, res, next) => {
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

router.post(
  '/mfa/setup',
  requireAuth,
  requireRole('admin'),
  // argon2 antes de abrir la transacción: no retener la conexión durante el hashing.
  // label: identificador legible para el QR; el frontend puede pedir el email aparte.
  asyncHandler(async (req, res, next) => {
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
  withRlsContext((req, client) =>
    verifyAndEnableMfa(client, req.user.id, req.body?.code)
  )
);

router.post(
  '/mfa/verify',
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
      const token = signToken({ sub: req.mfa.userId, role: req.mfa.role });
      return res
        .status(200)
        .json({ token, user: { id: req.mfa.userId, role: req.mfa.role } });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;