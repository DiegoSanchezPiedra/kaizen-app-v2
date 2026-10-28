// src/routes/tablet.js — la tablet de la academia (CONTEXT § Asistencia). No es usuario ni usa JWT:
// se vincula con el código del admin y después se autentica con `Authorization: Device <token>`.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { httpError } from '../lib/errors.js';
import { linkTablet, tabletFeed, qrPeriod, qrStep, qrCode } from '../services/checkin.js';

const router = Router();

// POST /tablet/link { code } → { device_token }: se devuelve una sola vez.
router.post('/link', asyncHandler(async (req, res) => {
  res.status(201).json(await linkTablet(req.body?.code));
}));

// GET /tablet/active-sessions (SSE): cada periodo del QR envía { qr, expires_in, sessions }. Cada envío
// revalida el token, así que una revocación corta el stream en un periodo como mucho.
router.get('/active-sessions', asyncHandler(async (req, res) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Device' || !token) throw httpError(401, 'missing_token', 'missing device token');
  const period = await qrPeriod();
  let sessions = await tabletFeed(token); // antes de abrir el stream: un token malo responde 401 normal

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' }); // Nginx no debe bufferizar el SSE
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const tick = () => {
    const now = Date.now();
    const step = qrStep(period, now);
    send('feed', { qr: qrCode(step), expires_in: Math.ceil((step + 1) * period - now / 1000), sessions });
  };
  tick();

  const timer = setInterval(async () => {
    try {
      sessions = await tabletFeed(token);
      tick();
    } catch (err) {
      send(err.code === 'device_not_found' ? 'revoked' : 'error', { code: err.code ?? 'internal' });
      clearInterval(timer);
      res.end();
    }
  }, period * 1000);
  req.on('close', () => clearInterval(timer));
}));

export default router;
