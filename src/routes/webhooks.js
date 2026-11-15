// src/routes/webhooks.js — se monta ANTES de express.json: la firma se verifica sobre el cuerpo crudo.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { BREVO_WEBHOOK_SECRET } from '../config/email.js';
import { suppress, SUPPRESSING } from '../services/emailSuppressions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../config/stripe.js';
import { httpError } from '../lib/errors.js';
import { handleEvent } from '../services/stripeWebhook.js';

const router = Router();

// POST /webhooks/stripe — 2xx solo cuando el evento queda procesado (o ya lo estaba); si no, Stripe reintenta.
router.post('/stripe', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) throw httpError(500, 'webhook_not_configured', 'Falta STRIPE_WEBHOOK_SECRET');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), STRIPE_WEBHOOK_SECRET);
  } catch {
    throw httpError(400, 'invalid_signature', 'Firma de Stripe inválida');
  }
  try {
    res.json({ received: true, result: await handleEvent(event) });
  } catch (err) {
    // Un error de la API de Stripe trae su propio statusCode (p. ej. 404): al webhook siempre 500.
    console.error(`[webhook] ${event.type} ${event.id}:`, err.message);
    throw httpError(500, 'webhook_failed', 'No se pudo procesar el evento');
  }
}));

// Comparación en tiempo constante: se comparan los SHA-256 (misma longitud siempre) con timingSafeEqual.
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const secretOk = (got) => typeof got === 'string' && crypto.timingSafeEqual(sha(got), sha(BREVO_WEBHOOK_SECRET));

// POST /webhooks/brevo — rebotes y quejas del transporte de email (ADR 0029). Brevo no firma el cuerpo: solo admite
// cabeceras propias, bearer, basic en la URL o lista de IPs; usamos la cabecera x-brevo-secret. 2xx solo si el evento
// queda procesado (o es de un tipo que no nos importa); si no, Brevo reintenta.
router.post('/brevo', asyncHandler(async (req, res) => {
  if (!BREVO_WEBHOOK_SECRET) throw httpError(500, 'webhook_not_configured', 'Falta BREVO_WEBHOOK_SECRET');
  if (!secretOk(req.get('x-brevo-secret'))) throw httpError(401, 'invalid_secret', 'Secreto de Brevo inválido');
  // Aquí y no en app.js: la autenticación va antes de leer el cuerpo.
  await new Promise((resolve, reject) => express.json({ limit: '100kb' })(req, res, (err) => (err ? reject(err) : resolve())));
  const { event, email, reason, 'message-id': messageId } = req.body ?? {};
  if (typeof event !== 'string' || typeof email !== 'string' || !email.includes('@') || email.length > 320) {
    throw httpError(400, 'invalid_event', 'Evento de Brevo sin event o email válidos');
  }
  if (event === 'soft_bounce') console.warn(`[brevo] soft_bounce ${email.trim().toLowerCase()}: ${reason ?? ''}`);
  if (!SUPPRESSING.includes(event)) return res.json({ received: true, result: 'ignored' });
  await suppress({ email: email.trim(), event, reason: reason ?? null, messageId: messageId ?? null });
  res.json({ received: true, result: 'suppressed' });
}));

export default router;
