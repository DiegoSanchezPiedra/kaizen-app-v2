import { useMutation } from '@tanstack/react-query'
import { ChevronLeftIcon, CameraOffIcon, CircleCheckIcon, XIcon } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { updateAndReload } from '@/lib/sw-update'
import { formatDay, madridDay } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { errorText } from '@/lib/errors'
import { errorCode } from '@/lib/notify'
import { useSession } from '@/lib/session'

type Candidate = { booking_id: string; student_id: string; display_name: string; discipline: string; starts_at: string; checked_in_at: string | null }
type Done = Candidate & { checked_in_at: string; already: boolean }
type Result = { status: 'done'; results: Done[] } | { status: 'choose'; candidates: Candidate[] }

// Check-in a pantalla completa: la cámara lee el QR de la tablet (POST /checkin { code }). `qr-scanner` usa
// BarcodeDetector si existe y, si no (Safari de iOS), su propio lector en un worker.
export function CheckinPage() {
  const session = useSession()
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<QrScanner | null>(null)
  const code = useRef('')
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied' | 'none'>('starting')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [done, setDone] = useState<Done[] | null>(null)
  const busy = useRef(false) // síncrono: el escáner puede leer otra vez antes de que React repinte isPending
  const [notice, setNotice] = useState<Notice | null>(null)
  const [stuck, setStuck] = useState(false) // cámara en marcha 8 s sin leer nada: quizá una versión vieja (iOS)
  const [dismissed, setDismissed] = useState(false)

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
    },
    onError: (err) => {
      const c = errorCode(err)
      setCandidates(null)
      setNotice({ kind: c === 'network' ? 'warning' : 'error', icon: c === 'network' ? 'wifi' : undefined, title: errorText(c) })
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

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-brand-ink text-white">
      <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" aria-hidden="true" />
      <div className="relative flex items-center p-2 pt-[max(8px,env(safe-area-inset-top))]">
        <Button variant="ghost" size="xl" className="text-white hover:bg-white/10" render={<Link to="/bookings" />}>
          <ChevronLeftIcon />
          Reservas
        </Button>
      </div>

      {camera === 'on' && !done && !notice && (
        <div className="pointer-events-none relative flex flex-1 flex-col items-center justify-center gap-6 p-6" role="status">
          <div className="grid size-60 place-items-center rounded-3xl shadow-[0_0_0_999px_rgb(3_5_14/0.55)]">
            {send.isPending && <Spinner className="size-8" />}
          </div>
          <p className="text-center text-base font-semibold">Apunta al código QR de la tablet</p>
          {stuck && !dismissed && !send.isPending && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-card p-2 pl-4 text-sm text-card-foreground">
              ¿No detecta el código?
              <Button size="lg" onClick={() => void updateAndReload()}>Actualizar la app</Button>
              <Button size="icon-lg" variant="ghost" aria-label="Ignorar" onClick={() => setDismissed(true)}><XIcon /></Button>
            </div>
          )}
        </div>
      )}

      {camera === 'starting' && !done && !notice && (
        <p className="relative m-4 mt-auto rounded-2xl bg-card p-4 text-card-foreground" role="status">
          Abriendo la cámara… Si el navegador te lo pide, permite el acceso.
        </p>
      )}

      {camera !== 'on' && camera !== 'starting' && !done && !notice && (
        <div className="relative m-4 mt-auto flex flex-col gap-4 rounded-2xl bg-card p-5 text-card-foreground">
          <CameraOffIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-bold">{camera === 'denied' ? 'No podemos usar la cámara' : 'No encontramos cámara'}</h1>
          <p className="text-sm text-muted-foreground">
            {camera === 'denied'
              ? 'Permite el acceso a la cámara para esta página en los ajustes del navegador (el candado junto a la dirección) y vuelve a intentarlo.'
              : 'Este dispositivo no tiene cámara. Haz el check-in desde un móvil.'}
          </p>
          {camera === 'denied' && (
            <Button size="xl" onClick={() => window.location.reload()}>
              Volver a intentarlo
            </Button>
          )}
        </div>
      )}

      {notice && (
        <div className="relative m-4 mt-auto flex flex-col gap-4 rounded-2xl bg-card p-4 text-card-foreground">
          <StatusAlert notice={notice} />
          <Button size="xl" onClick={again}>
            Escanear de nuevo
          </Button>
        </div>
      )}

      {done && (
        <div className="relative m-4 mt-auto flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center text-card-foreground" role="status">
          <CircleCheckIcon className="size-12 text-success" aria-hidden="true" />
          <h1 className="font-heading text-3xl font-bold text-balance">{allAlready ? 'Ya estaba registrado' : 'Check-in hecho'}</h1>
          <ul className="flex w-full flex-col gap-2 text-base">
            {done.map((d) => (
              <li key={d.booking_id} className="text-pretty">
                {(done.length > 1 || d.student_id !== session?.id) && <span className="font-semibold">{who(d)} · </span>}
                {d.discipline} · {formatDay(madridDay(d.starts_at))} a las <span className="tabular-nums">{formatTime(d.starts_at)}</span>
                {d.already && <span className="block text-sm text-muted-foreground">Ya registrado a las <span className="tabular-nums">{formatTime(d.checked_in_at)}</span></span>}
              </li>
            ))}
          </ul>
          <Button size="xl" className="w-full" render={<Link to="/bookings" />}>
            Volver a mis reservas
          </Button>
        </div>
      )}

      {import.meta.env.DEV && !done && (
        <form
          className="relative m-4 flex gap-2 rounded-xl bg-card p-2 text-card-foreground"
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

      <Sheet open={candidates !== null} onOpenChange={(o) => !o && !send.isPending && again()}>
        <SheetPopup side="bottom">
          <SheetHeader>
            <SheetTitle>¿A quién registras?</SheetTitle>
            <SheetDescription>Hay más de una reserva con el check-in abierto.</SheetDescription>
          </SheetHeader>
          <SheetPanel className="flex flex-col gap-2">
            {candidates?.map((c) => (
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
            <Button size="xl" className="mt-2" disabled={picked.length === 0} loading={send.isPending} onClick={() => submit({ code: code.current, booking_ids: picked })}>
              {picked.length > 1 ? `Registrar a ${picked.length}` : 'Registrar'}
            </Button>
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </div>
  )
}
