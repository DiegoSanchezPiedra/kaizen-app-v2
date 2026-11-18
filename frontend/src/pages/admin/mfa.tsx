import { CheckIcon, CopyIcon, DownloadIcon, ShieldCheckIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { PasswordInput } from '@/components/password-input'
import { QrCode } from '@/components/qr-code'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { OTPField, OTPFieldInput, OTPFieldSeparator } from '@/components/ui/otp-field'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { logout, queryClient } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { setToken } from '@/lib/session'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'

type Setup = { otpauth_uri: string; recovery_codes: string[] }
// El secreto y los códigos viven solo en este estado: no pasan por React Query (ni su caché) ni por el almacenamiento.
type Load = { status: 'idle' | 'loading' } | { status: 'ok'; data: Setup } | { status: 'error'; error: unknown }

const OTP_SLOT = 'h-14 w-12 sm:h-14 sm:w-12 font-mono text-2xl sm:text-2xl leading-14 sm:leading-14'
const TALL = 'h-11 sm:h-11'
const STEPS = ['Escanear', 'Códigos', 'Activar']

// La clave para teclearla a mano: el `secret` de la URI, en grupos de 4.
const secretOf = (uri: string): string => (new URL(uri).searchParams.get('secret') ?? '').replace(/(.{4})(?=.)/g, '$1 ')

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="Pasos" className="grid grid-cols-3 gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const now = n === current
        return (
          <li key={label} aria-current={now ? 'step' : undefined} className="flex flex-col gap-2">
            <span aria-hidden="true" className={cn('h-1 rounded-full bg-border transition-colors duration-300 ease-(--ease-out)', n <= current && 'bg-primary')} />
            <span className={cn('flex items-center gap-1 text-sm transition-colors duration-300', now ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {done ? <CheckIcon aria-hidden="true" className="size-4 text-primary" /> : <span className="tabular-nums">{n}.</span>}
              {label}
              {done && <span className="sr-only">(hecho)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// `focus`: al cambiar de paso, el foco va al título (el botón pulsado desaparece con el paso anterior).
function Step({ title, focus, children }: { title: string; focus?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <section aria-labelledby="step-title" className="enter-soft flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <h2 id="step-title" ref={ref} tabIndex={-1} className="text-xl font-semibold outline-none">
        {title}
      </h2>
      {children}
    </section>
  )
}

// docs/pantallas-b19.md § Acceso. Cada visita pide un secreto nuevo (el anterior deja de valer); la sesión sigue tras activar
// y las demás se cierran (ADR 0020). B20: empezar pide la contraseña, o un login reciente si la cuenta solo entra con Google.
export function MfaSetupPage() {
  const navigate = useNavigate()
  const back: string = (useLocation().state as { from?: string } | null)?.from ?? '/admin'
  const [step, setStep] = useState(1)
  const [saved, setSaved] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState<string | undefined>()
  const [load, setLoad] = useState<Load>({ status: 'idle' })
  const [manualCopy, setManualCopy] = useState(false)
  const started = useRef(false) // StrictMode repite el efecto: sin esto, dos secretos
  const done = useRef(false)
  const firstSlot = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLOListElement>(null)

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  const hasPassword = me.data?.has_password === true

  const request = (pw?: string) =>
    api<Setup>('/auth/mfa/setup', { method: 'POST', body: pw ? { password: pw } : undefined }).then(
      (data) => setLoad({ status: 'ok', data }),
      (err: unknown) => {
        if (errorCode(err) !== 'mfa_already_enabled') return setLoad({ status: 'error', error: err })
        void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
        toastOk('El doble factor ya está activo')
        navigate(back, { replace: true })
      },
    )
  const start = (pw?: string) => {
    setLoad({ status: 'loading' })
    void request(pw)
  }
  // Solo Google: sin contraseña que pedir, empieza al abrir.
  useEffect(() => {
    if (!me.isSuccess || me.data.has_password || started.current) return
    started.current = true
    void request()
  })

  const failed = load.status === 'error' ? load.error : null
  const wrongPassword = errorCode(failed) === 'wrong_password'
  const askPassword = hasPassword && load.status !== 'ok' && (load.status !== 'error' || wrongPassword)

  // Pasos 2 y 3: salir tira los códigos (solo se ven aquí) y el secreto.
  const guard = load.status === 'ok' && step >= 2
  const blocker = useBlocker(({ currentLocation, nextLocation }) => guard && !done.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!guard) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [guard])

  const activate = useMutation({
    mutationFn: (value: string) => api<{ token: string }>('/auth/mfa/activate', { method: 'POST', body: { code: value } }),
    onSuccess: async ({ token }) => {
      done.current = true
      setToken(token)
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      toastOk('Doble factor activado', 'Se han cerrado tus otras sesiones. Desde el próximo inicio de sesión te pedirá el código.')
      navigate(back, { replace: true })
    },
    onError: (err) => {
      if (errorCode(err) !== 'invalid_totp') return toastError(err)
      setError(errorText('invalid_totp'))
      setCode('') // se reintenta sin borrar seis casillas
      firstSlot.current?.focus()
    },
  })
  const submit = (value: string) => {
    if (value.length === 6 && !activate.isPending) activate.mutate(value)
  }

  const codes = load.status === 'ok' ? load.data.recovery_codes.join('\n') : ''
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(codes))
      .then(
        () => toastOk('Códigos copiados'),
        () => {
          // Sin permiso o sin HTTPS: se dejan seleccionados para copiarlos a mano.
          if (list.current) window.getSelection()?.selectAllChildren(list.current)
          setManualCopy(true)
        },
      )
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`Códigos de recuperación de Kaizen (cada uno sirve una vez)\n\n${codes}\n`], { type: 'text/plain' }))
    a.download = 'kaizen-codigos-de-recuperacion.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  let body: React.ReactNode
  if (me.isError) body = <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  else if (askPassword)
    body = (
      <Step title="Confirma que eres tú">
        <p className="text-muted-foreground">Escribe tu contraseña para empezar a configurar el doble factor.</p>
        <Form
          className="flex flex-col gap-4"
          errors={wrongPassword ? { password: errorText('wrong_password') } : undefined}
          onFormSubmit={(v) => {
            setPassword(String(v.password))
            start(String(v.password))
          }}
        >
          <Field name="password" className="items-stretch">
            <FieldLabel>Contraseña actual</FieldLabel>
            <PasswordInput autoComplete="current-password" required autoFocus />
            <FieldMessage match="valueMissing">Escribe tu contraseña actual.</FieldMessage>
            {wrongPassword && <FieldMessage>{errorText('wrong_password')}</FieldMessage>}
          </Field>
          <Button type="submit" size="xl" className="sm:h-11" loading={load.status === 'loading'}>
            Seguir
          </Button>
        </Form>
      </Step>
    )
  else if (errorCode(failed) === 'reauth_required')
    body = (
      <Step title="Vuelve a entrar">
        <p className="text-muted-foreground">
          Por seguridad, para activar el doble factor tienes que haber entrado hace poco. Cierra la sesión y vuelve a entrar con Google.
        </p>
        <Button size="xl" className="sm:h-11" onClick={() => void logout()}>
          Cerrar sesión
        </Button>
      </Step>
    )
  else if (load.status === 'error') body = <ErrorState error={load.error} onRetry={() => start(password)} />
  else if (load.status !== 'ok') body = <ListSkeleton rows={1} className="h-96" />
  else
    body = (
      <>
        <Steps current={step} />
        {step === 1 ? (
          <Step key={1} title="Escanea el código con tu app" focus={hasPassword}>
            <p className="text-muted-foreground">
              Protege la cuenta de administración con un segundo factor. Abre tu app de autenticación (Google Authenticator, 1Password…) y escanea este código.
            </p>
            <div className="size-56 self-center rounded-2xl bg-white p-2 ring-1 ring-border">
              <QrCode value={load.data.otpauth_uri} label="Código QR para la app de autenticación" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">¿No puedes escanearlo? Escribe esta clave:</p>
              <code className="rounded-lg bg-muted px-3 py-2 font-mono text-[15px] tracking-wide break-all select-all">{secretOf(load.data.otpauth_uri)}</code>
            </div>
            <Button size="xl" className="sm:h-11" onClick={() => setStep(2)}>
              Siguiente
            </Button>
          </Step>
        ) : step === 2 ? (
          <Step key={2} title="Guarda los códigos de recuperación" focus>
            <p className="text-muted-foreground">
              Si pierdes el móvil, cada uno de estos códigos te deja entrar una vez. Solo se ven ahora: guárdalos fuera de este dispositivo.
            </p>
            <ol ref={list} className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-muted px-4 py-3 font-mono text-[15px] tracking-wide">
              {load.data.recovery_codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button variant="outline" className={TALL} onClick={() => void copy()}>
                  <CopyIcon />
                  Copiar
                </Button>
                <Button variant="outline" className={TALL} onClick={download}>
                  <DownloadIcon />
                  Descargar .txt
                </Button>
              </div>
              {manualCopy && (
                <p role="status" className="text-sm text-muted-foreground">
                  No se han podido copiar solos: ya están seleccionados, cópialos con el menú o el teclado.
                </p>
              )}
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
              <Checkbox checked={saved} onCheckedChange={(c) => setSaved(c === true)} />
              Los he guardado
            </label>
            <Button size="xl" className="sm:h-11" disabled={!saved} onClick={() => setStep(3)}>
              Siguiente
            </Button>
          </Step>
        ) : (
          <Step key={3} title="Escribe el código de la app">
            <p className="text-muted-foreground">Escribe el código de 6 dígitos que ves ahora en la app para activarlo.</p>
            <Form className="flex flex-col gap-4" errors={error ? { code: error } : undefined} onFormSubmit={() => submit(code)}>
              <Field name="code" className="items-stretch">
                <FieldLabel>Código</FieldLabel>
                <OTPField
                  length={6}
                  value={code}
                  onValueChange={(v) => {
                    setCode(v)
                    setError(null)
                  }}
                  onValueComplete={submit}
                  validationType="numeric"
                  autoComplete="one-time-code"
                  className="justify-between sm:justify-start sm:gap-2"
                >
                  {[0, 1, 2].map((i) => (
                    <OTPFieldInput key={i} ref={i === 0 ? firstSlot : undefined} aria-invalid={!!error} className={OTP_SLOT} autoFocus={i === 0} />
                  ))}
                  <OTPFieldSeparator />
                  {[3, 4, 5].map((i) => (
                    <OTPFieldInput key={i} aria-invalid={!!error} className={OTP_SLOT} />
                  ))}
                </OTPField>
                {error && <FieldMessage>{error}</FieldMessage>}
              </Field>
              <Button type="submit" size="xl" className="sm:h-11" loading={activate.isPending} disabled={code.length !== 6}>
                <ShieldCheckIcon />
                Activar
              </Button>
              <Button variant="ghost" className={TALL} onClick={() => setStep(2)}>
                Volver a los códigos
              </Button>
            </Form>
          </Step>
        )}
      </>
    )

  return (
    <Page
      title="Configurar el doble factor"
      actions={
        <Button variant="ghost" className={TALL} onClick={() => navigate(back)}>
          Ahora no
        </Button>
      }
    >
      {body}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="¿Salir sin activar?"
        description="Los códigos de recuperación y el código QR dejarán de valer: tendrás que empezar de nuevo."
        confirmLabel="Salir sin activar"
        cancelLabel="Seguir aquí"
        onConfirm={() => blocker.proceed?.()}
      />
    </Page>
  )
}
