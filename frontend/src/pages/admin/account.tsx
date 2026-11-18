import { useQuery } from '@tanstack/react-query'
import { LogOutIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AvatarEditor } from '@/components/avatar-editor'
import { MyDataForm } from '@/components/my-data-form'
import { Page } from '@/components/page'
import { ErrorState } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { logout } from '@/lib/logout'
import { useAuthMe } from '@/lib/queries'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PasswordSection } from '@/pages/account'

const CARD = 'flex flex-col gap-4 rounded-2xl border bg-card p-5'
// Los botones de los formularios compartidos (Guardar, Cambiar contraseña, Subir foto) a 44 px también con ratón; el ojo de la
// contraseña (aria-pressed) ya tiene su zona de 44 px.
const TALL_BUTTONS = '[&_button:not([aria-pressed])]:h-11'

// Lo primero: a esto viene el admin. Sustituye aquí al aviso de MfaNotice (que sigue en el Inicio).
function MfaCard() {
  const me = useAuthMe()
  const on = me.data?.mfa_enabled === true
  return (
    <section aria-labelledby="mfa-title" className={CARD}>
      <div className="flex min-h-6.5 items-center justify-between gap-3">
        <h2 id="mfa-title" className="font-semibold">
          Doble factor
        </h2>
        {me.isPending ? (
          <Skeleton className="h-6.5 w-24" />
        ) : (
          me.data &&
          (on ? (
            <Badge variant="success" size="lg">
              <ShieldCheckIcon aria-hidden="true" />
              Activo
            </Badge>
          ) : (
            <Badge variant="warning" size="lg">
              <ShieldAlertIcon aria-hidden="true" />
              Sin activar
            </Badge>
          ))
        )}
      </div>
      {me.data && (
        <p className="text-[15px]">
          {on ? 'Al entrar, te pedimos también el código de tu app de autenticación.' : 'Protege los datos de la academia: con él, entrar pide también un código del móvil.'}
        </p>
      )}
      {me.data && !on && (
        <Button size="xl" className="sm:h-11 sm:self-start" render={<Link to="/admin/mfa" state={{ from: '/admin/account' }} />}>
          <ShieldCheckIcon />
          Activar el doble factor
        </Button>
      )}
      <p className="text-sm text-muted-foreground">Si pierdes el móvil y los códigos de recuperación, habla con quien administra el servidor.</p>
    </section>
  )
}

// Cuenta del admin (b19 § Acceso): doble factor, contraseña, foto y nombre, y cerrar sesión. Sin perfil público ni push.
export function AdminAccountPage() {
  const profile = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })
  const [round, setRound] = useState(0) // tras cambiar la contraseña, el formulario vuelve vacío
  return (
    <Page title="Cuenta">
      <MfaCard />
      {profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <>
          <section aria-labelledby="pw-title" className={cn(CARD, TALL_BUTTONS)}>
            <h2 id="pw-title" className="font-semibold">
              Contraseña
            </h2>
            <PasswordSection key={round} onDone={() => setRound((r) => r + 1)} />
          </section>
          <section aria-labelledby="data-title" className={cn(CARD, TALL_BUTTONS)}>
            <h2 id="data-title" className="font-semibold">
              Tus datos
            </h2>
            <AvatarEditor name={profile.data?.display_name ?? null} avatar={profile.data?.avatar} />
            <MyDataForm showEmail />
          </section>
        </>
      )}
      <Button variant="outline" size="xl" className="sm:h-11" onClick={() => logout()}>
        <LogOutIcon />
        Cerrar sesión
      </Button>
    </Page>
  )
}
