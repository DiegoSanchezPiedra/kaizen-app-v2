import { ArrowLeftIcon, ClockIcon, MailCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { PasswordInput } from '@/components/password-input'
import { FieldMessage, NativeMessages, StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'

const linkClass = 'inline-flex min-h-11 items-center self-center text-sm font-semibold text-link underline underline-offset-3'

function failure(err: unknown): Notice {
  const code = err instanceof ApiError ? err.code : 'unknown'
  return code === 'network'
    ? { kind: 'warning', icon: 'wifi', title: 'Sin conexión', text: 'Conéctate y vuelve a intentarlo.' }
    : { kind: 'error', title: errorText(code) }
}

// /forgot-password — POST /auth/password/forgot (B18.0) responde 204 exista o no la cuenta.
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(v: Record<string, unknown>) {
    setLoading(true)
    setNotice(null)
    try {
      await api('/auth/password/forgot', { method: 'POST', auth: false, body: { email: v.email } })
      setSent(true)
    } catch (err) {
      setNotice(failure(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Button variant="ghost" className="-ml-3 self-start" render={<Link to="/login" />}>
        <ArrowLeftIcon />
        Volver a entrar
      </Button>
      {sent ? (
        <div className="flex flex-col gap-4" role="status">
          <div className="grid size-16 place-items-center rounded-2xl bg-success/14 text-success-foreground">
            <MailCheckIcon className="size-7.5" aria-hidden="true" />
          </div>
          <h1 className="font-heading text-[34px] font-bold leading-tight">Revisa tu correo</h1>
          <p>Si existe una cuenta, te hemos enviado un enlace.</p>
          <p className="text-sm text-muted-foreground">Si no lo ves en unos minutos, mira en la carpeta de spam.</p>
          <Button variant="outline" size="xl" className="w-full" render={<Link to="/login" />}>
            Volver a entrar
          </Button>
        </div>
      ) : (
        <>
          <h1 className="font-heading text-[34px] font-bold leading-tight">Recuperar contraseña</h1>
          <p className="text-muted-foreground">Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.</p>
          {notice && <StatusAlert notice={notice} />}
          <Form className="flex flex-col gap-4" onFormSubmit={submit}>
            <Field name="email" className="items-stretch">
              <FieldLabel>Email</FieldLabel>
              <Input type="email" autoComplete="email" inputMode="email" required autoFocus />
              <NativeMessages email />
            </Field>
            <Button type="submit" size="xl" className="w-full" loading={loading}>
              Enviar enlace
            </Button>
          </Form>
        </>
      )}
    </AuthLayout>
  )
}

// /reset-password?token= — POST /auth/password/reset (B18.0); al acabar, a /login.
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const [invalid, setInvalid] = useState(!token)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(v: Record<string, unknown>) {
    setLoading(true)
    setNotice(null)
    setErrors({})
    try {
      await api('/auth/password/reset', { method: 'POST', auth: false, body: { token, password: v.password } })
      navigate('/login?cambiada=1', { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown'
      if (code === 'invalid_reset_token') setInvalid(true)
      else if (code === 'weak_password') setErrors({ password: errorText(code) })
      else setNotice(failure(err))
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4" role="alert">
          <div className="grid size-16 place-items-center rounded-2xl bg-warning/16 text-warning-foreground">
            <ClockIcon className="size-7.5" aria-hidden="true" />
          </div>
          <h1 className="font-heading text-[34px] font-bold leading-tight">El enlace ya no vale</h1>
          <p>Ha caducado o ya se ha usado. Pide otro para cambiar tu contraseña.</p>
          <Button size="xl" className="w-full" render={<Link to="/forgot-password" />}>
            Pedir otro enlace
          </Button>
          <Link to="/login" className={linkClass}>
            Volver a entrar
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="font-heading text-[34px] font-bold leading-tight">Nueva contraseña</h1>
      <p className="text-muted-foreground">Elige la contraseña con la que entrarás a partir de ahora.</p>
      {notice && <StatusAlert notice={notice} />}
      <Form className="flex flex-col gap-4" errors={errors} onFormSubmit={submit}>
        <Field name="password" className="items-stretch">
          <FieldLabel>Nueva contraseña</FieldLabel>
          <PasswordInput autoComplete="new-password" required minLength={8} autoFocus />
          <NativeMessages minLength />
          {errors.password ? <FieldMessage>{errors.password}</FieldMessage> : <FieldDescription>Mínimo 8 caracteres.</FieldDescription>}
        </Field>
        <Button type="submit" size="xl" className="w-full" loading={loading}>
          Guardar contraseña
        </Button>
      </Form>
    </AuthLayout>
  )
}
