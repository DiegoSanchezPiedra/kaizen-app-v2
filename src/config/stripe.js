// src/config/stripe.js
import 'dotenv/config';
import Stripe from 'stripe';

// Clave restringida (rk_) con permisos mínimos; sk_ solo en local.
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  throw new Error('STRIPE_SECRET_KEY is required (rk_… restricted key preferred)');
}

export const STRIPE_API_VERSION = '2026-09-30.endive';
export const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
