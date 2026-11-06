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

// `body` Blob: cuerpo crudo con su propio tipo (el PDF de un documento). `blob`: la respuesta es un archivo, no JSON.
type Options = { method?: string; body?: unknown; auth?: boolean; blob?: boolean }

let onUnauthorized: (reason?: 'password_changed') => void = () => {}
let onWrongRole: () => void = () => {}
// La sesión caducada y el rol que ya no vale los resuelve quien monta el router (cierra sesión y va a /login).
export const setUnauthorizedHandler = (fn: (reason?: 'password_changed') => void) => {
  onUnauthorized = fn
}
export const setWrongRoleHandler = (fn: () => void) => {
  onWrongRole = fn
}

async function once<T>(path: string, { method = 'GET', body, auth = true, blob }: Options): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const raw = body instanceof Blob
  if (body !== undefined) headers['Content-Type'] = raw ? body.type : 'application/json'
  const session = getSession()
  if (auth && session) headers.Authorization = `Bearer ${session.token}`

  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, { code: 'network' })
  }

  if (res.status === 204) return undefined as T
  if (res.ok && blob) return (await res.blob()) as T
  const data = await res.json().catch(() => null)
  // Un 200 que no es JSON (una página de un proxy) no es una respuesta de la API: nunca se da por buena.
  if (res.ok) {
    if (data === null) throw new ApiError(res.status, { code: 'bad_response' })
    return data as T
  }

  const err = new ApiError(res.status, data ?? {})
  // session_revoked: el token es anterior a un cambio de contraseña (ADR 0020).
  if (res.status === 401 && auth && session && (err.code === 'invalid_token' || err.code === 'missing_token')) onUnauthorized()
  if (res.status === 401 && auth && session && err.code === 'session_revoked') onUnauthorized('password_changed')
  if (res.status === 403 && auth && session && err.code === 'insufficient_role') onWrongRole()
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
