import type React from 'react'
import { CircleAlertIcon, CircleCheckIcon, ClockIcon, InfoIcon, TriangleAlertIcon, WifiOffIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FieldError } from '@/components/ui/field'

export type Notice = {
  kind: 'error' | 'warning' | 'info' | 'success'
  icon?: 'alert' | 'info' | 'clock' | 'wifi' | 'check' | 'triangle'
  title: string
  text?: string
}

const ICONS = {
  alert: CircleAlertIcon,
  info: InfoIcon,
  clock: ClockIcon,
  wifi: WifiOffIcon,
  check: CircleCheckIcon,
  triangle: TriangleAlertIcon,
}
const DEFAULT_ICON = { error: 'alert', warning: 'triangle', info: 'info', success: 'check' } as const

// Error general (o aviso) encima del formulario: icono + título, nunca solo color.
export function StatusAlert({ notice }: { notice: Notice }) {
  const Icon = ICONS[notice.icon ?? DEFAULT_ICON[notice.kind]]
  return (
    <Alert variant={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'} className="enter-soft" tabIndex={-1}>
      <Icon />
      <AlertTitle>{notice.title}</AlertTitle>
      {notice.text && <AlertDescription>{notice.text}</AlertDescription>}
    </Alert>
  )
}

// Error de campo: debajo del campo, con icono; Base UI lo enlaza con aria-describedby.
// Sin `match`, el error que llega del servidor; con `match`, el de la validación del navegador.
export function FieldMessage({ children, match }: { children: React.ReactNode; match?: keyof ValidityState }) {
  return (
    <FieldError match={match} className="enter-soft flex items-start gap-1.5 text-sm font-medium">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </FieldError>
  )
}

// Mensajes de la validación del navegador, en español y con el mismo aspecto.
export function NativeMessages({ email, minLength }: { email?: boolean; minLength?: boolean }) {
  return (
    <>
      <FieldMessage match="valueMissing">Rellena este campo.</FieldMessage>
      {email && <FieldMessage match="typeMismatch">Escribe un email válido.</FieldMessage>}
      {minLength && <FieldMessage match="tooShort">Usa al menos 8 caracteres.</FieldMessage>}
    </>
  )
}
