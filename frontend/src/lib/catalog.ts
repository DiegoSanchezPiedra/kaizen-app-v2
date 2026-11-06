import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'

// ── Precios: la API da céntimos, la pantalla euros ───────────────────────────

// «12,50» o «12.5» → 1250. Sin float: parte entera y hasta dos decimales. null si no es un importe.
export function eurosToCents(text: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(text.trim())
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null
}
export const centsToEuros = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

// «1», «2»… o «Todas» (null) en el campo «cuántas disciplinas» de un plan.
export const maxDisciplinesLabel = (max: number | null): string => (max === null ? 'Todas' : String(max))

// El catálogo era /admin/catalog con pestañas (?tab=plans | disciplines); ahora son dos rutas. Un enlace viejo, sin pestaña o con una desconocida, va a Disciplinas.
export const catalogRedirect = (tab: string | null): string => (tab === 'plans' ? '/admin/memberships' : '/admin/disciplines')

// ── Ajustes: tres grupos con su «Guardar» ────────────────────────────────────

export type CheckinSettings = { opens_minutes: number | null; closes_minutes: number | null; qr_seconds: number | null }
export type InsuranceSettings = { enabled: boolean; price_adult_cents: number | null; price_minor_cents: number | null }
export type Settings = { checkin: CheckinSettings; insurance: InsuranceSettings; discipline_changes: { per_period: number } }

const whole = (v: string): number | null => (/^\d{1,9}$/.test(v.trim()) ? Number(v) : null)
export const minutesOf = (v: string): number | null => {
  const n = whole(v)
  return n !== null && n >= 1 && n <= 1440 ? n : null
}

// Cada «xxxBody» da lo que se manda al guardar, o null si el borrador no vale (el botón se queda apagado).
export function checkinBody(d: Record<keyof CheckinSettings, string>) {
  const body = { opens_minutes: minutesOf(d.opens_minutes), closes_minutes: minutesOf(d.closes_minutes), qr_seconds: minutesOf(d.qr_seconds) }
  return body.opens_minutes && body.closes_minutes && body.qr_seconds ? (body as { [K in keyof CheckinSettings]: number }) : null
}
export const perPeriodBody = (v: string): { per_period: number } | null => {
  const n = whole(v)
  return n === null || n > 1000 ? null : { per_period: n }
}

// Un precio vacío solo vale si el seguro aún no lo tenía y sigue sin ofrecerse: la API no borra precios.
export function insuranceBody(saved: InsuranceSettings, d: { adult: string; minor: string; enabled: boolean }) {
  const body: { enabled: boolean; price_adult_cents?: number; price_minor_cents?: number } = { enabled: d.enabled }
  for (const [field, text, before] of [
    ['price_adult_cents', d.adult, saved.price_adult_cents],
    ['price_minor_cents', d.minor, saved.price_minor_cents],
  ] as const) {
    if (text.trim() === '') {
      if (before !== null || d.enabled) return null
      continue
    }
    const cents = eurosToCents(text)
    if (!cents) return null
    body[field] = cents
  }
  return body
}

// ¿Cambia algo respecto a lo guardado? (un campo ausente del cuerpo no cambia).
export const changed = (saved: object, body: object | null): boolean =>
  !!body && Object.entries(body).some(([k, v]) => v !== undefined && v !== (saved as Record<string, unknown>)[k])

// ── Documentos legales ───────────────────────────────────────────────────────

export const MAX_PDF = 10 * 1024 * 1024
export const VERSION_RE = /^\d+\.\d+$/
export const DOC_TYPES = Object.keys(AGREEMENT_TITLE) as AgreementType[]
export const docTitle = (type: string): string => AGREEMENT_TITLE[type as AgreementType] ?? type

// Antes de enviar: tipo, versión X.Y y un PDF de hasta 10 MB. El texto de lo primero que falla, o null.
export function pdfProblem(type: string, version: string, file: { type: string; size: number } | null): string | null {
  if (!DOC_TYPES.includes(type as AgreementType)) return 'Elige el tipo de documento.'
  if (!VERSION_RE.test(version.trim())) return 'La versión se escribe como 1.0 o 2.1.'
  if (!file) return 'Elige el PDF.'
  if (file.type !== 'application/pdf') return 'El archivo tiene que ser un PDF.'
  if (file.size === 0) return 'El PDF está vacío.'
  if (file.size > MAX_PDF) return 'El PDF pesa más de 10 MB.'
  return null
}

export type AgreementDoc = {
  id: string
  type: string
  version: string
  checksum: string
  created_at: string
  published_at: string | null
  retired_at: string | null
  status: 'created' | 'published' | 'retired'
}
export type DocGroup = { type: string; current: AgreementDoc | null; drafts: AgreementDoc[]; retired: AgreementDoc[] }

// Por tipo (en el orden de DOC_TYPES, y al final algún tipo que la API traiga de más): la vigente, los borradores
// y los retirados. La API ya los da del más nuevo al más viejo.
export function groupDocuments(docs: AgreementDoc[]): DocGroup[] {
  const types = [...new Set([...DOC_TYPES, ...docs.map((d) => d.type)])]
  return types.map((type) => {
    const mine = docs.filter((d) => d.type === type)
    return {
      type,
      current: mine.find((d) => d.status === 'published') ?? null,
      drafts: mine.filter((d) => d.status === 'created'),
      retired: mine.filter((d) => d.status === 'retired'),
    }
  })
}

// ── Tablets ──────────────────────────────────────────────────────────────────

export type Tablet = {
  id: string
  name: string
  link_expires_at: string | null
  created_at: string
  linked_at: string | null
  last_seen_at: string | null
  revoked_at: string | null
  link_code?: string
}
export type TabletState = 'waiting' | 'linked' | 'revoked'
export const tabletState = (t: Pick<Tablet, 'linked_at' | 'revoked_at'>): TabletState => (t.revoked_at ? 'revoked' : t.linked_at ? 'linked' : 'waiting')
