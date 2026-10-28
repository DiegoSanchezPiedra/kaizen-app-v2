// src/routes/webhooks.js — se monta ANTES de express.json: la firma se verifica sobre el cuerpo crudo.
import express, { Router } from 'express';
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

export default router;
