import { expect, test, type Page } from '@playwright/test'

// Rankings (/rankings y /rankings/:id) con todo simulado en el navegador (page.route): no escribe nada en la base de datos y
// no hace login (token de cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. Hora fija en Madrid.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`
const NOMBRES = ['Marta Ruiz', 'Iván Soto', 'Lucía Prieto', 'Carlos Méndez', 'Ana Beltrán', 'Pablo Ortega']
// Empate en el 3.º: el podio enseña las tres primeras filas y el empatado abre la lista con su puesto real.
const RANKS = [1, 2, 3, 3, 5, 6]
const filas = (medallas: boolean) =>
  NOMBRES.map((display_name, i) => ({ rank: RANKS[i], id: `p${i}`, display_name, hours: 100 - i * 10, ...(medallas ? { medals: 12 - i } : {}) }))
const disciplina = (id: number, name: string, is_open = false) => ({ id, name, is_active: true, is_open, max_age: null })

type Opciones = { abierta?: boolean; vacio?: boolean; fallo?: boolean }
async function abrir(page: Page, { abierta, vacio, fallo }: Opciones = {}, url = '/rankings') {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json({ id: 'u-1', role: 'alumno', display_name: 'Prueba', email: 'p@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: false, minor: null })
    if (u === '/me/children') return json({ children: [] })
    if (u === '/me/profile') return json({ is_public: true, visible_fields: { ranking: true } })
    if (u === '/disciplines') return json({ disciplines: [disciplina(1, 'Judo', abierta), disciplina(2, 'Kárate')] })
    const m = u.match(/^\/rankings\/(\d+)(\/medals)?$/)
    if (m) {
      if (fallo) return json({ code: 'internal' }, 500)
      const rows = vacio ? [] : filas(!!m[2])
      return json({ discipline: { id: m[1], name: 'Judo' }, ...(m[2] ? {} : { month: '2026-11' }), rows, total: rows.length, limit: 20 })
    }
    return json({})
  })
  await page.goto(url)
}
const podio = (page: Page) => page.getByRole('region', { name: 'Podio' }).getByRole('listitem')
const resto = (page: Page) => page.getByRole('region', { name: 'Resto del ranking' }).getByRole('listitem')

test('medallas: podio con los tres primeros sobre el pliegue y el empatado abre la lista', async ({ page }) => {
  await abrir(page)
  await expect(podio(page)).toHaveCount(3)
  await expect(podio(page).first()).toContainText('Marta Ruiz')
  await expect(podio(page).first()).toContainText('12 medallas')
  await expect(resto(page).first()).toContainText('3Carlos Méndez')
  await expect(page.getByText('Top 20 · 6 participan')).toBeVisible()
  // El podio entero cabe por encima de la barra inferior (64 px) en 812 px.
  const caja = (await page.getByRole('region', { name: 'Podio' }).boundingBox())!
  expect(caja.y + caja.height).toBeLessThanOrEqual(812 - 64)
  await expect(podio(page).first().getByRole('link')).toHaveAttribute('href', '/profiles/p0')
})

test('segmentado: las flechas pasan a horas del mes y la URL lo recuerda', async ({ page }) => {
  await abrir(page)
  const medallas = page.getByRole('radio', { name: 'Medallas' })
  await expect(medallas).toHaveAttribute('aria-checked', 'true')
  await medallas.focus()
  await page.keyboard.press('ArrowRight')
  const horas = page.getByRole('radio', { name: 'Horas del mes' })
  await expect(horas).toBeFocused()
  await expect(horas).toHaveAttribute('aria-checked', 'true')
  await expect(page).toHaveURL(/\?ver=mes$/)
  await expect(page.getByText('Noviembre de 2026', { exact: false })).toBeVisible()
  await expect(podio(page).first()).toContainText('100 h')
  for (const r of await page.getByRole('radio').all()) expect(Math.round((await r.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
})

test('disciplina abierta: sin segmentado, con la nota', async ({ page }) => {
  await abrir(page, { abierta: true })
  await expect(page.getByText('Las disciplinas abiertas solo tienen ranking de medallas.')).toBeVisible()
  await expect(page.getByRole('radiogroup')).toHaveCount(0)
  await expect(podio(page)).toHaveCount(3)
})

test('vacío y error con reintento', async ({ page }) => {
  await abrir(page, { vacio: true })
  await expect(page.getByText('Aún nadie en el ranking de medallas')).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await abrir(page, { fallo: true })
  await expect(page.getByRole('button', { name: /reintentar/i })).toBeVisible()
})
