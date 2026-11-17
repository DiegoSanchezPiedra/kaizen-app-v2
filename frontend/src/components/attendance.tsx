import { useMutation } from '@tanstack/react-query'
import { CheckIcon, QrCodeIcon, XIcon } from 'lucide-react'
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

// El interruptor grande de «Presente»: mientras guarda queda bloqueado, pero sin atenuarse ni animarse (se marca
// decenas de veces seguidas). «Guardando…» solo aparece si tarda más de 600 ms. El estado lo anuncia el propio
// role=switch: sin aria-live aquí. `touch`: 44 px de alto (pasar lista de pie en el tatami).
function SwitchCell({ on, pending, label, onChange, touch }: { on: boolean; pending: boolean; label: string; onChange: (present: boolean) => void; touch?: boolean }) {
  const slow = 'col-start-1 row-start-1 delay-600 duration-150 fill-mode-both'
  return (
    <div className="flex flex-col items-center gap-1">
      <Switch
        checked={on}
        disabled={pending}
        onCheckedChange={onChange}
        aria-label={label}
        className={cn(
          "relative transition-none duration-0 after:absolute after:-inset-1.5 after:content-[''] data-disabled:cursor-default data-disabled:opacity-100 [&>[data-slot=switch-thumb]]:transition-none",
          touch ? 'h-11 w-20 [--thumb-size:42px] sm:[--thumb-size:42px]' : 'h-9 w-16 [--thumb-size:34px] sm:[--thumb-size:34px]',
        )}
      />
      <span className={cn('grid text-xs font-semibold', on ? 'text-foreground' : 'text-muted-foreground')}>
        <span className={cn('col-start-1 row-start-1', pending && `${slow} animate-out fade-out`)}>{on ? 'Presente' : 'Sin marcar'}</span>
        {pending && <span className={`${slow} animate-in fade-in`}>Guardando…</span>}
      </span>
    </div>
  )
}

// Cada interruptor cambia la lista (y el contador) al tocarlo; si falla, esa fila vuelve tal como estaba.
function MarkSwitch({ sessionId, row, touch }: { sessionId: string; row: AttendanceRow; touch?: boolean }) {
  const setRow = (r: AttendanceRow) =>
    queryClient.setQueryData<Attendance>(attKey(sessionId), (a) => a && { ...a, students: a.students.map((x) => (x.student_id === r.student_id ? r : x)) })
  const mark = useMutation({
    mutationFn: (present: boolean) => api(`/sessions/${sessionId}/attendance/${row.student_id}`, { method: 'PUT', body: { present } }),
    onMutate: async (present) => {
      await queryClient.cancelQueries({ queryKey: attKey(sessionId) })
      queryClient.setQueryData<Attendance>(attKey(sessionId), (a) => a && withMark(a, row.student_id, present))
      return row
    },
    onError: (err, _present, prev) => {
      if (prev) setRow(prev)
      professorError(err, true)
      if (['no_active_booking', 'attendance_closed', 'session_not_started'].includes(errorCode(err))) void refreshAttendance(sessionId)
    },
  })
  return <SwitchCell on={row.status === 'present'} pending={mark.isPending} label={`Presente: ${row.display_name}`} onChange={(c) => mark.mutate(c)} touch={touch} />
}

// Lista de un evento (B21.2): presente sí o no, desde el inicio, sin cerrar ni corregir.
export const evKey = (id: string) => ['prof-event', id]
export function EventStudentItem({ eventId, student, open, touch }: { eventId: string; student: EventStudent; open: boolean; touch?: boolean }) {
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
        <p className={cn('text-base font-semibold', touch ? 'line-clamp-2 leading-snug break-words' : 'truncate')}>{student.display_name}</p>
      </div>
      {open ? (
        <SwitchCell on={on} pending={mark.isPending} label={`Presente: ${student.display_name}`} onChange={(c) => mark.mutate(c)} touch={touch} />
      ) : (
        <span className="text-[13px] font-semibold text-muted-foreground">Inscrito</span>
      )}
    </li>
  )
}

// `touch`: para pasar lista de pie (interruptor y «Corregir» de 44 px, nombre en dos líneas en vez de cortado).
// `canCorrect={false}`: el plazo de corrección ya ha terminado y no hay botón.
export function AttendanceItem({
  sessionId,
  row,
  mode,
  onCorrect,
  touch,
  canCorrect = true,
}: {
  sessionId: string
  row: AttendanceRow
  mode: 'switch' | 'read' | 'closed'
  onCorrect: (r: AttendanceRow) => void
  touch?: boolean
  canCorrect?: boolean
}) {
  return (
    <li className="grid min-h-18 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3.5 py-2.5 last:border-b-0">
      <ProfileAvatar name={row.display_name} avatar={row.avatar} className="size-10" />
      <div className={cn('min-w-0', mode === 'closed' && 'col-span-2')}>
        <p className={cn('text-base font-semibold', touch ? 'line-clamp-2 leading-snug break-words' : 'truncate')}>{row.display_name}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          {row.method === 'qr' && (
            <Badge variant="outline">
              <QrCodeIcon aria-hidden="true" />
              Llegó por check-in
            </Badge>
          )}
        </div>
      </div>
      {mode === 'switch' && <MarkSwitch sessionId={sessionId} row={row} touch={touch} />}
      {mode === 'read' && <span className="text-[13px] font-semibold text-muted-foreground">{row.status === 'present' ? 'Presente' : 'Reservado'}</span>}
      {mode === 'closed' && (
        <div className="col-span-2 col-start-2 flex items-center justify-between gap-2">
          <Badge variant={row.status === 'present' ? 'success' : 'error'} size="lg">
            {row.status === 'present' ? <CheckIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
            {row.status === 'present' ? 'Presente' : 'Falta'}
          </Badge>
          {canCorrect && (
            <Button size={touch ? 'xl' : 'lg'} variant="outline" aria-label={`Corregir la asistencia de ${row.display_name}`} onClick={() => onCorrect(row)}>
              Corregir
            </Button>
          )}
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
// `onExpired`: la pantalla se entera de que el plazo terminó (la API no lo da de antemano) y quita los «Corregir».
export function CorrectDialog({ sessionId, row, onClose, onExpired }: { sessionId: string; row: AttendanceRow | null; onClose: () => void; onExpired?: () => void }) {
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
      if (code === 'correction_window_expired') {
        onExpired?.()
        return setExpired(true)
      }
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
