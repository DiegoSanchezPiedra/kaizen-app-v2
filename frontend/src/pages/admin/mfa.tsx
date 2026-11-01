import { useMutation, useQuery } from '@tanstack/react-query'
import { CopyIcon, DownloadIcon, ShieldCheckIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Page } from '@/components/page'
import { QrCode } from '@/components/qr-code'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { OTPField, OTPFieldInput, OTPFieldSeparator } from '@/components/ui/otp-field'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { queryClient } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'

type Setup = { otpauth_uri: string; recovery_codes: string[] }

const OTP_SLOT = 'h-14 w-12 sm:h-14 sm:w-12 font-mono text-2xl sm:text-2xl leading-14 sm:leading-14'

// La clave para teclearla a mano: el `secret` de la URI, en grupos de 4.
const secretOf = (uri: string): string => (new URL(uri).searchParams.get('secret') ?? '').replace(/(.{4})(?=.)/g, '$1 ')

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="enter-soft flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Paso {n} de 3</p>
      <h2 className="font-heading text-2xl font-bold">{title}</h2>
      {children}
    </section>
  )
}

// docs/pantallas-b19.md § Acceso. Cada visita pide un secreto nuevo (el anterior deja de valer); la sesión sigue tras activar.
export function MfaSetupPage() {
  const navigate = useNavigate()
  const back: string = (useLocation().state as { from?: string } | null)?.from ?? '/admin'
  const [step, setStep] = useState(1)
  const [saved, setSaved] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Una query (no un efecto) para que StrictMode no pida dos secretos; sin caché: volver aquí pide otro.
  const setup = useQuery({
    queryKey: ['mfa-setup'],
    queryFn: () => api<Setup>('/auth/mfa/setup', { method: 'POST' }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const already = setup.error instanceof ApiError && setup.error.code === 'mfa_already_enabled'
  useEffect(() => {
    if (!already) return
    void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
    navigate('/admin', { replace: true })
  }, [already, navigate])

  const activate = useMutation({
    mutationFn: (value: string) => api('/auth/mfa/activate', { method: 'POST', body: { code: value } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      toastOk('Doble factor activado', 'Desde el próximo inicio de sesión te pedirá el código.')
      navigate(back, { replace: true })
    },
    onError: (err) => {
      if (errorCode(err) === 'invalid_totp') setError(errorText('invalid_totp'))
      else toastError(err)
    },
  })
  const submit = (value: string) => {
    if (value.length === 6 && !activate.isPending) activate.mutate(value)
  }

  const codes = setup.data?.recovery_codes.join('\n') ?? ''
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`Códigos de recuperación de Kaizen (cada uno sirve una vez)\n\n${codes}\n`], { type: 'text/plain' }))
    a.download = 'kaizen-codigos-de-recuperacion.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Page
      title="Configurar el doble factor"
      actions={
        <Button variant="ghost" onClick={() => navigate(back)}>
          Ahora no
        </Button>
      }
    >
      {setup.isPending || already ? (
        <ListSkeleton rows={1} className="h-96" />
      ) : setup.isError ? (
        <ErrorState error={setup.error} onRetry={() => void setup.refetch()} />
      ) : step === 1 ? (
        <Step n={1} title="Escanea el código con tu app">
          <p className="text-muted-foreground">
            Protege la cuenta de administración con un segundo factor. Abre tu app de autenticación (Google Authenticator, 1Password…) y escanea este código.
          </p>
          <div className="size-56 self-center rounded-2xl bg-white p-2 ring-1 ring-border">
            <QrCode value={setup.data.otpauth_uri} label="Código QR para la app de autenticación" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">¿No puedes escanearlo? Escribe esta clave:</p>
            <code className="rounded-lg bg-muted px-3 py-2 font-mono text-[15px] tracking-wide break-all select-all">{secretOf(setup.data.otpauth_uri)}</code>
          </div>
          <Button size="xl" onClick={() => setStep(2)}>
            Siguiente
          </Button>
        </Step>
      ) : step === 2 ? (
        <Step n={2} title="Guarda los códigos de recuperación">
          <p className="text-muted-foreground">
            Si pierdes el móvil, cada uno de estos códigos te deja entrar una vez. Solo se ven ahora: guárdalos fuera de este ordenador.
          </p>
          <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-muted px-4 py-3 font-mono text-[15px] tracking-wide">
            {setup.data.recovery_codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(codes).then(
                  () => toastOk('Códigos copiados'),
                  () => toastError(new ApiError(0, { code: 'unknown' })),
                )
              }
            >
              <CopyIcon />
              Copiar
            </Button>
            <Button variant="outline" onClick={download}>
              <DownloadIcon />
              Descargar .txt
            </Button>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <Checkbox checked={saved} onCheckedChange={(c) => setSaved(c === true)} />
            Los he guardado
          </label>
          <Button size="xl" disabled={!saved} onClick={() => setStep(3)}>
            Siguiente
          </Button>
        </Step>
      ) : (
        <Step n={3} title="Escribe el código de la app">
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
                  <OTPFieldInput key={i} aria-invalid={!!error} className={OTP_SLOT} autoFocus={i === 0} />
                ))}
                <OTPFieldSeparator />
                {[3, 4, 5].map((i) => (
                  <OTPFieldInput key={i} aria-invalid={!!error} className={OTP_SLOT} />
                ))}
              </OTPField>
              {error && <FieldMessage>{error}</FieldMessage>}
            </Field>
            <Button type="submit" size="xl" loading={activate.isPending} disabled={code.length !== 6}>
              <ShieldCheckIcon />
              Activar
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Volver a los códigos
            </Button>
          </Form>
        </Step>
      )}
    </Page>
  )
}
