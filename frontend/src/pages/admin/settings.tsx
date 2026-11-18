import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { useBlocker } from 'react-router'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { centsToEuros, changed, checkinBody, eurosToCents, minutesOf, pauseBody, perPeriodBody, rankingTopBody, type Settings } from '@/lib/catalog'
import { formatEuros } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastOk } from '@/lib/notify'
import { TextField, useFieldError } from '@/pages/admin/schedule-bits'

const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] })
const text = (n: number | null) => (n === null ? '' : String(n))
// Lo escrito difiere de lo guardado (aunque no sea válido): eso es «cambios sin guardar».
const differs = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).some((k) => a[k] !== b[k])
type OnDirty = (group: string, dirty: boolean) => void

// docs/pantallas-b19.md § Ajustes y docs/pantallas-b22.md § Tablets y Ajustes: un grupo por PUT, cada uno con su «Guardar».
export function AdminSettingsPage() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<Settings>('/admin/settings') })
  const [dirty, setDirty] = useState<string[]>([])
  const onDirty = useCallback<OnDirty>((g, on) => setDirty((d) => (on === d.includes(g) ? d : on ? [...d, g] : d.filter((x) => x !== g))), [])
  const pending = dirty.length > 0
  // Salir con cambios: diálogo propio dentro de la app; al recargar o cerrar, el aviso del navegador.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => pending && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!pending) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])
  const props = { onDirty }
  return (
    <Page title="Ajustes" wide>
      {q.isPending ? (
        <ListSkeleton rows={3} className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <Checkin saved={q.data.checkin} {...props} />
          <PauseSettingsGroup saved={q.data.pause} {...props} />
          <DisciplineChanges saved={q.data.discipline_changes} {...props} />
          <Rankings saved={q.data.rankings} {...props} />
        </div>
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="¿Salir sin guardar?"
        description={`Se pierden los cambios de ${dirty.join(' y ')}.`}
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir aquí"
        onConfirm={() => blocker.proceed?.()}
      />
    </Page>
  )
}

type Ask = { title: string; text: string } | null
function Group({
  title,
  description,
  dirty,
  invalid,
  confirm,
  onSave,
  onDiscard,
  disabled,
  loading,
  children,
}: {
  title: string
  description: string
  dirty: boolean
  invalid: boolean
  confirm?: Ask
  onSave: () => Promise<unknown>
  onDiscard: () => void
  disabled: boolean
  loading: boolean
  children: React.ReactNode
}) {
  const [asking, setAsking] = useState<Ask>(null)
  const save = () => void onSave().catch(() => undefined).finally(() => setAsking(null))
  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (disabled || loading) return
        if (confirm) setAsking(confirm)
        else save()
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="font-heading text-lg font-bold">{title}</h2>
          {dirty && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
              Cambios sin guardar
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="lg" className="h-11 sm:h-11" disabled={disabled} loading={loading}>
            Guardar
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" size="lg" className="h-11 sm:h-11" disabled={loading} onClick={onDiscard}>
              Descartar
            </Button>
          )}
        </div>
        {dirty && invalid && <p className="text-sm text-muted-foreground">Corrige el campo en rojo para guardar.</p>}
      </div>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => !o && !loading && setAsking(null)}
        title={asking?.title ?? ''}
        description={asking?.text ?? ''}
        confirmLabel="Guardar"
        variant="default"
        loading={loading}
        onConfirm={save}
      />
    </form>
  )
}

// Un grupo se guarda con su PUT; lo que no ha cambiado no se manda ni se puede guardar.
function useGroup<D extends Record<string, string>>(title: string, url: string, init: D, toBody: (d: D) => object | null, saved: object, onDirty: OnDirty) {
  const [d, setD] = useState(init)
  const fe = useFieldError()
  const body = toBody(d)
  const m = useMutation({
    mutationFn: () => {
      fe.clear()
      return api(url, { method: 'PUT', body })
    },
    onSuccess: () => toastOk('Ajustes guardados', title),
    onError: fe.fail,
    onSettled: () => void refresh(),
  })
  // Tras guardar, `saved` llega nuevo y lo escrito vuelve a coincidir.
  const dirty = differs(d, init)
  useEffect(() => onDirty(title, dirty), [onDirty, title, dirty])
  const set = (k: keyof D) => (v: string) => setD((x) => ({ ...x, [k]: v }))
  return {
    d,
    set,
    fe,
    body,
    group: {
      title,
      dirty,
      invalid: !body,
      onSave: () => m.mutateAsync(),
      onDiscard: () => {
        fe.clear()
        setD(init)
      },
      disabled: !body || !changed(saved, body),
      loading: m.isPending,
    },
  }
}

// Mensaje del campo: el mismo para lo que se ve mal al escribir y para el `invalid_field` de la API.
const fieldError = (fe: ReturnType<typeof useFieldError>, k: string, bad: boolean, msg: string) => (fe.error(k) || bad ? msg : undefined)

function Checkin({ saved, onDirty }: { saved: Settings['checkin']; onDirty: OnDirty }) {
  const init = { opens_minutes: text(saved.opens_minutes), closes_minutes: text(saved.closes_minutes), qr_seconds: text(saved.qr_seconds) }
  const { d, set, fe, group } = useGroup('Check-in', '/admin/settings/checkin', init, checkinBody, saved, onDirty)
  const field = (k: keyof typeof d, label: string) => (
    <TextField label={label} value={d[k]} onChange={set(k)} inputMode="numeric" hint="Entre 1 y 1440." error={fieldError(fe, k, d[k] !== '' && minutesOf(d[k]) === null, 'Escribe un número entero entre 1 y 1440.')} />
  )
  return (
    <Group
      {...group}
      description="Cuándo se abre la lista de una sesión y cada cuánto cambia el QR de la tablet."
      confirm={{ title: '¿Guardar el check-in?', text: 'Cambia al momento cuándo se abren y cierran las listas de todas las sesiones y cada cuánto cambia el QR de las tablets.' }}
    >
      {field('opens_minutes', 'Abre (minutos antes)')}
      {field('closes_minutes', 'Cierra (minutos después)')}
      {field('qr_seconds', 'El QR cambia cada (segundos)')}
    </Group>
  )
}

function DisciplineChanges({ saved, onDirty }: { saved: Settings['discipline_changes']; onDirty: OnDirty }) {
  const { d, set, fe, group } = useGroup('Cambios de disciplina', '/admin/settings/discipline-changes', { per_period: String(saved.per_period) }, (x) => perPeriodBody(x.per_period), saved, onDirty)
  return (
    <Group {...group} description="Cuántas veces por periodo de cuota puede cambiar el alumno una disciplina de su plan.">
      <TextField
        label="Cambios por periodo"
        value={d.per_period}
        onChange={set('per_period')}
        inputMode="numeric"
        hint="0 o más. Con 0 no hay cambios, salvo los gratis (cuando ya no se cubría la disciplina)."
        error={fieldError(fe, 'per_period', d.per_period !== '' && perPeriodBody(d.per_period) === null, 'Escribe un número entero, 0 o más.')}
      />
    </Group>
  )
}

function Rankings({ saved, onDirty }: { saved: Settings['rankings']; onDirty: OnDirty }) {
  const { d, set, fe, group } = useGroup('Rankings', '/admin/settings/rankings', { top: String(saved.top) }, (x) => rankingTopBody(x.top), saved, onDirty)
  return (
    <Group {...group} description="Cuántos puestos se ven en los rankings de medallas y de horas del mes.">
      <TextField label="Puestos (top)" value={d.top} onChange={set('top')} inputMode="numeric" hint="Entre 1 y 100. Vale para los dos rankings." error={fieldError(fe, 'top', d.top !== '' && rankingTopBody(d.top) === null, 'Escribe un número entero entre 1 y 100.')} />
    </Group>
  )
}

// Pausa (B30): sin precio la academia no ofrece pausas, y la API no deja quitarlo una vez puesto (solo cambiarlo).
function PauseSettingsGroup({ saved, onDirty }: { saved: Settings['pause']; onDirty: OnDirty }) {
  const init = { price: saved.price_cents === null ? '' : centsToEuros(saved.price_cents), max_months: String(saved.max_months), per_year: String(saved.per_year) }
  const hasPrice = saved.price_cents !== null
  // Vaciar un precio que ya existe no lo quita (no se manda): mejor decirlo en el campo que guardar como si nada.
  const toBody = (x: typeof init) => (hasPrice && !x.price.trim() ? null : pauseBody(x))
  const { d, set, fe, body, group } = useGroup('Pausa', '/admin/settings/pause', init, toBody, saved, onDirty)
  const price = d.price.trim()
  const priceError = hasPrice && !price ? 'El precio no se puede quitar. Para que nadie pause, pon 0 pausas al año.' : price && !eurosToCents(price) ? 'Escribe un importe mayor que 0, como 15 o 12,50.' : undefined
  const b = body as { price_cents?: number; per_year: number } | null
  const notes = b
    ? [
        !hasPrice && b.price_cents && `Los alumnos podrán pedir pausas por ${formatEuros(b.price_cents)} al mes. Podrás cambiar el precio, pero no quitarlo.`,
        hasPrice && b.price_cents && b.price_cents !== saved.price_cents && 'Las pausas ya pedidas siguen con su precio.',
        b.per_year === 0 && saved.per_year !== 0 && 'Nadie podrá pedir pausas nuevas.',
      ].filter(Boolean)
    : []
  return (
    <Group
      {...group}
      description="La cuota de mantenimiento es lo que se cobra cada mes de pausa en vez del plan. Sin precio, la academia no ofrece pausas."
      confirm={notes.length ? { title: '¿Guardar la pausa?', text: notes.join(' ') } : null}
    >
      <TextField
        label="Cuota de mantenimiento al mes (€)"
        value={d.price}
        onChange={set('price')}
        inputMode="decimal"
        hint={hasPrice ? 'Más de 0 €, impuestos incluidos. Un precio nuevo no cambia las pausas ya pedidas.' : 'Sin precio no hay pausas. Más de 0 €, impuestos incluidos. Una vez puesto, se cambia pero no se quita.'}
        error={fe.error('price_cents') ? 'Escribe un importe mayor que 0, como 15 o 12,50.' : priceError}
      />
      <TextField
        label="Máximo de meses por pausa"
        value={d.max_months}
        onChange={set('max_months')}
        inputMode="numeric"
        hint="Entre 1 y 12."
        error={fieldError(fe, 'max_months', d.max_months !== '' && pauseBody({ price: '', max_months: d.max_months, per_year: '0' }) === null, 'Escribe un número entero entre 1 y 12.')}
      />
      <TextField
        label="Máximo de pausas por año"
        value={d.per_year}
        onChange={set('per_year')}
        inputMode="numeric"
        hint="Entre 0 y 12, por año natural. Con 0 nadie puede pausar."
        error={fieldError(fe, 'per_year', d.per_year !== '' && pauseBody({ price: '', max_months: '1', per_year: d.per_year }) === null, 'Escribe un número entero entre 0 y 12.')}
      />
    </Group>
  )
}
