import { LinkIcon, MoonIcon, ScanLineIcon, WifiOffIcon } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import logo from '@/assets/logo.png'
import { FieldMessage, StatusAlert } from '@/components/status-alert'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useTabletFeed } from '@/hooks/use-tablet-feed'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { clearDeviceToken, getDeviceToken, normalizeLinkCode, sessionBadge, setDeviceToken, type View } from '@/lib/tablet'
import { cn } from '@/lib/utils'

const TZ = 'Europe/Madrid'
const dateFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' })

// La tablet está a la vista de todos y con luz variable: siempre oscura, sin mirar el sistema (pregunta b185n3).
export function TabletPage() {
  const [token, setToken] = useState(getDeviceToken)
  const [revoked, setRevoked] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => {
      document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {token ? (
        <Running
          token={token}
          onRevoked={() => {
            clearDeviceToken()
            setToken(null)
            setRevoked(true)
          }}
        />
      ) : (
        <>
          <Header />
          <LinkForm
            revoked={revoked}
            onLinked={(t) => {
              setDeviceToken(t)
              setRevoked(false)
              setToken(t)
            }}
          />
        </>
      )}
    </div>
  )
}

const PILL: Record<View, { text: string; dot: string }> = {
  connecting: { text: 'Conectando…', dot: 'bg-[#A2A9CC]' },
  live: { text: 'Conectada', dot: 'bg-[#34D399]' },
  reconnecting: { text: 'Reconectando…', dot: 'bg-[#FBBF24]' },
  paused: { text: 'Reconectando…', dot: 'bg-[#FBBF24]' },
  offline: { text: 'Sin conexión', dot: 'bg-[#A2A9CC]' },
}

// Cabecera siempre azul noche (lleva el logo blanco). La hora de Madrid se actualiza sola, sin animación.
function Header({ view }: { view?: View }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  const pill = view && PILL[view]
  return (
    <header className="flex h-22 shrink-0 items-center gap-4 border-b border-white/8 bg-brand-ink px-10 text-white">
      <img src={logo} alt="Kai Zen" className="h-10 w-auto" />
      <span className="border-l border-white/20 pl-4 font-heading text-[22px] font-bold uppercase tracking-[0.06em] text-[#C9D2FF]">
        Check-in
      </span>
      <div className="ml-auto flex items-center gap-6">
        {pill && (
          <span role="status" className="inline-flex min-h-9 items-center gap-2 rounded-full bg-white/8 px-3.5 text-[15px] font-semibold">
            <i aria-hidden="true" className={cn('size-2.5 rounded-full', pill.dot)} />
            {pill.text}
          </span>
        )}
        <p className="flex items-baseline gap-3">
          <span className="text-base font-medium capitalize text-[#C9D2FF]">{dateFmt.format(now).replace('.', '')}</span>
          <span className="font-heading text-[40px] font-bold leading-none tabular-nums">{formatTime(now)}</span>
        </p>
      </div>
    </header>
  )
}

function LinkForm({ revoked, onLinked }: { revoked: boolean; onLinked: (token: string) => void }) {
  const [sending, setSending] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(values: Record<string, unknown>) {
    const code = normalizeLinkCode(String(values.code ?? ''))
    setOffline(false)
    if (code.length !== 8) return setError('El código tiene 8 caracteres.')
    setError(null)
    setSending(true)
    try {
      const { device_token } = await api<{ device_token: string }>('/tablet/link', { method: 'POST', body: { code }, auth: false })
      onLinked(device_token)
    } catch (err) {
      const apiCode = err instanceof ApiError ? err.code : 'unknown'
      if (apiCode === 'network') setOffline(true)
      else setError(errorText(apiCode === 'invalid_link_code' ? apiCode : 'unknown'))
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-10 portrait:pt-30">
      <Card className="h-fit w-150 gap-5 p-10">
        <span className="grid size-12 place-items-center rounded-xl bg-primary/14 text-link">
          <LinkIcon className="size-6" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-[40px] font-bold leading-tight">Vincular esta tablet</h1>
          <p className="text-[17px] text-muted-foreground">Pide a la academia un código de vinculación. Caduca a los 15 minutos y solo vale una vez.</p>
        </div>
        {revoked && (
          <StatusAlert notice={{ kind: 'warning', icon: 'alert', title: 'Esta tablet se ha desvinculado', text: 'Pide un código nuevo a la academia.' }} />
        )}
        {offline && (
          <StatusAlert notice={{ kind: 'error', icon: 'wifi', title: 'Sin conexión', text: 'Comprueba la wifi de la tablet y vuelve a intentarlo.' }} />
        )}
        <Form className="flex flex-col gap-5" aria-busy={sending} errors={error ? { code: error } : {}} onFormSubmit={submit}>
          <Field name="code" className="items-stretch">
            <FieldLabel className="text-base">Código de vinculación</FieldLabel>
            <Input
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={sending}
              onChange={() => error && setError(null)}
              className="font-mono text-[34px] tracking-[0.3em] text-center *:text-center [&_input]:min-h-18 [&_input]:text-center [&_input]:text-[34px]"
            />
            {error ? <FieldMessage>{error}</FieldMessage> : <FieldDescription className="text-[15px]">8 letras y números. Da igual mayúsculas o minúsculas.</FieldDescription>}
          </Field>
          <Button type="submit" size="xl" className="min-h-14 w-full text-lg" loading={sending}>
            {sending ? 'Vinculando…' : 'Vincular'}
          </Button>
        </Form>
        <p className="text-sm text-muted-foreground">Queda vinculada hasta que la academia la desvincule. En esta pantalla no se inicia sesión.</p>
      </Card>
    </main>
  )
}

// El navegador suelta el bloqueo al ocultar la pestaña: hay que pedirlo otra vez al volver.
function useWakeLock(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    let alive = true
    async function request() {
      if (!('wakeLock' in navigator)) return setOk(false)
      try {
        lock = await navigator.wakeLock.request('screen')
        if (alive) setOk(true)
      } catch {
        if (alive) setOk(false)
      }
    }
    const visible = () => document.visibilityState === 'visible' && void request()
    void request()
    document.addEventListener('visibilitychange', visible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', visible)
      void lock?.release().catch(() => {})
    }
  }, [])
  return ok
}

// Siempre oscuro sobre blanco, también en modo oscuro: muchos lectores no leen un QR invertido.
function Qr({ code }: { code: string }) {
  const { size, data } = useMemo(() => QRCode.create(code, { errorCorrectionLevel: 'M' }).modules, [code])
  const path = useMemo(() => {
    let d = ''
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`
    return d
  }, [size, data])
  return (
    <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} shapeRendering="crispEdges" role="img" aria-label="Código QR para hacer check-in" className="block size-full">
      <path d={path} fill="#050A2E" />
    </svg>
  )
}

const QR_SIZE = 'size-[min(560px,calc(100vw-6rem))] landscape:size-[min(520px,calc(100dvh-12rem))]'

function Running({ token, onRevoked }: { token: string; onRevoked: () => void }) {
  const { view, feed, retry, retryNow, now } = useTabletFeed(token, onRevoked)
  const wakeOk = useWakeLock()
  const paused = view === 'paused' || view === 'offline'
  const sessions = [...(feed?.sessions ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  return (
    <>
      <Header view={view} />
      <main className="flex min-h-0 flex-1 items-center gap-14 overflow-y-auto px-14 py-8 portrait:flex-col portrait:gap-7 portrait:px-12 portrait:py-8 landscape:justify-center">
        <div className="grid shrink-0 place-items-center">
          {view === 'live' || view === 'reconnecting' ? (
            <div className={cn('enter-soft rounded-[28px] bg-white p-4 shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_0_96px_-24px_rgb(47_98_255/0.55)]', QR_SIZE)}>
              {feed && <Qr code={feed.qr} />}
            </div>
          ) : view === 'connecting' ? (
            <div aria-busy="true" className={cn('flex flex-col items-center justify-center gap-3.5 rounded-[28px] bg-muted text-muted-foreground', QR_SIZE)}>
              <Spinner className="size-8" aria-hidden="true" />
              <p className="font-heading text-2xl font-bold">Conectando…</p>
            </div>
          ) : (
            <div className={cn('enter-soft flex flex-col items-center justify-center gap-3.5 rounded-[28px] border-2 border-dashed border-foreground/26 bg-card p-12 text-center', QR_SIZE)}>
              <ScanLineIcon className="size-16 text-muted-foreground" aria-hidden="true" />
              <p className="font-heading text-4xl font-bold leading-tight">Código en pausa</p>
              <p className="max-w-85 text-lg text-muted-foreground">Un código antiguo no vale. Vuelve solo en cuanto se recupere la conexión.</p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6 portrait:w-full landscape:flex-1">
          <h1 className="font-heading text-[52px] font-extrabold italic uppercase leading-[0.95] portrait:text-center portrait:text-5xl">
            {paused ? 'Check-in en pausa' : 'Escanea para hacer check-in'}
          </h1>

          {(view === 'reconnecting' || view === 'paused') && (
            <Alert variant="warning" role="status" className="enter-soft items-center text-base has-[>svg]:grid-cols-[1.25rem_1fr_auto] [&>svg]:size-5">
              <Spinner className="size-5 text-warning-foreground" aria-hidden="true" />
              <AlertTitle className="text-[17px]">Reconectando…</AlertTitle>
              {view === 'paused' && (
                <Button variant="outline" size="xl" className="row-span-2 col-start-3 row-start-1" onClick={retryNow}>
                  Reintentar ahora
                </Button>
              )}
              {retry && <AlertDescription className="col-start-2 text-base">Intento {retry.attempt} · el siguiente en {retry.seconds} s</AlertDescription>}
            </Alert>
          )}
          {view === 'offline' && (
            <Alert role="status" className="enter-soft items-center text-base has-[>svg]:grid-cols-[1.25rem_1fr_auto] [&>svg]:size-5">
              <WifiOffIcon />
              <AlertTitle className="text-[17px]">La tablet no tiene internet</AlertTitle>
              <Button variant="outline" size="xl" className="row-span-2 col-start-3 row-start-1" onClick={retryNow}>
                Reintentar ahora
              </Button>
              <AlertDescription className="col-start-2 text-base">Revisa la wifi. El código vuelve solo en cuanto haya conexión.</AlertDescription>
            </Alert>
          )}
          {paused && <p className="text-xl">Si tienes prisa, el profesor puede marcarte en la lista.</p>}

          {!paused && (
            <>
              <ol className="flex list-none flex-col gap-2.5 p-0 portrait:self-center">
                {['Abre Kaizen en tu móvil', 'En Reservas, toca Check-in', 'Apunta la cámara a este código'].map((text, i) => (
                  <li key={text} className="flex items-center gap-3.5 text-xl font-medium">
                    <b className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/14 font-heading text-[19px] text-link">{i + 1}</b>
                    {text}
                  </li>
                ))}
              </ol>
              <section aria-labelledby="tb-sessions" className="flex flex-col gap-3">
                <h2 id="tb-sessions" className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Check-in abierto
                </h2>
                {!feed ? (
                  <ul aria-hidden="true" className="grid gap-3">
                    {[0, 1].map((i) => (
                      <li key={i} className="grid min-h-21 grid-cols-[88px_1fr] items-center gap-4 rounded-2xl border bg-card px-5">
                        <Skeleton className="h-7" />
                        <Skeleton className="h-7 w-3/5" />
                      </li>
                    ))}
                  </ul>
                ) : sessions.length ? (
                  <ul className="grid list-none gap-3 p-0">
                    {sessions.map((s) => {
                      const badge = sessionBadge(s.starts_at, now)
                      return (
                        <li key={s.session_id} className="grid min-h-21 grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-x-4.5 rounded-2xl border bg-card px-5 py-3 shadow-xs">
                          <p className="font-mono text-[28px] font-medium leading-tight tabular-nums">
                            {formatTime(s.starts_at)}
                            <span className="block text-[15px] font-normal text-muted-foreground">{formatTime(s.ends_at)}</span>
                          </p>
                          <p className="truncate font-heading text-[32px] font-bold leading-tight">{s.discipline}</p>
                          <Badge variant={badge.started ? 'outline' : 'info'} className="h-7.5 px-3 text-sm">
                            {badge.text}
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-dashed border-foreground/20 px-6 py-5">
                    <p className="font-heading text-[28px] font-bold leading-tight">No hay sesiones con el check-in abierto</p>
                    <p className="text-[17px] text-muted-foreground">El check-in se abre un rato antes de cada sesión. El código sigue en marcha.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
      {!wakeOk && (
        <div role="status" className="enter-soft flex min-h-15 shrink-0 items-center gap-3 border-t border-warning/36 bg-warning/12 px-10 text-base">
          <MoonIcon className="size-5.5 shrink-0 text-warning-foreground" aria-hidden="true" />
          <p>
            <strong>Esta pantalla puede apagarse sola.</strong> Quita el bloqueo automático en los ajustes de la tablet.
          </p>
        </div>
      )}
    </>
  )
}
