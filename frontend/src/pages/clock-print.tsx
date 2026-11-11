import type { UseQueryResult } from '@tanstack/react-query'
import { PrinterIcon } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { QueryView } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { authorName, type ClockEvent, type ClockKind, type ClockMonth, type Correction, formatDuration, monthParam, pausesOf, STATUS_LABEL, whatOf } from '@/lib/clock'
import { formatDay, formatMonth } from '@/lib/dates'
import { formatShortDate, formatTime } from '@/lib/format'
import { useAdminClock, useClock } from '@/lib/queries'

// «Registro de jornada» (B31): la misma hoja para el profesor (/clock/print) y para el admin (/admin/clock/print).
export function ClockPrintPage() {
  const [params] = useSearchParams()
  const month = monthParam(params)
  return <PrintView query={useClock(month)} month={month} />
}

export function AdminClockPrintPage() {
  const [params] = useSearchParams()
  const month = monthParam(params)
  return <PrintView query={useAdminClock(params.get('profile_id') ?? '', month)} month={month} />
}

function PrintView({ query, month }: { query: UseQueryResult<ClockMonth>; month: string }) {
  return (
    <>
      <style>{'@page { size: A4; margin: 15mm; }'}</style>
      <div className="mx-auto mb-4 flex max-w-[190mm] justify-end print:hidden">
        <Button variant="outline" size="lg" onClick={() => window.print()}>
          <PrinterIcon />
          Imprimir
        </Button>
      </div>
      <QueryView query={query}>{(data) => <Sheet data={data} month={month} />}</QueryView>
    </>
  )
}

// Un fichaje corregido lleva «*» (su hora es la de la corrección). En las pausas, la de cualquiera de sus dos extremos.
const stamp = (e: ClockEvent): string => `${formatTime(e.at)}${e.corrected ? '*' : ''}`
const listOf = (events: ClockEvent[], kind: ClockKind): string => events.filter((e) => e.kind === kind).map(stamp).join(', ') || '—'
const when = (iso: string): string => `${formatShortDate(iso)}, ${formatTime(iso)}`

function Sheet({ data, month }: { data: ClockMonth; month: string }) {
  return (
    <article className="mx-auto flex max-w-[190mm] flex-col gap-6 rounded-2xl border bg-card p-5 print:max-w-none print:gap-5 print:rounded-none print:border-0 print:bg-transparent print:p-0 print:text-[10.5pt]">
      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Kaizen</p>
        <h1 className="font-heading text-2xl font-bold">Registro de jornada</h1>
        <p>
          Trabajador: <span className="font-semibold">{data.profile.display_name ?? 'Sin nombre'}</span>
        </p>
        <p>Mes: {formatMonth(month)}</p>
      </header>

      <section aria-label="Días" className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left tabular-nums">
          <thead>
            <tr className="border-b text-xs font-semibold text-muted-foreground">
              <th className="py-1.5 pe-2 font-semibold">Fecha</th>
              <th className="py-1.5 pe-2 font-semibold">Entradas</th>
              <th className="py-1.5 pe-2 font-semibold">Salidas</th>
              <th className="py-1.5 pe-2 font-semibold">Pausas</th>
              <th className="py-1.5 text-end font-semibold">Horas</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((d) => (
              <tr key={d.date} className="border-b align-top">
                <td className="py-1.5 pe-2">
                  {formatDay(d.date)}
                  {d.open && <span className="block text-xs font-semibold">Jornada abierta</span>}
                </td>
                <td className="py-1.5 pe-2">{listOf(d.events, 'in')}</td>
                <td className="py-1.5 pe-2">{listOf(d.events, 'out')}</td>
                <td className="py-1.5 pe-2">
                  {pausesOf(d.events)
                    .map(([from, to]) => `${stamp(from)}–${to ? stamp(to) : ''}`)
                    .join(', ') || '—'}
                </td>
                <td className="py-1.5 text-end font-semibold">{formatDuration(d.worked_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.days.length === 0 && <p className="py-3 text-sm text-muted-foreground">Sin fichajes este mes.</p>}
        <p className="pt-1.5 text-xs text-muted-foreground">* Fichaje corregido</p>
      </section>

      <div className="flex items-baseline justify-between border-y py-2 font-semibold">
        <span>Total del mes</span>
        <span className="tabular-nums">{formatDuration(data.total_seconds)} h</span>
      </div>

      {data.corrections.length > 0 && (
        <section aria-label="Correcciones" className="flex flex-col gap-2">
          <h2 className="font-semibold">Correcciones</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {data.corrections.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0">
                <CorrectionItem c={c} data={data} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Firmas" className="mt-2 grid grid-cols-2 gap-6 print:break-inside-avoid">
        <Signature label="Firma del trabajador" />
        <Signature label="Firma de la empresa" />
      </section>
    </article>
  )
}

function CorrectionItem({ c, data }: { c: Correction; data: ClockMonth }) {
  return (
    <>
      <p className="font-semibold">{whatOf(c, data)}</p>
      <p>
        <span className="font-semibold">Motivo:</span> {c.reason}
      </p>
      <p className="text-muted-foreground">
        Pedida por {authorName(c.requested_by)} el {when(c.created_at)}
      </p>
      <p className="text-muted-foreground">
        {STATUS_LABEL[c.status]}
        {c.resolved_at && ` por ${authorName(c.resolved_by)} el ${when(c.resolved_at)}`}
        {c.resolution_reason && ` · ${c.resolution_reason}`}
      </p>
    </>
  )
}

function Signature({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-20 rounded-lg border border-dashed" />
      <p className="font-semibold">{label}</p>
      <p className="text-muted-foreground">Fecha: ____ / ____ / ________</p>
    </div>
  )
}

