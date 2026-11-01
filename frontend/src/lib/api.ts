import { getSession } from '@/lib/session'

// ADR 0013: la API vive bajo /api (Nginx y el proxy de Vite quitan el prefijo).
export class ApiError extends Error {
  status: number
  code: string
  field?: string
  details: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.code ?? 'unknown'))
    this.status = status
    this.code = String(body.code ?? 'unknown')
    this.field = typeof body.field === 'string' ? body.field : undefined
    this.details = body
  }
}

type Options = { method?: string; body?: unknown; auth?: boolean }

let onUnauthorized: () => void = () => {}
// La sesión caducada la resuelve quien monta el router (cierra sesión y va a /login).
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

async function once<T>(path: string, { method = 'GET', body, auth = true }: Options): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const session = getSession()
  if (auth && session) headers.Authorization = `Bearer ${session.token}`

  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, { code: 'network' })
  }

  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (res.ok) return data as T

  const err = new ApiError(res.status, data)
  if (res.status === 401 && auth && session && (err.code === 'invalid_token' || err.code === 'missing_token')) {
    onUnauthorized()
  }
  throw err
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  try {
    return await once<T>(path, options)
  } catch (err) {
    // El backend pide repetir una vez cuando dos reservas chocan; si vuelve a chocar, se enseña el error.
    if (err instanceof ApiError && err.code === 'booking_conflict_retry') return once<T>(path, options)
    throw err
  }
}
