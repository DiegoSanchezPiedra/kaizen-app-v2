import { expect, test, type Page } from '@playwright/test'

// Jornada del panel (/admin/clock y /admin/clock/print) con la API simulada (page.route): no escribe en la base de datos.
// Token falso de admin. Reloj fijo: miércoles 18-nov-2026 18:10 en Madrid. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const at = (day: number, hm: string) => new Date(`2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`).toISOString()
const E = (day: number, id: string, kind: string, hm: string) => ({ id: `${day}-${id}`, kind, at: at(day, hm), origin: 'app' })
const closed = (day: number) => ({
  date: `2026-11-${day}`,
  worked_seconds: 6.5 * 3600,
  pause_seconds: 1800,
  open: false,
  events: [E(day, 'in', 'in', '09:00'), E(day, 'ps', 'pause_start', '13:00'), E(day, 'pe', 'pause_end', '13:30'), E(day, 'out', 'out', '16:00')],
})
const who = (name: string | null) => ({ id: name ? 'p-1' : 'a-1', display_name: name })
const PENDING = { id: 'c1', event_id: '16-out', kind: 'out', at: at(16, '17:45'), reason: 'Me quedé a recoger.', created_at: at(16, '19:00'), requested_by: who('Kenji Sato'), status: 'pending', resolved_by: null, resolved_at: null, resolution_reason: null }
const PENDING2 = { ...PENDING, id: 'c3', event_id: '10-out', at: at(10, '16:30'), reason: 'Cerré yo.' }
const APPLIED = { ...PENDING, id: 'c2', event_id: '10-in', kind: 'in', at: at(10, '08:45'), reason: 'La tablet no leyó el QR.', status: 'applied', resolved_by: who(null), resolved_at: at(10, '12:00') }
const month = (o: { open?: boolean; employment?: string; corrections?: object[]; empty?: boolean } = {}) => {
  const days: { events: object[] }[] = o.empty ? [] : [closed(10), closed(16)]
  if (o.open) days.push({ date: '2026-11-17', worked_seconds: 0, pause_seconds: 0, open: true, events: [E(17, 'in', 'in', '08:00')] } as never)
  return {
    profile: { id: 'p-1', display_name: 'Kenji Sato', employment: o.employment ?? 'employee' },
    month: '2026-11',
    state: o.open ? 'in' : 'out',
    total_seconds: o.empty ? 0 : 13 * 3600,
    days,
    events: days.flatMap((d) => d.events),
    corrections: o.corrections ?? [],
  }
}
const EMPLOYEES = [
  { id: 'p-2', display_name: 'Ana Ruiz', pending: 0, open_since: null, open_late: false },
  { id: 'p-1', display_name: 'Kenji Sato', pending: 0, open_since: at(17, '08:00'), open_late: true },
  { id: 'p-4', display_name: 'Lucía Pérez', pending: 2, open_since: null, open_late: false },
  { id: 'p-5', display_name: 'Marcos Gil', pending: 0, open_since: at(18, '16:30'), open_late: false },
]

type Api = { employees?: object[]; data?: object; fail?: boolean }
async function abrir(page: Page, url: string, api: Api = {}) {
  const posts: { url: string; body: unknown }[] = []
  const done = new Map<string, string>() // lo aplicado o rechazado: el siguiente GET lo trae resuelto
  await page.clock.setFixedTime(new Date('2026-11-18T18:10:00+01:00'))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token)
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (api.fail && p.startsWith('/admin/clock')) return r.fulfill({ status: 500, json: { code: 'internal' } })
    if (p === '/admin/clock/employees') return r.fulfill({ json: { employees: api.employees ?? EMPLOYEES } })
    if (p === '/admin/clock/export') return r.fulfill({ body: '﻿Fecha;Total\r\n', contentType: 'text/csv; charset=utf-8' })
    if (p === '/admin/clock') {
      const data = (api.data ?? month()) as { corrections: { id: string }[] }
      return r.fulfill({ json: { ...data, corrections: data.corrections.map((c) => (done.has(c.id) ? { ...c, status: done.get(c.id), resolved_by: who(null), resolved_at: at(18, '18:10') } : c)) } })
    }
    if (r.request().method() === 'POST') {
      posts.push({ url: p, body: r.request().postDataJSON() })
      const [, id, action] = p.match(/corrections\/([^/]+)\/(apply|reject)$/) ?? []
      if (id) done.set(id, action === 'apply' ? 'applied' : 'rejected')
      return r.fulfill({ status: 201, json: {} })
    }
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return posts
}
const MES = '/admin/clock?profile_id=p-1&month=2026-11'

test('lista: estado de cada profesor y primero los que piden mirarlos', async ({ page }) => {
  await abrir(page, '/admin/clock')
  await expect(page.getByText('4 profesores empleados')).toBeVisible()
  const rows = page.getByRole('main').getByRole('listitem')
  // Kenji (abierta > 16 h) y Lucía (pendientes) arriba; Ana y Marcos (abierta 1 h 40), después, por nombre.
  await expect(rows).toHaveText([/^Kenji Sato/, /^Lucía Pérez/, /^Ana Ruiz/, /^Marcos Gil/])
  await expect(rows.nth(0)).toContainText('Jornada abierta desde el 17 nov a las 8:00')
  await expect(rows.nth(1)).toContainText('2 correcciones pendientes')
  await expect(rows.nth(2)).toContainText('Al día')
  await expect(rows.nth(3)).toContainText('En jornada desde las 16:30')
  for (const h of await rows.getByRole('link').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44)
  await rows.nth(1).getByRole('link').click()
  await expect(page).toHaveURL(/profile_id=p-4/)
})

test('lista vacía', async ({ page }) => {
  await abrir(page, '/admin/clock', { employees: [] })
  await expect(page.getByText('No hay profesores empleados')).toBeVisible()
})

test('lista: error de red con Reintentar', async ({ page }) => {
  await abrir(page, '/admin/clock', { fail: true })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible({ timeout: 15_000 })
})

test('mes con pendientes: «Por revisar» primero; Aplicar confirma y Rechazar pide motivo; la resuelta baja a su sección', async ({ page }) => {
  const posts = await abrir(page, MES, { data: month({ corrections: [APPLIED, PENDING, PENDING2] }) })
  await expect(page.getByRole('heading', { name: 'Kenji Sato', level: 2 })).toBeVisible()
  await expect(page.getByRole('main').locator('section[aria-label]').first()).toHaveAttribute('aria-label', 'Por revisar · 2')
  await expect(page.getByRole('region', { name: 'Correcciones del mes' })).toContainText('Aplicada')

  await page.getByRole('button', { name: 'Aplicar', exact: true }).first().click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Se avisa al profesor por email')
  await confirm.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(page.getByText('Corrección aplicada')).toBeVisible() // el toast antes de esperar al cierre
  await expect(confirm).toBeHidden()
  expect(posts.at(-1)?.url).toBe('/admin/clock/corrections/c1/apply')
  const history = page.getByRole('region', { name: 'Correcciones del mes' })
  await expect(page.getByRole('region', { name: 'Por revisar · 1' })).toBeVisible()
  // Entra en su sección con enter-soft (solo la recién resuelta; la que ya estaba aplicada, no).
  await expect(history.getByRole('listitem').filter({ hasText: 'Me quedé a recoger.' })).toHaveClass(/enter-soft/)
  await expect(history.getByRole('listitem').filter({ hasText: 'La tablet no leyó el QR.' })).not.toHaveClass(/enter-soft/)

  await page.getByRole('button', { name: 'Rechazar', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Rechazar la corrección' }) // los toasts también son «dialog»
  const send = sheet.getByRole('button', { name: 'Rechazar', exact: true })
  await expect(send).toBeDisabled()
  await sheet.getByLabel('Motivo').fill('No consta en la alarma.')
  await send.click()
  await expect(page.getByText('Corrección rechazada')).toBeVisible()
  await expect(sheet).toBeHidden()
  expect(posts.at(-1)).toEqual({ url: '/admin/clock/corrections/c3/reject', body: { reason: 'No consta en la alarma.' } })
  await expect(page.getByRole('region', { name: /^Por revisar/ })).toHaveCount(0)
  await expect(history).toContainText('Rechazada')
})

test('salida olvidada: el resumen la dice y abre la hoja con el día y la salida', async ({ page }) => {
  await abrir(page, MES, { data: month({ open: true }) })
  const summary = page.getByRole('region', { name: 'Resumen del mes' })
  await expect(summary).toContainText('Falta la salida del martes 17')
  await expect(summary).toContainText('Entró a las 08:00')
  await expect(page.getByRole('button', { name: 'Añadir la salida' })).toHaveCount(1) // en el resumen; el día solo avisa
  await expect(page.getByRole('region', { name: 'Martes 17' })).toContainText('Falta la salida')
  await summary.getByRole('button', { name: 'Añadir la salida' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Añadir un fichaje')).toBeVisible()
  await expect(sheet.getByLabel('Día')).toHaveValue('2026-11-17')
  await expect(sheet).toContainText('Salida')
})

test('autónomo: nota, sin acciones de corregir; Imprimir y CSV en la misma fila', async ({ page }) => {
  await abrir(page, MES, { data: month({ employment: 'self_employed' }) })
  await expect(page.getByText(/No ficha ni tiene correcciones/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Corregir/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Añadir fichaje' })).toHaveCount(0)
  const print = (await page.getByRole('link', { name: 'Imprimir' }).boundingBox())!
  const csv = (await page.getByRole('button', { name: 'Descargar CSV' }).boundingBox())!
  expect(Math.round(print.y)).toBe(Math.round(csv.y))
})

test('CSV: pide el export del mes y lo descarga', async ({ page }) => {
  await abrir(page, MES)
  const req = page.waitForRequest((r) => r.url().includes('/admin/clock/export'))
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar CSV' }).click()
  expect(new URL((await req).url()).searchParams.toString()).toBe('profile_id=p-1&month=2026-11&format=csv')
  expect((await download).suggestedFilename()).toBe('jornada-2026-11.csv')
})

test('mes sin fichajes', async ({ page }) => {
  await abrir(page, MES, { data: month({ empty: true }) })
  await expect(page.getByText('Sin fichajes este mes')).toBeVisible()
})

test('mes: error de red con Reintentar', async ({ page }) => {
  await abrir(page, MES, { fail: true })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible({ timeout: 15_000 })
})

test('hoja de imprimir: la vuelta dice de quién es', async ({ page }) => {
  await abrir(page, '/admin/clock/print?profile_id=p-1&month=2026-11')
  await expect(page.getByRole('heading', { name: 'Registro de jornada', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Jornada de Kenji Sato' }).click()
  await expect(page).toHaveURL(/\/admin\/clock\?profile_id=p-1&month=2026-11$/)
})
