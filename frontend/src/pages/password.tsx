import { ArrowLeftIcon, ClockIcon, MailCheckIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { PasswordInput } from '@/components/password-input'
import { FieldMessage, NativeMessages, StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { errorCode } from '@/lib/notify'

const linkClass = 'inline-flex min-h-11 items-center self-center text-sm font-semibold text-link underline underline-offset-3'

// Teclado: con puntero táctil, el foco inicial abriría el teclado y taparía la pantalla.
const hasFinePointer = () => window.matchMedia('(pointer: fine)').matches

// Un estado que sustituye a todo el formulario (enviado, enlace caducado): el botón que tenía el foco desaparece,
// así que el foco pasa al título. outline-none: no es un control; solo lo recibe por código.
const headingClass = 'font-heading text-[34px] font-bold leading-tight outline-none'

function failure(err: unknown): Notice {
  const code = errorCode(err)
  return code === 'network'
    ? { kind: 'warning', icon: 'wifi', title: 'Sin conexión', text: 'Conéctate y vuelve a intentarlo.' }
    : { kind: 'error', title: errorText(code) }
}

// /forgot-password — POST /auth/password/forgot (B18.0) responde 204 exista o no la cuenta.
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)
  const [fine] = useState(hasFinePointer)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (sent) heading.current?.focus()
  }, [sent])

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
      {sent ? (
        // enter-soft: solo aquí, porque este bloque llega después de enviar (nunca con la carga de la página).
        <div className="enter-soft flex flex-col gap-4">
          <div className="grid size-13 place-items-center rounded-2xl bg-success/14 text-success-foreground">
            <MailCheckIcon className="size-6.5" aria-hidden="true" />
          </div>
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            Revisa tu correo
          </h1>
          <p>Si existe una cuenta, te hemos enviado un enlace.</p>
          <p className="text-sm text-muted-foreground">Si no lo ves en unos minutos, mira en la carpeta de spam.</p>
          <Button variant="outline" size="xl" className="w-full" render={<Link to="/login" />}>
            Volver a entrar
          </Button>
        </div>
      ) : (
        <>
          <Button variant="ghost" className="-ml-3 min-h-11 self-start" render={<Link to="/login" />}>
            <ArrowLeftIcon />
            Volver a entrar
          </Button>
          <h1 className={headingClass}>Recuperar contraseña</h1>
          <p className="text-muted-foreground">Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.</p>
          <p className="text-sm text-muted-foreground">Si es la cuenta de un menor, su contraseña la cambia su tutor desde la app.</p>
          {notice && <StatusAlert notice={notice} />}
          <Form className="flex flex-col gap-4" onFormSubmit={submit}>
            <Field name="email" className="items-stretch">
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                required
                autoFocus={fine}
              />
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

// /reset-password?token= — POST /auth/password/reset (B18.0); al acabar, a /login. Con &invite=1 es la bienvenida de quien
// da de alta el admin (ADR 0028 y 0032): la misma ruta, otro texto.
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const invite = params.get('invite') === '1'
  const [invalid, setInvalid] = useState(!token)
  // El enlace se invalida al enviar (no con la carga): solo entonces el foco pasa al título y el bloque entra con fundido.
  const [late, setLate] = useState(false)
  const [fine] = useState(hasFinePointer)
  const heading = useRef<HTMLHeadingElement>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (invalid && late) heading.current?.focus()
  }, [invalid, late])
  // El token es una credencial de un solo uso: fuera de la URL (historial, logs de proxy) en cuanto se ha leído.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname + (invite ? '?invite=1' : ''))
  }, [token, invite])
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
      const code = errorCode(err)
      if (code === 'invalid_reset_token') {
        setLate(true)
        setInvalid(true)
      } else if (code === 'weak_password') {
        setErrors({ password: errorText(code) })
        form.current?.querySelector<HTMLElement>('[name="password"]')?.focus()
      } else setNotice(failure(err))
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <AuthLayout>
        <div className={late ? 'enter-soft flex flex-col gap-4' : 'flex flex-col gap-4'}>
          <div className="grid size-13 place-items-center rounded-2xl bg-warning/16 text-warning-foreground">
            <ClockIcon className="size-6.5" aria-hidden="true" />
          </div>
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            El enlace ya no vale
          </h1>
          {invite ? (
            <p>Ha caducado o ya se ha usado. Pide a administración que te reenvíe la invitación.</p>
          ) : (
            <>
              <p>Ha caducado o ya se ha usado. Pide otro para cambiar tu contraseña.</p>
              <Button size="xl" className="w-full" render={<Link to="/forgot-password" />}>
                Pedir otro enlace
              </Button>
            </>
          )}
          <Link to="/login" className={linkClass}>
            Volver a entrar
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className={headingClass}>{invite ? 'Te damos la bienvenida' : 'Nueva contraseña'}</h1>
      <p className="text-muted-foreground">
        {invite ? 'La academia te ha dado de alta en Kaizen. Elige la contraseña con la que entrarás.' : 'Elige la contraseña con la que entrarás a partir de ahora.'}
      </p>
      {notice && <StatusAlert notice={notice} />}
      <Form ref={form} className="flex flex-col gap-4" errors={errors} onFormSubmit={submit}>
        <Field name="password" className="items-stretch">
          <FieldLabel>Nueva contraseña</FieldLabel>
          <PasswordInput autoComplete="new-password" enterKeyHint="go" required minLength={8} autoFocus={fine} />
          <NativeMessages minLength />
          {errors.password ? <FieldMessage>{errors.password}</FieldMessage> : <FieldDescription>Mínimo 8 caracteres.</FieldDescription>}
        </Field>
        <Button type="submit" size="xl" className="w-full" loading={loading}>
          {invite ? 'Crear contraseña' : 'Guardar contraseña'}
        </Button>
      </Form>
    </AuthLayout>
  )
}
