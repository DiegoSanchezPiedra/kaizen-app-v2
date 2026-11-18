import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { monthsBetween, periodRange, validRange, type Period } from '@/lib/professor'
import { useDisciplines } from '@/lib/queries'
import { Filter } from '@/components/filter'
import { InlineError } from '@/components/screen-state'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'this', label: 'Este mes' },
  { value: 'last', label: 'Mes pasado' },
  { value: 'six', label: 'Últimos 6 meses' },
  { value: 'twelve', label: 'Últimos 12 meses' },
  { value: 'custom', label: 'Elegir meses…' },
]
const monthOptions = (cur: string) => Array.from({ length: 36 }, (_, i) => addMonths(cur, -i)).map((m) => ({ value: m, label: formatMonth(m) }))

// Periodo (meses de Madrid, 12 como mucho) y disciplina: los filtros de los informes de sesiones y de alumnos.
// Con `url` van en la URL (?periodo, ?desde, ?hasta, ?disciplina): sobreviven al cambio de pestaña y a recargar; cambiar uno quita ?page.
export function useReportFilters({ url = false }: { url?: boolean } = {}) {
  const cur = madridMonth()
  const [local, setLocal] = useState<Record<string, string>>({})
  const [params, setParams] = useSearchParams()
  const get = (k: string) => (url ? params.get(k) : local[k]) ?? undefined
  const set = (k: string) => (v: string) =>
    url
      ? setParams((p) => {
          const n = new URLSearchParams(p)
          n.set(k, v)
          n.delete('page')
          return n
        }, { replace: true })
      : setLocal((s) => ({ ...s, [k]: v }))
  const months = monthOptions(cur)
  const oneOf = <T extends string>(v: string | undefined, ok: { value: T }[], def: T): T => (ok.some((o) => o.value === v) ? (v as T) : def)
  const period = oneOf(get('periodo'), PERIODS, 'this')
  const cFrom = oneOf(get('desde'), months, addMonths(cur, -2))
  const cTo = oneOf(get('hasta'), months, cur)
  const disciplines = useDisciplines()
  const known = disciplines.data?.some((d) => String(d.id) === get('disciplina'))
  // Una disciplina que ya no existe (URL vieja) vale «todas» en cuanto llega la lista.
  const discipline = get('disciplina') && (known || !disciplines.data) ? get('disciplina')! : 'all'
  const [setPeriod, setCFrom, setCTo, setDiscipline] = ['periodo', 'desde', 'hasta', 'disciplina'].map(set)
  const { from, to } = period === 'custom' ? { from: cFrom, to: cTo } : periodRange(period)
  const ok = validRange(from, to)
  const n = monthsBetween(from, to)
  const filters = (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="Periodo" value={period} onChange={setPeriod} items={PERIODS} />
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={setDiscipline}
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
        {period === 'custom' && (
          <>
            <Filter label="Desde" value={cFrom} onChange={setCFrom} items={months} invalid={!ok} />
            <Filter label="Hasta" value={cTo} onChange={setCTo} items={months} invalid={!ok} />
          </>
        )}
      </div>
      {!ok && <InlineError>{n < 1 ? 'Revisa las fechas: «Hasta» es anterior a «Desde».' : `Revisa las fechas: son ${n} meses y como mucho caben 12.`}</InlineError>}
    </>
  )
  return { ok, base: { from, to, discipline_id: discipline === 'all' ? undefined : discipline }, filters }
}
