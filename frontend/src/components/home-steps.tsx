import { ChevronRightIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { StepRow } from '@/hooks/use-step-rows'
import { useSubject } from '@/hooks/use-subject'
import { cn } from '@/lib/utils'

const ICON = { warning: TriangleAlertIcon, error: CircleAlertIcon, info: InfoIcon }
// El color vive solo en el icono; el texto y la fila no cambian con la gravedad.
const TONE = { warning: 'text-warning-foreground', error: 'text-destructive-foreground', info: 'text-info-foreground' }
// Plegado de salida: la altura baja de 1fr a 0fr y se funde, 200 ms ease-out (solo transform/opacity no valen para la altura).
const FOLD = 'grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out) data-leaving:grid-rows-[0fr] data-leaving:opacity-0'

// Los avisos de Inicio en una sola tarjeta: una fila pulsable por aviso, en el orden de `homeNotices`.
export function HomeSteps({ rows }: { rows: StepRow[] }) {
  const { withSubject } = useSubject()
  const live = rows.filter((r) => !r.leaving).length
  const n = live || rows.length
  const gone = live === 0
  return (
    <div data-leaving={gone ? '' : undefined} className={FOLD}>
      <div className={cn('min-h-0', gone && 'overflow-hidden')}>
        <section aria-labelledby="pending" className="overflow-hidden rounded-2xl border bg-card shadow-xs/5">
          <h2 id="pending" className="px-4 pt-3.5 pb-1 text-base font-semibold">
            {n === 1 ? 'Tienes 1 cosa pendiente' : `Tienes ${n} cosas pendientes`}
          </h2>
          <ul className="divide-y">
            {rows.map(({ n: it, leaving }) => {
              const Icon = ICON[it.kind]
              return (
                <li key={it.id} data-leaving={leaving ? '' : undefined} inert={leaving} className={FOLD}>
                  <div className="min-h-0 overflow-hidden">
                    <Link
                      to={withSubject(it.to)}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-150 ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none active:bg-accent hover:bg-accent/60"
                    >
                      <Icon aria-hidden="true" className={`size-5 shrink-0 ${TONE[it.kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{it.title}</span>
                        <span className="block text-sm text-muted-foreground">{it.text}</span>
                      </span>
                      <span className="sr-only">{it.cta}</span>
                      <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
