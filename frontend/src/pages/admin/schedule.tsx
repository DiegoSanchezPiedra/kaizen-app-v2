import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { ClassesView } from '@/pages/admin/classes'
import { EventsView } from '@/pages/admin/events'
import { WeekView } from '@/pages/admin/sessions'

// Horario: la semana, las clases (que se repiten) y los eventos, en una entrada. La vista vive en `?vista=` (la semana, sin param).
// El botón de la cabecera crea lo propio de cada vista.
const VIEWS = [
  { value: 'semana', label: 'Semana', action: 'Clase suelta' },
  { value: 'clases', label: 'Clases', action: 'Nueva clase' },
  { value: 'eventos', label: 'Eventos', action: 'Nuevo evento' },
] as const
type View = (typeof VIEWS)[number]['value']

export function AdminSchedulePage() {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const view: View = VIEWS.find((v) => v.value === params.get('vista'))?.value ?? 'semana'
  const current = VIEWS.find((v) => v.value === view)!
  // Al cambiar de vista se quedan solo `vista` y, entre semana y clases, la disciplina.
  const go = (to: View) => {
    const n = new URLSearchParams()
    if (to !== 'semana') n.set('vista', to)
    const d = params.get('disciplina')
    if (d && to !== 'eventos') n.set('disciplina', d)
    setCreating(false)
    setParams(n, { replace: true })
  }
  const close = () => setCreating(false)
  return (
    <Page
      title="Horario"
      wide
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <PlusIcon />
          {current.action}
        </Button>
      }
    >
      <Tabs value={view} onValueChange={(v) => go(v as View)}>
        <TabsList className="w-full sm:w-fit" aria-label="Vista del horario">
          {VIEWS.map((v) => (
            <TabsTab key={v.value} value={v.value} className="min-h-11 flex-1 px-4">
              {v.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {view === 'semana' ? <WeekView creating={creating} onClose={close} /> : view === 'clases' ? <ClassesView creating={creating} onClose={close} /> : <EventsView creating={creating} onClose={close} />}
    </Page>
  )
}
