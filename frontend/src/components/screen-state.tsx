import type { UseQueryResult } from '@tanstack/react-query'
import { CircleAlertIcon, LockIcon, RefreshCwIcon, SearchXIcon, WifiOffIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'

// Estados comunes de docs/pantallas-b18.md: error, sin conexión y sin permiso. Cargando y vacío los pone cada pantalla.
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
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
        : 'Inténtalo de nuevo en un momento.'
  return (
    <Empty role={offline ? 'status' : 'alert'} className="rounded-2xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
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
}: {
  icon: React.ReactNode
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <Empty className="rounded-2xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {text && <EmptyDescription>{text}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
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
