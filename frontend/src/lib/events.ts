import { centsToEuros, eurosToCents } from '@/lib/catalog'
import { madridDay } from '@/lib/dates'
import { formatEuros, formatTime } from '@/lib/format'
import { madridToIso } from '@/lib/schedule'

// docs/api.md § Eventos y § Admin › Eventos.
export type Audience = 'all' | 'minors' | 'adults'
export type AdminEvent = {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  location: string
  discipline: { id: number | string; name: string } | null
  trainer: { id: string; display_name: string | null } | null
  capacity: number | null
  taken: number
  audience: Audience
  requires_risk_cover: boolean
  price_cents: number
  member_price_cents: number | null
  registration_deadline: string | null
  status: 'scheduled' | 'cancelled'
  cancel_note: string | null
}
type Ref = { id: string; display_name: string | null }
export type RefundStatus = 'requested' | 'refunded' | 'failed'
export type EventRegistration = {
  id: string
  student: Ref
  status: 'pending' | 'confirmed' | 'cancelled'
  amount_cents: number
  guest: boolean
  payer: Ref | null
  refund_status: RefundStatus | null
  refunded_cents: number
  attended: boolean | null
  cancel_reason: 'student' | 'admin' | 'event_cancelled' | 'checkout_expired' | null
  created_at: string
}

export const AUDIENCE_LABEL: Record<Audience, string> = { all: 'Todos', minors: 'Solo menores', adults: 'Solo adultos' }

// ── Euros ────────────────────────────────────────────────────────────────────

export const priceLabel = (cents: number): string => (cents === 0 ? 'Gratis' : formatEuros(cents))
export const memberPriceLabel = (e: Pick<AdminEvent, 'price_cents' | 'member_price_cents'>): string | null =>
  e.member_price_cents === null ? null : e.member_price_cents === 0 ? 'Gratis para socios' : `${formatEuros(e.member_price_cents)} para socios`

// Stripe no cobra menos de 0,50 €: un precio es 0 (gratis) o ≥ 50 céntimos.
const validPrice = (c: number | null): c is number => c !== null && (c === 0 || c >= 50)

// ── Formulario ───────────────────────────────────────────────────────────────

export type EventDraft = {
  title: string
  description: string
  day: string
  time: string
  endDay: string
  endTime: string
  location: string
  discipline: string // 'none' o el id
  trainer: string // 'none' o el id
  capacity: string // vacío = sin límite
  audience: Audience
  risk: boolean
  price: string // euros; vacío = gratis
  memberPrice: string // euros; vacío = sin precio de socio
  deadlineDay: string
  deadlineTime: string
}

export const emptyDraft = (): EventDraft => ({
  title: '', description: '', day: '', time: '', endDay: '', endTime: '', location: '', discipline: 'none', trainer: 'none',
  capacity: '', audience: 'all', risk: true, price: '', memberPrice: '', deadlineDay: '', deadlineTime: '',
})

const hhmm = (iso: string) => ({ day: madridDay(iso), time: formatTime(iso) })
export function draftOf(e: AdminEvent): EventDraft {
  const s = hhmm(e.starts_at)
  const f = hhmm(e.ends_at)
  const d = e.registration_deadline ? hhmm(e.registration_deadline) : { day: '', time: '' }
  return {
    title: e.title, description: e.description ?? '', day: s.day, time: s.time, endDay: f.day, endTime: f.time, location: e.location,
    discipline: e.discipline ? String(e.discipline.id) : 'none', trainer: e.trainer?.id ?? 'none',
    capacity: e.capacity === null ? '' : String(e.capacity), audience: e.audience, risk: e.requires_risk_cover,
    price: e.price_cents ? centsToEuros(e.price_cents) : '', memberPrice: e.member_price_cents === null ? '' : centsToEuros(e.member_price_cents),
    deadlineDay: d.day, deadlineTime: d.time,
  }
}

export type EventBody = {
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  location: string
  discipline_id: string | null
  trainer_id: string | null
  capacity: number | null
  audience: Audience
  requires_risk_cover: boolean
  price_cents: number
  member_price_cents: number | null
  registration_deadline: string | null
}

// El borrador entero como lo espera la API, o null si no vale (el botón se queda apagado). Las mismas reglas que el
// servidor; la fecha de inicio solo tiene que ser futura si `checkStart` (al crear o al moverla).
export function eventBody(d: EventDraft, now: number, checkStart = true): EventBody | null {
  const starts = madridToIso(d.day, d.time)
  const ends = madridToIso(d.endDay, d.endTime)
  if (!starts || !ends || Date.parse(ends) <= Date.parse(starts) || (checkStart && Date.parse(starts) <= now)) return null
  const title = d.title.trim()
  const location = d.location.trim()
  const description = d.description.trim()
  if (!title || title.length > 120 || !location || location.length > 200 || description.length > 2000) return null
  const price = d.price.trim() === '' ? 0 : eurosToCents(d.price)
  const member = d.memberPrice.trim() === '' ? null : eurosToCents(d.memberPrice)
  if (!validPrice(price) || (d.memberPrice.trim() !== '' && (!validPrice(member) || member > price))) return null
  const capacity = d.capacity.trim() === '' ? null : /^\d{1,6}$/.test(d.capacity.trim()) ? Number(d.capacity) : NaN
  if (capacity !== null && !(capacity >= 1)) return null
  const hasDeadline = d.deadlineDay !== '' || d.deadlineTime !== ''
  const deadline = hasDeadline ? madridToIso(d.deadlineDay, d.deadlineTime) : null
  if (hasDeadline && (!deadline || Date.parse(deadline) > Date.parse(starts))) return null
  return {
    title, description: description || null, starts_at: starts, ends_at: ends, location, discipline_id: d.discipline === 'none' ? null : d.discipline,
    trainer_id: d.trainer === 'none' ? null : d.trainer, capacity, audience: d.audience, requires_risk_cover: d.risk, price_cents: price,
    member_price_cents: member, registration_deadline: deadline,
  }
}

const TIME_FIELDS = ['starts_at', 'ends_at', 'registration_deadline']
const same = (k: string, a: unknown, b: unknown) => (TIME_FIELDS.includes(k) && a && b ? Date.parse(String(a)) === Date.parse(String(b)) : a === b)

// PATCH /admin/events/:id: solo lo que cambia respecto al evento guardado. Vacío si no cambia nada.
export function eventPatch(saved: AdminEvent, body: EventBody): Partial<EventBody> {
  const before: EventBody = {
    title: saved.title, description: saved.description, starts_at: saved.starts_at, ends_at: saved.ends_at, location: saved.location,
    discipline_id: saved.discipline ? String(saved.discipline.id) : null, trainer_id: saved.trainer?.id ?? null, capacity: saved.capacity,
    audience: saved.audience, requires_risk_cover: saved.requires_risk_cover, price_cents: saved.price_cents,
    member_price_cents: saved.member_price_cents, registration_deadline: saved.registration_deadline,
  }
  return Object.fromEntries(Object.entries(body).filter(([k, v]) => !same(k, v, before[k as keyof EventBody])))
}

// Inicio, fin o lugar avisan a los inscritos vivos (PATCH → notified); el resto no toca a quien ya está dentro.
export const notifiesOnPatch = (patch: Partial<EventBody>): boolean => ['starts_at', 'ends_at', 'location'].some((k) => k in patch)

// ── Inscripciones ────────────────────────────────────────────────────────────

export const isLive = (r: Pick<EventRegistration, 'status'>): boolean => r.status !== 'cancelled'
// Solo una pagada (confirmada con importe) se devuelve: una pendiente aún no ha pagado (su Checkout se caduca).
export const canRefund = (r: Pick<EventRegistration, 'status' | 'amount_cents'>): boolean => r.status === 'confirmed' && r.amount_cents > 0

// «Reintentar el reembolso»: una cancelada cuyo reembolso falló, o que se canceló sin devolver (`admin`, sin estado).
// shortcut: la API no dice si una cancelada por el admin llegó a pagar; si no pagó, el servidor contesta already_cancelled.
export const canRetryRefund = (r: Pick<EventRegistration, 'status' | 'amount_cents' | 'guest' | 'refund_status' | 'cancel_reason'>): boolean =>
  r.status === 'cancelled' && r.amount_cents > 0 && !r.guest && (r.refund_status === 'failed' || (r.refund_status === null && r.cancel_reason === 'admin'))

// Lo que cancelar el evento hace con sus inscripciones: cuántas hay vivas y cuánto se devuelve (todo lo pagado).
export function cancelSummary(regs: Pick<EventRegistration, 'status' | 'amount_cents'>[]): { live: number; paid: number; cents: number } {
  const paid = regs.filter(canRefund)
  return { live: regs.filter(isLive).length, paid: paid.length, cents: paid.reduce((n, r) => n + r.amount_cents, 0) }
}

export const payLabel = (r: EventRegistration): string =>
  r.guest ? 'Invitado' : r.amount_cents === 0 ? 'Gratis' : r.status === 'pending' ? `Pago pendiente · ${formatEuros(r.amount_cents)}` : r.status === 'confirmed' ? `Pagado · ${formatEuros(r.amount_cents)}` : r.refund_status ? `Pagado · ${formatEuros(r.amount_cents)}` : `Sin devolver · ${formatEuros(r.amount_cents)}`

export const refundLabel = (r: Pick<EventRegistration, 'refund_status' | 'refunded_cents'>): string | null =>
  r.refund_status === 'requested' ? 'Reembolso pedido' : r.refund_status === 'refunded' ? (r.refunded_cents ? `Devuelto ${formatEuros(r.refunded_cents)}` : 'Devuelto') : r.refund_status === 'failed' ? 'Reembolso fallido' : null

export const CANCEL_REASON_LABEL: Record<string, string> = {
  student: 'Cancelada por el alumno', admin: 'Cancelada por la academia', event_cancelled: 'Evento cancelado', checkout_expired: 'El pago caducó',
}

// El aviso de éxito de POST /admin/events/:id/cancel.
export function cancelResult(r: { refunded: number; refund_failed: number; notified: number }): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  return [n(r.refunded, 'reembolso', 'reembolsos'), r.refund_failed ? `${n(r.refund_failed, 'fallido', 'fallidos')} (reintenta desde el detalle)` : null, n(r.notified, 'aviso', 'avisos')]
    .filter(Boolean)
    .join(' · ')
}

// La asistencia se pasa desde el inicio del evento y solo en uno programado.
export const attendanceOpen = (e: Pick<AdminEvent, 'status' | 'starts_at'>, now: number): boolean => e.status === 'scheduled' && now >= Date.parse(e.starts_at)
