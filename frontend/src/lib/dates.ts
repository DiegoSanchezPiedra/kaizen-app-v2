import { formatDate } from '@/lib/format'

// Días (YYYY-MM-DD) y meses (YYYY-MM) siempre de Madrid, como los da y los pide la API.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' })
const monthFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' })

export const madridDay = (d: Date | string | number = new Date()): string => dayFmt.format(new Date(d))
export const madridMonth = (d: Date | string | number = new Date()): string => madridDay(d).slice(0, 7)

// Años cumplidos a `day` (ambos YYYY-MM-DD) por una fecha de nacimiento.
export function ageOn(birth: string, day: string): number {
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, d] = day.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const mondayOf = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))

export function addMonths(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}

// A mediodía UTC cae siempre en el mismo día de Madrid.
export const formatDay = (day: string): string => formatDate(`${day}T12:00:00Z`)
export const formatMonth = (month: string): string => monthFmt.format(new Date(`${month}-01T12:00:00Z`))
export const shortWeekday = (day: string): string =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`)).replace('.', '')
export const dayOfMonth = (day: string): number => Number(day.slice(8))
export const longWeekday = (day: string): string =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${day}T12:00:00Z`))

const wallFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
function wall(ms: number): number {
  const p = Object.fromEntries(wallFmt.formatToParts(ms).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
}

// «2026-07-01» + «09:30» (hora de Madrid) → ISO en UTC, que es lo que pide la API.
export function madridToIso(day: string, time: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const first = guess - (wall(guess) - guess)
  return new Date(guess - (wall(first) - first)).toISOString()
}
