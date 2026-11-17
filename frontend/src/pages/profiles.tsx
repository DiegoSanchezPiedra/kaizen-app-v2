import { useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Page } from '@/components/page'
import { ProfileAvatar } from '@/components/profile-avatar'
import { Rise } from '@/components/rise'
import { QueryView } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { formatMonth } from '@/lib/dates'
import { Medal } from '@/components/medal'
import { ladderOf } from '@/lib/progress'
import { NETWORKS } from '@/lib/profile'
import { themeOf } from '@/lib/themes'
import type { PublicProfile } from '@/lib/types'

const ROLE_LABEL: Record<string, string> = { alumno: 'Alumno', profesor: 'Profesor' }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// La entrada escalonada se juega solo en la primera visita de la sesión (como en rankings).
let played = false

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Skeleton className="size-24 shrink-0 rounded-full" />
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  )
}

// Ficha pública: solo los campos que la persona deja ver.
export function ProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const fromApp = useLocation().key !== 'default'
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api<{ profile: PublicProfile }>(`/profiles/${id}`).then((r) => r.profile), retry: false })
  return (
    <Page title="Perfil">
      {/* Desde la app, atrás conserva la disciplina, ?ver y el mes del ranking; por URL, sigue el enlace. */}
      <Link
        to="/rankings"
        onClick={(e) => {
          if (!fromApp || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          void navigate(-1)
        }}
        className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start rounded-md font-semibold text-link outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Rankings
      </Link>
      <QueryView query={profile} skeleton={<ProfileSkeleton />}>
        {(p) => {
          const links = Object.entries((p.social_links as Record<string, string> | null | undefined) ?? {})
          const disciplines = (p.disciplines ?? []) as ({ name: string } | string)[]
          const medals = p.achievements?.disciplines.reduce((n, d) => n + d.badges.length, 0) ?? 0
          const best = p.achievements?.streak.best ?? 0
          return (
            <div className="flex flex-col gap-4">
              <Rise on={first} i={0} className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                <ProfileAvatar name={p.display_name} avatar={p.avatar} className="[--avatar-size:--spacing(24)] font-semibold" />
                <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
                  <h2 className="text-[1.375rem] font-bold text-balance [overflow-wrap:anywhere]">{p.display_name}</h2>
                  <p className="text-muted-foreground">
                    {ROLE_LABEL[p.role] ?? p.role}
                    {p.member_since && ` · Con nosotros desde ${formatMonth(p.member_since)}`}
                  </p>
                  {p.achievements && (
                    <dl className="mt-3 flex gap-8">
                      <div className="flex flex-col-reverse">
                        <dt className="text-sm font-medium text-muted-foreground">{plural(medals, 'medalla', 'medallas')}</dt>
                        <dd className="font-heading text-3xl font-bold tabular-nums">{medals}</dd>
                      </div>
                      <div className="flex flex-col-reverse">
                        <dt className="text-sm font-medium text-muted-foreground">{plural(best, 'semana de mejor racha', 'semanas de mejor racha')}</dt>
                        <dd className="font-heading text-3xl font-bold tabular-nums">{best}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              </Rise>
              {links.length > 0 && (
                <Rise on={first} i={1}>
                  <ul aria-label="Redes" className="flex flex-wrap justify-center gap-2 sm:justify-start">
                    {links.map(([k, url]) => (
                      <li key={k}>
                        <Button variant="outline" size="lg" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
                          {NETWORKS.find(([key]) => key === k)?.[1] ?? k}
                          <ExternalLinkIcon />
                          <span className="sr-only">(se abre en otra pestaña)</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Rise>
              )}
              {(p.bio || disciplines.length > 0) && (
                <Rise on={first} i={2} className="flex flex-col gap-4">
                  {p.bio && <p className="max-w-[65ch] text-[15px] leading-relaxed whitespace-pre-line">{p.bio}</p>}
                  {disciplines.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label="Disciplinas">
                      {disciplines.map((d) => (
                        <li key={typeof d === 'string' ? d : d.name}>
                          <Badge variant="secondary" size="lg">{typeof d === 'string' ? d : d.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Rise>
              )}
              {p.achievements && (
                <Rise on={first} i={3}>
                  <section aria-labelledby="medals" className="flex flex-col gap-5 rounded-2xl border bg-card p-4 shadow-xs/5">
                    <h3 id="medals" className="text-lg font-semibold">Medallas</h3>
                    {p.achievements.disciplines.map((d) => (
                      <div key={d.id}>
                        <h4 className="mb-1.5 text-[13px] text-muted-foreground">
                          <span className="font-semibold text-foreground">{d.name}</span> · {themeOf(d.theme).series} · {d.badges.length} de 11
                        </h4>
                        <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
                          {/* La mejor primero: la escalera va de menor a mayor. */}
                          {ladderOf(d.theme).filter((m) => d.badges.some((b) => b.code === m.code)).reverse().map((m) => (
                            <li key={m.code} className="flex flex-col items-center gap-1 text-center">
                              <Medal medal={m} earned className="size-14" />
                              <span className="font-heading text-sm leading-tight font-extrabold uppercase italic">{m.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                </Rise>
              )}
              {!p.bio && disciplines.length === 0 && !p.achievements && links.length === 0 && (
                <p className="text-muted-foreground">No ha compartido nada más en su perfil.</p>
              )}
            </div>
          )
        }}
      </QueryView>
    </Page>
  )
}
