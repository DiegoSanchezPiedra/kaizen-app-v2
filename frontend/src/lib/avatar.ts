// Foto de perfil (B24, ADR 0019). La URL es la credencial: un <img> normal, sin token.
export const avatarSrc = (name: string): string => `/api/avatars/${name}`

// Sin foto se enseñan las iniciales: la primera y la última palabra del nombre.
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '·'
  const pick = (w: string) => Array.from(w)[0].toUpperCase()
  return words.length === 1 ? pick(words[0]) : pick(words[0]) + pick(words[words.length - 1])
}

// Cuadrado de la imagen (w×h) que se ve con `zoom` ≥ 1 centrado en (cx, cy), sin salirse de la imagen.
export function cropRect(w: number, h: number, zoom: number, cx: number, cy: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h) / zoom
  const clamp = (c: number, max: number) => Math.min(Math.max(c - size / 2, 0), max - size)
  return { sx: clamp(cx, w), sy: clamp(cy, h), size }
}
