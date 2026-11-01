import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { CalendarIcon, SearchIcon, SearchXIcon, UsersIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from '@/components/ui/combobox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { ageMarks, canChangeRole, isChild, ROLE_LABEL, type Paged, type ProfileFile, type ProfileRow } from '@/lib/admin'
import { ApiError, api } from '@/lib/api'
import { addDays, madridDay } from '@/lib/dates'
import { formatShortDate, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import type { Role } from '@/lib/paths'
import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'
import { bookingsOf, refreshBookings, useBookings } from '@/lib/queries'
import { CANCEL_REASON, PAST_CHUNK_DAYS } from '@/lib/sessions'
import { path } from '@/lib/url'
import type { Booking } from '@/lib/types'
import { Filter, useDebounced } from '@/pages/community'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'
import { BillingTab, SubBadge, useConfirm } from '@/pages/admin/user-billing'

const name = (p: { display_name: string | null }) => p.display_name ?? 'Sin nombre'
const Marks = ({ p }: { p: { is_minor: boolean; pending_claim: boolean } }) => (
  <>
    {ageMarks(p).map((m) => (
      <Tag key={m} variant="secondary">
        {m}
      </Tag>
    ))}
  </>
)
const toFile = (id: string) => `/admin/users/${id}`
const UserLink = ({ p }: { p: { id: string; display_name: string | null } }) => (
  <Link to={toFile(p.id)} className="font-medium text-link underline-offset-3 hover:underline">
    {name(p)}
  </Link>
)

// ── Lista ────────────────────────────────────────────────────────────────

const ROLES = [{ value: 'all', label: 'Todos los roles' }, ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))]

// docs/pantallas-b19.md § Usuarios › Lista: búsqueda, rol y página en la URL.
export function UsersPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const search = useDebounced(q.trim())
  const role = params.get('role') ?? 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v && v !== 'all') n.set(k, v)
        else n.delete(k)
        n.delete('page')
        return n
      },
      { replace: k === 'q' },
    )
  useEffect(() => {
    if (search !== (params.get('q') ?? '')) set('q', search)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar la búsqueda ya escrita
  }, [search])

  const list = useQuery({
    queryKey: ['admin', 'profiles', params.get('q') ?? '', role, page],
    queryFn: () =>
      api<Paged<'profiles', ProfileRow>>(
        path('/admin/profiles', {
          q: params.get('q') || undefined,
          role: role === 'all' ? undefined : role,
          limit: String(PAGE_SIZE),
          offset: String((page - 1) * PAGE_SIZE),
        }),
      ),
  })
  const href = (p: number) => {
    const n = new URLSearchParams(params)
    n.set('page', String(p))
    return `?${n}`
  }

  return (
    <Page title="Usuarios" wide>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon aria-hidden="true">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Buscar por nombre o email" placeholder="Buscar por nombre o email" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <div className="sm:w-52">
          <Filter label="Rol" value={role} onChange={(v) => set('role', v)} items={ROLES} />
        </div>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={params.get('q') ? `Nadie coincide con «${params.get('q')}»` : 'Nadie con ese rol'}
          text="Prueba con otra búsqueda o quita el filtro."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Nombre', 'Email', 'Rol', 'Cuota', 'Alta'].map((h, i) => (
                    <TableHead key={h} className={i ? undefined : 'ps-4'}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.profiles.map((p) => (
                  <TableRow key={p.id} className="h-10">
                    <TableCell className="ps-4">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <UserLink p={p} />
                        <Marks p={p} />
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.email ?? '—'}</TableCell>
                    <TableCell>{ROLE_LABEL[p.role]}</TableCell>
                    <TableCell>{p.role === 'alumno' ? <SubBadge status={p.subscription_status} /> : '—'}</TableCell>
                    <TableCell className="tabular-nums">{formatShortDate(p.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={href} />
        </>
      )}
    </Page>
  )
}

// ── Ficha ────────────────────────────────────────────────────────────────

const fileKey = (id: string) => ['admin', 'profile', id]
// Tras una acción, la ficha y la lista; las de la cuota los aplica el webhook, así que se vuelve a mirar al rato.
function useRefresh(id: string) {
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: fileKey(id) }), 3000)
  }
}

const MISSING: Record<string, string> = {
  display_name: 'Nombre',
  health_info: 'Ficha médica',
  emergency_contact: 'Contacto de emergencia',
  ...AGREEMENT_TITLE,
}
const access = (p: ProfileFile['profile']) =>
  p.has_password && p.has_google ? 'Contraseña y Google' : p.has_password ? 'Contraseña' : p.has_google ? 'Google' : 'Sin acceso propio'

function RoleChange({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const [role, setRole] = useState<Role | ''>('')
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const change = useMutation({
    mutationFn: () => api(`/admin/profiles/${p.id}/role`, { method: 'PUT', body: { role } }),
    onSuccess: () => {
      toastOk(`Ahora es ${ROLE_LABEL[role as Role].toLowerCase()}`)
      setRole('')
    },
    onError: (err) =>
      toastError(err, err instanceof ApiError && err.code === 'trainer_has_sessions' ? { label: 'Ir a Clases', onClick: () => navigate('/admin/classes') } : undefined),
    onSettled: () => {
      setOpen(false)
      refresh()
    },
  })
  const options = (['alumno', 'tutor', 'profesor'] as const).filter((r) => r !== p.role)
  return (
    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
      <div className="sm:w-52">
        <Filter
          label="Rol nuevo"
          value={role || 'none'}
          onChange={(v) => setRole(v === 'none' ? '' : (v as Role))}
          items={[{ value: 'none', label: 'Rol nuevo' }, ...options.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]}
        />
      </div>
      <Button variant="outline" size="lg" disabled={!role} onClick={() => setOpen(true)}>
        Cambiar el rol
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !o && !change.isPending && setOpen(false)}
        title={role ? `¿Pasar a ${name(p)} a ${ROLE_LABEL[role].toLowerCase()}?` : ''}
        description="El cambio es inmediato; si tiene la app abierta, tendrá que volver a entrar."
        confirmLabel="Cambiar el rol"
        variant="default"
        loading={change.isPending}
        onConfirm={() => change.mutate()}
      />
    </div>
  )
}

function Summary({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const { ask, dialog } = useConfirm(refresh)
  const rows: [string, React.ReactNode][] = [
    ['Alta', formatShortDate(p.created_at)],
    ['Cómo entra', access(p)],
    [
      'Perfil público',
      p.is_public ? (
        <span className="flex items-center gap-2">
          Sí
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              ask({
                title: 'Despublicar el perfil',
                description: 'Deja de verse en la comunidad. El dueño puede volver a publicarlo.',
                label: 'Despublicar',
                done: 'Perfil despublicado',
                run: () => api(`/admin/profiles/${p.id}/unpublish`, { method: 'POST' }),
              })
            }
          >
            Despublicar
          </Button>
        </span>
      ) : (
        'No'
      ),
    ],
  ]
  if (file.status) {
    rows.push(['Perfil', file.status.ok ? 'Completo' : `Le falta: ${(file.status.missing ?? []).map((m) => MISSING[m as AgreementType] ?? m).join(', ')}`])
    if (file.status.risk_cover !== undefined) rows.push(['Cobertura de riesgo', file.status.risk_cover ? 'Sí' : 'No'])
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <Kv rows={rows} />
      {canChangeRole(p) && <RoleChange file={file} refresh={refresh} />}
      {dialog}
    </section>
  )
}

// Vincular: cualquier adulto con acceso propio que aún no sea su tutor (el servidor lo vuelve a comprobar).
function LinkGuardian({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ProfileRow | null>(null)
  const search = useDebounced(q.trim())
  const found = useQuery({
    queryKey: ['admin', 'profiles', 'adults', search],
    enabled: search.length > 1,
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', { q: search, limit: '10' })),
  })
  const options = (found.data?.profiles ?? []).filter((x) => !isChild(x) && !x.is_minor && !file.guardians.some((g) => g.id === x.id))
  const link = useMutation({
    mutationFn: () => api(`/admin/profiles/${file.profile.id}/guardians`, { method: 'POST', body: { tutor_id: picked!.id } }),
    onSuccess: () => {
      toastOk('Tutor vinculado')
      setPicked(null)
      setQ('')
    },
    onError: (err) => toastError(err),
    onSettled: refresh,
  })
  return (
    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
      <Combobox
        items={options}
        filter={null}
        value={picked}
        onValueChange={setPicked}
        onInputValueChange={setQ}
        itemToStringLabel={(x: ProfileRow) => name(x)}
        isItemEqualToValue={(a: ProfileRow, b: ProfileRow) => a.id === b.id}
      >
        <ComboboxInput aria-label="Vincular otro tutor" placeholder="Busca un adulto por nombre o email" className="sm:max-w-sm" size="lg" showTrigger={false} />
        <ComboboxPopup>
          <ComboboxEmpty>{search.length > 1 ? (found.isFetching ? 'Buscando…' : 'Nadie coincide') : 'Escribe para buscar'}</ComboboxEmpty>
          <ComboboxList>
            {(x: ProfileRow) => (
              <ComboboxItem key={x.id} value={x} className="min-h-11">
                {name(x)} <span className="text-muted-foreground">· {x.email}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
      <Button size="lg" disabled={!picked} loading={link.isPending} onClick={() => link.mutate()}>
        Vincular otro tutor
      </Button>
    </div>
  )
}

function Family({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const { ask, dialog } = useConfirm(refresh)
  if (!isChild(file.profile)) {
    return file.children.length === 0 ? (
      <EmptyState icon={<UsersIcon />} title="No tiene hijos vinculados" />
    ) : (
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {file.children.map((c) => (
          <li key={c.id} className="flex min-h-12 items-center gap-2 px-4">
            <UserLink p={c} />
            {c.pending_claim && <Tag variant="secondary">Mayor de edad sin reclamar</Tag>}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">Tutores</h2>
      <ul className="flex flex-col divide-y">
        {file.guardians.map((g) => (
          <li key={g.id} className="flex min-h-12 items-center justify-between gap-3 py-1">
            <span className="min-w-0">
              <UserLink p={g} />
              <span className="block truncate text-sm text-muted-foreground">{g.email}</span>
            </span>
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: `¿Desvincular a ${name(g)}?`,
                  description: `Deja de ser tutor de ${name(file.profile)}: ya no verá ni gestionará su cuenta.`,
                  label: 'Desvincular',
                  done: 'Tutor desvinculado',
                  destructive: true,
                  run: () => api(`/admin/profiles/${file.profile.id}/guardians/${g.id}`, { method: 'DELETE' }),
                })
              }
            >
              Desvincular
            </Button>
          </li>
        ))}
      </ul>
      <LinkGuardian file={file} refresh={refresh} />
      {dialog}
    </section>
  )
}

// El motivo, dicho desde la academia (el de B18 le habla al alumno).
const REASON: Record<string, string> = { ...CANCEL_REASON, student: 'Cancelada por el alumno', no_coverage: 'Su cuota no la cubría' }
const stateText = (b: Booking) =>
  b.status === 'cancelled' ? (b.cancel_reason ? REASON[b.cancel_reason] : 'Cancelada') : b.status === 'waitlisted' ? 'En espera' : 'Confirmada'

function BookingTable({ rows, onCancel }: { rows: Booking[]; onCancel?: (b: Booking) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <Table>
        <TableBody>
          {rows.map((b) => (
            <TableRow key={b.id} className="h-10">
              <TableCell className="ps-4 tabular-nums">
                {formatShortDate(b.starts_at)} · {formatTime(b.starts_at)}
              </TableCell>
              <TableCell className="font-medium">{b.discipline_name}</TableCell>
              <TableCell className={b.status === 'cancelled' ? 'text-muted-foreground' : undefined}>{stateText(b)}</TableCell>
              {onCancel && (
                <TableCell className="text-right">
                  {b.status !== 'cancelled' && (
                    <Button variant="ghost" size="sm" onClick={() => onCancel(b)}>
                      Cancelar
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

const MAX_PAST_CHUNKS = 8 // unos dos años hacia atrás, como Mis reservas

// Reservas por tramos de 92 días (lo más que da la API). Reservar por él se hace desde el detalle de la sesión.
function Bookings({ id }: { id: string }) {
  const today = madridDay()
  const upcoming = useBookings(id, today, addDays(today, PAST_CHUNK_DAYS - 1))
  const past = useInfiniteQuery({
    queryKey: ['bookings', id, 'past'],
    initialPageParam: addDays(today, -1),
    queryFn: ({ pageParam: end }) => bookingsOf(id, addDays(end, -(PAST_CHUNK_DAYS - 1)), end),
    getNextPageParam: (_l, pages) => (pages.length < MAX_PAST_CHUNKS ? addDays(today, -1 - PAST_CHUNK_DAYS * pages.length) : undefined),
  })
  const [target, setTarget] = useState<Booking | null>(null)
  const cancel = useMutation({
    mutationFn: (b: Booking) => api(`/bookings/${b.id}/cancel`, { method: 'POST' }),
    onSuccess: () => toastOk('Reserva cancelada'),
    onError: (err) => toastError(err),
    onSettled: () => {
      setTarget(null)
      void refreshBookings()
    },
  })
  const byStart = (a: Booking, b: Booking) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
  const pastRows = (past.data?.pages.flat() ?? []).sort((a, b) => byStart(b, a))

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-semibold">Próximas</h2>
      {upcoming.isPending ? (
        <ListSkeleton rows={2} className="h-10" />
      ) : upcoming.isError ? (
        <ErrorState error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : upcoming.data.length === 0 ? (
        <EmptyState icon={<CalendarIcon />} title="No tiene reservas próximas" />
      ) : (
        <BookingTable rows={[...upcoming.data].sort(byStart)} onCancel={setTarget} />
      )}
      <h2 className="font-semibold">Pasadas</h2>
      {past.isPending ? (
        <ListSkeleton rows={2} className="h-10" />
      ) : past.isError ? (
        <ErrorState error={past.error} onRetry={() => void past.refetch()} />
      ) : pastRows.length === 0 && !past.hasNextPage ? (
        <EmptyState icon={<CalendarIcon />} title="No tiene reservas pasadas" />
      ) : (
        <>
          {pastRows.length > 0 && <BookingTable rows={pastRows} />}
          {past.hasNextPage && (
            <Button variant="outline" className="self-start" loading={past.isFetchingNextPage} onClick={() => void past.fetchNextPage()}>
              Ver más antiguas
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && !cancel.isPending && setTarget(null)}
        title="¿Cancelar la reserva?"
        description={target ? `${target.discipline_name}, ${formatShortDate(target.starts_at)} a las ${formatTime(target.starts_at)}. Queda como «cancelada por la academia»; nunca cuenta como tardía.` : ''}
        confirmLabel="Cancelar la reserva"
        loading={cancel.isPending}
        onConfirm={() => target && cancel.mutate(target)}
      />
    </div>
  )
}

const TABS = [
  { value: 'summary', label: 'Resumen' },
  { value: 'family', label: 'Familia' },
  { value: 'billing', label: 'Cuota y seguro', student: true },
  { value: 'bookings', label: 'Reservas', student: true },
]

// docs/pantallas-b19.md § Usuarios › Ficha. Nunca salud, edad ni fecha de nacimiento: la API no los da.
export function UserPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const refresh = useRefresh(id)
  const file = useQuery({ queryKey: fileKey(id), queryFn: () => api<ProfileFile>(`/admin/profiles/${id}`) })

  if (file.isPending) return <ListSkeleton rows={3} className="h-32" />
  if (file.isError) {
    const missing = file.error instanceof ApiError && (file.error.code === 'profile_not_found' || file.error.code === 'invalid_id')
    return (
      <Page title="Usuarios" wide>
        <Back to="/admin/users">Usuarios</Back>
        {missing ? <EmptyState icon={<SearchXIcon />} title="Este perfil no existe" /> : <ErrorState error={file.error} onRetry={() => void file.refetch()} />}
      </Page>
    )
  }
  const { profile: p } = file.data
  const tabs = TABS.filter((t) => !t.student || p.role === 'alumno')
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'summary'

  return (
    <Page title={name(p)} wide>
      <Back to="/admin/users">Usuarios</Back>
      <div className="-mt-3 flex flex-wrap items-center gap-2 text-muted-foreground">
        <Tag>{ROLE_LABEL[p.role]}</Tag>
        <Marks p={p} />
        {p.email && <span className="text-sm">{p.email}</span>}
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {tabs.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="summary">
          <Summary file={file.data} refresh={refresh} />
        </TabsPanel>
        <TabsPanel value="family">
          <Family file={file.data} refresh={refresh} />
        </TabsPanel>
        {p.role === 'alumno' && (
          <>
            <TabsPanel value="billing">
              <BillingTab file={file.data} refresh={refresh} />
            </TabsPanel>
            <TabsPanel value="bookings">
              <Bookings id={p.id} />
            </TabsPanel>
          </>
        )}
      </Tabs>
    </Page>
  )
}
