// `missing` de GET /me/profile-status → qué aviso y qué pasos (docs/pantallas-b18.md § Estados de bloqueo).
export const AGREEMENTS = ['data_protection', 'rights_of_image'] as const
export type AgreementType = (typeof AGREEMENTS)[number] | 'waiver'

export const AGREEMENT_TITLE: Record<AgreementType, string> = {
  data_protection: 'Protección de datos',
  rights_of_image: 'Derechos de imagen',
  waiver: 'Exención de responsabilidad',
}

const isAgreement = (m: string) => (AGREEMENTS as readonly string[]).includes(m)

// 'complete': falta algo que no es un acuerdo (nombre, ficha, contacto); 'sign': solo faltan acuerdos.
export function profileNotice(missing: string[] = []): 'complete' | 'sign' | null {
  if (!missing.length) return null
  return missing.every(isAgreement) ? 'sign' : 'complete'
}

export type Step = 'datos' | 'ficha' | 'acuerdos'
export function onboardingSteps(missing: string[], birthMissing: boolean): Step[] {
  const steps: Step[] = []
  if (missing.includes('display_name') || birthMissing) steps.push('datos')
  if (missing.some((m) => m === 'health_info' || m === 'emergency_contact')) steps.push('ficha')
  if (missing.some(isAgreement)) steps.push('acuerdos')
  return steps
}

// Los acuerdos que cuenta el sujeto: un tutor (rol), solo su protección de datos.
export const agreementsFor = (role: string): AgreementType[] => (role === 'tutor' ? ['data_protection'] : [...AGREEMENTS])
