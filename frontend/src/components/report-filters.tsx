import { useState } from 'react'
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
export function useReportFilters() {
  const cur = madridMonth()
  const [period, setPeriod] = useState<Period>('this')
  const [cFrom, setCFrom] = useState(addMonths(cur, -2))
  const [cTo, setCTo] = useState(cur)
  const [discipline, setDiscipline] = useState('all')
  const disciplines = useDisciplines()
  const { from, to } = period === 'custom' ? { from: cFrom, to: cTo } : periodRange(period)
  const ok = validRange(from, to)
  const n = monthsBetween(from, to)
  const filters = (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="Periodo" value={period} onChange={(v) => setPeriod(v as Period)} items={PERIODS} />
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={setDiscipline}
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
        {period === 'custom' && (
          <>
            <Filter label="Desde" value={cFrom} onChange={setCFrom} items={monthOptions(cur)} invalid={!ok} />
            <Filter label="Hasta" value={cTo} onChange={setCTo} items={monthOptions(cur)} invalid={!ok} />
          </>
        )}
      </div>
      {!ok && <InlineError>{n < 1 ? 'Revisa las fechas: «Hasta» es anterior a «Desde».' : `Revisa las fechas: son ${n} meses y como mucho caben 12.`}</InlineError>}
    </>
  )
  return { ok, base: { from, to, discipline_id: discipline === 'all' ? undefined : discipline }, filters }
}
