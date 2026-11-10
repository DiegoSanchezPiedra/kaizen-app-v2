import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { CalendarIcon, SearchIcon, SearchXIcon, UsersIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ProfileAvatar } from '@/components/profile-avatar'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from '@/components/ui/combobox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { OTPField, OTPFieldInput, OTPFieldSeparator } from '@/components/ui/otp-field'
import {
  ageMarks,
  canChangeRole,
  ESTADO_TAG,
  hasFilters,
  isChild,
  lastSeen,
  pageHref,
  profilesQuery,
  ROLE_LABEL,
  setFilter,
  toggleEstado,
  userFilters,
  type Estado,
  type Paged,
  type ProfileFile,
  type ProfileRow,
  type ProfileStats,
} from '@/lib/admin'
import { ApiError, api } from '@/lib/api'
import { addDays, madridDay } from '@/lib/dates'
import { formatShortDate, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import type { Role } from '@/lib/paths'
import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'
import { bookingsOf, refreshBookings, useBookings, useDisciplines } from '@/lib/queries'
import { CANCEL_REASON, PAST_CHUNK_DAYS } from '@/lib/sessions'
import { path } from '@/lib/url'
import type { Booking, Plan } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Filter, useDebounced } from '@/pages/community'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'
import { BillingTab, del, useConfirm } from '@/pages/admin/user-billing'

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
const STATE_ITEMS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'activo', label: 'Activos' },
  { value: 'inactivo', label: 'Inactivos' },
  { value: 'impago', label: 'Impago' },
  { value: 'sin_plan', label: 'Sin plan' },
]
const KPIS: [Estado, string, keyof ProfileStats][] = [
  ['activo', 'Activos', 'activos'],
  ['impago', 'Impago', 'impago'],
  ['inactivo', 'Inactivos ·\u00a014\u00a0d', 'inactivos'],
]
const useAdminPlans = () => useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<{ plans: Plan[] }>('/admin/plans').then((r) => r.plans) })

const EstadoTag = ({ estado }: { estado: Estado | null }) => (estado ? <Tag variant={ESTADO_TAG[estado][1]}>{ESTADO_TAG[estado][0]}</Tag> : null)
const roleLine = (p: ProfileRow) => [ROLE_LABEL[p.role], ...ageMarks(p), p.role === 'alumno' && (p.plan_name ?? 'Sin plan')].filter(Boolean).join(' · ')

// Activos, Impago e Inactivos de los alumnos de la disciplina elegida; pulsar una filtra la lista por ese estado.
function Kpis({ params, setParams }: { params: URLSearchParams; setParams: (p: URLSearchParams) => void }) {
  const f = userFilters(params)
  const stats = useQuery({
    queryKey: ['admin', 'profiles', 'stats', f.discipline],
    queryFn: () => api<ProfileStats>(path('/admin/profiles/stats', { discipline_id: f.discipline ?? undefined })),
  })
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
  return (
    // Caben 3 a 375 px; por debajo de unos 340, scroll dentro de su marco (el margen deja ver el anillo de foco).
    <div className="-m-1 overflow-x-auto p-1">
      <div className="grid min-w-[19.25rem] grid-cols-3 gap-2" role="group" aria-label="Alumnos por estado">
        {KPIS.map(([estado, label, key]) => {
          const n = stats.data?.[key]
          return (
            <button
              key={estado}
              type="button"
              aria-pressed={f.estado === estado}
              onClick={() => setParams(toggleEstado(params, estado))}
              className={cn(
                'flex min-h-24 flex-col items-start gap-2 rounded-2xl border bg-card p-3 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.96] motion-reduce:active:scale-100',
                f.estado === estado && 'border-primary ring-1 ring-primary',
              )}
            >
              {n === undefined ? (
                <Skeleton className="h-9 w-12 rounded-md" />
              ) : (
                <span className={cn('font-heading text-4xl leading-none font-bold tabular-nums', estado === 'impago' && n > 0 && 'text-destructive-foreground')}>{n}</span>
              )}
              <span className="text-sm leading-tight text-muted-foreground">
                {label}
                {estado === 'impago' && <span className="mt-0.5 block text-xs text-balance">Por alumno, no pagador</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// docs/pantallas-b22.md § Usuarios y docs/auditoria-b22.md § 4: KPIs arriba; búsqueda y filtros en la URL.
export function UsersPage() {
  const [params, setParams] = useSearchParams()
  const f = userFilters(params)
  const [q, setQ] = useState(f.q)
  const search = useDebounced(q.trim())
  const disciplines = useDisciplines()
  const plans = useAdminPlans()
  const set = (k: Parameters<typeof setFilter>[1], v: string | null) => setParams((p) => setFilter(p, k, v), { replace: k === 'q' })
  useEffect(() => {
    if (search !== (params.get('q') ?? '')) set('q', search)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar la búsqueda ya escrita
  }, [search])

  const list = useQuery({
    queryKey: ['admin', 'profiles', f],
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', profilesQuery(f, PAGE_SIZE))),
  })
  const clear = () => {
    setQ('')
    setParams(new URLSearchParams())
  }

  return (
    <Page title="Usuarios" wide>
      <section className="flex flex-col gap-3" aria-label="Resumen de alumnos">
        <div className="sm:w-64">
          <Filter
            label="Disciplina"
            value={f.discipline ?? 'all'}
            onChange={(v) => set('discipline', v)}
            items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
          />
        </div>
        <Kpis params={params} setParams={(p) => setParams(p)} />
      </section>
      <div className="flex flex-col gap-2">
        <InputGroup>
          <InputGroupAddon aria-hidden="true">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Buscar por nombre o email" placeholder="Buscar por nombre o email" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <div className="flex flex-wrap gap-2 *:min-w-36 *:flex-1 sm:*:max-w-52">
          <div>
            <Filter label="Rol" value={f.role ?? 'all'} onChange={(v) => set('role', v)} items={ROLES} />
          </div>
          <div>
            <Filter
              label="Plan"
              value={f.plan ?? 'all'}
              onChange={(v) => set('plan', v)}
              items={[{ value: 'all', label: 'Cualquier plan' }, ...(plans.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          </div>
          <div>
            <Filter label="Estado" value={f.estado ?? 'all'} onChange={(v) => set('estado', v)} items={STATE_ITEMS} />
          </div>
        </div>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} className="h-16 sm:h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={f.q ? `Nadie coincide con «${f.q}»` : hasFilters(f) ? 'Nadie con estos filtros' : 'Aún no hay usuarios'}
          text={hasFilters(f) ? 'Prueba con otra búsqueda o quita los filtros.' : undefined}
          action={
            hasFilters(f) && (
              <Button variant="outline" onClick={clear}>
                Quitar filtros
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Móvil: una fila por persona en un solo marco (auditoría § 4); toda la fila abre la ficha. */}
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card sm:hidden">
            {list.data.profiles.map((p) => (
              <li key={p.id}>
                <Link
                  to={toFile(p.id)}
                  className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none active:bg-accent"
                >
                  <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-10" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold">{name(p)}</span>
                      <EstadoTag estado={p.estado} />
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{roleLine(p)}</span>
                    {p.role === 'alumno' && <span className="text-sm text-muted-foreground">Última asistencia {lastSeen(p.last_attendance_at)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card sm:block">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Nombre', 'Rol', 'Plan', 'Estado', 'Última asistencia'].map((h, i) => (
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
                        <ProfileAvatar name={p.display_name} avatar={p.avatar} className="me-1 size-7" />
                        <UserLink p={p} />
                        <Marks p={p} />
                      </span>
                    </TableCell>
                    <TableCell>{ROLE_LABEL[p.role]}</TableCell>
                    <TableCell className={p.plan_name ? undefined : 'text-muted-foreground'}>{p.plan_name ?? '—'}</TableCell>
                    <TableCell>{p.estado ? <EstadoTag estado={p.estado} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{p.role === 'alumno' ? lastSeen(p.last_attendance_at) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={f.page} href={(n) => pageHref(params, n)} />
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

const OTP_SLOT = 'h-12 w-10 font-mono text-xl'

function RoleChange({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const [role, setRole] = useState<Role | ''>('')
  const [open, setOpen] = useState(false)
  // Dar admin se confirma con el código del doble factor de quien lo da (B20): un token robado no basta.
  const [code, setCode] = useState('')
  const toAdmin = role === 'admin'
  const navigate = useNavigate()
  const change = useMutation({
    mutationFn: () => api(`/admin/profiles/${p.id}/role`, { method: 'PUT', body: { role, ...(toAdmin && { mfa_code: code }) } }),
    onSuccess: () => {
      toastOk(`Ahora es ${ROLE_LABEL[role as Role].toLowerCase()}`)
      setRole('')
    },
    onError: (err) => {
      const errCode = err instanceof ApiError ? err.code : null
      const go = (label: string, to: string) => ({ label, onClick: () => navigate(to) })
      toastError(err, errCode === 'trainer_has_sessions' ? go('Ir a Clases', '/admin/classes') : errCode === 'mfa_required' ? go('Activar el doble factor', '/admin/mfa') : undefined)
    },
    onSettled: () => {
      setOpen(false)
      setCode('')
      refresh()
    },
  })
  const options = (['alumno', 'tutor', 'profesor', 'admin'] as const).filter((r) => r !== p.role)
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
        description={
          toAdmin
            ? 'Podrá hacer todo lo que haces tú y desde la app no se le podrá quitar. Confírmalo con el código de tu app de autenticación.'
            : 'El cambio es inmediato; si tiene la app abierta, tendrá que volver a entrar.'
        }
        confirmLabel="Cambiar el rol"
        variant="default"
        loading={change.isPending}
        disabled={toAdmin && code.length < 6}
        onConfirm={() => change.mutate()}
      >
        {toAdmin && (
          <OTPField length={6} value={code} onValueChange={setCode} validationType="numeric" autoComplete="one-time-code" aria-label="Código de tu app de autenticación">
            {[0, 1, 2].map((i) => (
              <OTPFieldInput key={i} className={OTP_SLOT} autoFocus={i === 0} />
            ))}
            <OTPFieldSeparator />
            {[3, 4, 5].map((i) => (
              <OTPFieldInput key={i} className={OTP_SLOT} />
            ))}
          </OTPField>
        )}
      </ConfirmDialog>
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
  if (p.avatar) {
    rows.push([
      'Foto',
      <Button
        key="avatar"
        variant="outline"
        size="sm"
        onClick={() =>
          ask({
            title: 'Quitar la foto',
            description: 'Se avisará a la persona (o a su tutor) sin decir el motivo.',
            label: 'Quitar foto',
            done: 'Foto quitada',
            destructive: true,
            run: del(`/admin/profiles/${p.id}/avatar`),
          })
        }
      >
        Quitar foto
      </Button>,
    ])
  }
  if (file.status) {
    rows.push(['Perfil', file.status.ok ? 'Completo' : `Le falta: ${(file.status.missing ?? []).map((m) => MISSING[m as AgreementType] ?? m).join(', ')}`])
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
      <div className="-mt-3 flex items-center gap-3">
        <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-14" />
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Tag>{ROLE_LABEL[p.role]}</Tag>
          <Marks p={p} />
          {p.email && <span className="text-sm">{p.email}</span>}
        </div>
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
