import { ageOn } from '@/lib/dates'

// `minor` de GET /me (docs/api.md): null en un adulto. `can_publish`: tiene la edad para decidir su perfil público
// (la edad de consentimiento la decide el servidor).
export type MinorInfo = { can_book: boolean; can_publish: boolean } | null | undefined

// Qué pantallas y tarjetas de la app del alumno ve cada cuenta. Un menor con acceso propio no ve nada de lo que la API
// le cierra con 403 minor_restricted (pagos, acuerdos, salud, hijos, su nombre). Sin /me cargado, como un adulto.
export function minorView(minor: MinorInfo) {
  return {
    isMinor: !!minor,
    billing: !minor,
    agreements: !minor,
    health: !minor,
    children: !minor,
    ownData: !minor,
    publicProfile: !minor || minor.can_publish,
  }
}

export const NO_BOOK = 'Tu tutor no te ha dado permiso para reservar'
export const PAID_EVENT = 'Este evento es de pago: lo inscribe tu tutor'

// El motivo que sustituye al botón de reservar, cancelar o inscribirse; null si puede.
export const bookBlock = (minor: MinorInfo): string | null => (minor && !minor.can_book ? NO_BOOK : null)
export const joinBlock = (minor: MinorInfo, amountCents = 0): string | null => bookBlock(minor) ?? (minor && amountCents > 0 ? PAID_EVENT : null)

// Perfil incompleto (nombre, ficha, acuerdos): lo completa el tutor, no el menor.
export const MINOR_INCOMPLETE = 'Tu tutor tiene que completar tu perfil para que puedas reservar.'

// El servidor da el email del menor solo desde esta edad (minor_consent_age(), art. 7 LOPDGDD); si la ley la sube, se
// cambia allí y aquí. Solo oculta un campo: el servidor sigue rechazando con email_requires_14.
export const CONSENT_AGE = 14
export const atConsentAge = (birth: string | null, today: string): boolean => !!birth && ageOn(birth, today) >= CONSENT_AGE

// En el login, el campo vale para un email o para el usuario que dio el tutor (sin @).
export const isUsername = (v: string): boolean => v.trim() !== '' && !v.includes('@')
