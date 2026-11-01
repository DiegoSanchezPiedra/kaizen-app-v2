import type { Stripe } from '@stripe/stripe-js'
import { ApiError } from '@/lib/api'

// Stripe.js solo para el 3DS (handleNextAction): se baja de js.stripe.com la primera vez que hace falta, no al abrir la app.
const KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined
let stripe: Promise<Stripe | null> | undefined

const load = () => (stripe ??= import('@stripe/stripe-js/pure').then(({ loadStripe }) => (KEY ? loadStripe(KEY) : null)))

// true si el banco lo confirma; false si lo rechaza o la persona cierra la ventana.
// Si Stripe.js no carga (sin clave o sin red), `stripe_unavailable`, que el toast traduce por code.
export async function bankConfirms(clientSecret: string): Promise<boolean> {
  const s = await load().catch(() => null)
  if (!s) {
    stripe = undefined
    throw new ApiError(0, { code: 'stripe_unavailable' })
  }
  const { error } = await s.handleNextAction({ clientSecret })
  return !error
}
