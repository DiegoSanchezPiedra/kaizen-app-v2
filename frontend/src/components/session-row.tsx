import type React from 'react'
import { Link } from 'react-router'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// Marco de un día: filas separadas por borde (docs/auditoria-b22.md § 4, «Fila de sesión»).
export function SessionRows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</ul>
}

const accents = { success: 'shadow-[inset_3px_0_0_var(--success)]', warning: 'shadow-[inset_3px_0_0_var(--warning)]', primary: 'shadow-[inset_3px_0_0_var(--primary)]' }

// Hora en columna fija, nombre en negrita, una línea gris y a la derecha el estado o la acción del rol.
// Si la derecha no cabe pasa debajo; en las 7 columnas de `lg` todo se apila.
export function SessionRow({
  start,
  end,
  title,
  meta,
  below,
  aside,
  to,
  off,
  accent,
}: {
  start: string
  end: string
  title: string
  meta?: string
  below?: React.ReactNode
  aside?: React.ReactNode
  to?: string
  off?: boolean
  accent?: keyof typeof accents
}) {
  const cls = cn(
    'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 lg:flex-col lg:items-stretch lg:gap-y-1 lg:px-2 lg:[&_[data-slot=badge]]:text-xs',
    accent && accents[accent],
    to && 'outline-none hover:bg-accent/40 active:bg-accent/60 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
  )
  const body = (
    <>
      <div className="w-13 shrink-0 font-mono text-[15px] leading-tight tabular-nums lg:w-auto">
        <div className="font-semibold">{formatTime(start)}</div>
        <div className="text-xs text-muted-foreground">{formatTime(end)}</div>
      </div>
      <div className="min-w-0 flex-1 basis-28 lg:basis-auto">
        <h4 className={cn('text-base break-words leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{title}</h4>
        {meta && <p className="text-[13px] leading-snug text-muted-foreground">{meta}</p>}
        {below && <div className="mt-1.5 flex flex-wrap gap-1.5">{below}</div>}
      </div>
      {aside && <div className="ml-auto flex shrink-0 flex-col items-end gap-1 lg:ml-0 lg:items-start">{aside}</div>}
    </>
  )
  return <li>{to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>
}
