// Medallas por disciplina (ADR 0022): la escalera de 11 del backend (migrations/019 y 037: first_day, HOUR_BADGES y
// STREAK_BADGES), con el nombre y el arte de la temática de cada disciplina (lib/themes). Quién la tiene y desde
// cuándo lo decide siempre la API.
import { KAIZEN, type Palette, type Shape, type ThemeArt, THEMES } from '@/lib/themes'
import type { DisciplineMedals } from '@/lib/types'

export type MedalKind = 'hours' | 'streak'
export type Medal = { code: string; kind: MedalKind; at: number; theme: string; name: string; mark: string; kanji: string; shape: Shape; palette: Palette }

// first_day va en la escalera de horas, con at 0: se gana con el primer presente.
export const LADDER: { code: string; kind: MedalKind; at: number }[] = [
  ...[0, 10, 50, 100, 250, 500, 1000].map((at) => ({ code: at ? `hours_${at}` : 'first_day', kind: 'hours' as const, at })),
  ...[4, 12, 26, 52].map((at) => ({ code: `streak_${at}`, kind: 'streak' as const, at })),
]

/** La medalla con el arte de su temática; sin temática, o una sin arte todavía, Kaizen. Fuera de la escalera, ninguna. */
export function medalOf(theme: string | null, code: string): Medal | undefined {
  const step = LADDER.find((x) => x.code === code)
  if (!step) return undefined
  const t: ThemeArt = (theme && THEMES[theme]) || KAIZEN
  const [name, mark, palette] = t.medals[code]
  return { ...step, theme: t.code, name, mark, kanji: t.kanji, shape: t.shape, palette: palette ?? t.palette }
}

/** Las 11 de una temática, en orden de escalera. */
export const ladderOf = (theme: string | null) => LADDER.map((x) => medalOf(theme, x.code)!)

/** «10 h», «12 semanas»; first_day, «1.ª sesión». */
export const medalGoal = (x: Medal) => (x.at === 0 ? '1.ª sesión' : x.kind === 'hours' ? `${x.at} h` : `${x.at} semanas`)

/** La primera de la escalera sin conseguir; ninguna con la escalera completa. */
export const nextMedal = (theme: string | null, kind: MedalKind, earned: Set<string>) =>
  ladderOf(theme).find((x) => x.kind === kind && !earned.has(x.code))

export type DisciplineMedal = { key: string; medal: Medal; discipline: { id: string; name: string } }
const rank = (code: string) => LADDER.findIndex((x) => x.code === code)

// La que se enseña junto al nombre (rankings, Comunidad): la de horas más alta, si no la racha más alta, si no la
// primera; entre disciplinas empatadas, la de más horas.
const TOP = ['hours_1000', 'hours_500', 'hours_250', 'hours_100', 'hours_50', 'hours_10', 'streak_52', 'streak_26', 'streak_12', 'streak_4', 'first_day']
export function topMedal(disciplines: DisciplineMedals[] | undefined): DisciplineMedal | undefined {
  let best: { d: DisciplineMedals; code: string; i: number } | undefined
  for (const d of disciplines ?? []) {
    const i = TOP.findIndex((c) => d.badges.some((b) => b.code === c))
    if (i >= 0 && (!best || i < best.i || (i === best.i && d.hours > best.d.hours))) best = { d, code: TOP[i], i }
  }
  return best && { key: `${best.d.id}:${best.code}`, medal: medalOf(best.d.theme, best.code)!, discipline: { id: best.d.id, name: best.d.name } }
}

const WINDOW_MS = 14 * 24 * 3600 * 1000

/** Las que celebrar: las que quien mira aún no celebró (seen: sus claves '<disciplina>:<código>'; sin ninguna, solo las
 *  de los últimos 14 días). Por clave y no por fecha: earned_at es el inicio de la sesión y una lista pasada tarde
 *  queda atrás. La más reciente primero y, empatadas, la más alta. */
export function medalsToCelebrate(disciplines: DisciplineMedals[], seen: string[] | null, now: Date): DisciplineMedal[] {
  return disciplines
    .flatMap((d) => d.badges.map((b) => ({ d, b, key: `${d.id}:${b.code}` })))
    .filter(({ b, key }) => rank(b.code) >= 0 && (seen ? !seen.includes(key) : Date.parse(b.earned_at) > now.getTime() - WINDOW_MS))
    .sort((x, z) => Date.parse(z.b.earned_at) - Date.parse(x.b.earned_at) || rank(z.b.code) - rank(x.b.code))
    .map(({ d, b, key }) => ({ key, medal: medalOf(d.theme, b.code)!, discipline: { id: d.id, name: d.name } }))
}

// El color de la temática que se lee sobre el fondo oscuro (títulos y anillos): el más claro entre cuerpo y detalle.
const lum = (hex: string) => [1, 3, 5].reduce((n, i, k) => n + [0.2126, 0.7152, 0.0722][k] * parseInt(hex.slice(i, i + 2), 16), 0)
export const glowOf = (m: Medal) => (lum(m.palette.c1) >= lum(m.palette.accent) ? m.palette.c1 : m.palette.accent)

export const formatHours = (h: number): string => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(h)} h`
