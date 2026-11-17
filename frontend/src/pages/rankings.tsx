import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, TrophyIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Filter } from '@/components/filter'
import { Page } from '@/components/page'
import { Rise } from '@/components/rise'
import { EmptyState, ErrorState } from '@/components/screen-state'
import { SectionTabs } from '@/components/section-tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { Medal } from '@/components/medal'
import { topMedal } from '@/lib/progress'
import { path } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import type { Discipline, MyProfile, PublicDisciplineMedals } from '@/lib/types'

const useDisciplines = () => useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })

// La medalla más alta junto al nombre en los rankings, con el arte de su disciplina, si enseña sus logros.
function TopMedal({ disciplines, className }: { disciplines?: PublicDisciplineMedals[]; className: string }) {
  const top = topMedal(disciplines)
  if (!top) return null
  return (
    <span className="shrink-0" title={`${top.medal.name} · ${top.discipline.name}`}>
      <Medal medal={top.medal} earned className={className} />
      <span className="sr-only">Mejor medalla: {top.medal.name}, en {top.discipline.name}</span>
    </span>
  )
}

type Row = { rank: number; id: string; display_name: string; hours: number; medals?: number; achievements?: PublicDisciplineMedals[] }
type Ranking = { discipline: { id: number; name: string }; month: string; rows: Row[]; total: number; limit: number }
type MedalRanking = { discipline: { id: string; name: string }; rows: Row[]; total: number; limit: number }

const hoursText = (h: number) => `${Number(h).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`

// La entrada escalonada solo en la primera visita de la sesión.
let played = false

// «Medallas | Horas del mes» con el aspecto de SectionTabs: radios con tabindex itinerante y flechas.
function Segmented({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (!d) return
    e.preventDefault()
    const n = (i + d + items.length) % items.length
    onChange(items[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Tipo de ranking" className="flex gap-1 rounded-xl bg-foreground/6 p-1">
      {items.map((it, i) => {
        const on = it.value === value
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'min-h-11 flex-1 rounded-lg px-2 text-[15px] font-semibold whitespace-nowrap text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
              on && 'bg-card text-foreground shadow-sm ring-1 ring-border',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

// Una fila del ranking, entera enlazada al perfil público. En el podio, más alta y con el puesto en grande.
function RankRow({ r, chosen, big, first }: { r: Row; chosen: string; big?: boolean; first?: boolean }) {
  return (
    <li className={cn('border-b last:border-b-0', first && 'bg-primary/6 dark:bg-primary/12')}>
      <Link
        to={`/profiles/${r.id}`}
        className={cn(
          'flex items-center gap-3 px-4 outline-none transition-[background-color,scale] duration-150 ease-(--ease-out) hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.99]',
          big ? 'min-h-18 py-3' : 'min-h-14 py-2',
        )}
      >
        <span className={cn('shrink-0 text-center font-heading font-bold tabular-nums', big ? 'w-9 text-4xl leading-none' : 'w-7 text-xl')}>{r.rank}</span>
        <TopMedal disciplines={r.achievements?.filter((d) => d.id === chosen)} className={big ? 'size-12' : 'size-9'} />
        <span className={cn('min-w-0 flex-1 truncate font-semibold', big && 'text-[17px]')}>{r.display_name}</span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {r.medals !== undefined ? (
            <>
              {r.medals} {r.medals === 1 ? 'medalla' : 'medallas'}
              <span className="block text-xs text-muted-foreground">{hoursText(r.hours)}</span>
            </>
          ) : (
            <span className="font-mono">{hoursText(r.hours)}</span>
          )}
        </span>
      </Link>
    </li>
  )
}

function RankingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-54 w-full rounded-2xl" />
      <Skeleton className="h-42 w-full rounded-2xl" />
    </div>
  )
}

// Rankings por disciplina (sin las de menores: un menor nunca sale): sus medallas de siempre (037) o sus horas del mes
// (sin las abiertas). ?ver=mes elige el mensual; por defecto, medallas. El top 3 va en un podio; el resto, en lista.
export function RankingsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const role = useSession()?.role
  const current = madridMonth()
  const [month, setMonth] = useState(current)
  // Tras el primer cambio de disciplina, tipo o mes, el resultado nuevo entra con un fundido.
  const [touched, setTouched] = useState(false)
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const disciplines = useDisciplines()
  // Sin rankings para las solo menores: las que tienen máximo por debajo de 18 años (sin máximo, o 18 y más, sí).
  const options = (disciplines.data ?? []).filter((d) => d.is_active && (d.max_age === null || d.max_age >= 18))
  // /rankings/medals era el de medallas de toda la academia (035): ahora, el de la primera disciplina.
  const chosen = (id !== 'medals' && id) || (options[0] ? String(options[0].id) : '')
  const open = options.find((d) => String(d.id) === chosen)?.is_open ?? false
  const isMedals = open || params.get('ver') !== 'mes'
  // Al cambiar de disciplina o de mes se queda lo anterior, atenuado, en vez de volver al esqueleto.
  const ranking = useQuery({
    queryKey: ['ranking', chosen, month],
    enabled: !!chosen && !isMedals,
    queryFn: () => api<Ranking>(path(`/rankings/${chosen}`, { month })),
    placeholderData: keepPreviousData,
  })
  const medals = useQuery({ queryKey: ['ranking', chosen, 'medals'], enabled: !!chosen && isMedals, queryFn: () => api<MedalRanking>(`/rankings/${chosen}/medals`), placeholderData: keepPreviousData })
  const mine = useQuery({ queryKey: ['my-profile'], queryFn: () => api<MyProfile>('/me/profile'), enabled: role === 'alumno' })
  const notShown = role === 'alumno' && mine.data && !(mine.data.is_public && mine.data.visible_fields.ranking)
  const list = isMedals ? medals : ranking
  const stale = list.isPlaceholderData

  return (
    <Page title="Rankings">
      <SectionTabs />
      {disciplines.isPending ? (
        <RankingSkeleton />
      ) : disciplines.isError ? (
        <ErrorState error={disciplines.error} onRetry={() => void disciplines.refetch()} />
      ) : !chosen ? (
        <EmptyState icon={<TrophyIcon />} title="Aún no hay rankings" text="Salen en cuanto haya una disciplina activa para adultos." />
      ) : (
        <>
          <Rise on={first} i={0} className="flex flex-col gap-3">
            <Filter
              label="Disciplina"
              value={chosen}
              onChange={(v) => {
                setTouched(true)
                void navigate(`/rankings/${v}${isMedals ? '' : '?ver=mes'}`)
              }}
              items={options.map((d) => ({ value: String(d.id), label: d.name }))}
            />
            {open ? (
              <p className="text-sm text-muted-foreground">Las disciplinas abiertas solo tienen ranking de medallas.</p>
            ) : (
              <Segmented
                value={isMedals ? 'medals' : 'month'}
                onChange={(v) => {
                  setTouched(true)
                  setParams(v === 'month' ? { ver: 'mes' } : {}, { replace: true })
                }}
                items={[
                  { value: 'medals', label: 'Medallas' },
                  { value: 'month', label: 'Horas del mes' },
                ]}
              />
            )}
            {!isMedals && (
              <div className="flex items-center justify-center">
                <Button
                  variant="ghost"
                  size="icon-xl"
                  aria-label="Mes anterior"
                  onClick={() => {
                    setTouched(true)
                    setMonth(addMonths(month, -1))
                  }}
                >
                  <ChevronLeftIcon />
                </Button>
                <span className="min-w-28 text-center text-sm font-semibold first-letter:uppercase" aria-live="polite">{formatMonth(month)}</span>
                <Button
                  variant="ghost"
                  size="icon-xl"
                  aria-label="Mes siguiente"
                  disabled={month >= current}
                  onClick={() => {
                    setTouched(true)
                    setMonth(addMonths(month, 1))
                  }}
                >
                  <ChevronLeftIcon className="rotate-180" />
                </Button>
              </div>
            )}
          </Rise>
          {notShown && (
            <Rise on={first} i={1}>
              <p className="rounded-2xl border bg-card p-4 text-sm">
                <span className="font-semibold">No apareces en los rankings.</span> Los rankings son solo entre quienes participan.{' '}
                <Link to="/account/profile" className="font-semibold text-link underline underline-offset-3">Cambiarlo en tu perfil público</Link>
              </p>
            </Rise>
          )}
          <Rise on={first} i={notShown ? 2 : 1}>
            {list.isPending ? (
              <RankingSkeleton />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : list.data.rows.length === 0 ? (
              <EmptyState
                icon={<TrophyIcon />}
                title={isMedals ? 'Aún nadie en el ranking de medallas' : 'Nadie en el ranking este mes'}
                text={isMedals ? 'Aparece quien participa en los rankings y tiene alguna medalla.' : 'Aparece quien participa en los rankings y ha entrenado.'}
              />
            ) : (
              <div
                // La identidad del dato, no la de la consulta: con el dato anterior en pantalla no se vuelve a montar.
                key={`${list.data.discipline.id}-${'month' in list.data ? list.data.month : 'medals'}`}
                aria-busy={stale}
                // enter-soft ya lleva la transición de opacidad para el atenuado (solo hay dato anterior tras un cambio).
                className={cn('flex flex-col gap-3', touched && 'enter-soft', stale && 'opacity-60')}
              >
                <section aria-labelledby="ranking-podium">
                  <h2 id="ranking-podium" className="sr-only">Podio</h2>
                  <ol className="overflow-hidden rounded-2xl border bg-card">
                    {list.data.rows.slice(0, 3).map((r, i) => (
                      <RankRow key={r.id} r={r} chosen={chosen} big first={i === 0} />
                    ))}
                  </ol>
                </section>
                {list.data.rows.length > 3 && (
                  <section aria-labelledby="ranking-rest">
                    <h2 id="ranking-rest" className="sr-only">Resto del ranking</h2>
                    <ol start={4} className="overflow-hidden rounded-2xl border bg-card">
                      {list.data.rows.slice(3).map((r) => (
                        <RankRow key={r.id} r={r} chosen={chosen} />
                      ))}
                    </ol>
                  </section>
                )}
                <p className="text-center text-xs text-muted-foreground tabular-nums">
                  Top {list.data.limit} · {list.data.total} {list.data.total === 1 ? 'participa' : 'participan'}
                </p>
              </div>
            )}
          </Rise>
        </>
      )}
    </Page>
  )
}
