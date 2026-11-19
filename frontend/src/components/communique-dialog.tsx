import { useMutation, useQuery } from '@tanstack/react-query'
import { MegaphoneIcon } from 'lucide-react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { api } from '@/lib/api'
import type { PendingCommunique } from '@/lib/communiques'
import { formatDate } from '@/lib/format'
import { toastError } from '@/lib/notify'
import { queryClient } from '@/lib/logout'

const KEY = ['me', 'communiques']
const KICKER = 'flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase'
const BODY = 'text-base text-pretty whitespace-pre-line text-foreground'

// Comunicados de la academia (ADR 0030): al abrir la app, uno tras otro, hasta pulsar «Entendido». No se cierra de
// otra forma (ni Escape ni fuera), ni solo: es lo que la academia necesita que se lea.
export function CommuniqueDialog() {
  const { pathname } = useLocation()
  const list = useQuery({ queryKey: KEY, queryFn: () => api<{ communiques: PendingCommunique[] }>('/me/communiques').then((r) => r.communiques), staleTime: Infinity })
  const seen = useMutation({
    mutationFn: (id: string) => api('/me/communiques/seen', { method: 'POST', body: { id } }),
    onSuccess: (_, id) => queryClient.setQueryData<PendingCommunique[]>(KEY, (xs) => xs?.filter((c) => c.id !== id)),
    onError: (err) => toastError(err),
  })
  const c = list.data?.[0]
  // El visor de check-in cubre la pantalla: la ventana espera a que se salga de él.
  if (!c || pathname.startsWith('/checkin')) return null
  return (
    <AlertDialog key={c.id} open onOpenChange={() => {}}>
      <AlertDialogPopup>
        <AlertDialogHeader className="text-left sm:text-left">
          <p className={KICKER}>
            <MegaphoneIcon aria-hidden="true" className="size-3.5" />
            Comunicado de la academia · {formatDate(c.created_at)}
          </p>
          <AlertDialogTitle className="leading-tight text-balance">{c.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription render={<div />} className={`min-h-0 overflow-y-auto px-6 pb-6 ${BODY}`}>
          {c.body}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button size="xl" loading={seen.isPending} onClick={() => seen.mutate(c.id)}>
            Entendido
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}

// La misma ventana, quieta: la vista previa del panel antes de enviar.
export function CommuniquePreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xs/5">
      <p className={KICKER}>
        <MegaphoneIcon aria-hidden="true" className="size-3.5" />
        Comunicado de la academia · hoy
      </p>
      <p className="font-heading text-xl leading-tight font-bold text-balance">{title}</p>
      <p className={BODY}>{body}</p>
      <p className="mt-2 self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" aria-hidden="true">
        Entendido
      </p>
    </div>
  )
}
