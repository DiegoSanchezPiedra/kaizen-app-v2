import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router'
import { QueryView } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { actionsFor, sinceOf, stateLine, type ClockKind, type ClockState } from '@/lib/clock'
import { madridMonth } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { useClock } from '@/lib/queries'

const DONE: Record<ClockKind, string> = { in: 'Entrada', out: 'Salida', pause_start: 'Pausa', pause_end: 'Vuelta de la pausa' }

// Inicio del profesor empleado: el estado de su jornada y lo que permite la secuencia. Al autónomo no le sale nada.
export function ClockCard() {
  const query = useClock(madridMonth())
  const fichar = useMutation({
    mutationFn: (kind: ClockKind) => api<{ event: { at: string }; state: ClockState }>('/me/clock', { method: 'POST', body: { kind } }),
    onSuccess: (r, kind) => toastOk(`${DONE[kind]} a las ${formatTime(r.event.at)}`),
    onError: (err) => toastError(err),
    // También si falla: invalid_sequence quiere decir que el estado ya era otro.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['clock'] }),
  })
  return (
    // Sin esqueleto: el autónomo no tiene tarjeta y no debe verla parpadear.
    <QueryView query={query} skeleton={null}>
      {(m) =>
        m.profile.employment === 'employee' && (
          <section aria-label="Jornada" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Jornada</h2>
              <Link to="/clock" className="inline-flex min-h-11 items-center text-sm font-semibold text-link">
                Mi registro
              </Link>
            </div>
            <p className="-mt-2 font-heading text-2xl font-bold" aria-live="polite">
              {stateLine(m.state, sinceOf(m))}
            </p>
            <div className="flex gap-2">
              {actionsFor(m.state).map((a) => (
                <Button
                  key={a.kind}
                  size="xl"
                  variant={a.kind === 'out' ? 'outline' : 'default'}
                  className="flex-1"
                  loading={fichar.isPending && fichar.variables === a.kind}
                  disabled={fichar.isPending}
                  onClick={() => fichar.mutate(a.kind)}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </section>
        )
      }
    </QueryView>
  )
}
