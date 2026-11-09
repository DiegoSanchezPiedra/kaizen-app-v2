import type { ThemeArt } from '.'

// Bleach (libre): de alma a Capitán Comandante del Gotei 13; la racha, sus técnicas. Sin Bankai (su kanji lleva un
// manji). Sello de tinta blanco y negro.
export default {
  code: 'shinigami', series: 'Bleach', shape: 'seal', kanji: '魂',
  palette: { c1: '#F2F2F2', c2: '#D6D6D6', accent: '#0B0B0F', hanko: '#E86A10' },
  medals: {
    first_day: ['Alma', '魂'], hours_10: ['Estudiante de la Academia Shinō', '学'], hours_50: ['Shinigami', '死'],
    hours_100: ['Shikai', '始'], hours_250: ['Teniente', '副'], hours_500: ['Capitán del Gotei 13', '隊'],
    hours_1000: ['Capitán Comandante', '総'],
    streak_4: ['Shunpo', '瞬'], streak_12: ['Kidō', '鬼'], streak_26: ['Getsuga Tenshō', '月'], streak_52: ['Mugetsu', '無'],
  },
} satisfies ThemeArt
