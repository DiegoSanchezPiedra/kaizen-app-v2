import type { ThemeArt } from '.'

// Shingeki no Kyojin (BJJ/Grappling): los titanes del menos al más fuerte, alternos entre las dos escaleras
// (horas 1, 2, 4, 5, 7, 9, 11; racha 3, 6, 8, 10). El orden de fuerza es nuestro, no canónico. Escudo de la Tropa.
export default {
  code: 'titanes', series: 'Shingeki no Kyojin', shape: 'shield', kanji: '巨',
  palette: { c1: '#E6E2D3', c2: '#B8AE93', accent: '#3D5A3A', hanko: '#8B1E1E' },
  medals: {
    first_day: ['Titán puro', '無'], hours_10: ['Titán excéntrico', '奇'], hours_50: ['Titán Mandíbula', '顎'],
    hours_100: ['Titán Hembra', '女'], hours_250: ['Titán Bestia', '獣'], hours_500: ['Titán de Ataque', '進'],
    hours_1000: ['Titán Fundador', '祖'],
    streak_4: ['Titán Carguero', '車'], streak_12: ['Titán Acorazado', '鎧'], streak_26: ['Titán Martillo de Guerra', '鎚'],
    streak_52: ['Titán Colosal', '超'],
  },
} satisfies ThemeArt
