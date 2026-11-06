import { centsToEuros, eurosToCents } from '@/lib/catalog'
import { formatDay, madridDay } from '@/lib/dates'
import { formatDeadline, formatEuros, formatTime } from '@/lib/format'
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

export type EventField = 'title' | 'description' | 'day' | 'time' | 'endDay' | 'endTime' | 'location' | 'capacity' | 'price' | 'memberPrice' | 'deadlineDay'

// Lo que `eventBody` rechaza, con su campo y su mensaje: vacío ⇔ `eventBody` da el cuerpo.
export function eventErrors(d: EventDraft, now: number, checkStart = true): Partial<Record<EventField, string>> {
  const e: Partial<Record<EventField, string>> = {}
  const starts = madridToIso(d.day, d.time)
  const ends = madridToIso(d.endDay, d.endTime)
  if (!d.day) e.day = 'Elige el día de inicio.'
  else if (!d.time) e.time = 'Elige la hora de inicio.'
  else if (!starts) e.time = 'Esa fecha u hora no existe.'
  else if (checkStart && Date.parse(starts) <= now) e.time = 'El inicio ya pasó.'
  if (!d.endDay) e.endDay = 'Elige el día de fin.'
  else if (!d.endTime) e.endTime = 'Elige la hora de fin.'
  else if (!ends) e.endTime = 'Esa fecha u hora no existe.'
  else if (starts && Date.parse(ends) <= Date.parse(starts)) e.endTime = 'El fin tiene que ser después del inicio.'
  const title = d.title.trim()
  if (!title) e.title = 'Pon un título.'
  else if (title.length > 120) e.title = 'Máximo 120 caracteres.'
  const location = d.location.trim()
  if (!location) e.location = 'Pon el lugar.'
  else if (location.length > 200) e.location = 'Máximo 200 caracteres.'
  if (d.description.trim().length > 2000) e.description = 'Máximo 2000 caracteres.'
  const price = d.price.trim() === '' ? 0 : eurosToCents(d.price)
  if (!validPrice(price)) e.price = 'Gratis, o 0,50 € como mínimo.'
  if (d.memberPrice.trim() !== '') {
    const member = eurosToCents(d.memberPrice)
    if (!validPrice(member)) e.memberPrice = 'Gratis, o 0,50 € como mínimo.'
    else if (validPrice(price) && member > price) e.memberPrice = 'No puede superar el precio.'
  }
  const cap = d.capacity.trim()
  if (cap !== '' && !(/^\d{1,6}$/.test(cap) && Number(cap) >= 1)) e.capacity = 'Mínimo 1 plaza.'
  if (d.deadlineDay !== '' || d.deadlineTime !== '') {
    const deadline = madridToIso(d.deadlineDay, d.deadlineTime)
    if (!deadline) e.deadlineDay = 'Pon el día y la hora.'
    else if (starts && Date.parse(deadline) > Date.parse(starts)) e.deadlineDay = 'Tiene que ser antes del inicio.'
  }
  return e
}

// «3 de 20 plazas» o «3 inscritos» si no hay tope.
export const eventSeats = (e: Pick<AdminEvent, 'taken' | 'capacity'>): string =>
  e.capacity === null ? `${e.taken} inscritos` : `${e.taken} de ${e.capacity} ${e.capacity === 1 ? 'plaza' : 'plazas'}`

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

// ── Alumno, tutor y profesor (B21.2) ─────────────────────────────────────────

// docs/api.md § Eventos: la forma que ve el alumno y el profesor. `registration` es la del sujeto (la viva o, si no, la última).
export type EventInfo = Omit<AdminEvent, 'cancel_note'> & {
  registration: { id: string; status: 'pending' | 'confirmed' | 'cancelled'; amount_cents: number } | null
}

// Socio = el sujeto con suscripción en vigor (active o past_due, como register_event en 028): el precio de socio solo se aplica a él.
export const isMember = (sub: { status: string } | null | undefined): boolean => !!sub && ['active', 'past_due'].includes(sub.status)

// Lo que el servidor cobrará al inscribirse; 0 = confirmada sin Checkout.
export const amountFor = (e: Pick<EventInfo, 'price_cents' | 'member_price_cents'>, member: boolean): number =>
  member && e.member_price_cents !== null ? e.member_price_cents : e.price_cents

// El importe que verá el sujeto: el suyo (si ya está inscrito, lo pagado) y, si no es socio y hay precio de socio, el otro como nota.
// `member` indefinido (aún cargando la cuota) se trata como no socio.
export function priceView(e: EventInfo, member: boolean | undefined): { main: string; note: string | null } {
  const r = e.registration
  if (r && r.status !== 'cancelled') return { main: priceLabel(r.amount_cents), note: null }
  if (member && e.member_price_cents !== null) return { main: priceLabel(e.member_price_cents), note: e.member_price_cents < e.price_cents ? 'Precio de socio' : null }
  return { main: priceLabel(e.price_cents), note: e.member_price_cents !== null && e.member_price_cents < e.price_cents ? memberPriceLabel(e) : null }
}

// Público por edad: solo se nombra el público del evento; la edad del sujeto no se calcula ni se enseña (el servidor responde audience_mismatch).
export const audienceTag = (a: Audience): string | null => (a === 'all' ? null : AUDIENCE_LABEL[a])
export const audienceText = (name?: string): string => `Este evento no es para ${name ? `la edad de ${name}` : 'tu edad'}.`

// Plazas libres: sin aforo no se dice nada.
export function spotsLabel(e: Pick<EventInfo, 'capacity' | 'taken'>): string | null {
  if (e.capacity === null) return null
  const left = e.capacity - e.taken
  return left <= 0 ? 'Completo' : left === 1 ? 'Queda 1 plaza' : `Quedan ${left} plazas`
}

export type JoinState = 'cancelled' | 'cancellable' | 'pending' | 'paid' | 'registered' | 'closed' | 'full' | 'audience' | 'profile' | 'cover' | 'open'
// blocked: perfil incompleto (del sujeto o, con un hijo, del tutor); riskCover: false = sin cobertura (solo importa si el evento la exige).
export type JoinCtx = { now: number; blocked: boolean; riskCover?: boolean; audienceBlocked?: boolean }

// Qué ofrece el botón del detalle. Cancelar solo si es gratis o está pendiente y antes del inicio; una pagada se pide a la academia.
export function joinState(e: EventInfo, c: JoinCtx): JoinState {
  if (e.status === 'cancelled') return 'cancelled'
  const r = e.registration
  const started = c.now >= Date.parse(e.starts_at)
  if (r && r.status !== 'cancelled') {
    if (r.status === 'confirmed' && r.amount_cents > 0) return 'paid'
    if (started) return 'registered'
    return r.status === 'pending' ? 'pending' : 'cancellable'
  }
  if (c.now >= Date.parse(e.registration_deadline ?? e.starts_at)) return 'closed'
  if (e.capacity !== null && e.taken >= e.capacity) return 'full'
  if (c.audienceBlocked) return 'audience'
  if (c.blocked) return 'profile'
  if (e.requires_risk_cover && c.riskCover === false) return 'cover'
  return 'open'
}

// Inscripción viva y evento aún sin terminar: lo que enseñan Reservas e Inicio.
export const isUpcomingRegistration = (e: EventInfo, now: number): boolean =>
  e.status === 'scheduled' && !!e.registration && e.registration.status !== 'cancelled' && Date.parse(e.ends_at) > now

// Las fichas de salud del profesor valen cualquier día del evento (de inicio a fin, en Madrid) y si no está cancelado.
export const eventHealthDay = (e: Pick<EventInfo, 'status' | 'starts_at' | 'ends_at'>, now: number): boolean =>
  e.status === 'scheduled' && madridDay(now) >= madridDay(e.starts_at) && madridDay(now) <= madridDay(e.ends_at)

// Lista del profesor: un evento y sus inscritos confirmados.
export type EventStudent = { profile_id: string; display_name: string; attended: boolean | null; risk_cover: boolean }

// Sesiones y eventos del profesor, por fecha. Hay sesiones y eventos a la misma hora: a igual inicio, primero la sesión.
export type Entry<S extends { starts_at: string }> = { kind: 'session'; s: S } | { kind: 'event'; e: EventInfo }
export const entryStart = (it: Entry<{ starts_at: string }>): number => Date.parse(it.kind === 'session' ? it.s.starts_at : it.e.starts_at)
export function mergeByStart<S extends { starts_at: string }>(sessions: S[], events: EventInfo[]): Entry<S>[] {
  const all: Entry<S>[] = [...sessions.map((s) => ({ kind: 'session' as const, s })), ...events.map((e) => ({ kind: 'event' as const, e }))]
  return all.sort((a, b) => entryStart(a) - entryStart(b))
}

// «sábado, 12 de diciembre · 10:00–14:00» o, si dura varios días, «12 dic a las 10:00 – 14 dic a las 18:00».
export function eventWhen(e: Pick<EventInfo, 'starts_at' | 'ends_at'>): string {
  const day = madridDay(e.starts_at)
  return day === madridDay(e.ends_at)
    ? `${formatDay(day)} · ${formatTime(e.starts_at)}–${formatTime(e.ends_at)}`
    : `${formatDeadline(e.starts_at)} – ${formatDeadline(e.ends_at)}`
}
