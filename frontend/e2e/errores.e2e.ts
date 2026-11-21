import { expect, test } from '@playwright/test'

// «Algo ha fallado» ya no esconde la causa: dice de dónde viene (servidor, red intermedia) y la manda a POST /client-errors
// con la versión de la build. API simulada en el navegador (page.route): no escribe en la base. Solo necesita E2E_BASE_URL.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`

for (const [name, reply, text] of [
  ['un 500 de la API', { status: 500, json: { code: 'internal_error' } }, 'El servidor ha fallado'],
  ['una página de un proxy (no JSON)', { status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' }, 'No hemos podido hablar con el servidor'],
] as const) {
  test(`${name}: lo dice y lo reporta con la versión`, async ({ page }) => {
    const reports: Record<string, unknown>[] = []
    await page.addInitScript((t) => localStorage.setItem('kz.token', t), token)
    await page.route('**/api/**', (r) => {
      const path = new URL(r.request().url()).pathname
      if (path === '/api/client-errors') {
        reports.push(r.request().postDataJSON())
        return r.fulfill({ status: 204 })
      }
      return r.fulfill(reply)
    })
    await page.goto('/bookings')
    await expect(page.getByText(text).first()).toBeVisible()
    await expect.poll(() => reports.find((x) => String(x.where).startsWith('api /'))).toMatchObject({
      status: reply.status,
      code: reply.status === 500 ? 'internal_error' : 'bad_response',
      version: expect.any(String),
    })
  })
}
