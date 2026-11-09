import type { ThemeArt } from '.'

// La neutra: la de una disciplina sin temática. Nombres de género, sin marca de nadie.
export default {
  code: 'kaizen', series: 'Kaizen', shape: 'burst', kanji: '改',
  palette: { c1: '#FFD23F', c2: '#E0A800', accent: '#FF7A00', hanko: '#D7262E' },
  medals: {
    first_day: ['Primer paso', '1'], hours_10: ['Constante', '10'], hours_50: ['Dedicado', '50'], hours_100: ['Centenario', '100'],
    hours_250: ['Veterano', '250'], hours_500: ['Maestro', '500'], hours_1000: ['Leyenda', '1K'],
    streak_4: ['Un mes', '4'], streak_12: ['Tres meses', '12'], streak_26: ['Medio año', '26'], streak_52: ['Un año', '52'],
  },
} satisfies ThemeArt
