import { expect, test, type Page } from '@playwright/test'

// /tablet sin tocar la BD: token de dispositivo falso, `/tablet/link` simulado y el SSE sustituido en `fetch`.
// page.route cierra el cuerpo al responder (la tablet pasaría a «reconectando»), así que el directo es un
// ReadableStream que no se cierra; window.__push manda un `feed` y window.__end corta la conexión.
test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: true })

const NOW = new Date('2026-11-17T18:00:00+01:00')
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString()
const SESSIONS = [
  { session_id: 's1', discipline: 'Brazilian Jiu-Jitsu', starts_at: at(-5), ends_at: at(55) },
  { session_id: 's2', discipline: 'Muay Thai', starts_at: at(12), ends_at: at(72) },
  { session_id: 's3', discipline: 'Judo infantil', starts_at: at(20), ends_at: at(80) },
  { session_id: 's4', discipline: 'Kickboxing', starts_at: at(25), ends_at: at(85) },
  { session_id: 's5', discipline: 'Grappling sin kimono', starts_at: at(28), ends_at: at(88) },
]

type Win = Window & { __push?: (o: unknown) => void; __end?: () => void; __ended?: boolean }

async function open(page: Page, o: { linked?: boolean; sse?: 'stream' | 'revoked'; install?: boolean } = {}) {
  const { linked = true, sse = 'stream', install = false } = o
  if (install) await page.clock.install({ time: NOW })
  else await page.clock.setFixedTime(NOW)
  if (linked) await page.addInitScript(() => localStorage.setItem('kz.device', 'dev-falso'))
  await page.addInitScript((mode) => {
    const w = window as Win
    const real = window.fetch
    window.fetch = (url, init) => {
      if (!String(url).includes('/api/tablet/active-sessions')) return real(url, init)
      if (mode === 'revoked') return Promise.resolve(new Response(null, { status: 401 }))
      if (w.__ended) return new Promise(() => {}) // tras cortar, el reintento se queda colgado
      const enc = new TextEncoder()
      const body = new ReadableStream({
        start(c) {
          w.__push = (d) => c.enqueue(enc.encode(`event: feed\ndata: ${JSON.stringify(d)}\n\n`))
          w.__end = () => {
            w.__ended = true
            c.close()
          }
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('abort', 'AbortError')))
        },
      })
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
  }, sse)
  await page.route('**/api/tablet/link', (r) => r.fulfill({ status: 400, json: { code: 'invalid_link_code' } }))
  await page.goto('/tablet')
}

async function push(page: Page, sessions = SESSIONS) {
  await page.waitForFunction(() => (window as Win).__push)
  await page.evaluate((s) => (window as Win).__push?.({ qr: 'kz1:dev:1:abc', expires_in: 30, sessions: s }), sessions)
}

const qr = (page: Page) => page.getByRole('img', { name: 'Código QR para hacer check-in' })

test('sin vincular: el código se ve en mayúsculas y un código que no vale lo dice', async ({ page }) => {
  await open(page, { linked: false })
  const field = page.getByLabel('Código de vinculación')
  await expect(field).toHaveAttribute('enterkeyhint', 'go')
  await field.fill('abcd-1234')
  await expect(field).toHaveCSS('text-transform', 'uppercase')
  await field.press('Enter')
  await expect(page.getByText('Este código no vale', { exact: false })).toBeVisible()
  // el botón queda por encima del teclado en pantalla (más o menos la mitad baja a 768 de alto)
  const box = await page.getByRole('button', { name: 'Vincular', exact: true }).boundingBox()
  expect(box!.y + box!.height).toBeLessThan(768 / 2 + 80)
})

test('en directo con 5 sesiones: título visible, «y N sesiones más» y sin scroll', async ({ page }) => {
  await open(page)
  await push(page)
  await expect(qr(page)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Conectada' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Escanea para hacer check-in' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByText('Ha empezado', { exact: true })).toBeVisible()
  await expect(page.getByText('En 12 min', { exact: true })).toBeVisible()
  await expect(page.getByText(/^y \d sesiones más$/)).toBeVisible()
  const items = page.getByRole('region', { name: 'Check-in abierto' }).getByRole('listitem')
  for (const li of await items.all()) await expect(li).toBeInViewport({ ratio: 1 })
  expect(await page.locator('main').evaluate((m) => m.scrollHeight <= m.clientHeight)).toBe(true)
})

test('sin sesiones: el QR sigue y lo dice', async ({ page }) => {
  await open(page)
  await push(page, [])
  await expect(qr(page)).toBeVisible()
  await expect(page.getByText('No hay sesiones con el check-in abierto')).toBeVisible()
})

test('reconectando con el código aún válido: el QR sigue a la vista', async ({ page }) => {
  await open(page)
  await push(page)
  await page.evaluate(() => (window as Win).__end?.())
  await expect(page.getByRole('status').filter({ hasText: 'Reconectando…' })).toBeVisible()
  await expect(qr(page)).toBeVisible()
})

test('en pausa (el QR caduca): se oculta, dice por qué y deja reintentar', async ({ page }) => {
  await open(page, { install: true })
  await push(page)
  await expect(qr(page)).toBeVisible()
  await page.clock.runFor(61_000) // expires_in 30 + un periodo de 30
  await expect(qr(page)).toHaveCount(0)
  await expect(page.getByText('Un código antiguo no vale', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check-in en pausa' })).toBeVisible()
  const retry = await page.getByRole('button', { name: 'Reintentar ahora' }).boundingBox()
  expect(Math.round(retry!.height)).toBeGreaterThanOrEqual(44)
})

test('sin conexión: sin QR y «Sin internet»', async ({ page }) => {
  await open(page)
  await push(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.getByText('Sin internet', { exact: true })).toBeVisible()
  await expect(qr(page)).toHaveCount(0)
})

test('revocada (401): vuelve a vincular y lo avisa', async ({ page }) => {
  await open(page, { sse: 'revoked' })
  await expect(page.getByText('Esta tablet se ha desvinculado')).toBeVisible()
  await expect(page.getByLabel('Código de vinculación')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('kz.device'))).toBeNull()
})
