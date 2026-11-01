import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { api } from '@/lib/api'
import { toastError, toastOk } from '@/lib/notify'
import { toastManager } from '@/components/ui/toast'
import { refreshBookings } from '@/lib/queries'
import type { Booking } from '@/lib/types'

// Cancelar una reserva o salir de la espera, con confirmación. Salir de la espera no avisa de la cancelación tardía.
export function useCancelBooking() {
  const [target, setTarget] = useState<{ id: string; waitlisted: boolean } | null>(null)
  const cancel = useMutation({
    mutationFn: (id: string) => api<{ booking: Booking }>(`/bookings/${id}/cancel`, { method: 'POST' }),
    onSuccess: ({ booking }) => {
      if (booking.cancel_reason === 'late') toastManager.add({ type: 'warning', title: 'Reserva cancelada', description: 'Ha contado como cancelación tardía.' })
      else toastOk(target?.waitlisted ? 'Has salido de la lista de espera' : 'Reserva cancelada')
    },
    onError: (err) => toastError(err),
    onSettled: async () => {
      setTarget(null)
      await refreshBookings()
    },
  })
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && !cancel.isPending && setTarget(null)}
      title={target?.waitlisted ? '¿Salir de la lista de espera?' : '¿Cancelar la reserva?'}
      description={
        target?.waitlisted
          ? 'Perderás tu sitio en la lista.'
          : 'Si falta poco para empezar, puede contar como cancelación tardía.'
      }
      confirmLabel={target?.waitlisted ? 'Salir de la espera' : 'Cancelar reserva'}
      loading={cancel.isPending}
      onConfirm={() => target && cancel.mutate(target.id)}
    />
  )
  return { ask: (id: string, waitlisted: boolean) => setTarget({ id, waitlisted }), dialog, pendingId: cancel.isPending ? target?.id : undefined }
}
