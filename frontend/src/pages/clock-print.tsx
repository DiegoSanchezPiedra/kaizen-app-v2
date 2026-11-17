import type { UseQueryResult } from '@tanstack/react-query'
import { PrinterIcon, TriangleAlertIcon } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Back } from '@/components/billing-bits'
import { QueryView } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { authorName, type ClockDay, type ClockEvent, type ClockKind, type ClockMonth, type Correction, formatDuration, monthParam, originalOf, pausesOf, STATUS_LABEL, whatOf } from '@/lib/clock'
import { dayOfMonth, formatMonth, shortWeekday } from '@/lib/dates'
import { formatShortDate, formatTime } from '@/lib/format'
import { useAdminClock, useClock } from '@/lib/queries'

// «Registro de jornada» (B31): la misma hoja para el profesor (/clock/print) y para el admin (/admin/clock/print).
export function ClockPrintPage() {
  const [params] = useSearchParams()
  const month = monthParam(params)
  return <PrintView query={useClock(month)} month={month} back={{ to: `/clock?month=${month}`, label: 'Mi registro' }} />
}

export function AdminClockPrintPage() {
  const [params] = useSearchParams()
  const month = monthParam(params)
  const id = params.get('profile_id') ?? ''
  // Va fuera del panel, sin menú ni márgenes: los pone aquí.
  return (
    <div className="px-4 py-6 print:p-0">
      <PrintView query={useAdminClock(id, month)} month={month} back={{ to: `/admin/clock?profile_id=${id}&month=${month}`, label: 'Jornada' }} />
    </div>
  )
}

// En la app instalada de iOS window.print() no hace nada. shortcut: solo se avisa; el PDF propio está en wip/fichaje-pdf.
const iosApp = (navigator as Navigator & { standalone?: boolean }).standalone === true

function PrintView({ query, month, back }: { query: UseQueryResult<ClockMonth>; month: string; back: { to: string; label: string } }) {
  const now = useNow()
  return (
    <div className="mx-auto flex max-w-[190mm] flex-col gap-4 print:max-w-none print:gap-0">
      <div className="print:hidden">
        <Back to={back.to}>{back.label}</Back>
      </div>
      <QueryView query={query}>
        {(data) => {
          const draft = draftOf(data)
          return (
            <>
              <style>{pageCss(data, month)}</style>
              <div className="flex flex-col gap-3 print:hidden">
                {draft && (
                  <p className="flex items-start gap-2 rounded-xl bg-warning/8 px-3 py-2.5 text-sm font-semibold dark:bg-warning/16">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                    El mes no está cerrado ({draft}). Si lo imprimes ahora, sale como borrador.
                  </p>
                )}
                {iosApp ? (
                  <p className="text-sm text-muted-foreground">Para imprimir o guardar el PDF, abre esta página en Safari: desde la app instalada no se puede.</p>
                ) : (
                  <Button size="xl" className="sm:h-11 sm:self-end" onClick={() => window.print()}>
                    <PrinterIcon />
                    Imprimir o guardar PDF
                  </Button>
                )}
              </div>
              <Sheet data={data} month={month} draft={draft} now={now} />
            </>
          )
        }}
      </QueryView>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Qué deja el mes sin cerrar, o null si está cerrado.
function draftOf(m: ClockMonth): string | null {
  const open = m.days.filter((d) => d.open).length
  const pending = m.corrections.filter((c) => c.status === 'pending').length
  const parts = [open && plural(open, 'jornada abierta', 'jornadas abiertas'), pending && plural(pending, 'corrección pendiente', 'correcciones pendientes')].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// A4 con pie en cada hoja: de quién es y «Página N de M» (márgenes de página de Chrome ≥ 131; los demás los ignoran).
const pageCss = (m: ClockMonth, month: string) =>
  `@page { size: A4; margin: 15mm 15mm 18mm; @bottom-left { content: ${JSON.stringify(`Kaizen · Registro de jornada · ${m.profile.display_name ?? 'Sin nombre'} · ${formatMonth(month)}`)}; font: 8pt sans-serif; color: #000; } @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt sans-serif; color: #000; } }`

// Un fichaje corregido lleva «*» (su hora es la de la corrección). En las pausas, la de cualquiera de sus dos extremos.
const stamp = (e: ClockEvent): string => `${formatTime(e.at)}${e.corrected ? '*' : ''}`
const listOf = (events: ClockEvent[], kind: ClockKind): string => events.filter((e) => e.kind === kind).map(stamp).join(', ') || '—'
const when = (iso: string): string => `${formatShortDate(iso)}, ${formatTime(iso)}`
const dayLabel = (day: string): string => `${shortWeekday(day).replace(/^./, (c) => c.toUpperCase())} ${dayOfMonth(day)}`

const MONO = 'font-mono tabular-nums'
// Bajo 640 px (solo en pantalla) cada día es un bloque; desde sm y al imprimir, una fila de tabla.
const CELL = 'sm:table-cell sm:border-b sm:py-1.5 sm:pe-3 print:table-cell print:border-b print:py-[3px] print:pe-3'
const LABEL = 'block text-xs text-muted-foreground sm:hidden print:hidden'

function Sheet({ data, month, draft, now }: { data: ClockMonth; month: string; draft: string | null; now: number }) {
  const employee = data.profile.employment === 'employee'
  const corrected = data.days.some((d) => d.events.some((e) => e.corrected))
  return (
    <article className="flex enter-soft flex-col gap-6 rounded-2xl border bg-card p-4 sm:p-8 print:gap-3.5 print:rounded-none print:border-0 print:bg-transparent print:p-0 print:text-[10pt] print:text-foreground print:[--border:#8a8a8a] print:[--foreground:#000] print:[--muted-foreground:#333]">
      <header className="flex flex-col gap-4 border-b border-foreground pb-4 print:pb-2 sm:flex-row sm:items-end sm:justify-between print:flex-row print:items-end print:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Kaizen · CIF: ____________</p>
          <h1 className="font-heading text-2xl font-bold">Registro de jornada</h1>
          <p>
            Trabajador: <span className="font-semibold">{data.profile.display_name ?? 'Sin nombre'}</span>
          </p>
          <p>
            Mes: <span className="font-semibold">{formatMonth(month)}</span>
          </p>
        </div>
        <div className="sm:text-end print:text-end">
          <p className="text-sm text-muted-foreground">Total del mes</p>
          <p className={`${MONO} text-3xl font-semibold`}>{formatDuration(data.total_seconds)} h</p>
        </div>
      </header>

      {draft && (
        <p className="border-2 border-dashed border-foreground px-3 py-2 font-semibold">
          Borrador: mes sin cerrar a {when(new Date(now).toISOString())} ({draft}).
        </p>
      )}
      {!employee && <p className="text-muted-foreground">Profesor autónomo: registro informativo, sin firma.</p>}

      <section aria-label="Días">
        {data.days.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">Sin fichajes este mes.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="hidden sm:table-header-group print:table-header-group">
              <tr className="border-b border-foreground text-xs text-muted-foreground">
                <th className="py-1.5 pe-3 font-semibold">Día</th>
                <th className="py-1.5 pe-3 font-semibold">Entrada</th>
                <th className="py-1.5 pe-3 font-semibold">Pausas</th>
                <th className="py-1.5 pe-3 font-semibold">Salida</th>
                <th className="py-1.5 text-end font-semibold">Horas</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <DayRow key={d.date} d={d} />
              ))}
            </tbody>
          </table>
        )}
        {corrected && <p className="pt-2 text-xs text-muted-foreground">* Hora corregida: ver «Correcciones».</p>}
      </section>

      {data.corrections.length > 0 && (
        <section aria-labelledby="corrections" className="flex flex-col gap-1">
          <h2 id="corrections" className="font-semibold">
            Correcciones
          </h2>
          <ul className="flex flex-col text-sm print:text-[9.5pt]">
            {data.corrections.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 border-b py-2 break-inside-avoid last:border-b-0">
                <CorrectionItem c={c} data={data} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Total y firmas" className="flex flex-col gap-6 break-inside-avoid print:gap-2">
        <div className="flex items-baseline justify-between border-y border-foreground py-2 font-semibold">
          <span>Total del mes</span>
          <span className={MONO}>{formatDuration(data.total_seconds)} h</span>
        </div>
        {employee && (
          <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
            <Signature label="Firma del trabajador" />
            <Signature label="Firma de la empresa" />
          </div>
        )}
      </section>
    </article>
  )
}

function DayRow({ d }: { d: ClockDay }) {
  const pauses = pausesOf(d.events).map(([from, to]) => `${stamp(from)}–${to ? stamp(to) : '…'}`)
  // role explícito: con display: grid en el móvil, Chrome deja de exponer la fila y las celdas.
  return (
    <tr role="row" className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 border-b py-2.5 break-inside-avoid sm:table-row sm:border-0 sm:py-0 print:table-row print:border-0 print:py-0">
      <td role="cell" className={`col-span-2 font-semibold sm:font-normal ${CELL}`}>
        {dayLabel(d.date)}
        {d.open && <span className="block text-xs font-semibold">Jornada abierta</span>}
      </td>
      <td role="cell" className={`row-start-2 ${MONO} ${CELL}`}>
        <span className={LABEL}>Entrada</span>
        {listOf(d.events, 'in')}
      </td>
      <td role="cell" className={`row-start-2 ${MONO} ${CELL}`}>
        <span className={LABEL}>Pausas</span>
        {pauses.join(', ') || '—'}
      </td>
      <td role="cell" className={`row-start-2 ${MONO} ${CELL}`}>
        <span className={LABEL}>Salida</span>
        {listOf(d.events, 'out')}
      </td>
      <td role="cell" className={`col-start-3 row-start-1 text-end font-semibold ${MONO} ${CELL} sm:pe-0 print:pe-0`}>
        {formatDuration(d.worked_seconds)}
      </td>
    </tr>
  )
}

function CorrectionItem({ c, data }: { c: Correction; data: ClockMonth }) {
  const at = c.at ?? originalOf(data, c.event_id)?.at
  return (
    <>
      <p>
        <span className="me-2 rounded border border-foreground px-1.5 text-xs font-semibold">{STATUS_LABEL[c.status]}</span>
        <span className="font-semibold">
          {at && `${formatShortDate(at)} · `}
          {whatOf(c, data)}
        </span>
      </p>
      <p>
        <span className="font-semibold">Motivo:</span> {c.reason}
      </p>
      <p className="text-muted-foreground">
        Pedida por {authorName(c.requested_by)} el {when(c.created_at)}
        {c.resolved_at && ` · ${STATUS_LABEL[c.status]} por ${authorName(c.resolved_by)} el ${when(c.resolved_at)}`}
      </p>
      {c.resolution_reason && (
        <p>
          <span className="font-semibold">Motivo del rechazo:</span> {c.resolution_reason}
        </p>
      )}
    </>
  )
}

function Signature({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="h-[25mm] border-b border-foreground print:h-[18mm]" />
      <p className="font-semibold">{label}</p>
      <p className="whitespace-nowrap text-muted-foreground">Fecha: ___/___/______</p>
    </div>
  )
}
