// Medallas: la lista cerrada de badges del backend (migrations/019: first_day, HOUR_BADGES y STREAK_BADGES),
// con nombre, icono, kanji y paleta. Quién la tiene y desde cuándo lo decide siempre la API.
// shortcut: los nombres e iconos son los de las series (de terceros, solo pruebas); cambiarlos por los del
// género (docs/research/medallas-shonen.md) antes de que haya producción.
export type MedalKind = 'hours' | 'streak'
export type Palette = { c1: string; c2: string; burst: string; hanko: string }
export type Medal = { code: string; name: string; kind: MedalKind; at: number; icon: string; kanji: string; palette: Palette }

const P = {
  green: { c1: '#4CC46A', c2: '#2E9A4B', burst: '#FFFFFF', hanko: '#D7262E' },
  orange: { c1: '#FF8A1F', c2: '#D9600A', burst: '#1F2A5A', hanko: '#D7262E' },
  gold: { c1: '#FFD23F', c2: '#E0A800', burst: '#FF7A00', hanko: '#D7262E' },
  silver: { c1: '#E3E9F5', c2: '#A9B6CF', burst: '#4C6FFF', hanko: '#1F2A5A' },
  straw: { c1: '#F2C14E', c2: '#D49A1E', burst: '#E5322D', hanko: '#1F2A5A' },
  ink: { c1: '#FFFFFF', c2: '#CFD3DC', burst: '#111111', hanko: '#D7262E' },
} satisfies Record<string, Palette>

// Iconos de trazo en una rejilla de 24.
const I = {
  tag: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M10 8l-1 8 M15 8l-1 8 M8 10.5h8 M7.5 13.5h8',
  plate: 'M2 12c3-1 5-1 6-1 M16 11c1 0 3 0 6 1 M8 8h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M9.5 10.5v.01 M14.5 10.5v.01 M9.5 12.5v.01 M14.5 12.5v.01',
  aura: 'M4 20c0-4 2-6 3-7L5 6l4 3 1-6 2 5 2-5 1 6 4-3-2 7c1 1 3 3 3 7z',
  hat: 'M2 15c0 1.7 4.5 3 10 3s10-1.3 10-3-4.5-2-10-2-10 .3-10 2z M6 13.5c0-4 2.5-7 6-7s6 3 6 7 M6.3 11.5c3.5 1 7.9 1 11.4 0',
  katana: 'M20 3L9 14 M20 3l-1 3 M9 14a2.2 2.2 0 1 0-1 1z M7.5 15.5L4 19 M3 18l3 3',
  card: 'M3 6h18v12H3z M6 10h5 M6 13h7 M17 9l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z',
  flame: 'M12 2c3 4 6 6 6 11a6 6 0 0 1-12 0c0-5 3-7 6-11z M12 9c1.5 2 3 3 3 5a3 3 0 0 1-6 0c0-2 1.5-3 3-5z',
  xmark: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M8 8l8 8 M16 8l-8 8',
  scroll: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7 M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2 M9 9h6 M9 13h6',
  haori: 'M8 3l-5 4 2 4 2-1v11h10V10l2 1 2-4-5-4c-1 2-2.5 3-4 3S9 5 8 3z',
  kasa: 'M12 3L2 16h20z M5 16c0 2 3 3 7 3s7-1 7-3 M12 3v3',
}

const m = (code: string, name: string, at: number, icon: string, kanji: string, palette: Palette): Medal =>
  ({ code, name, kind: code.startsWith('streak_') ? 'streak' : 'hours', at, icon, kanji, palette })

// first_day va en la escalera de horas, con at 0: se gana con el primer presente.
export const MEDALS: Medal[] = [
  m('first_day', 'Aspirante al Examen Hunter', 0, I.tag, '志', P.green),
  m('hours_10', 'Genin', 10, I.plate, '忍', P.orange),
  m('hours_50', 'Super Saiyan', 50, I.aura, '気', P.gold),
  m('hours_100', 'Supernova', 100, I.hat, '海', P.straw),
  m('hours_250', 'Shikai', 250, I.katana, '刀', P.ink),
  m('hours_500', 'Licencia Hunter', 500, I.card, '狩', P.green),
  m('hours_1000', 'Ultra Instinto', 1000, I.flame, '極', P.silver),
  m('streak_4', 'Nakama', 4, I.xmark, '仲', P.straw),
  m('streak_12', 'Chūnin', 12, I.scroll, '中', P.orange),
  m('streak_26', 'Capitán del Gotei 13', 26, I.haori, '隊', P.ink),
  m('streak_52', 'Hokage', 52, I.kasa, '火', P.orange),
]

export const medalOf = (code: string) => MEDALS.find((x) => x.code === code)

/** «10 h», «12 semanas»; first_day, «1.ª sesión». */
export const medalGoal = (x: Medal) => (x.at === 0 ? '1.ª sesión' : x.kind === 'hours' ? `${x.at} h` : `${x.at} semanas`)

/** La primera de la escalera sin conseguir; ninguna con la escalera completa. */
export const nextMedal = (kind: MedalKind, earned: Set<string>) => MEDALS.find((x) => x.kind === kind && !earned.has(x.code))

// La que se enseña junto al nombre (rankings, Comunidad): la de horas más alta, si no la racha más alta, si no la primera.
const TOP = ['hours_1000', 'hours_500', 'hours_250', 'hours_100', 'hours_50', 'hours_10', 'streak_52', 'streak_26', 'streak_12', 'streak_4', 'first_day']
export const topMedal = (codes: string[]) => medalOf(TOP.find((c) => codes.includes(c)) ?? '')

const WINDOW_MS = 14 * 24 * 3600 * 1000

/** Las que celebrar: las que quien mira aún no celebró (seen: sus códigos; sin ninguno, solo las de los últimos 14
 *  días). Por código y no por fecha: earned_at es el inicio de la sesión y una lista pasada tarde queda atrás. */
export function medalsToCelebrate(badges: { code: string; earned_at: string }[], seen: string[] | null, now: Date): Medal[] {
  const isNew = (b: { code: string; earned_at: string }) =>
    seen ? !seen.includes(b.code) : Date.parse(b.earned_at) > now.getTime() - WINDOW_MS
  return badges
    .filter((b) => isNew(b) && medalOf(b.code))
    .sort((a, z) => Date.parse(z.earned_at) - Date.parse(a.earned_at) || MEDALS.findIndex((x) => x.code === z.code) - MEDALS.findIndex((x) => x.code === a.code))
    .map((b) => medalOf(b.code)!)
}

export const formatHours = (h: number): string => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(h)} h`
