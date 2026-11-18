import { expect, test, type Page } from '@playwright/test'

// Catálogo del panel (/admin/memberships, /admin/disciplines, /admin/documents) sin tocar la BD, staging ni Stripe: token
// falso de admin en `kz.token` y toda la API simulada con page.route. Las escrituras se anotan aquí; nada cambia precios ni publica.
// Reloj fijo: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (d: string) => new Date(`${d}T10:00:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const plan = (id: string, name: string, cents: number, max: number | null, extra: object = {}) => ({ id, name, price_cents: cents, billing_period: 'month', max_disciplines: max, min_age: null, max_age: null, is_active: true, is_featured: false, eligible_discipline_ids: [], ...extra })
const PLANS = [
  plan('1', 'Infantil', 3900, 1, { min_age: 4, max_age: 12, eligible_discipline_ids: ['3', '5'] }),
  plan('3', 'Mensual 2 disciplinas', 6500, 2, { is_featured: true }),
  plan('5', 'Trimestral antiguo', 11000, 2, { is_active: false }),
]
const disc = (id: string, name: string, extra: object = {}) => ({ id, name, min_age: null, max_age: null, is_active: true, is_open: false, medal_theme: null, ...extra })
const DISCS = [disc('1', 'Brazilian Jiu-Jitsu', { medal_theme: 'ippo' }), disc('2', 'Open mat', { is_open: true }), disc('3', 'Judo infantil', { min_age: 4, max_age: 12 }), disc('4', 'Kickboxing', { is_active: false }), disc('5', 'Grappling', { min_age: 14 })]
const doc = (id: string, version: string, status: string, extra: object = {}) => ({ id, type: 'data_protection', version, checksum: 'x', created_at: at('2026-01-10'), published_at: null, retired_at: null, status, ...extra })
const DOCS = [
  doc('d1', '2.0', 'published', { published_at: at('2026-06-02') }),
  doc('d2', '2.1', 'created', { created_at: at('2026-11-15') }),
  doc('d3', '1.1', 'retired', { published_at: at('2026-02-01'), retired_at: at('2026-06-02') }),
  doc('d4', '1.0', 'retired', { published_at: at('2025-09-01'), retired_at: at('2026-02-01') }),
]

type Opts = { saveError?: { status: number; code: string; fields?: string[] } }
async function open(page: Page, url: string, o: Opts = {}) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const writes: string[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const m = r.request().method()
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (m !== 'GET') {
      writes.push(`${m} ${p}${u.search}`)
      if (o.saveError) return r.fulfill({ status: o.saveError.status, json: { code: o.saveError.code, fields: o.saveError.fields } })
      return r.fulfill({ json: { ok: true } })
    }
    if (p === '/admin/plans') return r.fulfill({ json: { plans: PLANS } })
    if (p === '/admin/disciplines') return r.fulfill({ json: { disciplines: DISCS } })
    if (p === '/admin/medal-themes') return r.fulfill({ json: { themes: [] } })
    if (p === '/admin/agreements/documents') return r.fulfill({ json: { documents: DOCS } })
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return { writes }
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('membresías a 375: una fila por membresía con precio, elegibles por nombre y solo el estado que se sale', async ({ page }) => {
  await open(page, '/admin/memberships')
  const infantil = page.getByRole('button', { name: /^Infantil/ })
  await expect(infantil).toContainText('39,00 €')
  await expect(infantil).toContainText('Elige 1 entre Judo infantil y Grappling')
  await expect(infantil).not.toContainText('Activa')
  await expect(page.getByRole('button', { name: /^Mensual 2 disciplinas/ })).toContainText('Recomendada')
  await expect(page.getByRole('button', { name: /^Trimestral antiguo/ })).toContainText('Retirada')
  await expect(page.getByRole('table')).toBeHidden()
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('membresías a 1280: la tabla cabe entera con sus acciones; cambiar el precio pide confirmación y dice a quién se avisa', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { writes } = await open(page, '/admin/memberships')
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  await expect(table.getByRole('row', { name: /Infantil/ })).toContainText('Elige 1 entre Judo infantil y Grappling')
  expect(await page.evaluate(() => [...document.querySelectorAll('main .overflow-x-auto')].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.scrollWidth - e.clientWidth).every((d) => d === 0))).toBe(true)
  await page.getByRole('button', { name: 'Editar la membresía Mensual 2 disciplinas', exact: true }).click()
  await page.getByLabel('Precio al mes (€)').fill('69,90')
  await page.getByRole('button', { name: 'Cambiar el precio', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('desde su siguiente cobro')
  await expect(confirm).toContainText('La app no avisa a los suscriptores.')
  expect(writes).toEqual([])
  await confirm.getByRole('button', { name: 'Cambiar el precio', exact: true }).click()
  await expect.poll(() => writes).toEqual(['PATCH /admin/plans/3'])
})

test('membresías: con suscriptores, el 409 se dice en el campo que no se puede cambiar', async ({ page }) => {
  await open(page, '/admin/memberships', { saveError: { status: 409, code: 'plan_has_subscriptions', fields: ['min_age'] } })
  await page.getByRole('button', { name: /^Mensual 2 disciplinas/ }).click()
  await page.getByLabel('Edad mínima').fill('8')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Con suscriptores no se cambia.')).toBeVisible()
  await expect(page.getByLabel('Edad mínima')).toHaveAttribute('aria-invalid', 'true')
})

test('disciplinas: abierta y desactivada con icono; desactivar avisa de lo que pasa antes de guardar', async ({ page }) => {
  const { writes } = await open(page, '/admin/disciplines')
  await expect(page.getByRole('button', { name: /^Open mat/ })).toContainText('Abierta')
  await expect(page.getByRole('button', { name: /^Kickboxing/ })).toContainText('Desactivada')
  await expect(page.getByRole('button', { name: /^Judo infantil/ })).toContainText('4–12 años')
  await page.getByRole('button', { name: /^Brazilian Jiu-Jitsu/ }).click()
  await page.getByRole('switch', { name: 'Activa' }).click()
  await page.getByRole('button', { name: 'Desactivar', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('avisa a quienes tenían reserva')
  expect(writes).toEqual([])
})

test('documentos: vigente y borrador a la vista, retirados plegados; sin vigente, solo el aviso; publicar confirma', async ({ page }) => {
  const { writes } = await open(page, '/admin/documents')
  const data = page.getByRole('region', { name: 'Protección de datos', exact: true })
  await expect(data.getByText('Versión 2.0')).toBeVisible()
  await expect(data.getByText('Versión 1.1')).toBeHidden()
  await data.getByText('2 versiones anteriores').click()
  await expect(data.getByText('Versión 1.1')).toBeVisible()
  const image = page.getByRole('region', { name: 'Derechos de imagen', exact: true })
  await expect(image).toContainText('Aún no hay documento publicado')
  await expect(image.getByText('Sin documentos')).toHaveCount(0)
  await page.getByRole('button', { name: 'Publicar la versión 2.1', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('tendrán que volver a firmar')
  expect(writes).toEqual([])
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publicar y avisar', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/agreements/documents/d2/publish'])
})

test('subir: los errores salen en su campo y no antes de elegir el PDF', async ({ page }) => {
  await open(page, '/admin/documents', { saveError: { status: 409, code: 'version_exists_different_content' } })
  await page.getByRole('button', { name: 'Subir', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Protección de datos' }).click()
  await dlg.getByLabel('Versión').fill('2.1')
  await expect(dlg.getByRole('alert')).toHaveCount(0)
  await dlg.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.alloc(100) })
  await expect(dlg.getByRole('alert')).toHaveText('El archivo tiene que ser un PDF.')
  await dlg.locator('input[type=file]').setInputFiles({ name: 'grande.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024) })
  await expect(dlg.getByRole('alert')).toHaveText('El PDF pesa más de 10 MB.')
  await dlg.locator('input[type=file]').setInputFiles({ name: 'v.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await dlg.getByRole('button', { name: 'Subir como borrador', exact: true }).click()
  await expect(dlg.getByText('Esa versión ya existe con otro PDF; usa otra versión.')).toBeVisible()
})
