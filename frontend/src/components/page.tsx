import type React from 'react'
import { cn } from '@/lib/utils'

// Columna de contenido y título de cada pantalla (como la de B18.1).
export function Page({ title, children, wide, actions }: { title: string; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  return (
    <div className={cn('mx-auto flex flex-col gap-5', wide ? 'max-w-5xl' : 'max-w-xl')}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-[26px] font-bold">{title}</h1>
        {actions}
      </div>
      {children}
    </div>
  )
}
