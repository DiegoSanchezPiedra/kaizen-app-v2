import { useMutation } from '@tanstack/react-query'
import { CheckIcon, QrCodeIcon, ShieldAlertIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { StatusAlert } from '@/components/status-alert'
import { ProfileAvatar } from '@/components/profile-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toastManager } from '@/components/ui/toast'
import { useIsMobile } from '@/hooks/use-media-query'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import type { EventStudent } from '@/lib/events'
import { queryClient } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { plural, withMark, type Attendance, type AttendanceRow } from '@/lib/professor'
import { cn } from '@/lib/utils'

// La lista de asistencia (B18.4) que comparten el profesor y el panel. Aquí no hay salud: eso es solo del profesor.

// Cerrar la lista: la pide el botón de cada pantalla, con su confirmación.
export function useCloseList(sessionId: string, onDone: () => void) {
  return useMutation({
    mutationFn: () => api<{ present: number; absent: number }>(`/sessions/${sessionId}/attendance/close`, { method: 'POST' }),
    onSuccess: async (r) => {
      toastOk('Lista cerrada', `${plural(r.present, 'presente', 'presentes')} y ${plural(r.absent, 'falta', 'faltas')}`)
      onDone()
      await refreshAttendance(sessionId)
    },
    onError: (err) => {
      onDone()
      professorError(err)
      void refreshAttendance(sessionId)
    },
  })
}

export const attKey = (id: string) => ['attendance', id]
export const refreshAttendance = (id: string) => queryClient.invalidateQueries({ queryKey: attKey(id) })

// El texto de attendance_closed para el alumno dice «habla con el profesor»: aquí el que habla es el profesor.
export function professorError(err: unknown, fallbackOffline = false) {
  const code = errorCode(err)
  if (code === 'attendance_closed') toastManager.add({ type: 'warning', title: 'La lista ya estaba cerrada. Hemos actualizado la lista.', timeout: 5000 })
  else if (code === 'network' && fallbackOffline) toastManager.add({ type: 'warning', title: 'Sin conexión: no se ha guardado. Vuelve a intentarlo.', timeout: 5000 })
  else toastError(err)
}

// El interruptor grande de «Presente»: mientras guarda queda bloqueado.
function SwitchCell({ on, pending, label, onChange }: { on: boolean; pending: boolean; label: string; onChange: (present: boolean) => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Switch
        checked={on}
        disabled={pending}
        onCheckedChange={onChange}
        aria-label={label}
        className="relative h-9 w-16 [--thumb-size:34px] after:absolute after:-inset-1.5 after:content-[''] sm:[--thumb-size:34px]"
      />
      <span className={cn('text-xs font-semibold', on ? 'text-foreground' : 'text-muted-foreground')} aria-live="polite">
        {pending ? 'Guardando…' : on ? 'Presente' : 'Sin marcar'}
      </span>
    </div>
  )
}

// Cada interruptor guarda al tocarlo; si falla, no cambia (la caché solo se toca al guardar).
function MarkSwitch({ sessionId, row }: { sessionId: string; row: AttendanceRow }) {
  const mark = useMutation({
    mutationFn: (present: boolean) => api(`/sessions/${sessionId}/attendance/${row.student_id}`, { method: 'PUT', body: { present } }),
    onSuccess: (_r, present) => queryClient.setQueryData<Attendance>(attKey(sessionId), (a) => a && withMark(a, row.student_id, present)),
    onError: (err) => {
      professorError(err, true)
      if (['no_active_booking', 'attendance_closed', 'session_not_started'].includes(errorCode(err))) void refreshAttendance(sessionId)
    },
  })
  const on = mark.isPending ? mark.variables : row.status === 'present'
  return <SwitchCell on={on} pending={mark.isPending} label={`Presente: ${row.display_name}`} onChange={(c) => mark.mutate(c)} />
}

// Lista de un evento (B21.2): presente sí o no, desde el inicio, sin cerrar ni corregir.
export const evKey = (id: string) => ['prof-event', id]
export function EventStudentItem({ eventId, student, open }: { eventId: string; student: EventStudent; open: boolean }) {
  const mark = useMutation({
    mutationFn: (present: boolean) => api(`/events/${eventId}/attendance/${student.profile_id}`, { method: 'PUT', body: { present } }),
    onError: (err) => {
      professorError(err, true)
      if (['registration_not_found', 'event_cancelled', 'event_not_started'].includes(errorCode(err))) void queryClient.invalidateQueries({ queryKey: evKey(eventId) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: evKey(eventId) }),
  })
  const on = mark.isPending ? mark.variables : student.attended === true
  return (
    <li className="grid min-h-18 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3.5 py-2.5 last:border-b-0">
      <ProfileAvatar name={student.display_name} className="size-10" />
      <div className="min-w-0">
        <p className="truncate text-base font-semibold">{student.display_name}</p>
        {!student.risk_cover && (
          <Badge variant="warning" className="mt-1">
            <ShieldAlertIcon aria-hidden="true" />
            Sin cobertura de riesgo
          </Badge>
        )}
      </div>
      {open ? (
        <SwitchCell on={on} pending={mark.isPending} label={`Presente: ${student.display_name}`} onChange={(c) => mark.mutate(c)} />
      ) : (
        <span className="text-[13px] font-semibold text-muted-foreground">Inscrito</span>
      )}
    </li>
  )
}

export function AttendanceItem({ sessionId, row, mode, onCorrect }: { sessionId: string; row: AttendanceRow; mode: 'switch' | 'read' | 'closed'; onCorrect: (r: AttendanceRow) => void }) {
  return (
    <li className="grid min-h-18 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3.5 py-2.5 last:border-b-0">
      <ProfileAvatar name={row.display_name} avatar={row.avatar} className="size-10" />
      <div className={cn('min-w-0', mode === 'closed' && 'col-span-2')}>
        <p className="truncate text-base font-semibold">{row.display_name}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          {row.method === 'qr' && (
            <Badge variant="outline">
              <QrCodeIcon aria-hidden="true" />
              Llegó por check-in
            </Badge>
          )}
          {!row.risk_cover && (
            <Badge variant="warning">
              <ShieldAlertIcon aria-hidden="true" />
              Sin cobertura de riesgo
            </Badge>
          )}
        </div>
      </div>
      {mode === 'switch' && <MarkSwitch sessionId={sessionId} row={row} />}
      {mode === 'read' && <span className="text-[13px] font-semibold text-muted-foreground">{row.status === 'present' ? 'Presente' : 'Reservado'}</span>}
      {mode === 'closed' && (
        <div className="col-span-2 col-start-2 flex items-center justify-between gap-2">
          <Badge variant={row.status === 'present' ? 'success' : 'error'} size="lg">
            {row.status === 'present' ? <CheckIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
            {row.status === 'present' ? 'Presente' : 'Falta'}
          </Badge>
          <Button size="lg" variant="outline" aria-label={`Corregir la asistencia de ${row.display_name}`} onClick={() => onCorrect(row)}>
            Corregir
          </Button>
        </div>
      )}
      {mode === 'closed' && row.corrected_at && (
        <p className="col-span-2 col-start-2 text-[13px] leading-snug text-muted-foreground">Corregido: «{row.correction_reason}»</p>
      )}
    </li>
  )
}

const MAX_REASON = 500

// Presente ↔ falta con motivo obligatorio. Sheet en móvil, Dialog en escritorio.
export function CorrectDialog({ sessionId, row, onClose }: { sessionId: string; row: AttendanceRow | null; onClose: () => void }) {
  const mobile = useIsMobile()
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [expired, setExpired] = useState(false)
  const to = row?.status === 'present' ? 'absent' : 'present'
  const fix = useMutation({
    mutationFn: () =>
      api(`/sessions/${sessionId}/attendance/${row!.student_id}/correct`, { method: 'POST', body: { status: to, reason: reason.trim() } }),
    onSuccess: async () => {
      toastOk('Asistencia corregida')
      await refreshAttendance(sessionId)
      close()
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'correction_window_expired') return setExpired(true)
      toastError(err)
      if (['no_change', 'attendance_not_closed', 'no_active_booking'].includes(code)) {
        void refreshAttendance(sessionId)
        close()
      }
    },
  })
  function close() {
    onClose()
    setReason('')
    setEmpty(false)
    setExpired(false)
  }
  function submit() {
    if (!reason.trim()) return setEmpty(true)
    fix.mutate()
  }
  const arrow = row ? `${row.status === 'present' ? 'Presente' : 'Falta'} → ${to === 'present' ? 'Presente' : 'Falta'}` : ''
  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold" aria-live="polite">{arrow}</p>
      {expired ? (
        <StatusAlert notice={{ kind: 'error', icon: 'clock', title: errorText('correction_window_expired') }} />
      ) : (
        <>
          <label htmlFor="reason" className="text-sm font-semibold">Motivo (obligatorio)</label>
          <Textarea
            id="reason"
            value={reason}
            maxLength={MAX_REASON}
            aria-invalid={empty || undefined}
            aria-describedby="reason-help"
            onChange={(e) => {
              setReason(e.target.value)
              setEmpty(false)
            }}
          />
          <p id="reason-help" className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className={cn(empty && 'font-semibold text-destructive-foreground')} role={empty ? 'alert' : undefined}>
              {empty ? errorText('reason_required') : 'Queda guardado con tu nombre.'}
            </span>
            <span className="tabular-nums">{reason.length} / {MAX_REASON}</span>
          </p>
        </>
      )}
    </div>
  )
  const buttons = (
    <>
      <Button variant="outline" size="xl" onClick={close}>{expired ? 'Cerrar' : 'Cancelar'}</Button>
      {!expired && <Button size="xl" loading={fix.isPending} onClick={submit}>Guardar corrección</Button>}
    </>
  )
  const title = `Corregir a ${row?.display_name ?? ''}`
  const open = row !== null
  return mobile ? (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetPopup side="bottom" closeProps={{ 'aria-label': 'Cerrar' }}>
        <SheetHeader><SheetTitle>{title}</SheetTitle><SheetDescription>La lista ya está cerrada.</SheetDescription></SheetHeader>
        <SheetPanel>{body}</SheetPanel>
        <SheetFooter>{buttons}</SheetFooter>
      </SheetPopup>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>La lista ya está cerrada.</DialogDescription></DialogHeader>
        <DialogPanel>{body}</DialogPanel>
        <DialogFooter>{buttons}</DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
