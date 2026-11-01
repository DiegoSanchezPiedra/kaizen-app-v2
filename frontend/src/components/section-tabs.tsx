import { NavLink } from 'react-router'
import { useSubject } from '@/hooks/use-subject'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

// Progreso, Comunidad y Rankings: enlaces con aspecto de pestañas (cada una es su ruta).
export function SectionTabs() {
  const role = useSession()?.role
  const { withSubject } = useSubject()
  const tabs = [
    ...(role === 'profesor' ? [] : [{ to: '/progress', label: 'Mi progreso' }]),
    { to: '/profiles', label: 'Comunidad' },
    { to: '/rankings', label: 'Rankings' },
  ]
  return (
    <nav aria-label="Secciones" className="flex gap-1 rounded-xl bg-foreground/6 p-1">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to === '/progress' ? withSubject(t.to) : t.to}
          end={t.to !== '/profiles' && t.to !== '/rankings'}
          className={({ isActive }) =>
            cn(
              'grid min-h-11 flex-1 place-items-center rounded-lg px-2 text-[15px] font-semibold whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive && 'bg-card text-foreground shadow-sm ring-1 ring-border',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
