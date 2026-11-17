import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Un bloque con su turno de entrada (60 ms por bloque). Es el ítem de la rejilla de escritorio. Sin `on` no anima nada.
export function Rise({ on, i, className, children }: { on: boolean; i: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', on && 'animate-rise', className)} style={on ? { animationDelay: `${i * 60}ms` } : undefined}>
      {children}
    </div>
  )
}
