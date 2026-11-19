import { expect, test, type Page } from '@playwright/test'

// Comunicados (ADR 0030): la pestaña del admin en Avisos y la ventana del alumno. Todo simulado con page.route y token
// falso: no escribe en la BD ni manda emails. Reloj fijo: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const NOW = new Date('2026-11-18T18:10:00+01:00')
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (sub: string, role: string) => `${b64({ alg: 'none' })}.${b64({ sub, role, exp: 4102444800 })}.x`
const me = (id: string, role: string) => ({ id, role, display_name: 'Marta', email: 'm@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null })
const SENT = {
  id: 'c-1', title: 'Cerrado el lunes', body: 'Por obras.\nVolvemos el martes.', audience: 'all', discipline_ids: null,
  channels: ['app', 'email', 'whatsapp'], app_count: 120, email_count: 110, seen: 34, created_at: '2026-11-17T09:41:00+01:00', withdrawn_at: null,
}

async function admin(page: Page, rows: object[] = [SENT]) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token('a-1', 'admin'))
  const posts: { url: string; body: unknown }[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const paged = (list: object[]) => r.fulfill({ json: { rows: list, total: list.length, limit: 25, offset: 0 } })
    if (r.request().method() === 'POST') {
      posts.push({ url: p + u.search, body: r.request().postDataJSON() })
      if (p === '/admin/communiques') return r.fulfill({ status: 201, json: { ...SENT, id: 'c-2', ...(r.request().postDataJSON() as object), seen: 0 } })
      return r.fulfill({ json: { withdrawn_at: NOW.toISOString() } })
    }
    if (p === '/me') return r.fulfill({ json: me('a-1', 'admin') })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (p === '/admin/communiques') return paged(rows)
    if (p === '/admin/communiques/audience') return r.fulfill({ json: u.searchParams.get('audience') === 'trainers' ? { app: 0, email: 0 } : { app: 120, email: 110 } })
    if (p === '/admin/disciplines') return r.fulfill({ json: { disciplines: [{ id: 1, name: 'Muay Thai', is_active: true }, { id: 2, name: 'Boxeo', is_active: true }] } })
    if (p === '/admin/notice-deliveries') return paged([])
    return r.fulfill({ json: {} })
  })
  await page.goto('/admin/notices?tab=communiques')
  return posts
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('historial a 375: para, canales, «Visto por» y compartir en WhatsApp con el texto', async ({ page }) => {
  await admin(page)
  await expect(page.getByRole('tab', { name: 'Comunicados' })).toHaveAttribute('aria-selected', 'true')
  const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Cerrado el lunes' })
  await expect(row).toContainText('Todos · 17 nov 2026 · 9:41')
  await expect(row).toContainText('Visto por 34 de 120 · 110 emails')
  const wa = row.getByRole('link', { name: 'Compartir en WhatsApp' })
  expect(decodeURIComponent((await wa.getAttribute('href'))!.split('text=')[1])).toBe('*Cerrado el lunes*\n\nPor obras.\nVolvemos el martes.')
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('nuevo comunicado: socios de una disciplina, vista previa con recuento y envío', async ({ page }) => {
  const posts = await admin(page)
  await page.getByRole('button', { name: 'Nuevo comunicado' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo comunicado' })
  await sheet.getByRole('textbox', { name: 'Título' }).fill('Clase especial')
  await sheet.getByRole('textbox', { name: 'Texto' }).fill('El sábado, seminario.\nTrae protecciones.')
  await sheet.getByRole('radio', { name: /Alumnos con cuota en vigor/ }).click()
  await sheet.getByRole('checkbox', { name: 'Muay Thai' }).click()
  await sheet.getByRole('checkbox', { name: /Email/ }).click()
  await expect(sheet).toContainText('Se enviará a 120 personas (110 por email)')
  await sheet.getByRole('button', { name: 'Enviar' }).click()
  const confirm = page.getByRole('alertdialog', { name: '¿Enviar el comunicado?' })
  await expect(confirm).toContainText('El sábado, seminario.')
  await page.screenshot({ path: 'test-results/comunicados-confirmar-375.png' })
  await confirm.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('Comunicado enviado')).toBeVisible()
  expect(posts.at(-1)).toEqual({
    url: '/admin/communiques',
    body: { title: 'Clase especial', body: 'El sábado, seminario.\nTrae protecciones.', audience: 'members', discipline_ids: ['1'], channels: ['app', 'email'] },
  })
})

test('sin destinatarios no deja enviar; retirar pide confirmación', async ({ page }) => {
  const posts = await admin(page)
  await page.getByRole('button', { name: 'Nuevo comunicado' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nuevo comunicado' })
  await sheet.getByRole('textbox', { name: 'Título' }).fill('Reunión')
  await sheet.getByRole('textbox', { name: 'Texto' }).fill('Lunes a las 9.')
  await sheet.getByRole('radio', { name: /Profesores/ }).click()
  await expect(sheet).toContainText('Nadie cumple estas condiciones')
  await expect(sheet.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: 'Retirar' }).click()
  await page.getByRole('alertdialog', { name: '¿Retirar el comunicado?' }).getByRole('button', { name: 'Retirar' }).click()
  await expect(page.getByText('Comunicado retirado')).toBeVisible()
  expect(posts.at(-1)?.url).toBe('/admin/communiques/c-1/withdraw')
})

test('alumno a 375: la ventana sale al abrir, no se cierra con Escape y «Entendido» pasa a la siguiente', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token('u-1', 'alumno'))
  const seen: unknown[] = []
  let pending = [
    { id: 'c-1', title: 'Cerrado el lunes', body: 'Por obras.\nVolvemos el martes.', created_at: '2026-11-17T09:41:00+01:00' },
    { id: 'c-2', title: 'Nuevo horario', body: 'Desde diciembre.', created_at: '2026-11-18T09:00:00+01:00' },
  ]
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    if (p === '/me/communiques/seen') {
      const { id } = r.request().postDataJSON() as { id: string }
      seen.push(id)
      pending = pending.filter((c) => c.id !== id)
      return r.fulfill({ status: 204 })
    }
    if (p === '/me/communiques') return r.fulfill({ json: { communiques: pending } })
    if (p === '/me') return r.fulfill({ json: me('u-1', 'alumno') })
    if (p === '/me/profile-status') return r.fulfill({ json: { ok: true, missing: [] } })
    if (p === '/billing/subscription') return r.fulfill({ status: 404, json: { code: 'subscription_not_found' } })
    return r.fulfill({ json: {} })
  })
  await page.goto('/account')
  const dialog = page.getByRole('alertdialog', { name: 'Cerrado el lunes' })
  await expect(dialog).toContainText('Comunicado de la academia · martes, 17 de noviembre')
  await expect(dialog).toContainText('Volvemos el martes.')
  await page.screenshot({ path: 'test-results/comunicados-ventana-375.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Entendido' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Nuevo horario' })).toBeVisible()
  await page.getByRole('button', { name: 'Entendido' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(seen).toEqual(['c-1', 'c-2'])
})
