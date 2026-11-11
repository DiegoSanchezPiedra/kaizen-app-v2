import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type React from 'react'
import { Page } from '@/components/page'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { centsToEuros, changed, checkinBody, eurosToCents, minutesOf, pauseBody, perPeriodBody, type Settings } from '@/lib/catalog'
import { queryClient } from '@/lib/logout'
import { toastOk } from '@/lib/notify'
import { TextField, useFieldError } from '@/pages/admin/schedule-bits'

const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] })
const text = (n: number | null) => (n === null ? '' : String(n))

// docs/pantallas-b19.md § Ajustes: tres grupos, cada uno con su «Guardar».
export function AdminSettingsPage() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<Settings>('/admin/settings') })
  return (
    <Page title="Ajustes" wide>
      {q.isPending ? (
        <ListSkeleton rows={3} className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Checkin saved={q.data.checkin} />
          <DisciplineChanges saved={q.data.discipline_changes} />
          <PauseSettingsGroup saved={q.data.pause} />
        </div>
      )}
    </Page>
  )
}

function Group({ title, description, onSave, disabled, loading, children }: { title: string; description: string; onSave: () => void; disabled: boolean; loading: boolean; children: React.ReactNode }) {
  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled && !loading) onSave()
      }}
    >
      <div>
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      <Button type="submit" size="xl" className="self-start" disabled={disabled} loading={loading}>
        Guardar
      </Button>
    </form>
  )
}

// Un grupo se guarda con su PUT; lo que no ha cambiado no se manda ni se puede guardar.
function useSave(url: string, body: object | null, saved: object, fe: ReturnType<typeof useFieldError>) {
  const m = useMutation({
    mutationFn: () => {
      fe.clear()
      return api(url, { method: 'PUT', body })
    },
    onSuccess: () => toastOk('Ajustes guardados'),
    onError: fe.fail,
    onSettled: () => void refresh(),
  })
  return { m, disabled: !body || !changed(saved, body) }
}

function Checkin({ saved }: { saved: Settings['checkin'] }) {
  const [d, setD] = useState({ opens_minutes: text(saved.opens_minutes), closes_minutes: text(saved.closes_minutes), qr_seconds: text(saved.qr_seconds) })
  const fe = useFieldError()
  const body = checkinBody(d)
  const { m, disabled } = useSave('/admin/settings/checkin', body, saved, fe)
  const field = (k: keyof typeof d, label: string, hint: string) => (
    <TextField label={label} value={d[k]} onChange={(v) => setD((x) => ({ ...x, [k]: v }))} inputMode="numeric" hint={hint} error={fe.error(k) ?? (d[k] && minutesOf(d[k]) === null ? 'Escribe un número entero entre 1 y 1440.' : undefined)} />
  )
  return (
    <Group title="Check-in" description="Cuándo se abre la lista de una sesión y cada cuánto cambia el QR de la tablet." onSave={() => m.mutate()} disabled={disabled} loading={m.isPending}>
      {field('opens_minutes', 'Abre (minutos antes)', 'Entre 1 y 1440.')}
      {field('closes_minutes', 'Cierra (minutos después)', 'Entre 1 y 1440.')}
      {field('qr_seconds', 'El QR cambia cada (segundos)', 'Entre 1 y 1440.')}
    </Group>
  )
}

function DisciplineChanges({ saved }: { saved: Settings['discipline_changes'] }) {
  const [v, setV] = useState(String(saved.per_period))
  const fe = useFieldError()
  const { m, disabled } = useSave('/admin/settings/discipline-changes', perPeriodBody(v), saved, fe)
  return (
    <Group title="Cambios de disciplina" description="Cuántas veces por periodo de cuota puede cambiar el alumno una disciplina de su plan." onSave={() => m.mutate()} disabled={disabled} loading={m.isPending}>
      <TextField label="Cambios por periodo" value={v} onChange={setV} inputMode="numeric" hint="0 o más. Con 0 no hay cambios, salvo los gratis (cuando ya no se cubría la disciplina)." error={fe.error('per_period') ?? (v && perPeriodBody(v) === null ? 'Escribe un número entero, 0 o más.' : undefined)} />
    </Group>
  )
}

// Pausa (B30): sin precio la academia no ofrece pausas, y la API no deja quitarlo una vez puesto (solo cambiarlo).
function PauseSettingsGroup({ saved }: { saved: Settings['pause'] }) {
  const [d, setD] = useState({ price: saved.price_cents === null ? '' : centsToEuros(saved.price_cents), max_months: String(saved.max_months), per_year: String(saved.per_year) })
  const fe = useFieldError()
  const body = pauseBody(d)
  const { m, disabled } = useSave('/admin/settings/pause', body, saved, fe)
  const set = (k: keyof typeof d) => (v: string) => setD((x) => ({ ...x, [k]: v }))
  const priceBad = d.price.trim() !== '' && !eurosToCents(d.price)
  return (
    <Group
      title="Pausa"
      description="La cuota de mantenimiento es lo que se cobra cada mes de pausa en vez del plan. Sin precio, la academia no ofrece pausas."
      onSave={() => m.mutate()}
      disabled={disabled}
      loading={m.isPending}
    >
      <TextField
        label="Cuota de mantenimiento al mes (€)"
        value={d.price}
        onChange={set('price')}
        inputMode="decimal"
        hint={saved.price_cents === null ? 'Sin precio no hay pausas. Más de 0 €, impuestos incluidos.' : 'Más de 0 €, impuestos incluidos. Un precio nuevo no cambia las pausas ya pedidas.'}
        error={fe.error('price_cents') ?? (priceBad ? 'Escribe un importe mayor que 0, como 15 o 12,50.' : undefined)}
      />
      <TextField label="Máximo de meses por pausa" value={d.max_months} onChange={set('max_months')} inputMode="numeric" hint="Entre 1 y 12." error={fe.error('max_months') ?? (pauseBody({ price: '', max_months: d.max_months, per_year: '0' }) === null ? 'Escribe un número entero entre 1 y 12.' : undefined)} />
      <TextField label="Máximo de pausas por año" value={d.per_year} onChange={set('per_year')} inputMode="numeric" hint="Entre 0 y 12, por año natural. Con 0 nadie puede pausar." error={fe.error('per_year') ?? (pauseBody({ price: '', max_months: '1', per_year: d.per_year }) === null ? 'Escribe un número entero entre 0 y 12.' : undefined)} />
    </Group>
  )
}
