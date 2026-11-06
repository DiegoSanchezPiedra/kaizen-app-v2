import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { useWeek } from '@/hooks/use-week'
import { ClassesView, CreateClass } from '@/pages/admin/classes'
import { EventSheet } from '@/pages/admin/events'
import { LooseSession, WeekView } from '@/pages/admin/sessions'
import { cn } from '@/lib/utils'

// Horario: siempre el calendario semanal, con las clases, las sueltas y los eventos, y tres botones para crear cada cosa.
// `?vista=clases` abre la lista de clases (cambiar y retirar), que no cabe en el calendario.
type Kind = 'clase' | 'suelta' | 'evento'
const CREATE: { kind: Kind; label: string }[] = [
  { kind: 'clase', label: 'Clase' },
  { kind: 'suelta', label: 'Clase suelta' },
  { kind: 'evento', label: 'Evento' },
]

// Mismo peso los tres: ninguno es «el» principal.
function CreateButtons({ onPick, className }: { onPick: (k: Kind) => void; className?: string }) {
  return (
    <div className={cn('gap-2', className)}>
      {CREATE.map((c) => (
        <Button key={c.kind} variant="outline" size="xl" className="px-2 active:not-disabled:scale-[0.96] sm:px-3" onClick={() => onPick(c.kind)}>
          <PlusIcon />
          {c.label}
        </Button>
      ))}
    </div>
  )
}

// Lunes = 1 … domingo = 7, del día AAAA-MM-DD.
const weekdayOf = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1

export function AdminSchedulePage() {
  const [params] = useSearchParams()
  const w = useWeek()
  const [creating, setCreating] = useState<Kind | null>(null)
  const classes = params.get('vista') === 'clases'
  const close = () => setCreating(null)
  return (
    <Page
      title="Horario"
      wide
      actions={
        classes ? (
          <Button size="lg" className="active:not-disabled:scale-[0.96]" onClick={() => setCreating('clase')}>
            <PlusIcon />
            Nueva clase
          </Button>
        ) : (
          <CreateButtons className="hidden sm:flex" onPick={setCreating} />
        )
      }
    >
      {classes ? (
        <>
          <Link to="/admin/sessions" className="font-semibold text-link underline underline-offset-3">
            Volver al horario
          </Link>
          <ClassesView />
        </>
      ) : (
        <>
          <CreateButtons className="grid grid-cols-3 sm:hidden" onPick={setCreating} />
          <WeekView w={w} />
        </>
      )}
      <CreateClass open={creating === 'clase'} onClose={close} defaultWeekday={weekdayOf(w.day)} />
      <LooseSession open={creating === 'suelta'} onClose={close} defaultDay={w.day} onCreated={w.pick} />
      <EventSheet open={creating === 'evento'} onClose={close} defaultDay={w.day} onCreated={w.pick} />
    </Page>
  )
}
