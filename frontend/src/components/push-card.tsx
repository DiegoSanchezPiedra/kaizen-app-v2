import { BellIcon, BellOffIcon, BellRingIcon, CheckIcon, CircleAlertIcon, MailIcon, ShareIcon, SmartphoneIcon, SquarePlusIcon } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { usePush } from '@/hooks/use-push'
import { useSubject } from '@/hooks/use-subject'
import { showOnHome, type PushState } from '@/lib/push'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

// Textos del canvas (B186Push). Propuestos: pendientes de confirmar, como los de errors.ts.
const TEXT: Record<Exclude<PushState, 'ofrecer' | 'pidiendo' | 'error'>, [string, string]> = {
  activado: ['Avisos activados', 'Te llegarán aquí si cancelan o cambian una sesión, o si hay un acuerdo nuevo que firmar.'], // propuesto
  denegado: ['Has bloqueado los avisos', 'Te avisaremos por email.'], // propuesto
  ios: ['Instala Kaizen para recibir avisos', 'En iPhone y iPad, los avisos solo llegan con Kaizen en la pantalla de inicio. Mientras tanto, te avisaremos por email.'], // propuesto
  sin_soporte: ['Este navegador no recibe avisos', 'Te avisaremos por email.'], // propuesto
}
const HINT: Partial<Record<PushState, string>> = {
  activado: 'Para quitarlos, cambia el permiso de notificaciones en los ajustes del navegador.', // propuesto (solo en Cuenta)
  denegado: 'Si cambias de idea, permite las notificaciones de Kaizen en los ajustes del navegador y vuelve aquí.', // propuesto
}
const ICON = { ofrecer: BellIcon, pidiendo: BellIcon, error: BellIcon, activado: BellRingIcon, denegado: BellOffIcon, sin_soporte: BellOffIcon, ios: SmartphoneIcon }
const TONE = { primary: 'bg-primary/14 text-link', success: 'bg-success/14 text-success-foreground', neutral: 'bg-foreground/8 text-muted-foreground' }

const DISMISS_KEY = 'kz.push.dismissed'
const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function forWhom(role: string | undefined, hasChildren: boolean) {
  if (role === 'tutor') return 'Para enterarte si cancelan o cambian la sesión de tus hijos.' // propuesto
  return hasChildren ? 'Para enterarte si cancelan o cambian tu sesión o la de tus hijos.' : 'Para enterarte si cancelan o cambian tu sesión.' // propuesto
}

// Tarjeta de avisos push (Inicio y Cuenta, alumno y tutor). Es del dispositivo: no cambia con el selector de sujeto.
export function PushCard({ place }: { place: 'inicio' | 'cuenta' }) {
  const role = useSession()?.role
  const { options } = useSubject()
  const { ready, state, decidedNow, enable } = usePush()
  const [dismissed, setDismissed] = useState(readDismissed)
  const inicio = place === 'inicio'
  if (!ready || (inicio && !showOnHome(state, { dismissed, decidedNow }))) return null

  const offering = state === 'ofrecer' || state === 'pidiendo' || state === 'error'
  const [title, text] = offering ? ['Activa los avisos', forWhom(role, options.length > 1)] : TEXT[state]
  const tone = state === 'activado' ? 'success' : state === 'denegado' || state === 'sin_soporte' ? 'neutral' : 'primary'
  const hint = state === 'activado' && inicio ? undefined : HINT[state]
  const Icon = ICON[state]
  const Heading = inicio ? 'h2' : 'h3'
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // sin almacenamiento solo se oculta en esta visita
    }
    setDismissed(true)
  }

  const card = (
    <section data-slot="push-card" aria-labelledby="push-t" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div key={state} className="enter-soft flex items-start gap-3" aria-live="polite">
        <div className={cn('grid size-11 shrink-0 place-items-center rounded-xl', TONE[tone])} aria-hidden="true">
          <Icon className="size-5.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Heading id="push-t" className="text-lg font-semibold">
            {title}
          </Heading>
          <p className="text-sm text-muted-foreground">{text}</p>
          {state === 'activado' && (
            <Badge variant="success" className="mt-1 self-start">
              <CheckIcon />
              En este dispositivo
            </Badge>
          )}
          {(state === 'denegado' || state === 'sin_soporte' || state === 'ios') && (
            <Badge variant="secondary" className="mt-1 self-start">
              <MailIcon />
              Por email
            </Badge>
          )}
        </div>
      </div>
      {state === 'ios' && (
        <ol className="flex flex-col gap-2.5 text-sm" aria-label="Cómo añadir Kaizen a la pantalla de inicio">
          <Step n={1}>
            En Safari, toca <strong>Compartir</strong> <ShareIcon className="inline size-4 align-[-3px] text-link" aria-hidden="true" /> (en la barra o en el menú ···).
          </Step>
          <Step n={2}>
            Elige <strong>Añadir a pantalla de inicio</strong> <SquarePlusIcon className="inline size-4 align-[-3px] text-link" aria-hidden="true" />.
          </Step>
          <Step n={3}>Abre Kaizen desde su icono y activa los avisos aquí.</Step>
        </ol>
      )}
      {state === 'error' && (
        <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-destructive-foreground">
          <CircleAlertIcon className="mt-px size-4.5 shrink-0" aria-hidden="true" />
          No hemos podido activarlos. Inténtalo de nuevo. {/* propuesto */}
        </p>
      )}
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
      {(offering || (inicio && state === 'ios')) && (
        <div className="flex flex-wrap gap-2">
          {state === 'pidiendo' ? (
            <Button size="xl" disabled aria-busy="true">
              <Spinner aria-hidden="true" />
              Esperando tu permiso…
            </Button>
          ) : (
            offering && (
              <Button size="xl" onClick={() => void enable()}>
                <BellIcon />
                Activar avisos
              </Button>
            )
          )}
          {inicio && state !== 'pidiendo' && (
            <Button size="xl" variant="ghost" onClick={dismiss}>
              Ahora no
            </Button>
          )}
        </div>
      )}
    </section>
  )

  // En Cuenta va en su grupo «App», que desaparece entero con push_disabled.
  return inicio ? (
    card
  ) : (
    <section aria-label="App" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">App</h2>
      {card}
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <b className="grid size-6.5 shrink-0 place-items-center rounded-full bg-primary/14 font-heading text-[15px] font-bold text-link">{n}</b>
      <span>{children}</span>
    </li>
  )
}
