import type React from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

// Columna de contenido y título de cada pantalla (como la de B18.1).
// `wide`: ancho de escritorio en todos los tamaños; `lgWide`: columna estrecha hasta lg y dos columnas desde ahí.
export function Page({ title, children, wide, lgWide, actions }: { title: string; children: React.ReactNode; wide?: boolean; lgWide?: boolean; actions?: React.ReactNode }) {
  return (
    <div className={cn('mx-auto flex flex-col gap-5', wide ? 'max-w-5xl' : lgWide ? 'max-w-xl lg:max-w-5xl' : 'max-w-xl')}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-[26px] font-bold">{title}</h1>
        <div className="flex items-center gap-2">
          {actions}
          <ThemeToggle className="-me-2" />
        </div>
      </div>
      {children}
    </div>
  )
}
