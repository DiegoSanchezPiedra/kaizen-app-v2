import type { UseQueryResult } from '@tanstack/react-query'
import { CircleAlertIcon, LockIcon, RefreshCwIcon, SearchXIcon, WifiOffIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useRouteError } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { errorCode } from '@/lib/notify'
import { BUILD, reportError } from '@/lib/report'
import { updateAndReload } from '@/lib/sw-update'

// Estados comunes de docs/pantallas-b18.md: error, sin conexión y sin permiso. Cargando y vacío los pone cada pantalla.
// DESIGN.md: los títulos de estado van en sans semibold, no en la condensada. Por defecto se conserva la condensada (las demás
// pantallas del grupo se pasan a ella al rediseñarlas): `plainTitle` la cambia.
const PLAIN = 'font-sans! font-semibold! text-lg'

export function ErrorState({ error, onRetry, plainTitle }: { error: unknown; onRetry?: () => void; plainTitle?: boolean }) {
  const offline = (error instanceof ApiError && error.code === 'network') || !navigator.onLine
  const forbidden = error instanceof ApiError && error.status === 403 && !offline
  const missing = error instanceof ApiError && error.status === 404
  const Icon = offline ? WifiOffIcon : forbidden ? LockIcon : missing ? SearchXIcon : CircleAlertIcon
  const title = offline ? 'Sin conexión' : forbidden ? 'No tienes acceso a esto' : missing ? 'No lo encontramos' : 'Algo ha fallado'
  const text = offline
    ? 'Conéctate a internet y vuelve a intentarlo.'
    : forbidden
      ? 'Vuelve al inicio para seguir.'
      : missing
        ? error.code === 'profile_not_found' ? errorText('profile_not_found') : 'Puede que ya no exista.'
        : errorText(errorCode(error), error instanceof ApiError ? error.details : {})
  return (
    <Empty role={offline ? 'status' : 'alert'} className="rounded-2xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className={plainTitle ? PLAIN : undefined}>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {forbidden || missing ? (
          <Button variant="outline" size="xl" render={<Link to="/" />}>
            Volver al inicio
          </Button>
        ) : (
          onRetry && (
            <Button variant="outline" size="xl" onClick={onRetry}>
              <RefreshCwIcon />
              Reintentar
            </Button>
          )
        )}
      </EmptyContent>
    </Empty>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  plainTitle,
}: {
  icon: React.ReactNode
  title: string
  text?: string
  action?: React.ReactNode
  plainTitle?: boolean
}) {
  return (
    <Empty className="rounded-2xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle className={plainTitle ? PLAIN : undefined}>{title}</EmptyTitle>
        {text && <EmptyDescription>{text}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

// Error en línea (fechas no válidas, una página que no carga): icono y texto en su color -texto, no solo color.
export function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="error">
      <CircleAlertIcon />
      <AlertDescription className="font-medium text-destructive-foreground">{children}</AlertDescription>
    </Alert>
  )
}

export function ListSkeleton({ rows = 3, className = 'h-24' }: { rows?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${className} w-full rounded-xl`} />
      ))}
    </div>
  )
}

// Cargando (esqueleto) → error → contenido. `children` recibe los datos ya cargados.
export function QueryView<T>({
  query,
  skeleton = <ListSkeleton />,
  children,
}: {
  query: UseQueryResult<T>
  skeleton?: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  if (query.isPending) return <>{skeleton}</>
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <>{children(query.data)}</>
}

// Pantalla de error del router (cuando una pantalla revienta): en vez del «Unexpected Application Error!» de React Router,
// la salida que casi siempre lo arregla, actualizar a la versión nueva (lib/sw-update.ts).
export function AppCrash() {
  const error = useRouteError()
  const [busy, setBusy] = useState(false)
  useEffect(() => reportError(error, { where: 'crash' }), [error])
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4">
      <Empty role="alert" className="rounded-2xl border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Algo ha fallado</EmptyTitle>
          <EmptyDescription>Puede que tengas una versión antigua de la app. Actualízala y vuelve a intentarlo.</EmptyDescription>
          {/* El error real, para poder mandarlo en una captura: en el móvil no hay consola. */}
          <p className="break-all font-mono text-xs text-muted-foreground">
            {error instanceof Error ? error.message : String(error)} · v{BUILD}
          </p>
        </EmptyHeader>
        <EmptyContent>
          <Button
            size="xl"
            loading={busy}
            onClick={() => {
              setBusy(true)
              void updateAndReload()
            }}
          >
            <RefreshCwIcon />
            Actualizar y recargar
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
