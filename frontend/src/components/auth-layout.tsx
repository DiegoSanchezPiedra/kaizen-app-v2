import type React from 'react'
import { useEffect, useState } from 'react'
import logo from '@/assets/logo.png'
import { ThemeToggle } from '@/components/theme-toggle'

// La entrada escalonada se juega una sola vez por sesión de la pestaña (no es dato de la API: ADR 0015 no aplica).
// Sin sessionStorage no anima.
const SEEN = 'kz.auth-seen'
function useFirstVisit() {
  const [first] = useState(() => {
    try {
      return !sessionStorage.getItem(SEEN)
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(SEEN, '1')
    } catch {
      /* sin almacenamiento: no hay marca y no se anima */
    }
  }, [])
  return first
}

// Pantallas sin sesión: en móvil, cabecera de marca y hoja encima; en escritorio, panel de marca a la izquierda.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const first = useFirstVisit()
  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      {/* Esquina superior derecha: sobre la marca en móvil, sobre el formulario en lg. */}
      <ThemeToggle className="absolute top-[max(env(safe-area-inset-top),0.5rem)] right-2 z-10 text-white hover:bg-white/10 hover:text-white lg:top-4 lg:right-4 lg:text-foreground lg:hover:bg-accent lg:hover:text-foreground" />
      <aside className="brand-glow relative isolate flex h-34 shrink-0 items-center justify-center overflow-hidden bg-brand-ink pb-6 text-white lg:brand-glow-corner lg:h-auto lg:w-[600px] lg:flex-col lg:items-start lg:justify-between lg:p-16">
        <Slashes />
        <img src={logo} alt="Kai Zen" className="h-auto w-32 lg:w-75" />
        <div className="hidden flex-col gap-4 lg:flex">
          <p className="font-heading text-[64px] font-extrabold italic uppercase leading-[0.95]">
            Disciplina, fuerza y evolución.
          </p>
          <p className="text-[#C9D2FF]">Kai Zen Training Camp · Barcelona</p>
        </div>
      </aside>
      {/* En oscuro la hoja sube a la superficie para que su borde se lea contra la cabecera. */}
      <main className="relative -mt-6 flex flex-1 justify-center rounded-t-3xl bg-background px-5 pt-7 pb-6 shadow-[0_-1px_0_var(--border)] dark:bg-card lg:mt-0 lg:items-center lg:rounded-none lg:p-12 lg:shadow-none lg:dark:bg-background">
        <div className={first ? 'auth-rise flex w-full max-w-100 flex-col gap-4' : 'flex w-full max-w-100 flex-col gap-4'}>
          {children}
        </div>
      </main>
    </div>
  )
}

// Rayas de la marca. En móvil caben en la cabecera; en lg se quedan en la mitad de arriba, fuera del lema.
function Slashes() {
  return (
    <>
      <svg className="absolute inset-0 -z-10 size-full lg:hidden" viewBox="0 0 390 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <polygon points="-30,260 250,-20 292,-20 12,260" fill="#0B47F0" opacity=".55" />
        <polygon points="150,320 420,40 436,40 172,320" fill="#0BB4F5" opacity=".32" />
        <polygon points="-40,120 90,-20 100,-20 -30,120" fill="#FFFFFF" opacity=".07" />
      </svg>
      {/* La máscara las desvanece antes de llegar al lema, sin cortes planos. */}
      <svg
        className="absolute inset-0 -z-10 hidden size-full [mask-image:linear-gradient(to_bottom,#000_30%,transparent_62%)] lg:block"
        viewBox="0 0 600 800"
        preserveAspectRatio="xMaxYMin slice"
        aria-hidden="true"
      >
        <polygon points="-250,540 300,-10 352,-10 -198,540" fill="#0B47F0" opacity=".55" />
        <polygon points="100,630 580,150 600,150 120,630" fill="#0BB4F5" opacity=".32" />
        <polygon points="-40,120 90,-20 100,-20 -30,120" fill="#FFFFFF" opacity=".07" />
      </svg>
    </>
  )
}
