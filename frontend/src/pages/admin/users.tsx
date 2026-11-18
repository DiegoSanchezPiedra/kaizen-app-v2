import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { BanIcon, CalendarIcon, ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, ClockIcon, HourglassIcon, SearchIcon, SearchXIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ProfileAvatar } from '@/components/profile-avatar'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from '@/components/ui/combobox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { OTPField, OTPFieldInput, OTPFieldSeparator } from '@/components/ui/otp-field'
import {
  ageMarks,
  ASSIGNABLE_ROLES,
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
  trainerState,
  userFilters,
  type Estado,
  type Paged,
  type ProfileFile,
  type ProfileRow,
  type ProfileStats,
  type UserTab,
  userTabs,
} from '@/lib/admin'
import { ApiError, api } from '@/lib/api'
import { isLive } from '@/lib/billing'
import { addDays, madridDay } from '@/lib/dates'
import { formatShortDate, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import type { Role } from '@/lib/paths'
import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'
import { bookingsOf, refreshBookings, useBookings, useDisciplines } from '@/lib/queries'
import { CANCEL_REASON, PAST_CHUNK_DAYS } from '@/lib/sessions'
import { path } from '@/lib/url'
import type { Booking } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Filter } from '@/components/filter'
import { useDebounced } from '@/lib/use-debounced'
import { useAdminPlans } from '@/lib/queries'
import { AuditLink, PAGE_SIZE, Pager } from '@/pages/admin/shell'
import { EmploymentChange } from '@/pages/admin/clock'
import { NewTrainer, TrainerActions, TrainerTag } from '@/pages/admin/trainers'
import { BillingTab, del, SubBadge, useConfirm } from '@/pages/admin/user-billing'

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
// Estados de la lista con su cifra (de /stats, por disciplina); «Sin plan» no tiene cifra en la API.
const CHIPS: [Estado | null, string, keyof ProfileStats | null][] = [
  [null, 'Todos', null],
  ['activo', 'Activos', 'activos'],
  ['impago', 'Impago', 'impago'],
  ['inactivo', 'Inactivos · 14 d', 'inactivos'],
  ['sin_plan', 'Sin plan', null],
]
const ESTADO_ICON: Record<Estado, LucideIcon> = { activo: CircleCheckIcon, inactivo: ClockIcon, impago: CircleAlertIcon, sin_plan: CircleDashedIcon }

// Alumno: su estado de cuota; profesor: el de su cuenta (activo, invitación pendiente, desactivado). Icono y texto.
const EstadoTag = ({ p }: { p: ProfileRow }) => {
  if (p.role === 'profesor') return <TrainerTag state={trainerState(p)} />
  if (!p.estado) return null
  const [label, variant] = ESTADO_TAG[p.estado]
  const Icon = ESTADO_ICON[p.estado]
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Tag>
  )
}
const roleLine = (p: ProfileRow) => [ROLE_LABEL[p.role], ...ageMarks(p), p.role === 'alumno' && (p.plan_name ?? 'Sin plan')].filter(Boolean).join(' · ')

// Filtro por estado con la cifra de los alumnos de la disciplina elegida (docs/pantallas-b22.md § Usuarios).
function EstadoChips({ params, setParams }: { params: URLSearchParams; setParams: (p: URLSearchParams) => void }) {
  const f = userFilters(params)
  const stats = useQuery({
    queryKey: ['admin', 'profiles', 'stats', f.discipline],
    queryFn: () => api<ProfileStats>(path('/admin/profiles/stats', { discipline_id: f.discipline ?? undefined })),
  })
  return (
    // A 375 no caben: scroll dentro de su marco (el margen deja ver el anillo de foco).
    <div className="-m-1 overflow-x-auto p-1 [scrollbar-width:none]">
      <div className="flex w-max gap-2" role="group" aria-label="Filtrar por estado">
        {CHIPS.map(([estado, label, key]) => {
          const on = f.estado === estado
          const n = key ? stats.data?.[key] : undefined
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => setParams(estado ? toggleEstado(params, estado) : setFilter(params, 'estado', null))}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium whitespace-nowrap outline-none transition-[background-color,border-color,scale] duration-150 ease-out hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-safe:active:scale-[0.97] sm:min-h-9',
                on && 'border-primary bg-primary/12 hover:bg-primary/12',
              )}
            >
              {label}
              {key && !stats.isError && (n === undefined ? <Skeleton className="h-4 w-6 rounded-sm" /> : <span className={cn('tabular-nums', estado === 'impago' && n > 0 ? 'text-destructive-foreground' : 'text-muted-foreground')}>{n}</span>)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// docs/pantallas-b22.md § Usuarios: se entra a buscar por nombre; estado, filtros y página en la URL.
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

  // Al filtrar se queda la lista anterior, atenuada, en vez de volver al esqueleto.
  const list = useQuery({
    queryKey: ['admin', 'profiles', f],
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', profilesQuery(f, PAGE_SIZE))),
    placeholderData: keepPreviousData,
  })
  const clear = () => {
    setQ('')
    setParams(new URLSearchParams())
  }
  const total = list.data?.total

  return (
    <Page title="Usuarios" wide actions={<NewTrainer />}>
      <div className="flex flex-col gap-3">
        <InputGroup className="**:placeholder:text-muted-foreground!">
          <InputGroupAddon aria-hidden="true">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Buscar por nombre o email" placeholder="Buscar por nombre o email" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <EstadoChips params={params} setParams={(p) => setParams(p)} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:max-w-2xl">
          <Filter label="Rol" value={f.role ?? 'all'} onChange={(v) => set('role', v)} items={ROLES} />
          <Filter
            label="Disciplina"
            value={f.discipline ?? 'all'}
            onChange={(v) => set('discipline', v)}
            items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
          />
          <div className="col-span-2 sm:col-span-1">
            <Filter
              label="Plan"
              value={f.plan ?? 'all'}
              onChange={(v) => set('plan', v)}
              items={[{ value: 'all', label: 'Cualquier plan' }, ...(plans.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          </div>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 sm:min-h-9">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {total !== undefined && !list.isError && `${total} ${total === 1 ? 'persona' : 'personas'}${f.estado === 'impago' ? ' · impago por alumno, no por pagador' : ''}`}
          </p>
          {hasFilters(f) && (
            <Button variant="ghost" size="sm" className="-me-2 max-sm:min-h-11" onClick={clear}>
              Quitar filtros
            </Button>
          )}
        </div>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} className="h-16 xl:h-11" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState
          icon={hasFilters(f) ? <SearchXIcon /> : <UsersIcon />}
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
        <div className={cn('flex flex-col gap-5 transition-opacity duration-150 ease-out', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
          {/* Hasta xl, una fila por persona en un solo marco (auditoría § 4; la tabla no cabe con la barra lateral); toda la fila abre la ficha. */}
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card xl:hidden">
            {list.data.profiles.map((p) => (
              <li key={p.id}>
                <Link
                  to={toFile(p.id)}
                  className="flex min-h-16 items-center gap-3 py-2.5 ps-4 pe-3 transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none active:bg-accent"
                >
                  <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-10" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold">{name(p)}</span>
                      <EstadoTag p={p} />
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{roleLine(p)}</span>
                    {p.role === 'alumno' && <span className="text-sm text-muted-foreground">Última asistencia {lastSeen(p.last_attendance_at)}</span>}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">Nombre</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="pe-4">Última asistencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.profiles.map((p) => (
                  <TableRow key={p.id} className="h-11">
                    <TableCell className="ps-4">
                      <span className="flex max-w-60 items-center gap-2">
                        <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-7" />
                        <span className="min-w-0 truncate">
                          <UserLink p={p} />
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        {ROLE_LABEL[p.role]}
                        <Marks p={p} />
                      </span>
                    </TableCell>
                    <TableCell className={p.plan_name ? undefined : 'text-muted-foreground'}>{p.plan_name ?? '—'}</TableCell>
                    <TableCell>{p.estado || p.role === 'profesor' ? <EstadoTag p={p} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="pe-4 text-muted-foreground tabular-nums">{p.role === 'alumno' ? lastSeen(p.last_attendance_at) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={f.page} href={(n) => pageHref(params, n)} />
        </div>
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
  p.has_password && p.has_google ? 'Contraseña y Google' : p.has_password ? 'Contraseña' : p.has_google ? 'Google' : p.email ? 'Pendiente de aceptar la invitación' : 'Sin acceso propio'

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
      toastError(err, errCode === 'mfa_required' ? go('Activar el doble factor', '/admin/mfa') : undefined)
    },
    onSettled: () => {
      setOpen(false)
      setCode('')
      refresh()
    },
  })
  const options = ASSIGNABLE_ROLES.filter((r) => r !== p.role)
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
      <Button variant="outline" size="lg" className="max-sm:h-11" disabled={!role} onClick={() => setOpen(true)}>
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
          <OTPField className="justify-center" length={6} value={code} onValueChange={setCode} validationType="numeric" autoComplete="one-time-code" aria-label="Código de tu app de autenticación">
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

// Permiso de dar de alta hijos (POST /me/children): lo concede un admin, por usuario. Solo un adulto con acceso propio.
function CanCreateChildren({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(`/admin/profiles/${p.id}/can-create-children`, { method: 'PUT', body: { enabled } }),
    onError: (err) => toastError(err),
    onSettled: refresh,
  })
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 border-t pt-3">
      <span className="text-[15px] font-medium">Puede crear hijos</span>
      <Switch checked={toggle.isPending ? toggle.variables : p.can_create_children} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
    </label>
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
        <span key="public" className="flex items-center gap-2">
          Sí
          <Button
            variant="outline"
            size="sm"
            className="max-sm:h-11"
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
        className="max-sm:h-11"
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
  const missing = file.status && !file.status.ok ? (file.status.missing ?? []).map((m) => MISSING[m as AgreementType] ?? m) : []
  if (file.status)
    rows.push([
      'Perfil',
      file.status.ok ? (
        'Completo'
      ) : (
        <Tag key="missing" variant="warning">
          <CircleAlertIcon aria-hidden="true" />
          Le {missing.length === 1 ? 'falta 1 dato' : `faltan ${missing.length} datos`}
        </Tag>
      ),
    ])
  const actions = [
    !isChild(p) && !p.is_minor && <CanCreateChildren key="children" file={file} refresh={refresh} />,
    canChangeRole(p) && <RoleChange key="role" file={file} refresh={refresh} />,
    p.role === 'profesor' && <TrainerActions key="trainer" file={file} refresh={refresh} />,
    p.role === 'profesor' && <EmploymentChange key="employment" id={p.id} />,
  ].filter(Boolean)
  // Datos a un lado y lo que cambia la cuenta (rol, permisos, profesor) en su propia tarjeta.
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-labelledby="user-data">
        <h2 id="user-data" className="font-semibold">
          Datos
        </h2>
        <Kv rows={rows} />
        {missing.length > 0 && <p className="text-sm text-muted-foreground">Le falta: {missing.join(', ')}.</p>}
      </section>
      {actions.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="user-account">
          <h2 id="user-account" className="font-semibold">
            Gestión
          </h2>
          <div className="flex flex-col gap-3 *:first:border-t-0 *:first:pt-0">{actions}</div>
        </section>
      )}
      {dialog}
    </div>
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
      <section className="flex flex-col gap-3" aria-labelledby="user-children">
        <h2 id="user-children" className="font-semibold">
          Hijos
        </h2>
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {file.children.map((c) => (
            <li key={c.id}>
              <Link
                to={toFile(c.id)}
                className="flex min-h-12 items-center gap-2 py-2 ps-4 pe-3 font-medium transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none active:bg-accent"
              >
                <span className="min-w-0 truncate">{name(c)}</span>
                {c.pending_claim && <Tag variant="secondary">Mayor de edad sin reclamar</Tag>}
                <ChevronRightIcon className="ms-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
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

const BOOKING_TAG = (b: Booking): ['success' | 'warning' | 'secondary', LucideIcon] =>
  b.status === 'cancelled' ? ['secondary', BanIcon] : b.status === 'waitlisted' ? ['warning', HourglassIcon] : ['success', CircleCheckIcon]
function BookingState({ b }: { b: Booking }) {
  const [variant, Icon] = BOOKING_TAG(b)
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {stateText(b)}
    </Tag>
  )
}
const when = (b: Booking) => `${formatShortDate(b.starts_at)} · ${formatTime(b.starts_at)}`

// Móvil: filas apiladas (sin tabla cortada); desde sm, tabla con cabecera.
function BookingTable({ rows, onCancel }: { rows: Booking[]; onCancel?: (b: Booking) => void }) {
  const cancel = (b: Booking, className?: string) =>
    onCancel &&
    b.status !== 'cancelled' && (
      <Button variant="ghost" size="sm" className={className} onClick={() => onCancel(b)}>
        Cancelar
      </Button>
    )
  return (
    <>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card sm:hidden">
        {rows.map((b) => (
          <li key={b.id} className="flex min-h-16 items-center gap-3 py-2.5 ps-4 pe-2">
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="font-semibold">{b.discipline_name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">{when(b)}</span>
              <BookingState b={b} />
            </span>
            {cancel(b, 'min-h-11 px-3')}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border bg-card sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-4">Fecha</TableHead>
              <TableHead>Disciplina</TableHead>
              <TableHead>Estado</TableHead>
              {onCancel && (
                <TableHead className="pe-4">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id} className="h-11">
                <TableCell className="ps-4 tabular-nums">{when(b)}</TableCell>
                <TableCell className="font-medium">{b.discipline_name}</TableCell>
                <TableCell>
                  <BookingState b={b} />
                </TableCell>
                {onCancel && <TableCell className="pe-4 text-right">{cancel(b)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
            <Button variant="outline" className="self-start max-sm:h-11" loading={past.isFetchingNextPage} onClick={() => void past.fetchNextPage()}>
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

const TAB_LABEL: Record<UserTab, string> = { summary: 'Resumen', billing: 'Cuota', bookings: 'Reservas', family: 'Familia' }

// Mientras carga, la misma silueta que la ficha (título, volver, cabecera y pestañas): sin salto al llegar.
function FileSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5" aria-busy="true" aria-label="Cargando la ficha">
      <Skeleton className="h-10 w-56 rounded-md" />
      <Skeleton className="h-6 w-24 rounded-md" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40 rounded-md" />
          <Skeleton className="h-4 w-52 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}

// docs/pantallas-b19.md § Usuarios › Ficha. Nunca salud, edad ni fecha de nacimiento: la API no los da.
export function UserPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const refresh = useRefresh(id)
  const file = useQuery({ queryKey: fileKey(id), queryFn: () => api<ProfileFile>(`/admin/profiles/${id}`) })

  if (file.isPending) return <FileSkeleton />
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
  const tabs = userTabs(file.data)
  const tab = tabs.find((t) => t === params.get('tab')) ?? 'summary'
  const sub = file.data.subscription && isLive(file.data.subscription.status) ? file.data.subscription : null
  const summary = <Summary file={file.data} refresh={refresh} />

  return (
    <Page title={name(p)} wide actions={<AuditLink type="profile" id={p.id} />}>
      <Back to="/admin/users">Usuarios</Back>
      {/* Quién es y, si es alumno, cómo va su cuota: a la vista desde cualquier pestaña. */}
      <div className="flex items-center gap-3">
        <ProfileAvatar name={p.display_name} avatar={p.avatar} className="size-14" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag>{ROLE_LABEL[p.role]}</Tag>
            <Marks p={p} />
            {p.role === 'alumno' && <SubBadge status={sub?.status} />}
            {sub && <span className="text-sm font-medium">{sub.plan.name}</span>}
          </div>
          {p.email && <span className="text-sm break-all text-muted-foreground">{p.email}</span>}
        </div>
      </div>
      {tabs.length === 1 ? (
        summary
      ) : (
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
          <TabsList className="w-full sm:w-auto">
            {tabs.map((t) => (
              <TabsTab key={t} value={t} className="min-h-11 flex-1 px-2 sm:px-4">
                {TAB_LABEL[t]}
              </TabsTab>
            ))}
          </TabsList>
          <TabsPanel value="summary">{summary}</TabsPanel>
          {tabs.includes('billing') && (
            <TabsPanel value="billing">
              <BillingTab file={file.data} refresh={refresh} />
            </TabsPanel>
          )}
          {tabs.includes('bookings') && (
            <TabsPanel value="bookings">
              <Bookings id={p.id} />
            </TabsPanel>
          )}
          {tabs.includes('family') && (
            <TabsPanel value="family">
              <Family file={file.data} refresh={refresh} />
            </TabsPanel>
          )}
        </Tabs>
      )}
    </Page>
  )
}
