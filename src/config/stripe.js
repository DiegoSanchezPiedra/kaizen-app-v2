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
// Portal limitado a método de pago y recibos (scripts/stripe-portal-config.js); sin él Stripe usaría el de por defecto.
export const STRIPE_PORTAL_CONFIGURATION_ID = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
// Descriptor del extracto en los Products de Kaizen (planes y seguro): Stripe lo usa en los cobros de la suscripción
// antes que el de la cuenta, que en producción comparte maat (B11). Vacío: el de la cuenta.
export const STRIPE_STATEMENT_DESCRIPTOR = process.env.STRIPE_STATEMENT_DESCRIPTOR || undefined;
// Reglas de Stripe: 5–22 caracteres latinos, al menos una letra, sin < > \ ' " *.
if (STRIPE_STATEMENT_DESCRIPTOR && !/^(?=.*[A-Za-z])[\x20-\x7E]{5,22}$/.test(STRIPE_STATEMENT_DESCRIPTOR)
    || /[<>\\'"*]/.test(STRIPE_STATEMENT_DESCRIPTOR ?? '')) {
  throw new Error('STRIPE_STATEMENT_DESCRIPTOR: 5–22 caracteres latinos con alguna letra y sin < > \\ \' " *');
}
// Frontend: destino de success/cancel del Checkout y vuelta del portal.
export const APP_URL = process.env.APP_URL || 'http://localhost:5173';
