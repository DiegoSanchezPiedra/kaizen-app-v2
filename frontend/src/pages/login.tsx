import { ArrowLeftIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { GoogleButton, googleEnabled } from '@/components/google-button'
import { PasswordInput } from '@/components/password-input'
import { FieldMessage, NativeMessages, StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { OTPField, OTPFieldInput, OTPFieldSeparator } from '@/components/ui/otp-field'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { setToken } from '@/lib/session'

type AuthResponse = { token: string } | { mfa_required: true; mfa_token: string }

function loginNotice(code: string): Notice {
  switch (code) {
    case 'link_required':
      return { kind: 'info', title: 'Ya hay una cuenta con ese email', text: 'Entra con tu contraseña.' }
    case 'invalid_mfa_token':
      return { kind: 'warning', icon: 'clock', title: 'El código ha caducado', text: 'Vuelve a entrar.' }
    case 'network':
      return { kind: 'warning', icon: 'wifi', title: 'Sin conexión', text: 'Conéctate y vuelve a intentarlo.' }
    case 'invalid_credentials':
      return { kind: 'error', title: 'El email o la contraseña no son correctos', text: 'Revísalos e inténtalo de nuevo.' }
    case 'invalid_google_token':
      return { kind: 'error', title: 'No hemos podido entrar con Google', text: 'Inténtalo de nuevo o entra con tu email.' }
    default:
      return { kind: 'error', title: errorText(code) }
  }
}

export function LoginPage() {
  const [params] = useSearchParams()
  const [mfaToken, setMfaToken] = useState<string | null>(null) // ADR 0014: el mfa_token solo en memoria
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(() =>
    params.get('caducada')
      ? { kind: 'info', icon: 'clock', title: 'Tu sesión ha caducado', text: 'Vuelve a entrar y seguirás donde estabas.' }
      : params.get('cambiada')
        ? { kind: 'success', title: 'Contraseña cambiada', text: 'Ya puedes entrar con la nueva.' }
        : null,
  )

  function finish(res: AuthResponse) {
    if ('mfa_required' in res) {
      setNotice(null)
      setMfaToken(res.mfa_token)
      return
    }
    setToken(res.token) // PublicOnly lleva a ?volver= o al inicio
  }

  async function run(path: string, body: unknown) {
    setLoading(true)
    setNotice(null)
    try {
      finish(await api<AuthResponse>(path, { method: 'POST', body, auth: false }))
    } catch (err) {
      setNotice(loginNotice(err instanceof ApiError ? err.code : 'unknown'))
    } finally {
      setLoading(false)
    }
  }

  if (mfaToken) {
    return (
      <MfaStep
        mfaToken={mfaToken}
        onDone={finish}
        onExpired={() => {
          setMfaToken(null)
          setNotice(loginNotice('invalid_mfa_token'))
        }}
        onBack={() => setMfaToken(null)}
      />
    )
  }

  return (
    <AuthLayout hero="tall">
      <h1 className="font-heading text-[34px] font-bold leading-tight">Entrar</h1>
      {notice && <StatusAlert notice={notice} />}
      <Form
        className="flex flex-col gap-4"
        aria-busy={loading}
        onFormSubmit={(v) => run('/auth/login', { email: v.email, password: v.password })}
      >
        <Field name="email" className="items-stretch">
          <FieldLabel>Email</FieldLabel>
          <Input type="email" autoComplete="email" inputMode="email" placeholder="tu@email.com" required autoFocus />
          <NativeMessages email />
        </Field>
        <Field name="password" className="items-stretch gap-1">
          <FieldLabel className="mb-1">Contraseña</FieldLabel>
          <PasswordInput autoComplete="current-password" required />
          <NativeMessages />
          <Link
            to="/forgot-password"
            className="inline-flex min-h-11 items-center self-end text-sm font-semibold text-link underline underline-offset-3"
          >
            ¿Has olvidado tu contraseña?
          </Link>
        </Field>
        <Button type="submit" size="xl" className="w-full" loading={loading}>
          Entrar
        </Button>
      </Form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            o
          </div>
          <GoogleButton disabled={loading} onCredential={(idToken) => run('/auth/google', { id_token: idToken })} />
        </>
      )}
      <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        ¿No tienes cuenta?
        <Link to="/register" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-3">
          Crear cuenta
        </Link>
      </p>
    </AuthLayout>
  )
}

function MfaStep({
  mfaToken,
  onDone,
  onExpired,
  onBack,
}: {
  mfaToken: string
  onDone: (r: AuthResponse) => void
  onExpired: () => void
  onBack: () => void
}) {
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)

  async function verify(value: string) {
    if (!value || loading) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      onDone(await api<AuthResponse>('/auth/mfa/verify', { method: 'POST', body: { mfa_token: mfaToken, code: value }, auth: false }))
    } catch (err) {
      const c = err instanceof ApiError ? err.code : 'unknown'
      if (c === 'invalid_mfa_token') return onExpired()
      // El texto del mapa habla de la app; con un código de recuperación, lo propio de ese modo.
      if (c === 'invalid_mfa_code') setError(recovery ? 'El código no es correcto o ya se ha usado.' : errorText(c))
      else setNotice(loginNotice(c))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Button variant="ghost" className="-ml-3 self-start" onClick={onBack}>
        <ArrowLeftIcon />
        Volver
      </Button>
      <div className="grid size-13 place-items-center rounded-2xl bg-primary/12 text-link">
        <ShieldCheckIcon className="size-6.5" aria-hidden="true" />
      </div>
      <h1 className="font-heading text-[34px] font-bold leading-tight">Verificación en dos pasos</h1>
      {notice && <StatusAlert notice={notice} />}
      <Form
        className="flex flex-col gap-4"
        // Escribir borra el error: con él puesto, el Form de Base UI no deja enviar.
        errors={error ? { code: error } : undefined}
        onFormSubmit={() => verify(code)}
      >
        {recovery ? (
          <>
            <p className="text-muted-foreground">Escribe uno de los códigos de recuperación que guardaste al activar la verificación.</p>
            <Field name="code" className="items-stretch">
              <FieldLabel>Código de recuperación</FieldLabel>
              <Input
                className="font-mono uppercase tracking-[0.12em]"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={10}
                placeholder="10 caracteres"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.trim().toUpperCase())
                  setError(null)
                }}
                autoFocus
              />
              {error ? <FieldMessage>{error}</FieldMessage> : <FieldDescription>Cada código sirve una sola vez.</FieldDescription>}
            </Field>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">Escribe el código de 6 dígitos de tu app de autenticación.</p>
            <Field name="code" className="items-stretch">
              <FieldLabel>Código</FieldLabel>
              <OTPField
                length={6}
                value={code}
                onValueChange={(v) => {
                  setCode(v)
                  setError(null)
                }}
                onValueComplete={verify}
                validationType="numeric"
                autoComplete="one-time-code"
                className="justify-between"
              >
                {[0, 1, 2].map((i) => (
                  <OTPFieldInput key={i} aria-invalid={!!error} className={OTP_SLOT} autoFocus={i === 0} />
                ))}
                <OTPFieldSeparator />
                {[3, 4, 5].map((i) => (
                  <OTPFieldInput key={i} aria-invalid={!!error} className={OTP_SLOT} />
                ))}
              </OTPField>
              {error && <FieldMessage>{error}</FieldMessage>}
            </Field>
          </>
        )}
        <Button type="submit" size="xl" className="w-full" loading={loading}>
          Verificar
        </Button>
      </Form>
      <button
        type="button"
        className="inline-flex min-h-11 items-center self-center text-sm font-semibold text-link underline underline-offset-3"
        onClick={() => {
          setRecovery((r) => !r)
          setCode('')
          setError(null)
        }}
      >
        {recovery ? 'Usar el código de la app' : 'Usar un código de recuperación'}
      </button>
    </AuthLayout>
  )
}

const OTP_SLOT = 'h-14 w-12 sm:h-14 sm:w-12 font-mono text-2xl sm:text-2xl leading-14 sm:leading-14'
