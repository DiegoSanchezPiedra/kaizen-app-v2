// Lo que la app enseña como «Algo ha fallado» se manda a POST /client-errors (src/routes/client-errors.js) con la versión de
// la build: en el móvil no hay consola y, sin esto, la causa real no quedaba en ningún sitio. Nunca lanza.
export const BUILD: string = import.meta.env.VITE_BUILD ?? 'dev'

type Info = { where: string; code?: string; status?: number }
let last = ''

export function reportError(err: unknown, { where, code, status }: Info): void {
  const e = err instanceof Error ? err : undefined
  const body = {
    where,
    code,
    status,
    name: e?.name,
    message: e ? e.message : String(err),
    stack: e?.stack,
    version: BUILD,
    url: location.pathname,
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  }
  console.error(`[${where}]`, err)
  const key = `${where}|${code}|${body.message}`
  if (key === last) return // el mismo fallo leído dos veces (errorCode y el aviso) cuenta una
  last = key
  // fetch directo, no api(): si el fallo es de la API, no se vuelve a reportar a sí mismo.
  void fetch('/api/client-errors', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}
