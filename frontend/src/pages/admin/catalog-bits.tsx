import { Tag } from '@/components/billing-bits'
import { TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { queryClient } from '@/lib/logout'
import { cn } from '@/lib/utils'

// Lo que cambia el catálogo lo ven también el alumno (planes, disciplinas), el calendario y las reservas.
export const refreshCatalog = () => Promise.all(['admin', 'plans', 'disciplines', 'calendar', 'bookings'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export const Head = ({ cols }: { cols: string[] }) => (
  <TableHeader className="sticky top-0 bg-card">
    <TableRow>
      {cols.map((h, i) => (
        <TableHead key={h || 'acciones'} className={i ? undefined : 'ps-4'}>
          {h || <span className="sr-only">Acciones</span>}
        </TableHead>
      ))}
    </TableRow>
  </TableHeader>
)

// docs/auditoria-b22.md § 4: por debajo de `sm`, una fila por elemento (nombre y estado; en gris, lo demás) y toda la fila abre la hoja.
export function CardList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-2xl border bg-card sm:hidden">{children}</ul>
}

export function CardRow({
  name,
  active,
  activeLabel,
  inactiveLabel,
  lines,
  onOpen,
}: {
  name: string
  active: boolean
  activeLabel: string
  inactiveLabel: string
  lines: string[]
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full flex-col gap-1 px-4 py-3 text-left outline-none transition-colors focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
      >
        <span className="flex items-center justify-between gap-3">
          <span className={cn('min-w-0 truncate font-medium', !active && 'text-muted-foreground')}>{name}</span>
          {active ? <Tag variant="success">{activeLabel}</Tag> : <Tag variant="secondary">{inactiveLabel}</Tag>}
        </span>
        {lines.map((l) => (
          <span key={l} className="text-sm text-muted-foreground">
            {l}
          </span>
        ))}
      </button>
    </li>
  )
}
