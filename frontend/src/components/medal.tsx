import { useId } from 'react'
import type { Medal as MedalInfo } from '@/lib/progress'
import { cn } from '@/lib/utils'

// Estallido de 16 puntas en una rejilla de 64; la sombra dura es el mismo desplazado (2, 3).
const star = (dx: number, dy: number) =>
  Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 ? 23.5 : 29.8
    const a = (i * Math.PI) / 16 - Math.PI / 2
    return `${(32 + dx + r * Math.cos(a)).toFixed(1)},${(32 + dy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')
const BURST = star(0, 0)
const SHADOW = star(2, 3)
const LOCKED = { c1: '#EEF0F5', c2: '#E2E5EE', burst: '#E6E8EF', hanko: '#B5BACB' }

// Medalla estilo manga: tinta negra, estallido, disco con sombra plana, trama y sello con kanji. Sin conseguir, en gris
// (se distingue también por luminosidad); el texto de al lado dice si está bloqueada.
export function Medal({ medal, earned, className }: { medal: MedalInfo; earned: boolean; className?: string }) {
  const id = useId()
  const c = earned ? medal.palette : LOCKED
  const ink = earned ? '#0A0A0A' : '#9AA0B8'
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0', className)}>
      <defs>
        <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" fill="#0A0A0A" opacity="0.28" />
        </pattern>
      </defs>
      <polygon points={SHADOW} fill={earned ? '#0A0A0A' : '#D5D8E2'} />
      <polygon points={BURST} fill={c.burst} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="19" fill={c.c1} />
      <path d="M32 13a19 19 0 0 1 0 38a15 17 0 0 0 0-38z" fill={c.c2} />
      {earned && <circle cx="32" cy="32" r="19" fill={`url(#${CSS.escape(id)})`} />}
      <ellipse cx="25" cy="21" rx="5" ry="2.6" fill="#FFFFFF" opacity={earned ? 0.85 : 0.5} transform="rotate(-30 25 21)" />
      <circle cx="32" cy="32" r="19" fill="none" stroke={ink} strokeWidth="2.4" />
      <path d={medal.icon} transform="translate(20 20)" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="45" y="45" width="16" height="16" rx="3" fill={c.hanko} stroke={ink} strokeWidth="1.6" />
      <text x="53" y="57.3" textAnchor="middle" fontSize="11" fontWeight="900" fill="#FFFFFF" fontFamily="'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif">
        {medal.kanji}
      </text>
    </svg>
  )
}
