import type { Palette, ThemeArt } from '.'

// Dragon Ball (Muay Thai): los niveles Saiyan, en inglés. Horas: la esfera del dragón de 1 a 7 estrellas (la marca
// es el número de estrellas); racha: la esfera con el color del aura de cada transformación.
// El detalle es el propio aura (una esfera de racha no pinta estrellas): así glowOf da su color y no blanco.
const aura = (c1: string, c2: string): Palette => ({ c1, c2, accent: c1, hanko: '#1D4E9E' })
export default {
  code: 'saiyan', series: 'Dragon Ball', shape: 'orb', kanji: '龍',
  palette: { c1: '#FFB347', c2: '#F28C28', accent: '#D7262E', hanko: '#1D4E9E' },
  medals: {
    first_day: ['Saiyan Warrior', '1'], hours_10: ['Super Saiyan', '2'], hours_50: ['Super Saiyan 2', '3'],
    hours_100: ['Super Saiyan 3', '4'], hours_250: ['Super Saiyan God', '5'], hours_500: ['Super Saiyan Blue', '6'],
    hours_1000: ['Ultra Instinct', '7'],
    streak_4: ['Kaioken', '界', aura('#FF5A4E', '#C4161C')], streak_12: ['Super Saiyan 4', '4', aura('#E0484E', '#7A1E22')],
    streak_26: ['Super Saiyan Blue Evolved', '進', aura('#4F7BFF', '#1D2E9E')], streak_52: ['Ultra Ego', '我', aura('#B26BFF', '#5A1E9E')],
  },
} satisfies ThemeArt
