import type { ThemeArt } from '.'

// Hunter x Hunter (libre): del Examen Hunter a Presidente de la Asociación; la racha, los cuatro principios del Nen.
// Licencia Hunter.
export default {
  code: 'hunter', series: 'Hunter x Hunter', shape: 'card', kanji: '念',
  palette: { c1: '#2E8A50', c2: '#1B6B3A', accent: '#F5D90A', hanko: '#1A1A2E' },
  medals: {
    first_day: ['Aspirante al Examen Hunter', '?'], hours_10: ['Licencia Hunter', 'H'], hours_50: ['Piso 200 de la Torre Celeste', '200'],
    hours_100: ['Hunter de una estrella', '★'], hours_250: ['Hunter de dos estrellas', '★★'], hours_500: ['Hunter de tres estrellas', '★★★'],
    hours_1000: ['Presidente de la Asociación', '会'],
    streak_4: ['Ten', '纏'], streak_12: ['Zetsu', '絶'], streak_26: ['Ren', '練'], streak_52: ['Hatsu', '発'],
  },
} satisfies ThemeArt
