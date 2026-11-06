import { addDays, mondayOf } from '@/lib/dates'
import { isDay, weekStart } from '@/lib/schedule'

// Semana y día elegidos en el calendario semanal (alumno, tutor, profesor y Horario). Viven en la URL como
// `?semana=` (lunes) y `?dia=`; lo que es el valor por defecto no se escribe.
export type WeekDay = { week: string; day: string }

// El día por defecto: hoy en la semana actual, el lunes en las demás.
const defaultDay = (week: string, today: string): string => (week === mondayOf(today) ? today : week)

// Una URL a mano rota cae en hoy; un `?dia=` que no está en la semana pedida se ignora.
export function resolveWeekDay(semana: string | null, dia: string | null, today: string): WeekDay {
  const week = weekStart(isDay(semana) ? semana : dia, today)
  return { week, day: isDay(dia) && mondayOf(dia) === week ? dia : defaultDay(week, today) }
}

// Al cambiar de semana se queda el mismo día de la semana; en la actual, hoy.
export function shiftWeek({ week, day }: WeekDay, n: number, today: string): WeekDay {
  const next = addDays(week, 7 * n)
  const index = Math.round((Date.parse(day) - Date.parse(week)) / 86_400_000)
  return { week: next, day: next === mondayOf(today) ? today : addDays(next, index) }
}

export const pickDay = (day: string): WeekDay => ({ week: mondayOf(day), day })

export const todayOf = (today: string): WeekDay => pickDay(today)

export function weekQuery({ week, day }: WeekDay, today: string): { semana: string | null; dia: string | null } {
  return { semana: week === mondayOf(today) ? null : week, dia: day === defaultDay(week, today) ? null : day }
}

export type StripDay = { day: string; letter: string; number: number; today: boolean; selected: boolean; past: boolean; marked: boolean }

// Los 7 botones de la tira. La inicial del miércoles es X, como en los calendarios en español.
export function stripDays({ week, day }: WeekDay, today: string, marked: ReadonlySet<string>): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(week, i)
    return { day: d, letter: 'LMXJVSD'[i], number: Number(d.slice(8)), today: d === today, selected: d === day, past: d < today, marked: marked.has(d) }
  })
}

// Primer día con clases después de `day` dentro de la semana, o null.
export const nextMarked = ({ week, day }: WeekDay, marked: ReadonlySet<string>): string | null =>
  Array.from({ length: 7 }, (_, i) => addDays(week, i)).find((d) => d > day && marked.has(d)) ?? null
