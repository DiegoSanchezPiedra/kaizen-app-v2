import { ChevronLeftIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { useId } from 'react'
import type React from 'react'
import { Link, type LinkProps } from 'react-router'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Radio } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

export function Back({ to, children }: { to: LinkProps['to']; children: React.ReactNode }) {
  return (
    <Link to={to} className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
      <ChevronLeftIcon className="size-4" aria-hidden="true" />
      {children}
    </Link>
  )
}

const ICON = { error: CircleAlertIcon, warning: TriangleAlertIcon, info: InfoIcon, success: CircleCheckIcon }

// Aviso con icono y título (nunca solo color) y, si la hay, su salida.
export function Note({
  kind,
  title,
  children,
  action,
}: {
  kind: keyof typeof ICON
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  const Icon = ICON[kind]
  return (
    <Alert variant={kind} role={kind === 'error' ? 'alert' : 'status'} className="enter-soft">
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  )
}

// Lista de datos (.kv del canvas): etiqueta a la izquierda, valor a la derecha.
export function Kv({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-t py-2.5 first:border-t-0">
          <dt className="flex-none text-sm text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right text-[15px] font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}


// Tarjeta de Radio Group (.plan del canvas): nombre, precio, descripción e insignias.
export function OptionCard({
  value,
  title,
  price,
  priceNote,
  description,
  tags,
  disabled,
}: {
  value: string
  title: string
  price?: string
  priceNote?: string
  description?: string
  tags?: React.ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label
      className={cn(
        'grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs transition-[border-color,background-color] duration-150 ease-out',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring has-data-checked:border-primary has-data-checked:bg-primary/6 has-data-checked:ring-1 has-data-checked:ring-primary',
        disabled && 'cursor-default bg-transparent shadow-none',
      )}
    >
      <Radio value={value} disabled={disabled} className="mt-0.5" aria-labelledby={id} />
      <span id={id} className="text-[17px] leading-snug font-bold">
        {title}
      </span>
      {price ? (
        <span className="text-right font-heading text-[22px] leading-none font-bold whitespace-nowrap tabular-nums">
          {price}
          {priceNote && <small className="mt-1 block font-sans text-xs font-medium text-muted-foreground">{priceNote}</small>}
        </span>
      ) : (
        <span />
      )}
      {description && <span className="col-span-2 col-start-2 text-sm text-muted-foreground">{description}</span>}
      {tags && <span className="col-span-2 col-start-2 mt-1.5 flex flex-wrap gap-1.5">{tags}</span>}
    </label>
  )
}

export const Tag = ({ children, variant = 'outline' }: { children: React.ReactNode; variant?: 'outline' | 'info' | 'warning' | 'success' | 'secondary' | 'error' }) => (
  <Badge variant={variant} size="lg">
    {children}
  </Badge>
)



// Botón principal pegado abajo, sobre la barra de pestañas en móvil, con fondo para no tapar el contenido.
export function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[1] -mx-4 flex flex-col gap-2 border-t bg-background px-4 py-3 lg:bottom-0 lg:mx-0 lg:px-0">
      {children}
    </div>
  )
}

