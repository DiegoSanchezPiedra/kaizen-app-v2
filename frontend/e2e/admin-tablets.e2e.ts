import { expect, test, type Page } from '@playwright/test'

// Tablets y Ajustes del panel (/admin/tablets, /admin/settings) sin tocar la BD ni staging: token falso de admin en `kz.token`
// y toda la API simulada con page.route. El código de vinculación es inventado; las escrituras se anotan aquí.
// Reloj: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (d: string, h = '10:00') => new Date(`${d}T${h}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const tablet = (id: string, name: string, o: object = {}) => ({ id, name, link_expires_at: null, created_at: at('2026-10-01'), linked_at: null, last_seen_at: null, revoked_at: null, ...o })
const TABLETS = [
  tablet('t1', 'Recepción', { linked_at: at('2026-10-02', '09:15'), last_seen_at: at('2026-11-18', '18:09') }),
  tablet('t2', 'Sala 2 · tatami grande de la planta de arriba junto a los vestuarios', { linked_at: at('2026-03-12', '17:40'), last_seen_at: at('2026-11-12', '21:30') }),
  tablet('t3', 'Sala 1', { link_expires_at: at('2026-11-18', '18:40') }),
  tablet('t4', 'Tablet vieja', { link_expires_at: at('2026-11-10', '12:30') }),
  tablet('t5', 'Entrada antigua', { linked_at: at('2025-09-01'), last_seen_at: at('2026-01-20', '20:00'), revoked_at: at('2026-01-21', '10:00') }),
]
const settings = (price: number | null) => ({ checkin: { opens_minutes: 30, closes_minutes: 60, qr_seconds: 30 }, discipline_changes: { per_period: 1 }, pause: { price_cents: price, max_months: 3, per_year: 1 }, rankings: { top: 10 } })

type Opts = { price?: number | null; invalid?: string }
async function open(page: Page, url: string, o: Opts = {}) {
  await page.clock.install({ time: NOW })
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const writes: string[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const m = r.request().method()
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (m !== 'GET') {
      writes.push(`${m} ${p} ${r.request().postData() ?? ''}`.trim())
      if (o.invalid) return r.fulfill({ status: 400, json: { code: 'invalid_field', field: o.invalid } })
      if (p === '/admin/tablets') return r.fulfill({ status: 201, json: { tablet: tablet('t9', 'Sala 3', { link_code: 'K7QX-M2PA', link_expires_at: at('2026-11-18', '18:40') }) } })
      return r.fulfill({ json: { ok: true } })
    }
    if (p === '/admin/tablets') return r.fulfill({ json: { tablets: TABLETS } })
    if (p === '/admin/settings') return r.fulfill({ json: settings(o.price ?? null) })
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return { writes }
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const group = (page: Page, title: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

test('tablets a 375: una fila por tablet con su estado en texto, «Sin conexión» a más de 24 h y fechas con año', async ({ page }) => {
  await open(page, '/admin/tablets')
  const rows = page.locator('main ul > li')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('Vinculada')
  await expect(rows.nth(0)).toContainText('Vista el 18 nov 2026 · 18:09')
  await expect(rows.nth(1)).toContainText('Sin conexión')
  await expect(rows.nth(2)).toContainText('Esperando vinculación')
  await expect(rows.nth(2)).toContainText('El código caduca a las 18:40')
  await expect(rows.nth(3)).toContainText('Código caducado')
  await expect(rows.nth(4)).toContainText('Revocada el 21 ene 2026 · 10:00')
  await expect(rows.nth(4).getByRole('button', { name: /Revocar/ })).toHaveCount(0)
  await expect(page.getByRole('table')).toBeHidden()
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('tablets a 1440: la tabla cabe entera y «Revocar» se ve sin desplazar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/admin/tablets')
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  const revoke = table.getByRole('button', { name: 'Revocar Recepción', exact: true })
  await expect(revoke).toBeInViewport({ ratio: 1 })
  expect((await revoke.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await table.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth)).toBe(0)
})

test('nueva tablet: el error de la API va en su campo', async ({ page }) => {
  await open(page, '/admin/tablets', { invalid: 'name' })
  await page.getByRole('button', { name: 'Nueva tablet', exact: true }).click()
  await page.getByLabel('Nombre').fill('Sala 3')
  await page.getByRole('button', { name: 'Crear y ver el código' }).click()
  await expect(page.getByText('Escribe un nombre de 1 a 100 caracteres.')).toBeVisible()
})

test('nueva tablet: el código grande se copia y avisa cuando caduca', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { writes } = await open(page, '/admin/tablets')
  await page.getByRole('button', { name: 'Nueva tablet', exact: true }).click()
  await page.getByLabel('Nombre').fill('Sala 3')
  await page.getByRole('button', { name: 'Crear y ver el código' }).click()
  const dialog = page.getByRole('dialog', { name: 'Código de Sala 3' })
  await expect(dialog.getByLabel('Código de vinculación')).toHaveText('K7QX-M2PA')
  await expect(dialog).toContainText('Caduca a las 18:40 (en 30 min); solo se ve ahora.')
  expect(writes).toEqual(['POST /admin/tablets {"name":"Sala 3"}'])
  await dialog.getByRole('button', { name: 'Copiar', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Copiado', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('K7QX-M2PA')
  await page.clock.runFor(31 * 60_000)
  await expect(dialog).toContainText('El código ha caducado. Revoca esta tablet y crea otra.')
  await expect(dialog.getByRole('button', { name: /^Cop/ })).toBeDisabled()
})

test('revocar pide confirmación y solo entonces llama a la API', async ({ page }) => {
  const { writes } = await open(page, '/admin/tablets')
  await page.getByRole('button', { name: 'Revocar Recepción', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('La tablet deja de mostrar el QR al momento')
  expect(writes).toEqual([])
  await confirm.getByRole('button', { name: 'Revocar', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/tablets/t1/revoke'])
})

test('ajustes: un valor inválido no se guarda; «Cambios sin guardar» y «Descartar» vuelven a lo guardado', async ({ page }) => {
  await open(page, '/admin/settings')
  const rankings = group(page, 'Rankings')
  await expect(rankings.getByText('Cambios sin guardar')).toHaveCount(0)
  await page.getByLabel('Puestos (top)').fill('0')
  await expect(rankings.getByText('Cambios sin guardar')).toBeVisible()
  await expect(rankings.getByText('Escribe un número entero entre 1 y 100.')).toBeVisible()
  await expect(rankings.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled()
  await expect(rankings.getByText('Corrige el campo en rojo para guardar.')).toBeVisible()
  await rankings.getByRole('button', { name: 'Descartar', exact: true }).click()
  await expect(page.getByLabel('Puestos (top)')).toHaveValue('10')
  await expect(rankings.getByText('Cambios sin guardar')).toHaveCount(0)
})

test('ajustes: el check-in confirma antes del PUT', async ({ page }) => {
  const { writes } = await open(page, '/admin/settings')
  await page.getByLabel('Abre (minutos antes)').fill('45')
  await group(page, 'Check-in').getByRole('button', { name: 'Guardar', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('todas las sesiones')
  expect(writes).toEqual([])
  await confirm.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => writes).toEqual(['PUT /admin/settings/checkin {"opens_minutes":45,"closes_minutes":60,"qr_seconds":30}'])
})

test('ajustes: el primer precio de la pausa avisa de que no se puede quitar', async ({ page }) => {
  const { writes } = await open(page, '/admin/settings')
  await page.getByLabel('Cuota de mantenimiento al mes (€)').fill('12,50')
  await group(page, 'Pausa').getByRole('button', { name: 'Guardar', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Podrás cambiar el precio, pero no quitarlo.')
  await confirm.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect.poll(() => writes).toEqual(['PUT /admin/settings/pause {"price_cents":1250,"max_months":3,"per_year":1}'])
})

test('ajustes con precio: vaciarlo se explica en el campo y no deja guardar', async ({ page }) => {
  await open(page, '/admin/settings', { price: 1250 })
  const pause = group(page, 'Pausa')
  await page.getByLabel('Cuota de mantenimiento al mes (€)').fill('')
  await expect(pause.getByText('El precio no se puede quitar.', { exact: false })).toBeVisible()
  await expect(pause.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled()
})

test('ajustes: el invalid_field de la API va en su campo con el rango', async ({ page }) => {
  await open(page, '/admin/settings', { invalid: 'top' })
  await page.getByLabel('Puestos (top)').fill('20')
  const rankings = group(page, 'Rankings')
  await rankings.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(rankings.getByText('Escribe un número entero entre 1 y 100.')).toBeVisible()
})

test('ajustes: salir con cambios pregunta, y «Seguir aquí» los conserva', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await open(page, '/admin/settings')
  await page.getByLabel('Puestos (top)').fill('20')
  await page.getByRole('link', { name: 'Tablets', exact: true }).click()
  const leave = page.getByRole('alertdialog', { name: '¿Salir sin guardar?' })
  await expect(leave).toContainText('Se pierden los cambios de Rankings.')
  await leave.getByRole('button', { name: 'Seguir aquí', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/settings$/)
  await expect(page.getByLabel('Puestos (top)')).toHaveValue('20')
  await page.getByRole('link', { name: 'Tablets', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Salir sin guardar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/tablets$/)
})
