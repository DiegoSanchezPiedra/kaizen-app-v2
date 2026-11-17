import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon, ClockIcon, FileSignatureIcon, GlobeIcon, HeartPulseIcon, IdCardIcon, InfoIcon, KeyRoundIcon, LogOutIcon, UsersIcon, WalletIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type React from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router'
import { PasswordInput } from '@/components/password-input'
import { AvatarEditor } from '@/components/avatar-editor'
import { AgreementsPanel } from '@/components/agreements-panel'
import { HealthForm } from '@/components/health-form'
import { MyDataForm } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { PushCard } from '@/components/push-card'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { logout } from '@/lib/logout'
import { agreementsFor } from '@/lib/profile'
import { madridMonth } from '@/lib/dates'
import { minorView } from '@/lib/minor'
import { minorNotice } from '@/lib/minor-access'
import { accountBadges, list, type AccountBadge } from '@/lib/notices'
import { useClock, useMe, useProfileStatus, useSubscription } from '@/lib/queries'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { setToken, useSession } from '@/lib/session'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSubject } from '@/hooks/use-subject'

// Lo que lee el propio menor sobre su cuenta, en lenguaje sencillo (lib/minor-access.ts).
function MinorCard({ canPublish }: { canPublish: boolean }) {
  const n = minorNotice(canPublish)
  return (
    <section aria-label={n.title} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-[15px] leading-snug">
      <h2 className="text-lg font-semibold">{n.title}</h2>
      <p>{n.intro}</p>
      <ul className="list-disc space-y-1 pl-5">
        {n.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  )
}

// La insignia mantiene 14 px también desde sm (el tamaño por defecto baja a 12).
const BADGE_ICON = { warning: CircleAlertIcon, error: CircleAlertIcon, info: InfoIcon }

function Row({ to, icon: Icon, label, hint, badge }: { to: LinkProps['to']; icon: typeof IdCardIcon; label: string; hint?: string; badge?: AccountBadge }) {
  const BadgeIcon = badge && BADGE_ICON[badge.variant]
  return (
    <li className="border-b last:border-b-0">
      <Link
        to={to}
        className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none transition-colors duration-150 ease-(--ease-out) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/8 text-link dark:bg-primary/16" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          {hint && <span className="block text-[13px] text-muted-foreground">{hint}</span>}
        </span>
        {badge && BadgeIcon && (
          <Badge variant={badge.variant} className="sm:h-5.5 sm:text-sm">
            <BadgeIcon className="size-3.5" aria-hidden="true" />
            {badge.label}
          </Badge>
        )}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
    <ul className="overflow-hidden rounded-xl border bg-card">{children}</ul>
  </section>
)

// ADR 0015: nada de la API se guarda en el dispositivo. La entrada escalonada se juega una vez por sesión de la app
// (en memoria), como la del Inicio: volver a Cuenta no la repite.
let played = false

// Un bloque de Cuenta con su turno de entrada (60 ms por bloque). `empty:hidden`: un bloque que se queda sin contenido (push) no deja hueco.
function Rise({ on, i, className, children }: { on: boolean; i: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('empty:hidden', on && 'animate-rise', className)} style={on ? { animationDelay: `${i * 60}ms` } : undefined}>
      {children}
    </div>
  )
}

// «Mi registro» solo para el profesor empleado; comparte la consulta de la tarjeta de Inicio.
function ClockGroup({ on, i }: { on: boolean; i: number }) {
  const clock = useClock(madridMonth())
  if (clock.data?.profile.employment !== 'employee') return null
  return (
    <Rise on={on} i={i}>
      <Group title="Trabajo">
        <Row to="/clock" icon={ClockIcon} label="Mi registro" hint="Tus fichajes y correcciones" />
      </Group>
    </Rise>
  )
}

// Salud, acuerdos y cuota, con una palabra de aviso si algo falta. Solo se monta para alumno y tutor adultos.
function FamilyGroups({ on, i }: { on: boolean; i: number }) {
  const { withSubject, subject, profileId } = useSubject()
  const status = useProfileStatus(profileId)
  const subscription = useSubscription(profileId)
  // Con un hijo, además el estado del propio tutor (su protección de datos).
  const selfStatus = useProfileStatus(undefined)
  const badges = accountBadges({ status: status.data, subscription: subscription.data, self: profileId ? selfStatus.data : undefined })
  const kid = subjectName(subject)
  return (
    <>
      <Rise on={on} i={i}>
        <Group title={kid ? `Salud y documentos de ${kid}` : 'Salud y documentos'}>
          <Row to={withSubject('/account/health')} icon={HeartPulseIcon} label="Ficha de salud" badge={badges.health} />
          <Row to={withSubject('/agreements')} icon={FileSignatureIcon} label="Acuerdos" badge={badges.agreements} />
        </Group>
      </Rise>
      <Rise on={on} i={i + 1}>
        <Group title={kid ? `Cuota de ${kid}` : 'Cuota'}>
          <Row to={withSubject('/billing')} icon={WalletIcon} label="Mi cuota" badge={badges.billing} />
        </Group>
      </Rise>
    </>
  )
}

const ROLE = { alumno: 'Alumno', profesor: 'Profesor', tutor: 'Tutor' } as const

export function AccountPage() {
  const role = useSession()?.role
  const { options } = useSubject()
  const me = useMe()
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const family = role === 'alumno' || role === 'tutor'
  // B32: un menor con acceso propio no ve lo que su tutor lleva (cuota, acuerdos, salud, hijos, su nombre).
  const view = minorView(me.data?.minor)
  const kids = options.filter((o) => !o.self).map((o) => o.label)
  const base = me.data?.minor ? 'Alumno' : role === 'alumno' || role === 'profesor' || role === 'tutor' ? ROLE[role] : ''
  const roleLine = !kids.length ? base : role === 'tutor' ? `Tutor de ${list(kids)}` : `${base} y tutor de ${list(kids)}`
  // Cada bloque lleva su turno; los que no se pintan no lo gastan.
  let i = 0
  return (
    <Page title="Cuenta">
      <Rise on={first} i={i++}>
        <div className="rounded-2xl border bg-card p-4">
          <AvatarEditor name={me.data?.display_name ?? null} avatar={me.data?.avatar}>
            {/* Alto fijo del texto (28 + 20 + 20 px): el esqueleto no hace saltar la ficha al cargar. */}
            {me.data ? (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{me.data.display_name ?? 'Sin nombre'}</p>
                <p className="truncate text-sm text-muted-foreground">{me.data.email ?? me.data.username}</p>
                <p className="truncate text-sm font-medium text-muted-foreground">{roleLine}</p>
              </div>
            ) : (
              <Skeleton className="h-17 w-40" />
            )}
          </AvatarEditor>
        </div>
      </Rise>
      {me.data?.minor && (
        <Rise on={first} i={i++}>
          <MinorCard canPublish={me.data.minor.can_publish} />
        </Rise>
      )}
      <Rise on={first} i={i++}>
        <Group title="Tú">
          {view.ownData && <Row to="/account/data" icon={IdCardIcon} label="Mis datos" hint="Tu nombre y tu email" />}
          <Row to="/account/password" icon={KeyRoundIcon} label="Contraseña" />
          {role !== 'tutor' && view.publicProfile && <Row to="/account/profile" icon={GlobeIcon} label="Perfil público" hint="Qué ven los demás de ti" />}
          {family && view.children && <Row to="/account/children" icon={UsersIcon} label="Mis hijos" hint="Sus datos y su acceso" />}
        </Group>
      </Rise>
      {role === 'profesor' && <ClockGroup on={first} i={i++} />}
      {family && view.health && <FamilyGroups on={first} i={(i += 2) - 2} />}
      {family && (
        <Rise on={first} i={i++}>
          <PushCard place="cuenta" />
        </Rise>
      )}
      <Rise on={first} i={i++} className="mt-2">
        <Button variant="outline" size="xl" className="w-full" onClick={() => logout()}>
          <LogOutIcon />
          Cerrar sesión
        </Button>
      </Rise>
    </Page>
  )
}

function Back({ to = '/account', children = 'Cuenta' }: { to?: string; children?: React.ReactNode }) {
  return (
    <Link to={to} className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
      <ChevronLeftIcon className="size-4" aria-hidden="true" />
      {children}
    </Link>
  )
}

export function DataPage() {
  const navigate = useNavigate()
  return (
    <Page title="Mis datos">
      <Back />
      <MyDataForm showEmail onSaved={() => void navigate('/account')} />
    </Page>
  )
}

// ADR 0020: cambiar la contraseña cierra las demás sesiones; la respuesta trae el token que mantiene esta.
function PasswordForm() {
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const change = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) => api<{ token: string }>('/me/password', { method: 'POST', body }),
    onSuccess: ({ token }) => {
      setToken(token)
      toastOk('Contraseña cambiada. Se han cerrado tus otras sesiones.')
      void navigate('/account')
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'wrong_password') setErrors({ current_password: errorText(code) })
      else if (code === 'weak_password' || code === 'invalid_field') setErrors({ new_password: errorText('weak_password') })
      else toastError(err)
    },
  })
  return (
    <Form
      className="flex flex-col gap-4"
      errors={errors}
      onFormSubmit={(v) => {
        setErrors({})
        change.mutate({ current_password: String(v.current_password), new_password: String(v.new_password) })
      }}
    >
      <Field name="current_password" className="items-stretch">
        <FieldLabel>Contraseña actual</FieldLabel>
        <PasswordInput autoComplete="current-password" required />
        <FieldMessage match="valueMissing">Escribe tu contraseña actual.</FieldMessage>
        {errors.current_password && <FieldMessage>{errors.current_password}</FieldMessage>}
      </Field>
      <Field name="new_password" className="items-stretch">
        <FieldLabel>Contraseña nueva</FieldLabel>
        <PasswordInput autoComplete="new-password" required minLength={8} />
        <FieldMessage match="valueMissing">Escribe la contraseña nueva.</FieldMessage>
        <FieldMessage match="tooShort">Usa al menos 8 caracteres.</FieldMessage>
        {errors.new_password ? <FieldMessage>{errors.new_password}</FieldMessage> : <FieldDescription>Mínimo 8 caracteres.</FieldDescription>}
      </Field>
      <Button type="submit" size="xl" loading={change.isPending}>
        Cambiar contraseña
      </Button>
    </Form>
  )
}

// Una cuenta solo con Google no tiene contraseña que cambiar: la crea con el email de «restablecer».
function CreatePassword({ email }: { email: string }) {
  const create = useMutation({
    mutationFn: () => api('/auth/password/forgot', { method: 'POST', auth: false, body: { email } }),
    onSuccess: () => toastOk('Te hemos enviado un email para crearla'),
    onError: (err) => toastError(err),
  })
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">Entras con Google y aún no tienes contraseña. Te enviamos un email a {email} para que la crees.</p>
      <Button size="xl" loading={create.isPending} onClick={() => create.mutate()}>
        Crear contraseña
      </Button>
    </div>
  )
}

// También en la Cuenta del admin (pages/admin/account.tsx).
export function PasswordSection() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  if (me.isPending) return <ListSkeleton rows={2} />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  return me.data.has_password ? <PasswordForm /> : <CreatePassword email={me.data.email ?? ''} />
}

export function PasswordPage() {
  return (
    <Page title="Contraseña">
      <Back />
      <PasswordSection />
    </Page>
  )
}

export function HealthPage() {
  const navigate = useNavigate()
  return (
    <Page title="Ficha de salud">
      <Back />
      <SubjectGate>
        {({ subject, profileId }) => (
          <>
            {subjectName(subject) && <p className="text-sm font-semibold">Ficha de {subjectName(subject)}</p>}
            {/* key: al cambiar de sujeto el formulario parte de cero con la ficha del nuevo */}
            <HealthForm key={profileId ?? 'self'} profileId={profileId} onSaved={() => void navigate(-1)} />
          </>
        )}
      </SubjectGate>
    </Page>
  )
}

function Agreements({ profileId, name }: { profileId?: string; name?: string }) {
  const role = useSession()?.role ?? 'alumno'
  const status = useProfileStatus(profileId)
  // Un tutor firma además su propia protección de datos (la de él, no la del hijo).
  const own = useProfileStatus(undefined)
  const query = status.isError ? status : own
  if (status.isPending || (role === 'tutor' && own.isPending)) return <ListSkeleton rows={2} className="h-32" />
  if (query.isError && (status.isError || role === 'tutor')) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return (
    <div className="flex flex-col gap-5">
      {role === 'tutor' && own.data && (
        <section aria-label="Tus acuerdos" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Tus acuerdos</h2>
          <AgreementsPanel types={agreementsFor('tutor')} status={own.data} />
        </section>
      )}
      <section aria-label={name ? `Acuerdos de ${name}` : 'Acuerdos'} className="flex flex-col gap-3">
        {role === 'tutor' && <h2 className="text-lg font-semibold">Acuerdos de {name}</h2>}
        <AgreementsPanel types={agreementsFor('alumno')} status={status.data!} profileId={profileId} />
      </section>
    </div>
  )
}

export function AgreementsPage() {
  return (
    <Page title="Acuerdos">
      <Back />
      <SubjectGate>{({ subject, profileId }) => <Agreements key={profileId ?? 'self'} profileId={profileId} name={subjectName(subject)} />}</SubjectGate>
    </Page>
  )
}
