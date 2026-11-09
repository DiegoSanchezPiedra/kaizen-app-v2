import { usesSubject } from '@/lib/subject'
export type Role = 'alumno' | 'tutor' | 'profesor' | 'admin'
export type Session = { token: string; id: string; role: Role; exp: number }
// Por qué terminó la sesión en esta pestaña: decide a dónde lleva el router.
export type EndReason = 'logout' | 'expired' | 'role_changed' | 'password_changed' | null

// Lee el JWT sin verificarlo (lo verifica el backend): solo para el rol y la caducidad.
export function decode(token: string): Session | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part))
    if (!payload.sub || !payload.role) return null
    return { token, id: payload.sub, role: payload.role, exp: payload.exp ?? 0 }
  } catch {
    return null
  }
}

export const isExpired = (s: Session, now = Date.now()): boolean => s.exp * 1000 <= now

// Solo rutas propias: nunca una URL externa que llegue en ?volver=.
export const safeReturnPath = (p: string | null): string => (p && p.startsWith('/') && !p.startsWith('//') ? p : '/')

// Cerrar sesión va a /login a secas; caducada o sin sesión, con la ruta para volver después.
// Con el rol cambiado no se vuelve: la ruta era del rol viejo.
export function loginPath(reason: EndReason, back: string): string {
  if (reason === 'logout') return '/login'
  if (reason === 'role_changed') return '/login?acceso=1'
  const params = new URLSearchParams()
  if (reason === 'expired') params.set('caducada', '1')
  if (reason === 'password_changed') params.set('clave', '1')
  if (back !== '/') params.set('volver', back)
  const q = params.toString()
  return q ? `/login?${q}` : '/login'
}

export const isAdminPath = (p: string): boolean => p === '/admin' || p.startsWith('/admin/')

// A dónde lleva el router a cada rol: el admin solo dentro de /admin; el resto, fuera; el profesor empieza en lo suyo.
export function redirectFor(role: Role, pathname: string): string | null {
  if (role === 'admin') return isAdminPath(pathname) ? null : '/admin'
  if (isAdminPath(pathname)) return '/'
  // Las pantallas que actúan por un alumno (y su inicio) no son del profesor: la API le da 403 y se quedaría cargando.
  if (role === 'profesor' && usesSubject(pathname)) return '/professor'
  return null
}
