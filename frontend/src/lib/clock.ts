import { madridMonth } from '@/lib/dates'
import { formatTime } from '@/lib/format'

// Registro de jornada (B31, docs/api.md § Registro de jornada). La hora de un fichaje la pone el servidor.
export type ClockState = 'out' | 'in' | 'paused'
export type ClockKind = 'in' | 'out' | 'pause_start' | 'pause_end'
export type Employment = 'employee' | 'self_employed'
export type ClockEvent = { id: string; kind: ClockKind; at: string; origin: 'app' | 'tablet' | 'correction'; corrected?: boolean }
export type ClockDay = { date: string; worked_seconds: number; pause_seconds: number; open: boolean; events: ClockEvent[] }
export type Author = { id: string; display_name: string | null }
export type Correction = {
  id: string
  event_id: string | null
  kind: ClockKind
  at: string | null
  reason: string
  created_at: string
  requested_by: Author
  status: 'pending' | 'applied' | 'rejected'
  resolved_by: Author | null
  resolved_at: string | null
  resolution_reason: string | null
}
export type ClockMonth = {
  profile: { id: string; display_name: string | null; employment: Employment }
  month: string
  state: ClockState
  total_seconds: number
  days: ClockDay[]
  events: ClockEvent[]
  corrections: Correction[]
}

export const KIND_LABEL: Record<ClockKind, string> = { in: 'Entrada', out: 'Salida', pause_start: 'Inicio de pausa', pause_end: 'Fin de pausa' }
export const KINDS = Object.keys(KIND_LABEL) as ClockKind[]
export const EMPLOYMENT_LABEL: Record<Employment, string> = { employee: 'Empleado', self_employed: 'Autónomo' }
export const STATUS_LABEL: Record<Correction['status'], string> = { pending: 'Pendiente', applied: 'Aplicada', rejected: 'Rechazada' }
// Un autor sin nombre es el admin: un profesor no puede leer ese perfil.
export const authorName = (a: Author | null): string => a?.display_name ?? 'La academia'

// Lo que permite la secuencia: fuera → entrar; trabajando → pausa o salir; en pausa → volver.
const ACTIONS: Record<ClockState, { kind: ClockKind; label: string }[]> = {
  out: [{ kind: 'in', label: 'Entrar' }],
  in: [
    { kind: 'pause_start', label: 'Pausa' },
    { kind: 'out', label: 'Salir' },
  ],
  paused: [{ kind: 'pause_end', label: 'Volver' }],
}
export const actionsFor = (state: ClockState) => ACTIONS[state]

// H:MM, como el CSV del servidor (los segundos sueltos no cuentan).
export const formatDuration = (s: number): string => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

export function stateLine(state: ClockState, since?: string): string {
  if (state === 'paused') return 'En pausa'
  if (state === 'out') return 'Fuera'
  return since ? `Trabajando desde ${formatTime(since)}` : 'Trabajando'
}

// La última entrada del mes. shortcut: si la jornada abierta empezó el mes anterior, no se ve y sale «Trabajando» a secas.
export const sinceOf = (m: ClockMonth): string | undefined => m.days.flatMap((d) => d.events).findLast((e) => e.kind === 'in')?.at

// El fichaje tal cual se fichó (los de `events`, que son los del mes). Un fichaje añadido por una corrección no tiene original.
export const originalOf = (m: ClockMonth, id: string | null): ClockEvent | undefined => (id ? m.events.find((o) => o.id === id) : undefined)

// Un fichaje con una corrección pendiente no admite otra hasta que se resuelva.
export const hasPending = (m: ClockMonth, eventId: string): boolean => m.corrections.some((c) => c.status === 'pending' && c.event_id === eventId)

// Qué hace una corrección, con la hora original a la vista; si el original no es de este mes, lo dice.
export function whatOf(c: Correction, m: ClockMonth): string {
  const kind = KIND_LABEL[c.kind].toLowerCase()
  if (c.event_id === null) return `Añadir ${kind} a las ${formatTime(c.at!)}`
  const orig = originalOf(m, c.event_id)
  const from = orig ? ` de las ${formatTime(orig.at)}` : ''
  const where = orig ? '' : m.corrections.some((x) => x.id === c.event_id) ? ' (fichaje añadido por una corrección)' : ' (fichaje de otro mes)'
  return c.at ? `Cambiar ${kind}${from} a las ${formatTime(c.at)}${where}` : `Anular ${kind}${from}${where}`
}

// ?month=YYYY-MM de la URL, o el mes en curso si falta o no vale.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export const monthParam = (params: URLSearchParams): string => (MONTH.test(params.get('month') ?? '') ? params.get('month')! : madridMonth())

// Las pausas del día como [inicio, fin]; la que sigue abierta, con fin undefined. Los fichajes vienen en orden.
export function pausesOf(events: ClockEvent[]): [ClockEvent, ClockEvent | undefined][] {
  const out: [ClockEvent, ClockEvent | undefined][] = []
  for (const e of events) {
    const last = out.at(-1)
    if (e.kind === 'pause_start') out.push([e, undefined])
    else if (e.kind === 'pause_end' && last && last[1] === undefined) last[1] = e
  }
  return out
}
