import type { ThemeArt } from '.'

// Naruto (libre): los rangos ninja hasta Hokage; la racha, las técnicas de Naruto. Placa de la bandana.
export default {
  code: 'naruto', series: 'Naruto', shape: 'plate', kanji: '忍',
  palette: { c1: '#E3E8EF', c2: '#C0C7D0', accent: '#1F2A44', hanko: '#F07F13' },
  medals: {
    first_day: ['Estudiante de la Academia', '学'], hours_10: ['Genin', '下'], hours_50: ['Chūnin', '中'], hours_100: ['Jōnin', '上'],
    hours_250: ['ANBU', '暗'], hours_500: ['Sannin', '三'], hours_1000: ['Hokage', '火'],
    streak_4: ['Rasengan', '螺'], streak_12: ['Modo Sabio', '仙'], streak_26: ['Rasen-shuriken', '手'], streak_52: ['Modo Seis Caminos', '六'],
  },
} satisfies ThemeArt
