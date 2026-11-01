import { toastManager } from '@/components/ui/toast'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'

export const errorCode = (err: unknown): string => (err instanceof ApiError ? err.code : 'unknown')

// Toast de error por `code`; `action` es la salida cuando la hay («Ver opciones», «Completar»).
export function toastError(err: unknown, action?: { label: string; onClick: () => void }): void {
  const code = errorCode(err)
  toastManager.add({
    type: code === 'network' ? 'warning' : 'error',
    title: errorText(code),
    timeout: action ? 8000 : 5000,
    actionProps: action && { children: action.label, onClick: action.onClick },
  })
}

export const toastOk = (title: string, description?: string): void => {
  toastManager.add({ type: 'success', title, description, timeout: 4000 })
}
