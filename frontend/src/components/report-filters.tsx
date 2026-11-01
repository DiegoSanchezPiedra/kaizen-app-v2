import { useState } from 'react'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { periodRange, validRange, type Period } from '@/lib/professor'
import { useDisciplines } from '@/lib/queries'
import { Filter } from '@/pages/community'

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
  const filters = (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <Filter label="Periodo" value={period} onChange={(v) => setPeriod(v as Period)} items={PERIODS} />
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={setDiscipline}
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
        {period === 'custom' && (
          <>
            <Filter label="Desde" value={cFrom} onChange={setCFrom} items={monthOptions(cur)} />
            <Filter label="Hasta" value={cTo} onChange={setCTo} items={monthOptions(cur)} />
          </>
        )}
      </div>
      {!ok && <p role="alert" className="rounded-xl border bg-card p-3.5 text-sm font-semibold">Revisa las fechas: «Hasta» no puede ser anterior a «Desde» y como mucho son 12 meses.</p>}
    </>
  )
  return { ok, base: { from, to, discipline_id: discipline === 'all' ? undefined : discipline }, filters }
}

