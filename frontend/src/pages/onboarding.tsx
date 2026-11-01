import { useQuery } from '@tanstack/react-query'
import { CircleCheckIcon, UsersIcon } from 'lucide-react'
import { Link } from 'react-router'
import { AgreementsPanel } from '@/components/agreements-panel'
import { HealthForm } from '@/components/health-form'
import { MyDataForm, useMeKey } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { agreementsFor, onboardingSteps, type Step } from '@/lib/profile'
import { useProfileStatus } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'

const TITLES: Record<Step, string> = { datos: 'Tus datos', ficha: 'Ficha de salud', acuerdos: 'Acuerdos' }

// Se entra cuando `missing` no está vacío; los pasos salen de él y se puede salir y volver.
export function OnboardingPage() {
  const session = useSession()
  const role = session?.role ?? 'alumno'
  const status = useProfileStatus()
  const me = useQuery({ queryKey: useMeKey, queryFn: () => api<Me>('/me') })
  const query = status.isError ? status : me
  if (status.isPending || me.isPending) return <Page title="Completar perfil"><ListSkeleton rows={3} /></Page>
  if (query.isError) return <Page title="Completar perfil"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Page>

  const missing = status.data!.missing ?? []
  const remaining = onboardingSteps(missing, me.data!.birth_date === null && role === 'alumno')
  // El tutor (rol) no tiene ficha: nombre y protección de datos.
  const all: Step[] = role === 'tutor' ? ['datos', 'acuerdos'] : ['datos', 'ficha', 'acuerdos']
  const now = remaining[0]

  if (!now) {
    return (
      <Page title="Completar perfil">
        <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
          <CircleCheckIcon className="size-10 text-success" aria-hidden="true" />
          <h2 className="font-heading text-2xl font-bold">Perfil completo</h2>
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
      </Page>
    )
  }

  return (
    <Page title="Completar perfil">
      <div>
        <ol className="flex gap-1.5" aria-label="Pasos">
          {all.map((s) => (
            <li key={s} className={cn('h-1.5 flex-1 rounded-full bg-foreground/10', !remaining.includes(s) && 'bg-primary', s === now && 'bg-primary/45')}>
              <span className="sr-only">
                {TITLES[s]}: {!remaining.includes(s) ? 'hecho' : s === now ? 'ahora' : 'pendiente'}
              </span>
            </li>
          ))}
        </ol>
        <h2 className="mt-3 text-lg font-semibold">
          Paso {all.indexOf(now) + 1} de {all.length} · {TITLES[now]}
        </h2>
      </div>
      {now === 'datos' && <MyDataForm submitLabel="Continuar" />}
      {now === 'ficha' && <HealthForm />}
      {now === 'acuerdos' && <AgreementsPanel types={agreementsFor(role)} status={status.data!} />}
    </Page>
  )
}
