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

// Rutas que un menor no abre aunque escriba la URL (la API las cierra con 403): vuelve a Inicio. Mismas que oculta `minorView`.
const MINOR_CLOSED = ['/billing', '/agreements', '/account/health', '/account/data', '/account/children']
export const redirectForMinor = (minor: MinorInfo, pathname: string): string | null =>
  minor && MINOR_CLOSED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? '/' : null

// En el login, el campo vale para un email o para el usuario que dio el tutor (sin @).
export const isUsername = (v: string): boolean => v.trim() !== '' && !v.includes('@')
