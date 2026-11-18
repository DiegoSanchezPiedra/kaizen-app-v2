import { BanIcon, ChevronRightIcon, CircleCheckIcon } from 'lucide-react'
import { Tag } from '@/components/billing-bits'
import { TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { queryClient } from '@/lib/logout'
import { cn } from '@/lib/utils'

// Lo que cambia el catálogo lo ven también el alumno (planes, disciplinas), el calendario y las reservas.
export const refreshCatalog = () => Promise.all(['admin', 'plans', 'disciplines', 'calendar', 'bookings'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export const Head = ({ cols, end = [] }: { cols: string[]; end?: number[] }) => (
  <TableHeader className="sticky top-0 bg-card">
    <TableRow>
      {cols.map((h, i) => (
        <TableHead key={h || 'acciones'} className={cn(!i && 'ps-4', end.includes(i) && 'text-right')}>
          {h || <span className="sr-only">Acciones</span>}
        </TableHead>
      ))}
    </TableRow>
  </TableHeader>
)

// Estado con icono y texto. En las filas solo sale lo que se sale (retirada, desactivada); en la tabla, siempre.
export const StateTag = ({ active, off }: { active: boolean; off: string }) =>
  active ? (
    <Tag variant="success">
      <CircleCheckIcon aria-hidden="true" />
      Activa
    </Tag>
  ) : (
    <Tag variant="secondary">
      <BanIcon aria-hidden="true" />
      {off}
    </Tag>
  )

// Como Usuarios (docs/pantallas-b22.md): hasta `xl`, una fila por elemento en un marco y toda la fila abre la hoja;
// la tabla solo desde `xl`, que con la barra lateral no cabe antes.
export function CatalogRows({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card xl:hidden">{children}</ul>
}

export function CatalogRow({ name, active, off, marks, lines, onOpen }: { name: string; active: boolean; off: string; marks?: React.ReactNode; lines: React.ReactNode[]; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-3 py-2.5 ps-4 pe-3 text-left transition-colors duration-150 ease-out outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start justify-between gap-3">
            <span className={cn('min-w-0 font-semibold break-words', !active && 'text-muted-foreground')}>{name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {marks}
              {!active && <StateTag active={false} off={off} />}
            </span>
          </span>
          {lines.map((l, i) => (
            <span key={i} className="text-sm text-muted-foreground">
              {l}
            </span>
          ))}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
}

export function CatalogTable({ children }: { children: React.ReactNode }) {
  return <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">{children}</div>
}
