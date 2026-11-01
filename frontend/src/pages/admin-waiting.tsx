import { HourglassIcon, LogOutIcon } from 'lucide-react'
import { AuthLayout } from '@/components/auth-layout'
import { Button } from '@/components/ui/button'
import { logout } from '@/lib/logout'

// El panel del admin es de B19: tras el login (y el MFA) solo ve esta espera.
export function AdminWaitingPage() {
  return (
    <AuthLayout hero="hero">
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/12 text-link">
        <HourglassIcon className="size-7.5" aria-hidden="true" />
      </div>
      <h1 className="font-heading text-[34px] font-bold leading-tight">El panel de la academia llega pronto</h1>
      <p className="text-muted-foreground">Has entrado como administrador. Cuando el panel esté listo, lo verás aquí al entrar.</p>
      <Button variant="outline" size="xl" className="mt-2 w-full" onClick={() => logout()}>
        <LogOutIcon />
        Cerrar sesión
      </Button>
    </AuthLayout>
  )
}
