import { ApiError } from '@/lib/api'
import { getSession } from '@/lib/session'

// El PDF vigente de un tipo y su versión (X-Agreement-Version). Va con Bearer, así que no se puede abrir con un
// enlace directo: se baja y se abre su URL temporal (en memoria, nada queda en el dispositivo).
export async function fetchAgreement(type: string): Promise<{ version: string; url: string }> {
  const token = getSession()?.token
  let res: Response
  try {
    res = await fetch(`/api/agreements/${type}/current`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError(0, { code: 'network' })
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})))
  const version = res.headers.get('X-Agreement-Version')
  if (!version) throw new ApiError(500, { code: 'internal_error' })
  return { version, url: URL.createObjectURL(await res.blob()) }
}
