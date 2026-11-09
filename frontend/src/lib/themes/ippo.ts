import type { ThemeArt } from '.'

// Hajime no Ippo (Boxeo): el camino de Ippo en el Kamogawa hasta el título; la racha, sus golpes. Hebilla de cinturón.
export default {
  code: 'ippo', series: 'Hajime no Ippo', shape: 'belt', kanji: '拳',
  palette: { c1: '#F2CF4A', c2: '#C9A227', accent: '#B1121B', hanko: '#111111' },
  medals: {
    first_day: ['Gimnasio Kamogawa', '鴨'], hours_10: ['Licencia profesional', '免'], hours_50: ['Novato del Este', '東'],
    hours_100: ['Rey de los novatos', '王'], hours_250: ['Campeón de Japón', '日'], hours_500: ['Campeón OPBF', '亜'],
    hours_1000: ['Campeón del mundo', '世'],
    streak_4: ['Peek-a-boo', 'PB'], streak_12: ['Gazelle Punch', 'GP'], streak_26: ['Dempsey Roll', 'DR'], streak_52: ['Espíritu de lucha', '闘'],
  },
} satisfies ThemeArt
