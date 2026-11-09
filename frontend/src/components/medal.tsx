import { type ReactNode, useId } from 'react'
import type { Medal as MedalInfo } from '@/lib/progress'
import type { Palette, Shape } from '@/lib/themes'
import { cn } from '@/lib/utils'

// Medalla estilo manga en una rejilla de 64: tinta negra, sombra dura desplazada (2, 3), trama, brillo, la marca de
// la medalla en el centro y el sello con el kanji de la temática. Cada temática tiene su forma (lib/themes): cinturón
// (Ippo), esfera del dragón (Dragon Ball), escudo (Shingeki), cartel de «Se busca» (One Piece), placa ninja (Naruto),
// sello (Bleach), licencia (HxH) y estallido (Kaizen). Sin conseguir, en gris (también por luminosidad); el texto de
// al lado dice si está bloqueada.
const INK = '#0A0A0A'
const LOCKED: Palette = {
  c1: '#EEF0F5',
  c2: '#E2E5EE',
  accent: '#D5D8E2',
  hanko: '#B5BACB',
}
const JP = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif"

const poly = (n: number, r1: number, r2: number, cx = 32, cy = 32, rot = -Math.PI / 2) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? r2 : r1
    const a = (i * Math.PI) / n + rot
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')
const BURST = poly(16, 29.8, 23.5)
const AURA = poly(9, 31, 22)
const OCTAGON = poly(4, 20, 20, 32, 32, Math.PI / 8)
const SHIELD = 'M32 4 L56 11 C56 33 47 50 32 60 C17 50 8 33 8 11 Z'
const STAR = (cx: number, cy: number, r: number) => poly(5, r, r * 0.45, cx, cy)
// Las estrellas de la esfera del dragón: 1 en el centro; 2–6 en corro; 7, corro de 6 + centro.
const stars = (n: number) => {
  const ring = n === 7 ? 6 : n
  const pts =
    n === 1
      ? [[32, 34]]
      : Array.from({ length: ring }, (_, i) => {
          const a = (i * 2 * Math.PI) / ring - Math.PI / 2
          return [32 + 10 * Math.cos(a), 34 + 10 * Math.sin(a)]
        })
  return n === 7 ? [...pts, [32, 34]] : pts
}

function Mark({ text, x = 32, y = 32, color, size }: { text: string; x?: number; y?: number; color: string; size?: number }) {
  const s = size ?? (text.length === 1 ? 19 : text.length === 2 ? 14 : text.length === 3 ? 11 : 9)
  return (
    <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={s} fontWeight="900" fill={color} fontFamily={JP} letterSpacing={text.length > 2 ? -0.4 : 0}>
      {text}
    </text>
  )
}

// El cuerpo de cada forma: fondo con sombra y contorno, y encima la marca.
function body(shape: Shape, m: MedalInfo, c: Palette, ink: string, dots: string, earned: boolean): ReactNode {
  const shade = <ellipse cx="25" cy="20" rx="5" ry="2.6" fill="#FFFFFF" opacity={earned ? 0.85 : 0.5} transform="rotate(-30 25 20)" />
  switch (shape) {
    case 'belt':
      return (
        <>
          <>
            <rect x="3" y="25" width="60" height="18" rx="3" fill={earned ? INK : '#D5D8E2'} />
            <rect x="1" y="22" width="60" height="18" rx="3" fill={c.accent} stroke={ink} strokeWidth="1.6" />
            <path d="M4 25.5h54 M4 36.5h54" stroke={earned ? '#FFFFFF' : '#C7CBD6'} strokeWidth="0.9" strokeDasharray="2 2" opacity="0.7" />
            <polygon points={OCTAGON} transform="translate(2 3)" fill={earned ? INK : '#D5D8E2'} />
            <polygon points={OCTAGON} fill={c.c1} stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
            <polygon points={poly(4, 15, 15, 32, 32, Math.PI / 8)} fill={c.c2} stroke={ink} strokeWidth="1" />
            {earned && <polygon points={OCTAGON} fill={dots} />}
            {shade}
          </>
          <Mark text={m.mark} color={ink} />
        </>
      )
    case 'orb': {
      const n = Number(m.mark)
      const isStars = m.kind === 'hours' && n >= 1 && n <= 7
      return (
        <>
          <>
            {m.kind === 'streak' && <polygon points={AURA} fill={c.c1} opacity={earned ? 0.55 : 0.4} stroke={ink} strokeWidth="1" strokeLinejoin="round" />}
            <circle cx="34" cy="35" r="22" fill={earned ? INK : '#D5D8E2'} />
            <circle cx="32" cy="32" r="22" fill={c.c1} />
            <path d="M32 10a22 22 0 0 1 0 44a18 20 0 0 0 0-44z" fill={c.c2} />
            {earned && <circle cx="32" cy="32" r="22" fill={dots} />}
            <ellipse cx="23" cy="19" rx="7" ry="3.4" fill="#FFFFFF" opacity={earned ? 0.9 : 0.5} transform="rotate(-35 23 19)" />
            <circle cx="32" cy="32" r="22" fill="none" stroke={ink} strokeWidth="2.4" />
          </>
          {isStars ? (
            stars(n).map(([x, y], i) => (
              <polygon key={i} points={STAR(x, y, n === 1 ? 7 : n >= 6 ? 3.8 : 4.6)} fill={c.accent} stroke={ink} strokeWidth="0.8" strokeLinejoin="round" />
            ))
          ) : (
            <Mark text={m.mark} color={earned ? '#FFFFFF' : ink} />
          )}
        </>
      )
    }
    case 'shield':
      return (
        <>
          <>
            <path d={SHIELD} transform="translate(2 3)" fill={earned ? INK : '#D5D8E2'} />
            <path d={SHIELD} fill={c.accent} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
            <path d="M32 9 L51 14.5 C51 32 44 46 32 54.5 C20 46 13 32 13 14.5 Z" fill={c.c1} stroke={ink} strokeWidth="1.2" />
            {/* Las dos alas, en sombra detrás de la marca. */}
            <path d="M32 44c-6-2-12-8-14-18 5 2 9 2 14 6z" fill={earned ? '#1B3A5C' : c.c2} opacity="0.35" />
            <path d="M32 44c6-2 12-8 14-18-5 2-9 2-14 6z" fill={c.c2} opacity="0.6" />
            {earned && <path d={SHIELD} fill={dots} opacity="0.6" />}
            {shade}
          </>
          <Mark text={m.mark} y={30} color={ink} />
        </>
      )
    case 'poster':
      return (
        <>
          <>
            <rect x="12" y="5" width="44" height="57" fill={earned ? INK : '#D5D8E2'} />
            <rect x="10" y="2" width="44" height="57" fill={c.c1} stroke={ink} strokeWidth="1.6" />
            <rect x="10" y="2" width="44" height="57" fill={dots} opacity={earned ? 0.5 : 0} />
            <text x="32" y="11.5" textAnchor="middle" fontSize="8.4" fontWeight="900" fill={ink} fontFamily="Georgia, serif" letterSpacing="0.6">
              WANTED
            </text>
            <rect x="15" y="15" width="34" height="25" fill={c.c2} stroke={ink} strokeWidth="1.2" />
            {/* El sombrero de paja. */}
            <path d="M18 33c0 2 6 3.5 14 3.5S46 35 46 33s-6-2.6-14-2.6S18 31 18 33z" fill="#F2C14E" stroke={ink} strokeWidth="1.1" />
            <path d="M24 31c0-5 3.5-8.5 8-8.5s8 3.5 8 8.5" fill="#F2C14E" stroke={ink} strokeWidth="1.1" />
            <path d="M24.3 29.2c5 1.3 10.4 1.3 15.4 0" stroke={c.accent} strokeWidth="2.2" />
            <text x="28" y="47" textAnchor="middle" fontSize="4.2" fontWeight="800" fill={ink} fontFamily="Georgia, serif" letterSpacing="0.4">
              DEAD OR ALIVE
            </text>
          </>
          <Mark text={m.kind === 'hours' ? `฿${m.mark}` : m.mark} x={27} y={53} color={earned ? c.accent : ink} size={m.mark.length > 3 ? 8 : 9.5} />
        </>
      )
    case 'plate':
      return (
        <>
          <>
            <rect x="1" y="24" width="62" height="16" fill={c.accent} stroke={ink} strokeWidth="1.4" />
            <rect x="14" y="16" width="38" height="34" rx="5" fill={earned ? INK : '#D5D8E2'} />
            <rect x="12" y="13" width="38" height="34" rx="5" fill={c.c1} stroke={ink} strokeWidth="2.2" />
            <path d="M44 13h1a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5h-1z" fill={c.c2} />
            {earned && <rect x="12" y="13" width="38" height="34" rx="5" fill={dots} opacity="0.7" />}
            {[
              [16.5, 17.5],
              [45.5, 17.5],
              [16.5, 42.5],
              [45.5, 42.5],
            ].map(([x, y]) => (
              <circle key={x + '' + y} cx={x} cy={y} r="1.5" fill={c.c2} stroke={ink} strokeWidth="0.8" />
            ))}
            <ellipse cx="21" cy="19" rx="4" ry="1.8" fill="#FFFFFF" opacity={earned ? 0.85 : 0.5} transform="rotate(-20 21 19)" />
          </>
          <Mark text={m.mark} y={30} color={ink} />
        </>
      )
    case 'seal':
      return (
        <>
          <>
            <circle cx="34" cy="35" r="25" fill={earned ? '#E86A10' : '#D5D8E2'} />
            <circle cx="32" cy="32" r="25" fill={c.accent} stroke={ink} strokeWidth="1.6" />
            <circle cx="32" cy="32" r="20" fill="none" stroke={c.c1} strokeWidth="1.6" />
            <circle cx="32" cy="32" r="17" fill="none" stroke={c.c1} strokeWidth="0.7" strokeDasharray="1.2 1.6" />
            <path d="M18 18a20 20 0 0 1 20-6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity={earned ? 0.5 : 0.3} />
          </>
          <Mark text={m.mark} color={earned ? c.c1 : '#FFFFFF'} />
        </>
      )
    case 'card':
      return (
        <>
          <>
            <rect x="6" y="13" width="54" height="40" rx="5" fill={earned ? INK : '#D5D8E2'} />
            <rect x="4" y="10" width="54" height="40" rx="5" fill={c.c1} stroke={ink} strokeWidth="2" />
            <path d="M4 18h54" stroke={ink} strokeWidth="1" />
            <rect x="4.8" y="10.8" width="52.4" height="7" rx="4" fill={c.accent} />
            <text x="31" y="16.2" textAnchor="middle" fontSize="5.4" fontWeight="900" fill={INK} fontFamily="Georgia, serif" letterSpacing="1.2">
              HUNTER
            </text>
            {earned && <rect x="4" y="18" width="54" height="32" fill={dots} opacity="0.5" />}
            <path d="M44 22l3 6-3 6-3-6z" fill={c.accent} stroke={ink} strokeWidth="0.8" opacity="0.9" />
            {shade}
          </>
          <Mark text={m.mark} y={34} color={earned ? c.accent : ink} />
        </>
      )
    default:
      return (
        <>
          <>
            <polygon points={BURST} transform="translate(2 3)" fill={earned ? INK : '#D5D8E2'} />
            <polygon points={BURST} fill={c.accent} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="32" cy="32" r="19" fill={c.c1} />
            <path d="M32 13a19 19 0 0 1 0 38a15 17 0 0 0 0-38z" fill={c.c2} />
            {earned && <circle cx="32" cy="32" r="19" fill={dots} />}
            <ellipse cx="25" cy="21" rx="5" ry="2.6" fill="#FFFFFF" opacity={earned ? 0.85 : 0.5} transform="rotate(-30 25 21)" />
            <circle cx="32" cy="32" r="19" fill="none" stroke={ink} strokeWidth="2.4" />
          </>
          <Mark text={m.mark} color={ink} />
        </>
      )
  }
}

export function Medal({ medal, earned, className }: { medal: MedalInfo; earned: boolean; className?: string }) {
  const id = useId()
  const c = earned ? medal.palette : LOCKED
  const ink = earned ? INK : '#9AA0B8'
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0 overflow-visible', className)}>
      <defs>
        <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" fill={INK} opacity="0.22" />
        </pattern>
      </defs>
      {body(medal.shape, medal, c, ink, `url(#${CSS.escape(id)})`, earned)}
      <rect x="46" y="46" width="16" height="16" rx="3" fill={c.hanko} stroke={ink} strokeWidth="1.6" />
      <text x="54" y="58.3" textAnchor="middle" fontSize="11" fontWeight="900" fill="#FFFFFF" fontFamily={JP}>
        {medal.kanji}
      </text>
    </svg>
  )
}
