import { useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ExternalLinkIcon } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Page } from '@/components/page'
import { ProfileAvatar } from '@/components/profile-avatar'
import { ListSkeleton, QueryView } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatMonth } from '@/lib/dates'
import { Medal } from '@/components/medal'
import { ladderOf } from '@/lib/progress'
import { NETWORKS } from '@/lib/profile'
import { themeOf } from '@/lib/themes'
import type { PublicProfile } from '@/lib/types'

const ROLE_LABEL: Record<string, string> = { alumno: 'Alumno', profesor: 'Profesor' }

// Ficha pública: solo los campos que la persona deja ver.
export function ProfilePage() {
  const { id } = useParams()
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api<{ profile: PublicProfile }>(`/profiles/${id}`).then((r) => r.profile), retry: false })
  return (
    <Page title="Perfil">
      <Link to="/rankings" className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Rankings
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
                <section aria-labelledby="medals" className="flex flex-col gap-3">
                  <h3 id="medals" className="text-sm font-semibold">Medallas · mejor racha {p.achievements.streak.best} semanas</h3>
                  {p.achievements.disciplines.map((d) => (
                    <div key={d.id}>
                      <h4 className="mb-1.5 text-[13px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{d.name}</span> · {themeOf(d.theme).series} · {d.badges.length} de 11
                      </h4>
                      <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
                        {ladderOf(d.theme).filter((m) => d.badges.some((b) => b.code === m.code)).map((m) => (
                          <li key={m.code} className="flex flex-col items-center gap-1 text-center">
                            <Medal medal={m} earned className="size-14" />
                            <span className="font-heading text-sm leading-tight font-extrabold uppercase italic">{m.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}
              {links.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {links.map(([k, url]) => (
                    <li key={k}>
                      <Button variant="outline" size="xl" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
                        {NETWORKS.find(([key]) => key === k)?.[1] ?? k}
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
