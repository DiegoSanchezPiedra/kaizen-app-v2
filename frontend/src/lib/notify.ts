import { toastManager } from '@/components/ui/toast'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'

export const errorCode = (err: unknown): string => (err instanceof ApiError ? err.code : 'unknown')

// Toast de error por `code`; `action` es la salida cuando la hay («Ver opciones», «Completar»).
export function toastError(err: unknown, action?: { label: string; onClick: () => void }): void {
  const code = errorCode(err)
  // capacity_below_bookings trae `fits_from`: el primer día en que el aforo sí cabe.
  const fits = err instanceof ApiError && typeof err.details.fits_from === 'string' ? ` Cabe desde el ${formatShortDate(err.details.fits_from)}.` : ''
  toastManager.add({
    type: code === 'network' ? 'warning' : 'error',
    title: errorText(code, err instanceof ApiError ? err.details : {}) + fits,
    timeout: action ? 8000 : 5000,
    actionProps: action && { children: action.label, onClick: action.onClick },
  })
}

export const toastOk = (title: string, description?: string): void => {
  toastManager.add({ type: 'success', title, description, timeout: 4000 })
}
