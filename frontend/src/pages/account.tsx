import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, FileSignatureIcon, GlobeIcon, HeartPulseIcon, IdCardIcon, KeyRoundIcon, LogOutIcon, UsersIcon, WalletIcon } from 'lucide-react'
import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { logout } from '@/lib/logout'
import { agreementsFor } from '@/lib/profile'
import { useProfileStatus } from '@/lib/queries'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { setToken, useSession } from '@/lib/session'
import type { Me } from '@/lib/types'
import { useSubject } from '@/hooks/use-subject'

function Row({ to, icon: Icon, label, hint }: { to: LinkProps['to']; icon: typeof IdCardIcon; label: string; hint?: string }) {
  return (
    <li className="border-b last:border-b-0">
      <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          {hint && <span className="block text-[13px] text-muted-foreground">{hint}</span>}
        </span>
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

export function AccountPage() {
  const role = useSession()?.role
  const { withSubject } = useSubject()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  const family = role === 'alumno' || role === 'tutor'
  return (
    <Page title="Cuenta">
      <div className="rounded-2xl border bg-card p-4">
        <AvatarEditor name={me.data?.display_name ?? null} avatar={me.data?.avatar}>
          <div className="min-w-0">
            {me.isPending ? <Skeleton className="h-10 w-40" /> : <p className="truncate font-semibold">{me.data?.display_name ?? 'Sin nombre'}</p>}
            {me.data && <p className="truncate text-sm text-muted-foreground">{me.data.email}</p>}
          </div>
        </AvatarEditor>
      </div>
      <Group title="Tú">
        <Row to="/account/data" icon={IdCardIcon} label="Mis datos" />
        <Row to="/account/password" icon={KeyRoundIcon} label="Contraseña" />
        {role !== 'tutor' && <Row to="/account/profile" icon={GlobeIcon} label="Perfil público" hint="Qué ven los demás de ti" />}
        {family && <Row to="/account/children" icon={UsersIcon} label="Mis hijos" />}
      </Group>
      {role === 'profesor' && (
        <Group title="Trabajo">
          <Row to="/clock" icon={ClockIcon} label="Mi registro" hint="Tus fichajes y correcciones" />
        </Group>
      )}
      {family && (
        <Group title="Salud y documentos">
          <Row to={withSubject('/account/health')} icon={HeartPulseIcon} label="Ficha de salud" />
          <Row to={withSubject('/agreements')} icon={FileSignatureIcon} label="Acuerdos" />
        </Group>
      )}
      {family && (
        <Group title="Cuota">
          <Row to={withSubject('/billing')} icon={WalletIcon} label="Mi cuota" />
        </Group>
      )}
      {family && <PushCard place="cuenta" />}
      <Button variant="outline" size="xl" onClick={() => logout()}>
        <LogOutIcon />
        Cerrar sesión
      </Button>
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
  return me.data.has_password ? <PasswordForm /> : <CreatePassword email={me.data.email} />
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
