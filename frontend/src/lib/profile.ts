// `missing` de GET /me/profile-status → qué aviso y qué pasos (docs/pantallas-b18.md § Estados de bloqueo).
export const AGREEMENTS = ['data_protection', 'rights_of_image'] as const
export type AgreementType = (typeof AGREEMENTS)[number]

export const AGREEMENT_TITLE: Record<AgreementType, string> = {
  data_protection: 'Protección de datos',
  rights_of_image: 'Derechos de imagen',
}

const isAgreement = (m: string) => (AGREEMENTS as readonly string[]).includes(m)

// 'complete': falta algo que no es un acuerdo (nombre, ficha, contacto); 'sign': solo faltan acuerdos.
export function profileNotice(missing: string[] = []): 'complete' | 'sign' | null {
  if (!missing.length) return null
  return missing.every(isAgreement) ? 'sign' : 'complete'
}

// «Completar perfil» de un hijo (no tiene onboarding): a la ficha si falta; si solo faltan acuerdos, a firmarlos.
export function childProfilePath(missing: string[]): string {
  return profileNotice(missing) === 'sign' ? '/agreements' : '/account/health'
}

// Del 403 profile_incomplete actuando por un hijo: `whose` dice de quién es `missing`. Lo de quien actúa, a su onboarding;
// lo del hijo (o sin `whose`, de una API anterior), a su ficha o acuerdos.
export const incompletePath = (missing: string[], whose: unknown): string => (whose === 'actor' ? '/onboarding' : childProfilePath(missing))

// Qué impide pagar y a dónde lleva «Completar perfil». `child`: lo que falta al hijo, o null si uno paga lo suyo.
// Por un hijo deben estar completos los dos (CONTEXT.md «Perfil completo»): primero el hijo, luego quien paga.
// Lo propio, siempre en el onboarding: /agreements solo enseña los acuerdos propios a un tutor, no a un alumno con hijos.
export function payBlocker(child: string[] | null, own: string[]): { mine: boolean; missing: string[]; to: string } | null {
  if (child?.length) return { mine: false, missing: child, to: childProfilePath(child) }
  return own.length ? { mine: true, missing: own, to: '/onboarding' } : null
}

export type Step = 'datos' | 'ficha' | 'acuerdos'
export function onboardingSteps(missing: string[], birthMissing: boolean): Step[] {
  const steps: Step[] = []
  // B32: a los 18, quien entró con el usuario de su tutor añade su email en el mismo paso.
  if (missing.includes('display_name') || missing.includes('email') || birthMissing) steps.push('datos')
  if (missing.some((m) => m === 'health_info' || m === 'emergency_contact')) steps.push('ficha')
  if (missing.some(isAgreement)) steps.push('acuerdos')
  return steps
}

// Los acuerdos que cuenta el sujeto: un tutor (rol), solo su protección de datos.
export const agreementsFor = (role: string): AgreementType[] => (role === 'tutor' ? ['data_protection'] : [...AGREEMENTS])

// Redes del perfil público (propio o de un hijo): solo enlaces https.
export const NETWORKS: [string, string][] = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['web', 'Web']]
export const isHttps = (u: string): boolean => /^https:\/\/\S+$/.test(u)
