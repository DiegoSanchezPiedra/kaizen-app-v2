// Crea la configuración del Customer Portal (B10): solo método de pago y recibos; sin cambio de plan ni baja.
// Ejecutar una vez por cuenta/sandbox y guardar el id en STRIPE_PORTAL_CONFIGURATION_ID.
import 'dotenv/config';
import { stripe } from '../src/config/stripe.js';

const cfg = await stripe.billingPortal.configurations.create({
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
    customer_update: { enabled: false },
  },
});
console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${cfg.id}`);
