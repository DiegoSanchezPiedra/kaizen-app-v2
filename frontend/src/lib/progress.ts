// Lista cerrada de badges del backend (migrations/019: HOUR_BADGES y STREAK_BADGES). Los nombres son propuestos.
export const HOUR_BADGES = [10, 50, 100, 250, 500, 1000]
export const STREAK_BADGES = [4, 12, 26, 52]

export type BadgeInfo = { code: string; title: string; kind: 'hours' | 'streak' }
export const BADGES: BadgeInfo[] = [
  ...HOUR_BADGES.map((h) => ({ code: `hours_${h}`, title: `${h} horas`, kind: 'hours' as const })),
  ...STREAK_BADGES.map((n) => ({ code: `streak_${n}`, title: `${n} semanas`, kind: 'streak' as const })),
]

export const formatHours = (h: number): string => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(h)} h`
