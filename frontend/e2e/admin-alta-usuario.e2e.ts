import { expect, test, type Page } from '@playwright/test'

// Alta de usuarios por el admin (ADR 0032) sin tocar la BD: token falso de admin y la API simulada con page.route.
// Las escrituras se anotan y se responden aquí.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Ada Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }
const URL_1 = 'https://kaizen.example/reset-password?token=uno&invite=1'
const URL_2 = 'https://kaizen.example/reset-password?token=dos&invite=1'
const PROFILE = {
  id: 'u1', display_name: 'Lucía Pérez', avatar: null, email: 'lucia@example.invalid', roles: ['tutor'], is_minor: false, pending_claim: false, disabled: false,
  has_password: false, has_google: false, invite_pending: true, created_at: '2026-11-18T10:00:00Z', is_public: false, can_create_children: true,
}

type Write = { method: string; path: string; body: Record<string, unknown> | null }
async function open(page: Page, url: string, fail?: { status: number; code: string }) {
  const writes: Write[] = []
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const method = r.request().method()
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin', roles: ['admin'] }, mfa_enabled: false } })
    if (method !== 'GET') {
      writes.push({ method, path: p, body: r.request().postDataJSON() })
      if (fail) return r.fulfill({ status: fail.status, json: { code: fail.code } })
      if (p === '/admin/users') return r.fulfill({ status: 201, json: { profile: PROFILE, invite_url: URL_1 } })
      if (p === '/admin/trainers') return r.fulfill({ status: 201, json: { trainer: { ...PROFILE, id: 't1', roles: ['profesor'] }, invite_url: URL_1 } })
      if (p.endsWith('/invite')) return r.fulfill({ json: { invite_url: URL_2 } })
      return r.fulfill({ json: {} })
    }
    if (p === '/admin/profiles/stats') return r.fulfill({ json: { activos: 0, impago: 0, inactivos: 0 } })
    if (p === '/admin/profiles') return r.fulfill({ json: { profiles: [], total: 0 } })
    if (p === '/admin/profiles/u1') return r.fulfill({ json: { profile: PROFILE, status: { ok: true }, guardians: [], children: [], subscription: null } })
    if (p === '/bookings') return r.fulfill({ json: { bookings: [] } })
    return r.fulfill({ json: { plans: [], disciplines: [], rows: [], total: 0, communiques: [] } })
  })
  await page.goto(url)
  return writes
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Nuevo usuario' })
async function fill(page: Page, role: string | null, { birth = true } = {}) {
  await page.getByRole('button', { name: 'Nuevo usuario' }).first().click()
  const d = sheet(page)
  if (role) {
    await d.getByRole('combobox', { name: 'Rol' }).click()
    await page.getByRole('option', { name: role, exact: true }).click()
  }
  await d.getByLabel('Nombre', { exact: true }).fill('Lucía Pérez')
  await d.getByLabel(role === 'Profesor' ? 'Correo corporativo' : 'Email', { exact: true }).fill('lucia@example.invalid')
  if (birth) await d.getByLabel('Fecha de nacimiento').fill('1990-04-12')
  return d
}

test.describe('alta de usuarios 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('lista vacía: ofrece el alta', async ({ page }) => {
    await open(page, '/admin/users')
    await expect(page.getByText('Aún no hay usuarios')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nuevo usuario' })).toHaveCount(2)
  })

  test('alumno: envía rol y fecha y enseña el enlace para copiar', async ({ page }) => {
    const writes = await open(page, '/admin/users')
    const d = await fill(page, null)
    await d.getByRole('button', { name: 'Dar de alta' }).click()
    const link = page.getByRole('dialog', { name: 'Enlace para Lucía Pérez' })
    await expect(link.getByLabel('Enlace de invitación')).toHaveText(URL_1)
    expect(writes).toEqual([{ method: 'POST', path: '/admin/users', body: { display_name: 'Lucía Pérez', email: 'lucia@example.invalid', role: 'alumno', birth_date: '1990-04-12' } }])
    await expect(link.getByRole('button', { name: 'Copiar enlace' })).toBeVisible()
    await link.getByRole('button', { name: 'Ver ficha' }).click()
    await expect(page).toHaveURL(/\/admin\/users\/u1$/)
  })

  test('admin: sin fecha de nacimiento', async ({ page }) => {
    const writes = await open(page, '/admin/users')
    const d = await fill(page, 'Admin', { birth: false })
    await expect(d.getByLabel('Fecha de nacimiento')).toHaveCount(0)
    await d.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(page.getByRole('dialog', { name: 'Enlace para Lucía Pérez' })).toBeVisible()
    expect(writes[0].body).toEqual({ display_name: 'Lucía Pérez', email: 'lucia@example.invalid', role: 'admin' })
  })

  test('profesor: va por /admin/trainers con correo corporativo y tipo de relación', async ({ page }) => {
    const writes = await open(page, '/admin/users')
    const d = await fill(page, 'Profesor', { birth: false })
    await d.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(page.getByRole('dialog', { name: 'Enlace para Lucía Pérez' })).toBeVisible()
    expect(writes[0]).toEqual({ method: 'POST', path: '/admin/trainers', body: { display_name: 'Lucía Pérez', email: 'lucia@example.invalid', employment: 'self_employed' } })
  })

  test('menor: el error queda en la fecha y la hoja sigue abierta', async ({ page }) => {
    await open(page, '/admin/users', { status: 400, code: 'invalid_birth_date' })
    const d = await fill(page, 'Tutor')
    await d.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(d.getByText('Revisa la fecha de nacimiento.')).toBeVisible()
  })

  test('email repetido: el error queda en el email', async ({ page }) => {
    await open(page, '/admin/users', { status: 409, code: 'email_taken' })
    const d = await fill(page, null)
    await d.getByRole('button', { name: 'Dar de alta' }).click()
    await expect(d.getByText('Ya hay una cuenta con este email.')).toBeVisible()
  })

  test('ficha de quien no ha entrado: «Nuevo enlace» confirma y enseña el enlace nuevo', async ({ page }) => {
    const writes = await open(page, '/admin/users/u1')
    await page.getByRole('button', { name: 'Nuevo enlace' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Crear enlace' }).click()
    await expect(page.getByRole('dialog', { name: 'Enlace para Lucía Pérez' }).getByLabel('Enlace de invitación')).toHaveText(URL_2)
    expect(writes).toEqual([{ method: 'POST', path: '/admin/users/u1/invite', body: null }])
  })
})
