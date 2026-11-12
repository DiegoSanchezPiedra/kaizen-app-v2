import { AGREEMENT_TITLE, profileNotice, type AgreementType } from '@/lib/profile'
import type { ProfileStatus, Subscription } from '@/lib/types'

export type HomeNotice = { id: string; kind: 'warning' | 'error' | 'info'; title: string; text: string; to: string; cta: string }

export const MISSING_TEXT: Record<string, string> = {
  display_name: 'tu nombre',
  email: 'tu email',
  health_info: 'la ficha de salud',
  emergency_contact: 'un contacto de emergencia',
  data_protection: 'la protección de datos',
  rights_of_image: 'los derechos de imagen',
}
const list = (items: string[]): string => items.join(', ').replace(/, ([^,]*)$/, ' y $1')

// Sin cuota: en Inicio y encima del Calendario, que es donde se intenta reservar.
export const NO_SUBSCRIPTION: HomeNotice = { id: 'nosub', kind: 'info', title: 'Contrata una cuota para reservar', text: 'Sin cuota no se puede reservar ninguna sesión.', to: '/billing', cta: 'Contratar cuota' }

// Avisos de estado de Inicio, en el orden del canvas: perfil o acuerdo, impagado, gracia, sin suscripción.
// `subject`: null si es uno mismo, o el hijo; `self`: el estado del tutor cuando actúa por un hijo.
export function homeNotices({
  status,
  subscription,
  subject,
  self,
}: {
  status?: ProfileStatus
  subscription?: Subscription | null
  subject: { id: string; label: string } | null
  self?: ProfileStatus
}): HomeNotice[] {
  const out: HomeNotice[] = []
  const missing = status?.missing ?? []
  const kind = profileNotice(missing)
  const forWho = subject ? ` de ${subject.label}` : ''
  if (kind === 'complete') {
    const labels = missing.map((m) => MISSING_TEXT[m]).filter(Boolean)
    out.push({
      id: 'profile',
      kind: 'warning',
      title: `Completa el perfil${forWho}`,
      text: `Falta ${list(labels)}.`,
      // Un hijo no tiene pantalla de pasos: su ficha se rellena desde Cuenta.
      to: subject ? '/account/health' : '/onboarding',
      cta: 'Completar perfil',
    })
  } else if (kind === 'sign') {
    const docs = missing.map((m) => AGREEMENT_TITLE[m as AgreementType]?.toLowerCase()).filter(Boolean)
    out.push({
      id: 'sign',
      kind: 'warning',
      title: `Tienes que firmar${forWho ? '' : ' un documento'}`,
      text: `${subject ? `Falta firmar por ${subject.label}` : 'Falta firmar'}: ${list(docs)}.`,
      to: '/agreements',
      cta: 'Firmar',
    })
  }
  if (subject && self?.missing?.includes('data_protection')) {
    out.push({ id: 'self-dp', kind: 'warning', title: 'Te falta firmar tu protección de datos', text: 'Hace falta para actuar por tus hijos.', to: '/agreements', cta: 'Firmar' })
  }
  if (subscription?.status === 'unpaid') {
    out.push({ id: 'unpaid', kind: 'error', title: 'La cuota está impagada', text: 'Hay un cobro pendiente y no se pueden hacer reservas hasta pagarlo.', to: '/billing', cta: 'Gestionar pagos' })
  } else if (subscription?.status === 'past_due' || subscription?.status === 'grace_period') {
    out.push({ id: 'grace', kind: 'warning', title: 'Hay un cobro pendiente', text: 'Todavía puedes reservar, pero conviene resolverlo pronto.', to: '/billing', cta: 'Gestionar pagos' })
  }
  if (subscription === null) {
    out.push(NO_SUBSCRIPTION)
  }
  return out
}
