import { ClockIcon, FlameIcon } from 'lucide-react'
import type { BadgeInfo } from '@/lib/progress'
import { cn } from '@/lib/utils'

// Insignia hexagonal de badge («nivel de poder»). Conseguida: naranja de poder; sin conseguir: gris y el texto lo dice.
export function BadgeHex({ badge, earnedAt }: { badge: BadgeInfo; earnedAt?: string }) {
  const Icon = badge.kind === 'hours' ? ClockIcon : FlameIcon
  return (
    <li className="flex flex-col items-center gap-1.5 text-center">
      <span
        className={cn(
          'grid size-16 place-items-center [clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)]',
          earnedAt ? 'bg-power text-[#1A0A00]' : 'bg-foreground/8 text-muted-foreground',
        )}
        aria-hidden="true"
      >
        <Icon className="size-7" />
      </span>
      <span className="text-sm leading-tight font-semibold">{badge.title}</span>
      <span className="text-xs text-muted-foreground">{earnedAt ?? 'Sin conseguir'}</span>
    </li>
  )
}
