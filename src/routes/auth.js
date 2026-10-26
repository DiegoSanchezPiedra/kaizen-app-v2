// src/routes/auth.js
import { Router } from 'express';
import { registerLocal, loginLocal, loginGoogle } from '../services/auth.js';
import { requireAuth, withRlsContext } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    const result = await registerLocal({ email, password, displayName });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await loginLocal({ email, password });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/google', async (req, res, next) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) throw Object.assign(new Error('id_token obligatorio'), { status: 400 });
    const result = await loginGoogle({ idToken: id_token });
    res.json(result);
  } catch (err) { next(err); }
});

// Ruta de prueba protegida + SET LOCAL
router.get('/me', requireAuth, withRlsContext(async (req, client) => {
  const { rows } = await client.query(
    `SELECT current_setting('app.current_user_id', true) AS uid,
            current_setting('app.current_role', true) AS role`
  );
  return { user: req.user, rls_context: rows[0] };
}));

export default router;