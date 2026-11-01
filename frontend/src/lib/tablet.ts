// Lógica pura de la tablet (B18.5): lector del SSE, espera de reconexión y qué se ve en cada momento.
// El token de la tablet es otro que el de usuario y tiene su propia clave (ADR 0014).
const KEY = 'kz.device'

export const getDeviceToken = (): string | null => localStorage.getItem(KEY)
export const setDeviceToken = (token: string) => localStorage.setItem(KEY, token)
export const clearDeviceToken = () => localStorage.removeItem(KEY)

export type SseEvent = { event: string; data: unknown }

// Lector de `text/event-stream` por trozos: un evento puede llegar partido entre dos lecturas.
// Solo entiende `event:` y `data:`; los comentarios (`:`) y otros campos se ignoran.
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n')
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    const events: SseEvent[] = []
    for (const block of blocks) {
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (!data.length) continue
      try {
        events.push({ event, data: JSON.parse(data.join('\n')) })
      } catch {
        // dato que no es JSON: no es de este backend, se ignora
      }
    }
    return events
  }
}

// Espera creciente entre intentos: 1, 2, 4, 8, 16 y 30 s como máximo (el intento 1 es el primero tras la caída).
export const backoffSeconds = (attempt: number): number => Math.min(30, 2 ** Math.max(0, attempt - 1))

// Lo que manda `tablet_feed` (migración 011): `discipline` es el nombre de la disciplina; `docs/api.md` decía `id` y `name`.
export type TabletSession = { session_id: string; discipline: string; starts_at: string; ends_at: string }
export type Feed = { qr: string; expires_in: number; sessions: TabletSession[] }
export type Received = { feed: Feed; at: number; period: number }

// El periodo del QR es de 30 s salvo que la academia lo cambie; hasta medirlo entre dos `feed` se supone ese.
export const DEFAULT_PERIOD = 30

// El servidor acepta el QR de su paso y el anterior: un `feed` vale `expires_in` más un periodo. Contar solo
// `expires_in` escondería el QR cada vez, porque el siguiente `feed` llega un periodo entero después del anterior.
export const validUntil = ({ feed, at, period }: Received): number => at + (feed.expires_in + period) * 1000

export type View = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline'

export function viewOf(o: { online: boolean; received: Received | null; down: boolean; now: number }): View {
  if (!o.online) return 'offline'
  if (!o.received) return o.down ? 'paused' : 'connecting'
  if (o.now >= validUntil(o.received)) return 'paused'
  return o.down ? 'reconnecting' : 'live'
}

// Código de vinculación: 8 caracteres; da igual mayúsculas, espacios o guiones.
export const normalizeLinkCode = (text: string): string => text.replace(/[\s-]/g, '').toUpperCase()

// «En N min» antes de empezar y «Ha empezado» después.
export function sessionBadge(startsAt: string, now: number): { text: string; started: boolean } {
  const minutes = Math.ceil((new Date(startsAt).getTime() - now) / 60000)
  return minutes > 0 ? { text: `En ${minutes} min`, started: false } : { text: 'Ha empezado', started: true }
}
