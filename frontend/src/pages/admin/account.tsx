import { LogOutIcon, ShieldCheckIcon } from 'lucide-react'
import { MyDataForm } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { logout } from '@/lib/logout'
import { useAuthMe } from '@/lib/queries'
import { MfaNotice } from '@/pages/admin/shell'

// Cuenta del admin: nombre y email, doble factor y cerrar sesión. Sin perfil público ni push.
export function AdminAccountPage() {
  const me = useAuthMe()
  return (
    <Page title="Cuenta">
      <MfaNotice />
      <section aria-label="Tus datos" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Tus datos</h2>
        <MyDataForm showEmail />
      </section>
      <section aria-label="Doble factor" className="flex flex-col gap-2 rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Doble factor</h2>
          {me.isPending ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            me.data?.mfa_enabled && (
              <Badge variant="success">
                <ShieldCheckIcon aria-hidden="true" />
                Activo
              </Badge>
            )
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {me.data && (me.data.mfa_enabled ? 'Al entrar, te pedimos también el código de tu app de autenticación.' : 'Sin activar: para entrar basta la contraseña.')} Si pierdes el móvil y los códigos de recuperación, habla con quien administra el servidor.
        </p>
      </section>
      <Button variant="outline" size="xl" onClick={() => logout()}>
        <LogOutIcon />
        Cerrar sesión
      </Button>
    </Page>
  )
}
