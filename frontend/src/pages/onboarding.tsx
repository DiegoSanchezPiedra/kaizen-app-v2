import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CircleCheckIcon, CircleDotIcon, CircleIcon, UsersIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { AgreementsPanel } from '@/components/agreements-panel'
import { HealthForm } from '@/components/health-form'
import { MyDataForm, useMeKey } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { Rise } from '@/components/rise'
import { ErrorState } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { safeReturnPath } from '@/lib/paths'
import { agreementsFor, onboardingSteps, type Step } from '@/lib/profile'
import { useProfileStatus } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'

const TITLES: Record<Step, string> = { datos: 'Tus datos', ficha: 'Ficha de salud', acuerdos: 'Acuerdos' }
const SHORT: Record<Step, string> = { datos: 'Datos', ficha: 'Ficha', acuerdos: 'Acuerdos' }

// La entrada escalonada se juega solo en la primera visita de la sesión (como en profiles).
let played = false

// Con la forma real de la pantalla: barras de pasos, título, línea y formulario.
function OnboardingSkeleton({ steps }: { steps: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando">
      <div className="flex flex-col gap-3">
        <div className={cn('grid gap-1.5', steps === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
          {Array.from({ length: steps }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  )
}

// Se entra cuando `missing` no está vacío; los pasos salen de él y se puede salir y volver.
export function OnboardingPage() {
  const session = useSession()
  const role = session?.role ?? 'alumno'
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  // Al guardar un paso se desmonta su formulario: el foco pasa al título del siguiente (no en la primera carga).
  const lastStep = useRef<Step | 'fin' | null>(null)
  const focusOnChange = (step: Step | 'fin') => (el: HTMLElement | null) => {
    if (!el) return
    if (lastStep.current && lastStep.current !== step) el.focus()
    lastStep.current = step
  }
  const status = useProfileStatus()
  const [params] = useSearchParams()
  const volver = params.get('volver')
  const me = useQuery({ queryKey: useMeKey, queryFn: () => api<Me>('/me') })
  const query = status.isError ? status : me
  if (status.isPending || me.isPending) return <Page title="Completar perfil"><OnboardingSkeleton steps={role === 'tutor' ? 2 : 3} /></Page>
  if (query.isError) return <Page title="Completar perfil"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Page>

  const missing = status.data!.missing ?? []
  const remaining = onboardingSteps(missing, me.data!.birth_date === null && role === 'alumno')
  // El tutor (rol) no tiene ficha: nombre y protección de datos.
  const all: Step[] = role === 'tutor' ? ['datos', 'acuerdos'] : ['datos', 'ficha', 'acuerdos']
  const now = remaining[0]

  // Lanzado desde otra pantalla (p. ej. contratar la cuota de un hijo): al terminar, de vuelta allí.
  if (!now && volver) return <Navigate to={safeReturnPath(volver)} replace />
  if (!now) {
    return (
      <Page title="Completar perfil">
        <Rise on={first} i={0}>
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
            <CircleCheckIcon className="size-10 text-success" aria-hidden="true" />
            <h2 ref={focusOnChange('fin')} tabIndex={-1} className="text-xl font-semibold outline-none">
              Perfil completo
            </h2>
            <p className="text-sm text-muted-foreground">
              {role === 'tutor' ? 'Ahora añade a tus hijos: reservarás y harás su seguimiento desde aquí.' : 'Ya puedes reservar tus sesiones.'}
            </p>
            {role === 'tutor' ? (
              <Button size="xl" render={<Link to="/account/children" />}>
                <UsersIcon />
                Añade a tus hijos
              </Button>
            ) : (
              <Button size="xl" render={<Link to="/calendar" />}>Ver calendario</Button>
            )}
            <Button variant="ghost" size="xl" render={<Link to="/" />}>Ir al inicio</Button>
          </div>
        </Rise>
      </Page>
    )
  }

  return (
    <Page title="Completar perfil">
      <Rise on={first} i={0} className="flex flex-col gap-3">
        <ol className={cn('grid gap-1.5', all.length === 2 ? 'grid-cols-2' : 'grid-cols-3')} aria-label="Pasos">
          {all.map((s) => {
            const done = !remaining.includes(s)
            const current = s === now
            return (
              <li key={s} aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-col gap-1.5">
                <div className={cn('h-1.5 rounded-full transition-colors duration-300 ease-(--ease-out)', done || current ? 'bg-primary' : 'bg-foreground/10', current && 'ring-2 ring-primary/25')} />
                <span className={cn('flex items-center gap-1 text-xs', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {done ? <CheckIcon className="size-3.5 shrink-0 text-success-foreground" aria-hidden="true" /> : current ? <CircleDotIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : <CircleIcon className="size-3.5 shrink-0" aria-hidden="true" />}
                  <span className="truncate">{SHORT[s]}</span>
                  <span className="sr-only">: {done ? 'hecho' : current ? 'ahora' : 'pendiente'}</span>
                </span>
              </li>
            )
          })}
        </ol>
        <div className="flex flex-col gap-1">
          <h2 key={now} ref={focusOnChange(now)} tabIndex={-1} className="text-lg font-semibold outline-none">
            {TITLES[now]}
          </h2>
          <p className="text-sm text-muted-foreground">
            Paso {all.indexOf(now) + 1} de {all.length} · {volver ? 'Al terminar, vuelves a donde estabas.' : 'Puedes salir y volver cuando quieras.'}
          </p>
        </div>
      </Rise>
      <Rise on={first} i={1}>
        {/* Al guardar un paso, el siguiente entra con un fundido suave (con movimiento reducido, solo opacidad: index.css limita las transiciones). */}
        <div key={now} className="transition-[opacity,translate] duration-200 ease-(--ease-out) starting:translate-y-1.5 starting:opacity-0">
          {now === 'datos' && <MyDataForm submitLabel="Continuar" askEmail={missing.includes('email')} quiet />}
          {now === 'ficha' && <HealthForm submitLabel="Continuar" quiet />}
          {now === 'acuerdos' && <AgreementsPanel types={agreementsFor(role)} status={status.data!} />}
        </div>
      </Rise>
    </Page>
  )
}
