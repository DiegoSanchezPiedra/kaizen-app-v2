import { CalendarCheckIcon, CalendarIcon, ChartColumnIcon, HouseIcon, LogOutIcon, UserIcon, UsersIcon, ZapIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import logo from '@/assets/logo.png'
import { SubjectPicker } from '@/components/subject-picker'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { usePushQuery } from '@/hooks/use-push'
import { logout } from '@/lib/logout'
import { cn } from '@/lib/utils'
import { useSession, type Role } from '@/lib/session'
import { usesSubject } from '@/lib/subject'

type Item = { to: string; label: string; icon: typeof HouseIcon; end?: boolean }

const STUDENT: Item[] = [
  { to: '/', label: 'Inicio', icon: HouseIcon, end: true },
  { to: '/calendar', label: 'Calendario', icon: CalendarIcon },
  { to: '/bookings', label: 'Reservas', icon: CalendarCheckIcon },
  { to: '/progress', label: 'Progreso', icon: ZapIcon },
  { to: '/account', label: 'Cuenta', icon: UserIcon },
]
const PROFESSOR: Item[] = [
  { to: '/professor', label: 'Sesiones', icon: CalendarIcon, end: true },
  { to: '/professor/reports', label: 'Informes', icon: ChartColumnIcon },
  { to: '/profiles', label: 'Comunidad', icon: UsersIcon },
  { to: '/account', label: 'Cuenta', icon: UserIcon },
]
const navFor =(role: Role): Item[] => (role === 'profesor' ? PROFESSOR : STUDENT)

// Barra inferior en móvil; en escritorio (≥ 1024 px) pasa a lateral. Sin animación al cambiar de pestaña.
export function AppShell() {
  const session = useSession()
  // Al abrir la app con sesión: clave VAPID y reafirmar la suscripción (ADR 0011), en cualquier pantalla.
  usePushQuery()
  const items = navFor(session?.role ?? 'alumno')
  const { pathname } = useLocation()
  // El sujeto sigue al cambiar de pestaña.
  const para = useSearchParams()[0].get('para')
  const search = para ? `?${new URLSearchParams({ para })}` : ''
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <nav
        aria-label="Principal"
        className="order-last fixed inset-x-0 bottom-0 z-10 grid border-t bg-card px-1 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] lg:static lg:order-first lg:flex lg:w-64 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-3 lg:py-4"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        <div className="mb-4 hidden items-center gap-2.5 px-2 lg:flex">
          <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-brand-ink">
            <img src={logo} alt="" className="w-8.5" />
          </span>
          <span className="font-heading text-[22px] font-extrabold italic uppercase">Kaizen</span>
        </div>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={{ pathname: to, search }}
            end={end}
            className={({ isActive }) =>
              cn(
                'group flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold text-muted-foreground transition-transform duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
                'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[15px] lg:active:scale-100',
                isActive && 'text-link lg:bg-primary/12',
              )
            }
          >
            <span className="grid h-7.5 w-14 place-items-center rounded-full group-aria-[current=page]:bg-primary/12 lg:h-auto lg:w-auto lg:group-aria-[current=page]:bg-transparent">
              <Icon className="size-6 lg:size-5" aria-hidden="true" />
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 px-4 pt-6 pb-28 lg:px-10 lg:pb-10">
        {usesSubject(pathname) && <SubjectPicker />}
        <Outlet />
      </main>
    </div>
  )
}

const TITLES: Record<string, string> = {
  '/': 'Inicio',
  '/calendar': 'Calendario',
  '/bookings': 'Reservas',
  '/progress': 'Progreso',
  '/account': 'Cuenta',
  '/billing': 'Cuota',
  '/agreements': 'Acuerdos',
  '/profiles': 'Comunidad',
}

// Hueco de lo que aún no existe: el router y la sesión ya funcionan.
export function PendingScreen() {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? TITLES[`/${pathname.split('/')[1]}`] ?? 'Kaizen'
  const block = 'B18.5'
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="font-heading text-[26px] font-bold">{title}</h1>
      <Empty className="rounded-2xl border bg-card">
        <EmptyHeader>
          <EmptyTitle>Esta pantalla llega en {block}</EmptyTitle>
          <EmptyDescription>La sesión ya funciona: puedes moverte por las pestañas y cerrar sesión desde Cuenta.</EmptyDescription>
        </EmptyHeader>
        {pathname === '/account' && (
          <EmptyContent>
            <Button variant="outline" size="xl" onClick={() => logout()}>
              <LogOutIcon />
              Cerrar sesión
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  )
}
