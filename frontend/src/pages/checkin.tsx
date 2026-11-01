import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, CameraOffIcon, CircleCheckIcon } from 'lucide-react'
import QrScanner from 'qr-scanner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { formatDay, madridDay } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { errorText } from '@/lib/errors'
import { errorCode } from '@/lib/notify'
import { bookingsOf } from '@/lib/queries'
import { useSession } from '@/lib/session'

type Candidate = { booking_id: string; student_id: string; display_name: string; discipline: string; starts_at: string }
type Result = { status: 'checked_in'; booking_id: string; session_id: string; student_id: string } | { status: 'choose'; candidates: Candidate[] }

// Check-in a pantalla completa: la cámara lee el QR de la tablet (POST /checkin { code }). `qr-scanner` usa
// BarcodeDetector si existe y, si no (Safari de iOS), su propio lector en un worker.
export function CheckinPage() {
  const session = useSession()
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<QrScanner | null>(null)
  const code = useRef('')
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied' | 'none'>('starting')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [done, setDone] = useState<{ booking_id: string; student_id: string; picked?: Candidate } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const send = useMutation({
    mutationFn: (v: { code: string; booking_id?: string }) => api<Result>('/checkin', { method: 'POST', body: v }),
    onSuccess: (res, v) => {
      setNotice(null)
      if (res.status === 'choose') return setCandidates(res.candidates)
      setCandidates(null)
      setDone({ booking_id: res.booking_id, student_id: res.student_id, picked: candidates?.find((c) => c.booking_id === v.booking_id) })
    },
    onError: (err) => {
      const c = errorCode(err)
      setCandidates(null)
      setNotice({ kind: c === 'network' ? 'warning' : 'error', icon: c === 'network' ? 'wifi' : undefined, title: errorText(c) })
    },
  })

  const onCode = useCallback((data: string) => {
    if (send.isPending) return
    scanner.current?.pause()
    code.current = data
    send.mutate({ code: data })
  }, [send])

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

  const again = () => {
    setNotice(null)
    setDone(null)
    setCandidates(null)
    void scanner.current?.start()
  }

  // Sin candidata elegida, la disciplina y la hora salen de las reservas de hoy.
  const lookup = useQuery({
    queryKey: ['bookings', 'checkin', done?.booking_id],
    enabled: !!done && !done.picked,
    queryFn: () =>
      bookingsOf(done!.student_id === session?.id ? undefined : done!.student_id, madridDay(), madridDay()).then((l) => l.find((b) => b.id === done!.booking_id)),
  })
  const info = done?.picked ? { discipline: done.picked.discipline, starts_at: done.picked.starts_at, who: done.picked.display_name } : lookup.data ? { discipline: lookup.data.discipline_name, starts_at: lookup.data.starts_at } : null

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
          <h1 className="font-heading text-3xl font-bold">Check-in hecho</h1>
          {info ? (
            <p className="text-base">
              {info.who && <span className="font-semibold">{info.who} · </span>}
              {info.discipline} · {formatDay(madridDay(info.starts_at))} a las {formatTime(info.starts_at)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Ya estás en la lista de la sesión.</p>
          )}
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

      <Sheet open={candidates !== null} onOpenChange={(o) => !o && setCandidates(null)}>
        <SheetPopup side="bottom">
          <SheetHeader>
            <SheetTitle>Elige la reserva</SheetTitle>
            <SheetDescription>Hay más de una con el check-in abierto.</SheetDescription>
          </SheetHeader>
          <SheetPanel className="flex flex-col gap-2">
            {candidates?.map((c) => (
              <Button key={c.booking_id} variant="outline" size="xl" className="h-auto min-h-14 flex-col items-start gap-0 py-2 text-left" loading={send.isPending && send.variables?.booking_id === c.booking_id} onClick={() => send.mutate({ code: code.current, booking_id: c.booking_id })}>
                <span className="font-semibold">{c.display_name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {c.discipline} · {formatTime(c.starts_at)}
                </span>
              </Button>
            ))}
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </div>
  )
}
