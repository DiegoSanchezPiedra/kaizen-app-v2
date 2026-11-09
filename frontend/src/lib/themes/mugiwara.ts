import type { ThemeArt } from '.'

// One Piece (Muay Thai Kids): de grumete a Rey de los Piratas, con los términos japoneses; la racha, los Gears de
// Luffy. Cartel de «Se busca»: la marca es la recompensa (en berries).
export default {
  code: 'mugiwara', series: 'One Piece', shape: 'poster', kanji: '海',
  palette: { c1: '#F1E4BF', c2: '#E8D9B0', accent: '#8B1E1E', hanko: '#1B3A5C' },
  medals: {
    first_day: ['Grumete', '1M'], hours_10: ['Pirata novato', '30M'], hours_50: ['Nakama', '100M'], hours_100: ['Supernova', '300M'],
    hours_250: ['Shichibukai', '1.5B'], hours_500: ['Yonkō', '3B'], hours_1000: ['Rey de los Piratas', '5B'],
    streak_4: ['Gear Second', 'G2'], streak_12: ['Gear Third', 'G3'], streak_26: ['Gear Fourth', 'G4'], streak_52: ['Gear Fifth', 'G5'],
  },
} satisfies ThemeArt
