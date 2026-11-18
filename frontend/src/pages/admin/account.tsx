import { useQuery } from '@tanstack/react-query'
import { KeyRoundIcon, LogOutIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AvatarEditor } from '@/components/avatar-editor'
import { MyDataForm } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { PasswordInput } from '@/components/password-input'
import { RecoveryCodes } from '@/components/recovery-codes'
import { ErrorState } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { errorText } from '@/lib/errors'
import { logout } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { useAuthMe } from '@/lib/queries'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PasswordSection } from '@/pages/account'

const CARD = 'flex flex-col gap-4 rounded-2xl border bg-card p-5'
// Los botones y campos de los formularios compartidos (Guardar, Cambiar contraseña, Subir foto) a 44 px también con ratón,
// solo aquí (/account sigue igual); el ojo de la contraseña (aria-pressed) ya tiene su zona de 44 px.
const TALL_CONTROLS = '[&_button:not([aria-pressed])]:h-11 [&_input:not([type=file])]:h-11'

// ADR 0031: con el MFA activo, códigos nuevos; los anteriores dejan de valer. Viven solo en este estado (ni React Query ni
// almacenamiento) y el diálogo no se cierra hasta marcar «Los he guardado».
function RegenerateCodes({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [fail, setFail] = useState<'wrong_password' | 'reauth_required' | null>(null)
  const generate = (password?: string) => {
    setPending(true)
    setFail(null)
    api<{ recovery_codes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST', body: password ? { password } : undefined })
      .then(
        (r) => setCodes(r.recovery_codes),
        (err: unknown) => {
          const code = errorCode(err)
          if (code === 'wrong_password' || code === 'reauth_required') setFail(code)
          else toastError(err)
        },
      )
      .finally(() => setPending(false))
  }
  const locked = codes !== null && !saved
  return (
    <>
      <Button variant="outline" size="xl" className="sm:h-11 sm:self-start" onClick={() => setOpen(true)}>
        <KeyRoundIcon />
        Generar códigos nuevos
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => !locked && setOpen(o)}
        onOpenChangeComplete={(o) => {
          if (o) return
          setCodes(null)
          setSaved(false)
          setFail(null)
        }}
        disablePointerDismissal={codes !== null}
      >
        <DialogPopup showCloseButton={codes === null} closeProps={{ 'aria-label': 'Cerrar' }}>
          {codes ? (
            <>
              <DialogHeader>
                <DialogTitle>Tus códigos nuevos</DialogTitle>
                <DialogDescription>Si pierdes el móvil, cada uno te deja entrar una vez. Solo se ven ahora: guárdalos fuera de este dispositivo.</DialogDescription>
              </DialogHeader>
              <DialogPanel className="flex flex-col gap-3">
                <RecoveryCodes codes={codes} />
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                  <Checkbox checked={saved} onCheckedChange={(c) => setSaved(c === true)} />
                  Los he guardado
                </label>
              </DialogPanel>
              <DialogFooter>
                <Button
                  className="h-11 sm:h-11"
                  disabled={!saved}
                  onClick={() => {
                    setOpen(false)
                    toastOk('Códigos nuevos guardados', 'Los anteriores ya no valen.')
                  }}
                >
                  Hecho
                </Button>
              </DialogFooter>
            </>
          ) : fail === 'reauth_required' ? (
            <>
              <DialogHeader>
                <DialogTitle>Vuelve a entrar</DialogTitle>
                <DialogDescription>Por seguridad, para generar códigos nuevos tienes que haber entrado hace poco. Cierra la sesión y vuelve a entrar con Google.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" className="h-11 sm:h-11" />}>Ahora no</DialogClose>
                <Button className="h-11 sm:h-11" onClick={() => void logout()}>
                  Cerrar sesión
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>¿Generar códigos nuevos?</DialogTitle>
                <DialogDescription>Los códigos de recuperación que tienes dejarán de valer, también los que no hayas usado. El código de la app sigue igual.</DialogDescription>
              </DialogHeader>
              {hasPassword && (
                <DialogPanel>
                  <Form
                    id="regen-codes"
                    className="flex flex-col gap-4"
                    errors={fail === 'wrong_password' ? { password: errorText('wrong_password') } : undefined}
                    onFormSubmit={(v) => generate(String(v.password))}
                  >
                    <Field name="password" className="items-stretch">
                      <FieldLabel>Contraseña actual</FieldLabel>
                      <PasswordInput autoComplete="current-password" required autoFocus />
                      <FieldMessage match="valueMissing">Escribe tu contraseña actual.</FieldMessage>
                      {fail === 'wrong_password' && <FieldMessage>{errorText('wrong_password')}</FieldMessage>}
                    </Field>
                  </Form>
                </DialogPanel>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" className="h-11 sm:h-11" />}>Cancelar</DialogClose>
                <Button
                  className="h-11 sm:h-11"
                  loading={pending}
                  {...(hasPassword ? { type: 'submit' as const, form: 'regen-codes' } : { onClick: () => generate() })}
                >
                  Generar códigos
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogPopup>
      </Dialog>
    </>
  )
}

// Lo primero: a esto viene el admin. Sustituye aquí al aviso de MfaNotice (que sigue en el Inicio).
function MfaCard({ hasPassword }: { hasPassword: boolean | undefined }) {
  const me = useAuthMe()
  const on = me.data?.mfa_enabled === true
  return (
    <section aria-labelledby="mfa-title" className={CARD}>
      <div className="flex min-h-6.5 items-center justify-between gap-3">
        <h2 id="mfa-title" className="font-semibold">
          Doble factor
        </h2>
        {me.isPending ? (
          <Skeleton className="h-6.5 w-24" />
        ) : (
          me.data &&
          (on ? (
            <Badge variant="success" size="lg">
              <ShieldCheckIcon aria-hidden="true" />
              Activo
            </Badge>
          ) : (
            <Badge variant="warning" size="lg">
              <ShieldAlertIcon aria-hidden="true" />
              Sin activar
            </Badge>
          ))
        )}
      </div>
      {me.data && (
        <p className="text-[15px]">
          {on ? 'Al entrar, te pedimos también el código de tu app de autenticación.' : 'Protege los datos de la academia: con él, entrar pide también un código del móvil.'}
        </p>
      )}
      {me.data && !on && (
        <Button size="xl" className="sm:h-11 sm:self-start" render={<Link to="/admin/mfa" state={{ from: '/admin/account' }} />}>
          <ShieldCheckIcon />
          Activar el doble factor
        </Button>
      )}
      {on && hasPassword !== undefined && <RegenerateCodes hasPassword={hasPassword} />}
      <p className="text-sm text-muted-foreground">
        {on ? '¿Has usado o perdido los códigos de recuperación? Genera otros. ' : ''}Si pierdes el móvil y los códigos, habla con quien administra el servidor.
      </p>
    </section>
  )
}

// Cuenta del admin (b19 § Acceso): doble factor, contraseña, foto y nombre, y cerrar sesión. Sin perfil público ni push.
export function AdminAccountPage() {
  const profile = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  const [round, setRound] = useState(0) // tras cambiar la contraseña, el formulario vuelve vacío
  return (
    <Page title="Cuenta">
      <MfaCard hasPassword={profile.data?.has_password} />
      {profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <>
          <section aria-labelledby="pw-title" className={cn(CARD, TALL_CONTROLS)}>
            <h2 id="pw-title" className="font-semibold">
              Contraseña
            </h2>
            <PasswordSection key={round} onDone={() => setRound((r) => r + 1)} />
          </section>
          <section aria-labelledby="data-title" className={cn(CARD, TALL_CONTROLS)}>
            <h2 id="data-title" className="font-semibold">
              Tus datos
            </h2>
            <AvatarEditor name={profile.data?.display_name ?? null} avatar={profile.data?.avatar} />
            <MyDataForm showEmail />
          </section>
        </>
      )}
      <Button variant="outline" size="xl" className="sm:h-11" onClick={() => logout()}>
        <LogOutIcon />
        Cerrar sesión
      </Button>
    </Page>
  )
}
