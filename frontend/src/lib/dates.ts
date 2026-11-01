import { formatDate } from '@/lib/format'

// Días (YYYY-MM-DD) y meses (YYYY-MM) siempre de Madrid, como los da y los pide la API.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' })
const monthFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' })

export const madridDay = (d: Date | string | number = new Date()): string => dayFmt.format(new Date(d))
export const madridMonth = (d: Date | string | number = new Date()): string => madridDay(d).slice(0, 7)

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
