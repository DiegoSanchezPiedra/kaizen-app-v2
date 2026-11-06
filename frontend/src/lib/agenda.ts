import type { AdminEvent } from '@/lib/events'
import { groupByDay } from '@/lib/sessions'
import type { CalendarSession } from '@/lib/types'

// Lo que Horario pinta en un día: una sesión (de clase o suelta) o un evento. Un evento va el día en que empieza.
export type DayEntry = { kind: 'session'; s: CalendarSession } | { kind: 'event'; e: AdminEvent }
export const dayEntryStart = (x: DayEntry): string => (x.kind === 'session' ? x.s.starts_at : x.e.starts_at)

// Una sesión sin clase es suelta. `class_id` viene del calendario; si falta (servidor viejo) no se etiqueta nada.
export const isLoose = (s: Pick<CalendarSession, 'class_id'>): boolean => s.class_id === null

// Las sesiones y los eventos de la semana por día (Madrid), cada día por hora. La disciplina filtra también los eventos que
// tienen una; los que no, se ven siempre.
export function agendaByDay(sessions: CalendarSession[], events: AdminEvent[], discipline: string): Map<string, DayEntry[]> {
  const all: DayEntry[] = [
    ...sessions.map((s): DayEntry => ({ kind: 'session', s })),
    ...events.filter((e) => discipline === 'all' || !e.discipline || String(e.discipline.id) === discipline).map((e): DayEntry => ({ kind: 'event', e })),
  ].sort((a, b) => Date.parse(dayEntryStart(a)) - Date.parse(dayEntryStart(b)))
  return new Map(groupByDay(all, dayEntryStart))
}
