import type React from 'react'
import logo from '@/assets/logo.png'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

type HeroSize = 'tall' | 'compact' | 'hero'

const heroHeight: Record<HeroSize, string> = { tall: 'h-52', compact: 'h-29', hero: 'h-75' }
const logoWidth: Record<HeroSize, string> = { tall: 'w-47', compact: 'w-28', hero: 'w-55' }

// Pantallas sin sesión: en móvil, cabecera de marca y hoja encima; en escritorio, panel de marca a la izquierda.
export function AuthLayout({ hero = 'compact', children }: { hero?: HeroSize; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      {/* Esquina superior derecha: sobre la marca en móvil, sobre el formulario en lg. */}
      <ThemeToggle className="absolute top-[max(env(safe-area-inset-top),0.5rem)] right-2 z-10 text-white hover:bg-white/10 hover:text-white lg:top-4 lg:right-4 lg:text-foreground lg:hover:bg-accent lg:hover:text-foreground" />
      <aside
        className={cn(
          'brand-glow relative isolate flex shrink-0 items-center justify-center overflow-hidden bg-brand-ink pb-6 text-white',
          heroHeight[hero],
          'lg:brand-glow-corner lg:h-auto lg:w-[600px] lg:flex-col lg:items-start lg:justify-between lg:p-16',
        )}
      >
        <Slashes />
        <img src={logo} alt="Kai Zen" className={cn('h-auto', logoWidth[hero], 'lg:w-75')} />
        <div className="hidden flex-col gap-4 lg:flex">
          <p className="font-heading text-[64px] font-extrabold italic uppercase leading-[0.95]">
            Disciplina, fuerza y evolución.
          </p>
          <p className="text-[#C9D2FF]">Kai Zen Training Camp · Barcelona</p>
        </div>
      </aside>
      <main className="relative -mt-6 flex flex-1 justify-center rounded-t-3xl bg-background px-5 pt-7 pb-6 shadow-[0_-1px_0_var(--border)] lg:mt-0 lg:items-center lg:rounded-none lg:p-12 lg:shadow-none">
        <div className="flex w-full max-w-100 flex-col gap-4">{children}</div>
      </main>
    </div>
  )
}

function Slashes() {
  return (
    <svg
      className="absolute inset-0 -z-10 size-full"
      viewBox="0 0 390 300"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <polygon points="-30,260 250,-20 292,-20 12,260" fill="#0B47F0" opacity=".55" />
      <polygon points="150,320 420,40 436,40 172,320" fill="#0BB4F5" opacity=".32" />
      <polygon points="-40,120 90,-20 100,-20 -30,120" fill="#FFFFFF" opacity=".07" />
    </svg>
  )
}
