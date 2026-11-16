import { useMutation } from '@tanstack/react-query'
import { CameraOffIcon, ChevronLeftIcon, CircleCheckIcon, WifiOffIcon, XIcon } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { updateAndReload } from '@/lib/sw-update'
import { formatDay, madridDay } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { errorText } from '@/lib/errors'
import { errorCode } from '@/lib/notify'
import { useSession } from '@/lib/session'

type Candidate = { booking_id: string; student_id: string; display_name: string; discipline: string; starts_at: string; checked_in_at: string | null }
type Done = Candidate & { already: boolean }
type Result = { status: 'done'; results: Done[] } | { status: 'choose'; candidates: Candidate[] }

// Con estos errores volver a escanear no arregla nada: la salida es Reservas.
const DEAD_END = ['no_candidates', 'attendance_closed']
// Las cuatro esquinas del marco del visor.
const CORNERS = ['top-0 left-0 rounded-tl-3xl border-t-4 border-l-4', 'top-0 right-0 rounded-tr-3xl border-t-4 border-r-4', 'bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4', 'bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4']

// El check-in se hace en la franja de la clase: casi siempre es hoy, y entonces basta la hora.
function When({ iso }: { iso: string }) {
  const hoy = madridDay(iso) === madridDay()
  return (
    <>
      {hoy ? 'Hoy' : formatDay(madridDay(iso))} · <span className="tabular-nums">{formatTime(iso)}</span>
    </>
  )
}

// Todos los estados comparten esta tarjeta pegada abajo, al alcance del pulgar.
function Panel({ children, role }: { children: ReactNode; role?: 'status' }) {
  const ref = useRef<HTMLDivElement>(null)
  // La tarjeta sustituye al visor (y al campo de desarrollo): el foco pasa a ella para no perderlo.
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div ref={ref} tabIndex={-1} role={role} className="enter-soft flex flex-col gap-4 rounded-2xl bg-card p-5 text-card-foreground outline-none">
      {children}
    </div>
  )
}

const Title = ({ children }: { children: ReactNode }) => <h1 className="text-xl font-semibold text-balance">{children}</h1>

// Check-in a pantalla completa: la cámara lee el QR de la tablet (POST /checkin { code }). `qr-scanner` usa
// BarcodeDetector si existe y, si no (Safari de iOS), su propio lector en un worker.
export function CheckinPage() {
  const session = useSession()
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<QrScanner | null>(null)
  const code = useRef('')
  const sheetTitle = useRef<HTMLHeadingElement>(null)
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied' | 'none'>('starting')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [done, setDone] = useState<Done[] | null>(null)
  const busy = useRef(false) // síncrono: el escáner puede leer otra vez antes de que React repinte isPending
  const [notice, setNotice] = useState<(Notice & { code: string }) | null>(null)
  const [stuck, setStuck] = useState(false) // cámara en marcha 8 s sin leer nada: quizá una versión vieja (iOS)
  const [dismissed, setDismissed] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const send = useMutation({
    mutationFn: (v: { code: string; booking_ids?: string[] }) => api<Result>('/checkin', { method: 'POST', body: v }),
    onSettled: () => {
      busy.current = false
    },
    onSuccess: (res) => {
      setNotice(null)
      if (res.status === 'choose') {
        // Nada marcado de entrada; si el QR caducó mientras elegía, se conserva lo que ya había marcado.
        const pending = new Set(res.candidates.filter((c) => !c.checked_in_at).map((c) => c.booking_id))
        setPicked((p) => p.filter((id) => pending.has(id)))
        return setCandidates(res.candidates)
      }
      setCandidates(null)
      setPicked([])
      setDone(res.results)
      if (res.results.some((r) => !r.already)) navigator.vibrate?.(10)
    },
    onError: (err) => {
      const c = errorCode(err)
      setCandidates(null)
      setNotice({ code: c, kind: c === 'network' ? 'warning' : 'error', icon: c === 'network' ? 'wifi' : undefined, title: errorText(c) })
    },
  })

  const submit = (v: { code: string; booking_ids?: string[] }) => {
    if (busy.current) return
    busy.current = true
    send.mutate(v)
  }

  const onCode = (data: string) => {
    if (busy.current) return
    scanner.current?.pause()
    code.current = data
    submit({ code: data })
  }

  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  })
  useEffect(() => {
    const el = video.current
    if (!el) return
    let cancelled = false
    const s = new QrScanner(el, (r) => onCodeRef.current(r.data), { preferredCamera: 'environment', maxScansPerSecond: 5, highlightScanRegion: false, highlightCodeOutline: false, returnDetailedScanResult: true })
    scanner.current = s
    void (async () => {
      if (!(await QrScanner.hasCamera())) return !cancelled && setCamera('none')
      try {
        await s.start()
        if (!cancelled) setCamera('on')
      } catch {
        if (!cancelled) setCamera('denied')
      }
    })()
    return () => {
      cancelled = true
      s.destroy()
      scanner.current = null
    }
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => {
      removeEventListener('online', on)
      removeEventListener('offline', off)
    }
  }, [])

  // Escaneando, sin red no tiene sentido leer (el QR caduca): se pausa y se reanuda solo al volver.
  const idle = camera === 'on' && !done && !notice && candidates === null && !send.isPending
  useEffect(() => {
    if (!idle) return
    if (online) void scanner.current?.start()
    else scanner.current?.pause()
  }, [idle, online])

  useEffect(() => {
    if (camera !== 'on') return
    const t = setTimeout(() => setStuck(true), 8000)
    return () => clearTimeout(t)
  }, [camera])

  const again = () => {
    setNotice(null)
    setDone(null)
    setCandidates(null)
    void scanner.current?.start()
  }

  const who = (c: Candidate) => (c.student_id === session?.id ? 'Tú' : c.display_name)
  const allAlready = !!done?.every((d) => d.already)
  // Pendientes primero; las que ya constan, al final y atenuadas.
  const sorted = candidates ? [...candidates.filter((c) => !c.checked_in_at), ...candidates.filter((c) => c.checked_in_at)] : []
  const pendingIds = sorted.filter((c) => !c.checked_in_at).map((c) => c.booking_id)
  const allPicked = pendingIds.length > 0 && pendingIds.every((id) => picked.includes(id))
  const scanning = idle || (camera === 'on' && send.isPending)
  const result = done || notice || camera === 'denied' || camera === 'none'

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-brand-ink text-white">
      <video ref={video} muted playsInline className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${online ? '' : 'opacity-40'}`} aria-hidden="true" />
      <div className="relative bg-linear-to-b from-brand-ink/80 to-transparent p-2 pt-[max(8px,env(safe-area-inset-top))] pb-6">
        <Button variant="ghost" size="xl" className="bg-brand-ink/60 text-white hover:bg-brand-ink/80 hover:text-white" render={<Link to="/bookings" />}>
          <ChevronLeftIcon />
          Reservas
        </Button>
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {camera === 'on' && !result && (
          <div className="relative grid size-60 place-items-center rounded-3xl shadow-[0_0_0_999px_rgb(3_5_14/0.55)]" aria-hidden="true">
            {CORNERS.map((c) => (
              <span key={c} className={`absolute size-10 border-white ${c}`} />
            ))}
            {send.isPending && <Spinner className="size-8" />}
          </div>
        )}
        {(scanning || camera === 'starting') && !result && (
          <p role="status" className="enter-soft flex max-w-xs items-center gap-2 rounded-full bg-brand-ink/80 px-4 py-2 text-center text-sm font-semibold text-balance">
            {camera === 'starting' ? (
              'Abriendo la cámara… Si el navegador te lo pide, permite el acceso.'
            ) : !online ? (
              <>
                <WifiOffIcon className="size-4 shrink-0" aria-hidden="true" />
                Sin conexión. Seguimos en cuanto vuelva.
              </>
            ) : (
              'Apunta al código QR de la tablet'
            )}
          </p>
        )}
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {camera === 'on' && !result && stuck && !dismissed && !send.isPending && (
          <div className="enter-soft flex items-center gap-2 rounded-2xl bg-card p-2 pl-4 text-sm text-card-foreground">
            ¿No detecta el código?
            <Button size="lg" onClick={() => void updateAndReload()}>Actualizar la app</Button>
            <Button size="icon-lg" variant="ghost" aria-label="Ignorar" onClick={() => setDismissed(true)}><XIcon /></Button>
          </div>
        )}

        {camera === 'denied' && !done && !notice && (
          <Panel>
            <CameraOffIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <Title>No podemos usar la cámara</Title>
            <ol className="list-decimal ps-5 text-sm text-muted-foreground">
              <li>Toca el candado junto a la dirección del navegador.</li>
              <li>Cambia «Cámara» a «Permitir».</li>
            </ol>
            <Button size="xl" onClick={() => window.location.reload()}>
              Volver a intentarlo
            </Button>
            <Button size="xl" variant="ghost" render={<Link to="/bookings" />}>
              Volver a mis reservas
            </Button>
          </Panel>
        )}

        {camera === 'none' && !done && !notice && (
          <Panel>
            <CameraOffIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <Title>No encontramos cámara</Title>
            <p className="text-sm text-muted-foreground">Este dispositivo no tiene cámara. Haz el check-in desde un móvil o pídeselo al profesor.</p>
            <Button size="xl" render={<Link to="/bookings" />}>
              Volver a mis reservas
            </Button>
          </Panel>
        )}

        {notice && (
          <Panel>
            <StatusAlert notice={notice} />
            {DEAD_END.includes(notice.code) ? (
              <>
                <Button size="xl" render={<Link to="/bookings" />}>
                  Volver a mis reservas
                </Button>
                <Button size="xl" variant="ghost" onClick={again}>
                  Escanear de nuevo
                </Button>
              </>
            ) : (
              <Button size="xl" onClick={again}>
                Escanear de nuevo
              </Button>
            )}
          </Panel>
        )}

        {done && (
          <Panel role="status">
            <div className="flex items-center gap-3">
              <CircleCheckIcon
                className={`size-9 shrink-0 transition-[opacity,scale] duration-200 ease-(--ease-out) starting:scale-90 starting:opacity-0 ${allAlready ? 'text-muted-foreground' : 'text-success'}`}
                aria-hidden="true"
              />
              <Title>{allAlready ? 'Ya estaba registrado' : 'Check-in hecho'}</Title>
            </div>
            <ul className="flex flex-col gap-3">
              {done.map((d) => (
                <li key={d.booking_id} className="flex flex-col text-pretty">
                  {(done.length > 1 || d.student_id !== session?.id) && <span className="font-semibold">{who(d)}</span>}
                  <span>
                    {d.discipline} · <When iso={d.starts_at} />
                  </span>
                  {d.already && d.checked_in_at && (
                    <span className="text-sm text-muted-foreground">
                      Registrado a las <span className="tabular-nums">{formatTime(d.checked_in_at)}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <Button size="xl" render={<Link to="/bookings" />}>
              Volver a mis reservas
            </Button>
          </Panel>
        )}

        {import.meta.env.DEV && !done && (
          <form
            className="flex gap-2 rounded-xl bg-card p-2 text-card-foreground"
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get('code')
              if (typeof v === 'string' && v) onCode(v)
            }}
          >
            <input name="code" aria-label="Código (solo en desarrollo)" placeholder="Código (solo desarrollo)" className="min-h-11 flex-1 rounded-lg border bg-background px-3 text-base" />
            <Button type="submit" size="xl">
              Enviar
            </Button>
          </form>
        )}
      </div>

      <Sheet open={candidates !== null} onOpenChange={(o) => !o && !send.isPending && again()}>
        <SheetPopup side="bottom" className="sm:mx-auto sm:max-w-md" initialFocus={sheetTitle} closeProps={{ 'aria-label': 'Cerrar' }}>
          <SheetHeader>
            <SheetTitle ref={sheetTitle} tabIndex={-1} className="font-sans font-semibold outline-none">
              ¿A quién registras?
            </SheetTitle>
            <SheetDescription>Hay más de una reserva con el check-in abierto.</SheetDescription>
          </SheetHeader>
          <SheetPanel className="flex flex-col gap-2">
            {pendingIds.length >= 3 && (
              <Button size="lg" variant="ghost" className="self-end" disabled={send.isPending} onClick={() => setPicked(allPicked ? [] : pendingIds)}>
                {allPicked ? 'Quitar selección' : 'Marcar todos'}
              </Button>
            )}
            {sorted.map((c) => (
              <label key={c.booking_id} className="flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 has-data-disabled:opacity-64">
                <Checkbox
                  checked={!!c.checked_in_at || picked.includes(c.booking_id)}
                  disabled={!!c.checked_in_at || send.isPending}
                  onCheckedChange={(on) => setPicked((p) => (on ? [...p, c.booking_id] : p.filter((id) => id !== c.booking_id)))}
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{who(c)}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.discipline} · <span className="tabular-nums">{formatTime(c.starts_at)}</span>
                    {c.checked_in_at && <> · Ya registrado a las <span className="tabular-nums">{formatTime(c.checked_in_at)}</span></>}
                  </span>
                </span>
              </label>
            ))}
          </SheetPanel>
          <SheetFooter variant="bare" className="pb-[max(24px,env(safe-area-inset-bottom))]">
            <Button size="xl" disabled={picked.length === 0} loading={send.isPending} onClick={() => submit({ code: code.current, booking_ids: picked })}>
              {picked.length > 1 ? `Registrar a ${picked.length}` : 'Registrar'}
            </Button>
          </SheetFooter>
        </SheetPopup>
      </Sheet>
    </div>
  )
}
