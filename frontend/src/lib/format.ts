// Siempre en español y en hora de Madrid, aunque el móvil esté en otra zona.
const TZ = 'Europe/Madrid'

const dateFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const eurosFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

export const formatDate = (iso: string | Date): string => dateFmt.format(new Date(iso))
export const formatTime = (iso: string | Date): string => timeFmt.format(new Date(iso))
// La API da céntimos; el importe siempre lleva «impuestos incluidos» al lado en la UI.
export const formatEuros = (cents: number): string => eurosFmt.format(cents / 100)

// dd/mm/aaaa → AAAA-MM-DD (lo que espera la API), o null si no es una fecha real.
export function parseSpanishDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toISOString().startsWith(iso) ? iso : null
}

// Inserta las barras mientras se escribe: «14051998» → «14/05/1998».
export function maskSpanishDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/')
}

// AAAA-MM-DD → dd/mm/aaaa (para rellenar el campo de fecha al editar).
export const isoToSpanish = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/')

// «1 dic 2026» y «1 dic a las 9:24», como en el canvas de B18.3.
const shortFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })
const shortNoYear = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short' })
const hourFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
export const formatShortDate = (iso: string | Date): string => shortFmt.format(new Date(iso)).replace('.', '')
export const formatDeadline = (iso: string | Date): string =>
  `${shortNoYear.format(new Date(iso)).replace('.', '')} a las ${hourFmt.format(new Date(iso))}`
