// src/routes/auth.js
import { Router } from 'express';

import { registerLocal, loginLocal, loginGoogle } from '../services/auth.js';
import { signToken } from '../services/jwt.js';
import {
  setupMfa,
  verifyAndEnableMfa,
  verifyMfaCode,
  getMfaStatus,
  getMfaStatusWithClient,
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

    const { enabled: mfaEnabled } = await getMfaStatus(profileId, role);
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
      throw Object.assign(new Error('id_token obligatorio'), {
        status: 400,
        code: 'invalid_payload',
      });
    }
    const { profileId, email: userEmail, role } = await loginGoogle({
      idToken: id_token,
    });

    const { enabled: mfaEnabled } = await getMfaStatus(profileId, role);
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
    const { enabled } = await getMfaStatusWithClient(client, req.user.id);
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
  async (req, res, next) => {
    try {
      // label: identificador legible para el QR. Con el email si lo tuvieras
      // a mano; si no, el propio id. El frontend puede pedir email aparte.
      const label = req.user.id;
      const result = await setupMfa(req.user.id, req.user.role, label);
      return res.status(201).json(result);
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/mfa/activate',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { code } = req.body || {};
      const result = await verifyAndEnableMfa(
        req.user.id,
        req.user.role,
        code
      );
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/mfa/verify',
  requireMfaTokenFromBody,
  async (req, res, next) => {
    try {
      const { code } = req.body || {};
      const ok = await verifyMfaCode(req.mfa.userId, req.mfa.role, code);
      if (!ok) {
        return res
          .status(401)
          .json({ error: 'unauthorized', code: 'invalid_mfa_code' });
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