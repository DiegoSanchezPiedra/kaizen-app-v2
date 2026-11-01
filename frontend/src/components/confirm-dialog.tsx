import type React from 'react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

// Confirmación de una acción que no se deshace (cancelar una reserva, salir de la espera).
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Volver',
  loading,
  onConfirm,
  variant = 'destructive',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  // Una confirmación que no destruye nada (programar un cambio de plan) va con el botón principal.
  variant?: 'destructive' | 'default'
  children?: React.ReactNode
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children && <div className="flex flex-col gap-3 px-6 pb-4 text-sm">{children}</div>}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="xl" />}>{cancelLabel}</AlertDialogClose>
          <Button variant={variant} size="xl" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
