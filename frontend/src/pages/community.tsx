import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ExternalLinkIcon, SearchIcon, TrophyIcon, UsersIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Page } from '@/components/page'
import { ProfileAvatar } from '@/components/profile-avatar'
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/screen-state'
import { SectionTabs } from '@/components/section-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { Medal } from '@/components/medal'
import { MEDALS, topMedal } from '@/lib/progress'
import { path } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { Discipline, MyProfile, PublicProfile } from '@/lib/types'

const PAGE = 25
const ROLE_LABEL: Record<string, string> = { alumno: 'Alumno', profesor: 'Profesor' }

export function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const useDisciplines = () => useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })

export function Filter({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger aria-label={label} className="min-h-11 sm:min-h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value} className="min-h-11 sm:min-h-11">
            {i.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}

// Directorio: solo perfiles públicos (un hijo nunca sale: la vista no lo da).
export function CommunityPage() {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('all')
  const [discipline, setDiscipline] = useState('all')
  const search = useDebounced(q.trim())
  const disciplines = useDisciplines()
  const list = useInfiniteQuery({
    queryKey: ['profiles', search, role, discipline],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ profiles: PublicProfile[]; total: number }>(
        path('/profiles', { q: search || undefined, role: role === 'all' ? undefined : role, discipline_id: discipline === 'all' ? undefined : discipline, limit: String(PAGE), offset: String(pageParam) }),
      ),
    getNextPageParam: (last, pages) => (pages.length * PAGE < last.total ? pages.length * PAGE : undefined),
  })
  const profiles = list.data?.pages.flatMap((p) => p.profiles) ?? []
  return (
    <Page title="Comunidad">
      <SectionTabs />
      <div className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon aria-hidden="true">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Buscar por nombre" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <div className="grid grid-cols-2 gap-2">
          <Filter label="Rol" value={role} onChange={setRole} items={[{ value: 'all', label: 'Todos' }, { value: 'alumno', label: 'Alumnos' }, { value: 'profesor', label: 'Profesores' }]} />
          <Filter label="Disciplina" value={discipline} onChange={setDiscipline} items={[{ value: 'all', label: 'Todas' }, ...(disciplines.data ?? []).filter((d) => d.is_active).map((d) => ({ value: String(d.id), label: d.name }))]} />
        </div>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-16" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : profiles.length === 0 ? (
        <EmptyState icon={<UsersIcon />} title="No hay perfiles" text={search || role !== 'all' || discipline !== 'all' ? 'Prueba con otra búsqueda o quita los filtros.' : 'Aún no hay perfiles públicos.'} />
      ) : (
        <>
          <ul className="flex flex-col overflow-hidden rounded-xl border bg-card">
            {profiles.map((p) => (
              <li key={p.id} className="border-b last:border-b-0">
                <Link to={`/profiles/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-10" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.display_name}</span>
                  <TopMedal codes={p.achievements?.badges.map((b) => b.code)} />
                  <Badge variant="outline" size="lg">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button size="xl" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Ver más
            </Button>
          )}
        </>
      )}
    </Page>
  )
}

const NETWORKS: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', web: 'Web' }

// La medalla más alta junto al nombre (Comunidad y rankings), si la persona enseña sus logros.
function TopMedal({ codes }: { codes?: string[] }) {
  const m = codes && topMedal(codes)
  return m ? <Medal medal={m} earned className="size-9" /> : null
}

// Ficha pública: solo los campos que la persona deja ver.
export function ProfilePage() {
  const { id } = useParams()
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api<{ profile: PublicProfile }>(`/profiles/${id}`).then((r) => r.profile), retry: false })
  return (
    <Page title="Perfil">
      <Link to="/profiles" className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Comunidad
      </Link>
      <QueryView query={profile} skeleton={<ListSkeleton rows={2} />}>
        {(p) => {
          const links = Object.entries((p.social_links as Record<string, string> | null | undefined) ?? {})
          const disciplines = (p.disciplines ?? []) as ({ name: string } | string)[]
          return (
            <article className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
              <div className="flex items-center gap-4">
                <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-16" />
                <div>
                  <h2 className="font-heading text-2xl font-bold">{p.display_name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {ROLE_LABEL[p.role] ?? p.role}
                    {p.member_since && ` · Con nosotros desde ${formatMonth(p.member_since)}`}
                  </p>
                </div>
              </div>
              {p.bio && <p className="text-[15px] leading-relaxed whitespace-pre-line">{p.bio}</p>}
              {disciplines.length > 0 && (
                <div className="flex flex-wrap gap-2" aria-label="Disciplinas">
                  {disciplines.map((d) => (
                    <Badge key={typeof d === 'string' ? d : d.name} variant="secondary" size="lg">{typeof d === 'string' ? d : d.name}</Badge>
                  ))}
                </div>
              )}
              {p.achievements && (
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">
                    Medallas · {p.achievements.badges.length} de {MEDALS.length} · mejor racha {p.achievements.streak.best}
                  </h3>
                  <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
                    {MEDALS.filter((m) => p.achievements!.badges.some((b) => b.code === m.code)).map((m) => (
                      <li key={m.code} className="flex flex-col items-center gap-1 text-center">
                        <Medal medal={m} earned className="size-14" />
                        <span className="font-heading text-sm leading-tight font-extrabold uppercase italic">{m.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {links.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {links.map(([k, url]) => (
                    <li key={k}>
                      <Button variant="outline" size="xl" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
                        {NETWORKS[k] ?? k}
                        <ExternalLinkIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )
        }}
      </QueryView>
    </Page>
  )
}

type Ranking = { discipline: { id: number; name: string }; month: string; rows: { rank: number; id: string; display_name: string; hours: number; badges?: string[] }[]; total: number }
type MedalRanking = { rows: { rank: number; id: string; display_name: string; medals: number; hours: number; badges?: string[] }[]; total: number }

const hoursText = (h: number) => `${Number(h).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`

// Rankings: el de medallas de siempre (toda la academia) y el mensual por disciplina (sin las abiertas ni las de menores).
export function RankingsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const role = useSession()?.role
  const current = madridMonth()
  const [month, setMonth] = useState(current)
  const disciplines = useDisciplines()
  const options = (disciplines.data ?? []).filter((d) => d.is_active && !d.is_open && !d.minors_only)
  const chosen = id ?? 'medals'
  const isMedals = chosen === 'medals'
  const ranking = useQuery({
    queryKey: ['ranking', chosen, month],
    enabled: !isMedals,
    queryFn: () => api<Ranking>(path(`/rankings/${chosen}`, { month, limit: '50' })),
  })
  const medals = useQuery({ queryKey: ['ranking', 'medals'], enabled: isMedals, queryFn: () => api<MedalRanking>(path('/rankings/medals', { limit: '50' })) })
  const mine = useQuery({ queryKey: ['my-profile'], queryFn: () => api<MyProfile>('/me/profile'), enabled: role === 'alumno' })
  const notShown = role === 'alumno' && mine.data && !(mine.data.is_public && mine.data.visible_fields.ranking)
  const list = isMedals ? medals : ranking

  return (
    <Page title="Rankings">
      <SectionTabs />
      {disciplines.isPending ? (
        <ListSkeleton rows={3} className="h-14" />
      ) : disciplines.isError ? (
        <ErrorState error={disciplines.error} onRetry={() => void disciplines.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <Filter label="Ranking" value={chosen} onChange={(v) => void navigate(`/rankings/${v}`)} items={[{ value: 'medals', label: 'Medallas · de siempre' }, ...options.map((d) => ({ value: String(d.id), label: d.name }))]} />
            {!isMedals && (
              <div className="flex items-center">
                <Button variant="ghost" size="icon-xl" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}>
                  <ChevronLeftIcon />
                </Button>
                <span className="min-w-28 text-center text-sm font-semibold first-letter:uppercase" aria-live="polite">{formatMonth(month)}</span>
                <Button variant="ghost" size="icon-xl" aria-label="Mes siguiente" disabled={month >= current} onClick={() => setMonth(addMonths(month, 1))}>
                  <ChevronLeftIcon className="rotate-180" />
                </Button>
              </div>
            )}
          </div>
          {notShown && (
            <p className="rounded-xl border bg-card p-4 text-sm">
              <span className="font-semibold">No apareces en los rankings.</span> Los rankings son solo entre quienes participan.{' '}
              <Link to="/account/profile" className="font-semibold text-link underline underline-offset-3">Cambiarlo en tu perfil público</Link>
            </p>
          )}
          {list.isPending ? (
            <ListSkeleton rows={4} className="h-14" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data.rows.length === 0 ? (
            <EmptyState
              icon={<TrophyIcon />}
              title={isMedals ? 'Aún nadie en el ranking de medallas' : 'Nadie en el ranking este mes'}
              text={isMedals ? 'Aparece quien participa en los rankings y tiene alguna medalla.' : 'Aparece quien participa en los rankings y ha entrenado.'}
            />
          ) : (
            <ol className="flex flex-col overflow-hidden rounded-xl border bg-card">
              {list.data.rows.map((r) => (
                <li key={r.id} className="flex min-h-14 items-center gap-3 border-b px-4 py-2 last:border-b-0">
                  <span className="w-7 text-center font-heading text-xl font-bold tabular-nums">{r.rank}</span>
                  <TopMedal codes={r.badges} />
                  <Link to={`/profiles/${r.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{r.display_name}</Link>
                  <span className="text-right font-mono text-sm tabular-nums">
                    {'medals' in r ? (
                      <>
                        {r.medals} {r.medals === 1 ? 'medalla' : 'medallas'}
                        <span className="block text-xs text-muted-foreground">{hoursText(r.hours)}</span>
                      </>
                    ) : (
                      hoursText(r.hours)
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Page>
  )
}
