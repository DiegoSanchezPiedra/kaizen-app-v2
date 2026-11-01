import {
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  ChartColumnIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  HistoryIcon,
  HouseIcon,
  LayersIcon,
  SettingsIcon,
  ShieldAlertIcon,
  TabletIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import logo from '@/assets/logo.png'
import { Page } from '@/components/page'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Pagination } from '@/components/ui/pagination'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { showMfaNotice } from '@/lib/admin'
import { useAuthMe } from '@/lib/queries'

type Item = { to: string; label: string; icon: typeof HouseIcon; block: string }

// docs/pantallas-b19.md § Estructura, en ese orden. `block`: el sub-bloque que la trae (para el hueco de lo que falta).
const NAV: Item[] = [
  { to: '/admin', label: 'Inicio', icon: HouseIcon, block: 'B19.2' },
  { to: '/admin/users', label: 'Usuarios', icon: UsersIcon, block: 'B19.3' },
  { to: '/admin/billing', label: 'Cobros', icon: WalletIcon, block: 'B19.4' },
  { to: '/admin/notices', label: 'Avisos', icon: BellIcon, block: 'B19.4' },
  { to: '/admin/sessions', label: 'Horario', icon: CalendarIcon, block: 'B19.5' },
  { to: '/admin/classes', label: 'Clases', icon: LayersIcon, block: 'B19.5' },
  { to: '/admin/catalog', label: 'Catálogo', icon: BookOpenIcon, block: 'B19.6' },
  { to: '/admin/reports', label: 'Informes', icon: ChartColumnIcon, block: 'B19.2' },
  { to: '/admin/documents', label: 'Documentos legales', icon: FileTextIcon, block: 'B19.6' },
  { to: '/admin/audit', label: 'Auditoría', icon: HistoryIcon, block: 'B19.4' },
  { to: '/admin/tablets', label: 'Tablets', icon: TabletIcon, block: 'B19.6' },
  { to: '/admin/settings', label: 'Ajustes', icon: SettingsIcon, block: 'B19.6' },
]
const ACCOUNT: Item = { to: '/admin/account', label: 'Cuenta', icon: UserIcon, block: 'B19.2' }

const isActive = (to: string, pathname: string) => (to === '/admin' ? pathname === to : pathname === to || pathname.startsWith(`${to}/`))

function NavItem({ item }: { item: Item }) {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const Icon = item.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive(item.to, pathname)}
        className="h-10 text-[15px]"
        render={<NavLink to={item.to} end={item.to === '/admin'} onClick={() => setOpenMobile(false)} />}
      >
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

// Barra lateral fija desde 1024 px; por debajo, en hoja (Sheet). Sin selector de sujeto ni push.
export function AdminShell() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-4">
          <Link to="/admin" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-9 place-items-center overflow-hidden rounded-lg bg-brand-ink">
              <img src={logo} alt="" className="w-7.5" />
            </span>
            <span className="font-heading text-xl font-extrabold italic uppercase">Kaizen</span>
            <span className="text-sm font-medium text-muted-foreground">Academia</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <nav aria-label="Panel">
              <SidebarMenu>
                {NAV.map((item) => (
                  <NavItem key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          <SidebarMenu>
            <NavItem item={ACCOUNT} />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-2 lg:hidden">
          <SidebarTrigger className="size-11" />
          <span className="font-heading text-lg font-extrabold italic uppercase">Kaizen</span>
        </header>
        <div className="px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ADR 0016: el MFA es opcional y se fomenta. No bloquea nada y desaparece al activarlo.
export function MfaNotice() {
  const me = useAuthMe()
  const { pathname } = useLocation()
  if (!showMfaNotice(me.data)) return null
  return (
    <Alert variant="warning" role="status">
      <ShieldAlertIcon />
      <AlertTitle>Activa el doble factor: protege los datos de la academia</AlertTitle>
      <AlertDescription>Con él, entrar pide también un código del móvil.</AlertDescription>
      <AlertAction>
        <Button size="sm" render={<Link to="/admin/mfa" state={{ from: pathname }} />}>
          Activar
        </Button>
      </AlertAction>
    </Alert>
  )
}

// Hueco de las pantallas que traen los siguientes sub-bloques.
export function AdminPending() {
  const { pathname } = useLocation()
  const item = NAV.find((i) => isActive(i.to, pathname) && i.to !== '/admin')
  return (
    <Page title={item?.label ?? 'Panel'} wide>
      <Empty className="rounded-2xl border bg-card">
        <EmptyHeader>
          <EmptyTitle>{item ? `Esta pantalla llega en ${item.block}` : 'No lo encontramos'}</EmptyTitle>
          <EmptyDescription>Mientras, el resto del panel ya funciona.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Page>
  )
}

// Paginación de 25 de las tablas del panel, con la página en la URL (?page=, desde 1) para volver atrás y compartir.
export const PAGE_SIZE = 25
export function Pager({ total, page, href }: { total: number; page: number; href: (page: number) => string }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return null
  return (
    <Pagination className="items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Página {page} de {pages} · {total} en total
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} render={page > 1 ? <Link to={href(page - 1)} /> : undefined}>
          <ChevronLeftIcon />
          Anterior
        </Button>
        <Button variant="outline" disabled={page >= pages} render={page < pages ? <Link to={href(page + 1)} /> : undefined}>
          Siguiente
          <ChevronRightIcon />
        </Button>
      </div>
    </Pagination>
  )
}
