import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { errorCode, toastError } from '@/lib/notify'

// Portal de Stripe (tarjeta y recibos). Sin cuenta de pagador → 404 no_billing_account: lo gestiona otra persona.
export function usePortal() {
  const m = useMutation({
    mutationFn: () => api<{ url: string }>('/billing/portal', { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => errorCode(err) !== 'no_billing_account' && toastError(err),
  })
  return { open: () => m.mutate(), busy: m.isPending || m.isSuccess, notPayer: errorCode(m.error) === 'no_billing_account' }
}
