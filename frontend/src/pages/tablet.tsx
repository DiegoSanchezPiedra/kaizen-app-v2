import { CircleCheckIcon, ClockIcon, LinkIcon, MoonIcon, PlayIcon, WifiOffIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import logo from '@/assets/logo.png'
import { QrCode } from '@/components/qr-code'
import { FieldMessage, StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useNow } from '@/hooks/use-now'
import { useTabletFeed } from '@/hooks/use-tablet-feed'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { clearDeviceToken, getDeviceToken, normalizeLinkCode, rowsThatFit, sessionBadge, setDeviceToken, type TabletSession } from '@/lib/tablet'
import { cn } from '@/lib/utils'

const TZ = 'Europe/Madrid'
const dateFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' })

// La tablet está a la vista de todos y con luz variable: siempre oscura, sin mirar el sistema (pregunta b185n3).
// Puede acabar en una TV: todo va en rem y la raíz crece con el lado corto (16 px a 768, ~22 px a 1080).
export function TabletPage() {
  const [token, setToken] = useState(getDeviceToken)
  const [revoked, setRevoked] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    root.style.fontSize = 'clamp(16px, 2.08vmin, 28px)'
    return () => {
      root.style.fontSize = ''
      root.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header />
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
        <LinkForm
          revoked={revoked}
          onLinked={(t) => {
            setDeviceToken(t)
            setRevoked(false)
            setToken(t)
          }}
        />
      )}
    </div>
  )
}

// Cabecera siempre azul noche (lleva el logo blanco). La hora de Madrid se actualiza sola, sin animación.
function Header() {
  const now = useNow(10_000)
  return (
    <header className="flex h-[5.5rem] shrink-0 items-center gap-4 border-b border-white/8 bg-brand-ink px-[4vmin] text-white">
      <img src={logo} alt="Kai Zen" className="h-10 w-auto" />
      <span className="whitespace-nowrap border-l border-white/20 pl-4 font-heading text-[1.375rem] font-bold uppercase tracking-[0.06em] text-[#C9D2FF]">
        Check-in
      </span>
      <p className="ml-auto flex items-baseline gap-3">
        <span className="text-base font-medium capitalize text-[#C9D2FF] max-sm:hidden">{dateFmt.format(now).replace('.', '')}</span>
        <span className="font-heading text-[2.5rem] font-bold leading-none tabular-nums">{formatTime(new Date(now))}</span>
      </p>
    </header>
  )
}

// En horizontal, dos columnas pegadas arriba: el campo y el botón quedan por encima del teclado en pantalla.
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
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-[4vmin]">
      <Card className="h-fit w-full max-w-[60rem] gap-5 p-[clamp(1.25rem,4vmin,2.5rem)] landscape:grid landscape:grid-cols-2 landscape:gap-x-10">
        <div className="flex flex-col gap-5">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/14 text-link">
            <LinkIcon className="size-6" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-[2.5rem] font-bold leading-tight">Vincular esta tablet</h1>
            <p className="text-lg text-muted-foreground">Pide a la academia un código de vinculación. Caduca a los 15 minutos y solo vale una vez.</p>
          </div>
          {revoked && (
            <StatusAlert notice={{ kind: 'warning', icon: 'alert', title: 'Esta tablet se ha desvinculado', text: 'Pide un código nuevo a la academia.' }} />
          )}
          {offline && (
            <StatusAlert notice={{ kind: 'error', icon: 'wifi', title: 'Sin conexión', text: 'Comprueba la wifi de la tablet y vuelve a intentarlo.' }} />
          )}
        </div>
        <Form className="flex flex-col gap-5 landscape:pt-17" aria-busy={sending} errors={error ? { code: error } : {}} onFormSubmit={submit}>
          <Field name="code" className="items-stretch">
            <FieldLabel className="text-base">Código de vinculación</FieldLabel>
            <Input
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={11}
              disabled={sending}
              onChange={() => error && setError(null)}
              className="font-mono [&_input]:min-h-18 [&_input]:text-center [&_input]:text-[2.125rem] [&_input]:uppercase [&_input]:tracking-[0.2em]"
            />
            {error ? <FieldMessage>{error}</FieldMessage> : <FieldDescription className="text-base">8 letras y números. Da igual mayúsculas o minúsculas.</FieldDescription>}
          </Field>
          <Button type="submit" size="xl" className="min-h-14 w-full text-lg" loading={sending}>
            {sending ? 'Vinculando…' : 'Vincular'}
          </Button>
          <p className="text-sm text-muted-foreground">Queda vinculada hasta que la academia la desvincule. En esta pantalla no se inicia sesión.</p>
        </Form>
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

type FeedState = ReturnType<typeof useTabletFeed>

function Running({ token, onRevoked }: { token: string; onRevoked: () => void }) {
  const state = useTabletFeed(token, onRevoked)
  const wakeOk = useWakeLock()
  const paused = state.view === 'paused' || state.view === 'offline'

  return (
    <>
      <main className="grid min-h-0 flex-1 gap-[4vmin] overflow-y-auto p-[4vmin] landscape:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] landscape:grid-rows-[1fr] portrait:grid-rows-[auto_1fr]">
        <QrSlot {...state} />
        <div className="flex min-h-0 flex-col gap-[2.5vmin]">
          <h1 className="font-heading text-[2.75rem] font-extrabold italic uppercase leading-[0.95] text-balance portrait:text-center">
            {paused ? 'Check-in en pausa' : 'Escanea para hacer check-in'}
          </h1>
          {paused ? (
            <p className="text-xl portrait:text-center">Si tienes prisa, el profesor puede marcarte en la lista.</p>
          ) : (
            <>
              <ol className="flex list-none flex-col gap-2.5 p-0 portrait:self-center">
                {['Abre Kaizen en tu móvil', 'En Reservas, toca Check-in', 'Apunta la cámara a este código'].map((text, i) => (
                  <li key={text} className="flex items-center gap-3.5 text-xl font-medium">
                    <b className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/14 font-heading text-[1.1875rem] text-link">{i + 1}</b>
                    {text}
                  </li>
                ))}
              </ol>
              <SessionList sessions={state.feed?.sessions} now={state.now} />
            </>
          )}
        </div>
      </main>
      {!wakeOk && (
        <div role="status" className="enter-soft flex min-h-15 shrink-0 items-center gap-3 border-t border-warning/36 bg-warning/12 px-[4vmin] text-base">
          <MoonIcon className="size-5.5 shrink-0 text-warning-foreground" aria-hidden="true" />
          <p>
            <strong>Esta pantalla puede apagarse sola.</strong> Quita el bloqueo automático en los ajustes de la tablet.
          </p>
        </div>
      )}
    </>
  )
}

// El hueco del QR dice también el estado de la conexión, que es lo que se mira desde lejos. La columna lleva
// `container-type: size` para que el QR sea el mayor cuadrado que cabe, con la línea de estado debajo.
function QrSlot({ view, feed, retry, retryNow }: FeedState) {
  const box = 'size-[min(100cqw,calc(100cqh-3.75rem))]'
  return (
    <div className="grid min-h-0 content-start justify-items-center gap-4 [container-type:size] portrait:h-[44dvh]">
      {view === 'live' || view === 'reconnecting' ? (
        <>
          <div className={cn('rounded-[1.75rem] bg-white p-[3cqmin] shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_0_96px_-24px_rgb(47_98_255/0.55)]', box)}>
            {feed && <QrCode value={feed.qr} label="Código QR para hacer check-in" />}
          </div>
          {view === 'live' ? (
            <p key="live" role="status" className="enter-soft flex h-11 items-center gap-2.5 text-[1.375rem] font-semibold text-success-foreground">
              <CircleCheckIcon className="size-7 shrink-0" aria-hidden="true" />
              Conectada
              <span className="font-medium text-muted-foreground max-sm:hidden">· el código cambia solo</span>
            </p>
          ) : (
            <p key="re" role="status" className="enter-soft flex h-11 items-center gap-2.5 text-[1.375rem] font-semibold text-warning-foreground">
              <Spinner className="size-7 shrink-0" aria-hidden="true" />
              Reconectando…
              <span className="font-medium text-muted-foreground max-sm:hidden">el código sigue valiendo</span>
            </p>
          )}
        </>
      ) : view === 'connecting' ? (
        <div role="status" aria-busy="true" className={cn('flex flex-col items-center justify-center gap-4 rounded-[1.75rem] bg-muted text-muted-foreground', box)}>
          <Spinner className="size-10" aria-hidden="true" />
          <p className="text-[1.75rem] font-semibold">Conectando…</p>
        </div>
      ) : (
        <div key={view} role="status" className={cn('enter-soft flex flex-col items-center justify-center gap-4 rounded-[1.75rem] border-2 border-dashed border-foreground/26 bg-card p-[6cqmin] text-center', box)}>
          {view === 'offline' ? (
            <WifiOffIcon className="size-14 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Spinner className="size-14 text-warning-foreground" aria-hidden="true" />
          )}
          <p className="text-[2.25rem] font-semibold leading-tight">{view === 'offline' ? 'Sin internet' : 'Reconectando…'}</p>
          <p className="max-w-[24rem] text-lg text-muted-foreground">
            {view === 'offline'
              ? 'Revisa la wifi de la tablet. El código vuelve solo en cuanto haya conexión.'
              : 'Un código antiguo no vale: vuelve solo en cuanto se recupere la conexión.'}
          </p>
          {retry && retry.seconds > 0 && (
            <p className="text-base tabular-nums text-muted-foreground">
              Intento {retry.attempt} · el siguiente en {retry.seconds} s
            </p>
          )}
          <Button variant="outline" size="xl" className="min-h-12 px-6 text-lg" onClick={retryNow}>
            Reintentar ahora
          </Button>
        </div>
      )}
    </div>
  )
}

// Filas de alto fijo para saber cuántas caben sin scroll; si sobran, las primeras y «y N sesiones más».
function SessionList({ sessions, now }: { sessions: TabletSession[] | undefined; now: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState<{ height: number; rem: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSpace({ height: el.clientHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sorted = [...(sessions ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const shown = !space || sorted.length <= rowsThatFit(space.height, space.rem, false) ? sorted : sorted.slice(0, rowsThatFit(space.height, space.rem, true))
  const more = sorted.length - shown.length

  return (
    <section aria-labelledby="tb-sessions" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 id="tb-sessions" className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Check-in abierto
      </h2>
      <div ref={box} className="min-h-[5.5rem] flex-1 overflow-hidden">
        {!sessions ? (
          <ul aria-hidden="true" className="grid gap-3">
            {[0, 1].map((i) => (
              <li key={i} className="grid h-[5.5rem] grid-cols-[6rem_1fr] items-center gap-5 rounded-2xl border bg-card px-5">
                <Skeleton className="h-8" />
                <Skeleton className="h-8 w-3/5" />
              </li>
            ))}
          </ul>
        ) : sorted.length ? (
          <ul className="grid list-none gap-3 p-0">
            {shown.map((s) => {
              const badge = sessionBadge(s.starts_at, now)
              return (
                <li key={s.session_id} className="enter-soft grid h-[5.5rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 rounded-2xl border bg-card px-5 shadow-xs">
                  <p className="font-mono text-[2rem] font-medium leading-none tabular-nums">{formatTime(s.starts_at)}</p>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate font-heading text-[1.875rem] font-bold leading-tight">{s.discipline}</p>
                    <p className="flex items-center gap-3 text-base text-muted-foreground">
                      <Badge variant={badge.started ? 'success' : 'info'} className="h-8 gap-1.5 px-2.5 text-lg sm:h-8 sm:text-lg [&_svg]:size-4.5 sm:[&_svg]:size-4.5 [&_svg]:opacity-100">
                        {badge.started ? <PlayIcon aria-hidden="true" /> : <ClockIcon aria-hidden="true" />}
                        {badge.text}
                      </Badge>
                      <span className="tabular-nums">hasta {formatTime(s.ends_at)}</span>
                    </p>
                  </div>
                </li>
              )
            })}
            {more > 0 && (
              <li className="grid h-[3.5rem] place-items-center rounded-2xl border-2 border-dashed border-foreground/20 text-xl font-semibold text-muted-foreground">
                y {more} {more === 1 ? 'sesión más' : 'sesiones más'}
              </li>
            )}
          </ul>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-dashed border-foreground/20 px-6 py-5">
            <p className="text-2xl font-semibold leading-tight">No hay sesiones con el check-in abierto</p>
            <p className="text-lg text-muted-foreground">El check-in se abre un rato antes de cada sesión. El código sigue en marcha.</p>
          </div>
        )}
      </div>
    </section>
  )
}
