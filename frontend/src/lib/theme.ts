// Tema: «system» sigue al sistema. Se guarda por dispositivo; la tablet siempre es oscura.
export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'kaizen-theme'

export const isDark = (pref: ThemePref, systemDark: boolean, pathname: string): boolean =>
  pathname === '/tablet' || pref === 'dark' || (pref === 'system' && systemDark)

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system' // almacenamiento bloqueado (privado): seguir al sistema
  }
}

export const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)')
export function applyTheme() {
  const dark = isDark(getThemePref(), systemDark().matches, location.pathname)
  document.documentElement.classList.toggle('dark', dark)
  // La barra de estado de la PWA (index.html la da por sistema) sigue al tema elegido.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#060A1C' : '#F6F7FB')
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
  // Fundido corto del cambio entero donde se puede; sin él (o con movimiento reducido), al instante.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduce) document.startViewTransition(applyTheme)
  else applyTheme()
}
