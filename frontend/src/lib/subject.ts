import type { Role } from '@/lib/paths'

export type Child = { id: string; display_name: string; avatar?: string | null; birth_date: string | null; pending_claim: boolean }
// birth_date: la edad de hoy (rango de disciplinas) sale de aquí; null = sin fecha, se toma como adulto.
export type Subject = { id: string; label: string; self: boolean; avatar?: string | null; birth_date: string | null }

// Selector de sujeto (CONTEXT.md): un tutor, entre sus hijos; un alumno, él y sus hijos. Nunca un hijo pending_claim.
// Sin hijos vigentes, lista vacía: no hay selector.
export function subjectOptions(role: Role, selfId: string, selfBirth: string | null, children: Child[]): Subject[] {
  const kids = children.filter((c) => !c.pending_claim).map((c) => ({ id: c.id, label: c.display_name, self: false, avatar: c.avatar, birth_date: c.birth_date }))
  if (role === 'tutor') return kids
  if (role === 'alumno' && kids.length) return [{ id: selfId, label: 'Tú', self: true, birth_date: selfBirth }, ...kids]
  return []
}

// ?para= solo vale si está en la lista; si no, el primero (el propio alumno o, para un tutor, su primer hijo).
export const activeSubject = (options: Subject[], para: string | null): Subject | null =>
  options.find((o) => o.id === para) ?? options[0] ?? null

// Rutas que actúan por un sujeto (docs/pantallas-b18.md); el check-in no.
const SUBJECT_PATHS = ['/calendar', '/bookings', '/progress', '/account/health', '/agreements', '/billing', '/events']
// La vuelta de Stripe y el cambio de pagador van ligados a un alumno concreto: sin selector (canvas, nota b183n3).
const NO_PICKER = ['/billing/success', '/billing/cancel', '/billing/payer-changes']
export const usesSubject = (pathname: string): boolean =>
  !NO_PICKER.some((p) => pathname.startsWith(p)) &&
  (pathname === '/' || SUBJECT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
