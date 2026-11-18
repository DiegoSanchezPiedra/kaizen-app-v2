import { CalendarDaysIcon, CalendarPlusIcon, PlusIcon, RepeatIcon, TicketIcon, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useWeek } from '@/hooks/use-week'
import { ClassesView, CreateClass } from '@/pages/admin/classes'
import { EventSheet } from '@/pages/admin/events'
import { LooseSession, WeekView } from '@/pages/admin/sessions'

// Horario: la semana (clases, sueltas y eventos) o la lista de clases semanales (`?vista=clases`: cambiar y retirar).
// Un solo «Nuevo» con las tres cosas que se crean, cada una con lo que la distingue (rediseño 7, 2026-11-18).
type Kind = 'clase' | 'suelta' | 'evento'
const CREATE: { kind: Kind; label: string; hint: string; Icon: LucideIcon }[] = [
  { kind: 'clase', label: 'Clase semanal', hint: 'Se repite cada semana', Icon: RepeatIcon },
  { kind: 'suelta', label: 'Clase suelta', hint: 'Un día concreto, sin repetir', Icon: CalendarPlusIcon },
  { kind: 'evento', label: 'Evento', hint: 'Con inscripción, gratis o de pago', Icon: TicketIcon },
]

function CreateMenu({ onPick }: { onPick: (k: Kind) => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="lg" className="transition-[scale,box-shadow] motion-safe:active:not-disabled:scale-[0.96] motion-reduce:active:not-disabled:scale-100" />}
      >
        <PlusIcon />
        Nuevo
      </MenuTrigger>
      {/* Sale del botón (origin en --transform-origin): fundido y escala corta; con movimiento reducido, solo el fundido. */}
      <MenuPopup
        align="end"
        className="min-w-64 transition-[opacity,scale] duration-150 ease-(--ease-out) data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:data-ending-style:scale-[0.97] motion-safe:data-starting-style:scale-[0.96]"
      >
        {CREATE.map(({ kind, label, hint, Icon }) => (
          <MenuItem key={kind} className="min-h-14 gap-3 py-2" onClick={() => onPick(kind)}>
            <Icon aria-hidden="true" className="text-muted-foreground" />
            <span className="flex flex-col">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

// Lunes = 1 … domingo = 7, del día AAAA-MM-DD.
const weekdayOf = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1

export function AdminSchedulePage() {
  const [params, setParams] = useSearchParams()
  const w = useWeek()
  const [creating, setCreating] = useState<Kind | null>(null)
  const view = params.get('vista') === 'clases' ? 'clases' : 'semana'
  const close = () => setCreating(null)
  // Cambiar de vista conserva la disciplina (y la semana, al volver).
  const setView = (v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (v === 'clases') n.set('vista', 'clases')
      else n.delete('vista')
      return n
    })
  return (
    <Page title="Horario" wide actions={<CreateMenu onPick={setCreating} />}>
      <Tabs value={view} onValueChange={(v) => setView(String(v))} className="gap-5">
        <TabsList className="w-full sm:w-auto sm:self-start">
          <TabsTab value="semana" className="min-h-11 flex-1 px-2 sm:px-4">
            <CalendarDaysIcon aria-hidden="true" />
            Semana
          </TabsTab>
          <TabsTab value="clases" className="min-h-11 flex-1 px-2 sm:px-4">
            <RepeatIcon aria-hidden="true" />
            Clases semanales
          </TabsTab>
        </TabsList>
        <TabsPanel value="semana" className="flex flex-col gap-5">
          <WeekView w={w} />
        </TabsPanel>
        <TabsPanel value="clases" className="flex flex-col gap-5">
          <ClassesView onCreate={() => setCreating('clase')} />
        </TabsPanel>
      </Tabs>
      <CreateClass open={creating === 'clase'} onClose={close} defaultWeekday={weekdayOf(w.day)} />
      <LooseSession open={creating === 'suelta'} onClose={close} defaultDay={w.day} onCreated={w.pick} />
      <EventSheet open={creating === 'evento'} onClose={close} defaultDay={w.day} onCreated={w.pick} />
    </Page>
  )
}
