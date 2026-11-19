import { useMutation } from '@tanstack/react-query'
import { ArrowLeftRightIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { Spinner } from '@/components/ui/spinner'
import { ROLE_LABEL, rolesOf, sortRoles, type AuthMe } from '@/lib/admin'
import { api, ApiError } from '@/lib/api'
import { queryClient } from '@/lib/logout'
import { toastError } from '@/lib/notify'
import { homeFor, type Role } from '@/lib/paths'
import { useAuthMe } from '@/lib/queries'
import { setToken, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

// Rol activo de la sesión (ADR 0033). Solo se pinta si el perfil tiene más de un rol. Elegir otro pide un token nuevo,
// vacía la caché (lo que se veía era del otro rol) y lleva al inicio de ese rol.
export function RoleSwitcher({ className, side = 'bottom' }: { className?: string; side?: 'top' | 'bottom' }) {
  const me = useAuthMe()
  const active = useSession()?.role
  const navigate = useNavigate()
  const roles = sortRoles(rolesOf(me.data))
  const change = useMutation({
    mutationFn: (role: Role) => api<{ token: string }>('/auth/role', { method: 'POST', body: { role } }),
    onSuccess: ({ token }, role) => {
      const before = me.data
      setToken(token)
      void queryClient.cancelQueries()
      queryClient.removeQueries()
      // La lista de roles es la misma: se conserva para que el selector no parpadee mientras vuelve a pedirse.
      if (before) queryClient.setQueryData<AuthMe>(['auth-me'], { ...before, user: { ...before.user, role } })
      void navigate(homeFor(role))
    },
    // reauth_required: la sesión ya se cerró (api.ts) y /login lo explica. Si no, puede que el admin le haya quitado ese rol
    // mientras tanto: se vuelve a leer la lista.
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'reauth_required') return
      toastError(err)
      void me.refetch()
    },
  })
  if (roles.length < 2 || !active) return null
  return (
    <Menu>
      <MenuTrigger
        disabled={change.isPending}
        render={
          <Button
            variant="outline"
            size="xl"
            className={cn('h-auto min-h-12 w-full justify-start gap-3 py-1.5 text-start sm:h-auto', className)}
          />
        }
      >
        {change.isPending ? (
          <Spinner className="size-5" aria-hidden="true" role={undefined} aria-label={undefined} />
        ) : (
          <ArrowLeftRightIcon aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
          <span className="text-xs font-normal text-muted-foreground">Rol activo</span>
          <span className="max-w-full truncate">{ROLE_LABEL[active]}</span>
        </span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" side={side} className="min-w-(--anchor-width)">
        <MenuRadioGroup aria-label="Rol activo" value={active} onValueChange={(v: Role) => v !== active && change.mutate(v)}>
          {roles.map((role) => (
            <MenuRadioItem key={role} value={role} className="min-h-11 sm:min-h-9">
              {ROLE_LABEL[role]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  )
}
