import { useSyncExternalStore } from 'react'
import { decode, type EndReason, type Session } from '@/lib/paths'

export { isExpired, type EndReason, type Role, type Session } from '@/lib/paths'

// ADR 0014: el JWT en localStorage.
const KEY = 'kz.token'

function read(): Session | null {
  let token: string | null = null
  try {
    token = localStorage.getItem(KEY)
  } catch {
    return null
  }
  return token ? decode(token) : null
}

let current = read()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

// Otra pestaña entra o sale: todas siguen la misma sesión.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  current = read()
  emit()
})

export const getSession = (): Session | null => current

let endReason: EndReason = null
export const getEndReason = (): EndReason => endReason

export function setToken(token: string): void {
  localStorage.setItem(KEY, token)
  current = decode(token)
  endReason = null
  emit()
}

export function clearToken(reason: EndReason = null): void {
  endReason = reason
  try {
    localStorage.removeItem(KEY)
  } catch {
    // sin almacenamiento no hay nada que borrar
  }
  current = null
  emit()
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
