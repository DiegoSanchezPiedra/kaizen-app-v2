import { expect, test, type Page } from '@playwright/test'

// Varios roles por cuenta con rol activo (ADR 0033) con la API simulada en el navegador (page.route): no escribe en la base
// de datos ni hace login (token falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. Móvil 375 px; el escritorio, aparte.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (role: string) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role, exp: 4102444800 })}.x`
const ME = { id: 'u-1', display_name: 'Ana Pérez', email: 'ana@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: false, minor: null }

type Opts = { role: string; roles: string[]; switchTo?: { status: number; code?: string } }
// `state.role` es el rol activo: lo cambia POST /auth/role, como el servidor, y /auth/me lo repite.
async function abrir(page: Page, url: string, o: Opts) {
  const state = { role: o.role }
  const calls: { path: string; body: unknown }[] = []
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(o.role))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const method = r.request().method()
    if (method === 'POST' && u === '/auth/role') {
      const body = r.request().postDataJSON()
      calls.push({ path: u, body })
      if (o.switchTo?.status) return r.fulfill({ status: o.switchTo.status, json: { code: o.switchTo.code } })
      state.role = body.role
      return r.fulfill({ json: { token: token(body.role), user: { id: 'u-1', email: ME.email, role: body.role } } })
    }
    if (method !== 'GET') return r.fulfill({ json: {} })
    if (u === '/auth/me') return r.fulfill({ json: { user: { id: 'u-1', role: state.role, roles: o.roles }, mfa_enabled: false } })
    if (u === '/me') return r.fulfill({ json: { ...ME, role: state.role } })
    if (u === '/me/children') return state.role === 'alumno' ? r.fulfill({ json: { children: [] } }) : r.fulfill({ status: 403, json: { code: 'insufficient_role' } })
    if (u === '/me/clock') return r.fulfill({ json: { profile: { id: 'u-1', display_name: 'Ana Pérez', employment: 'employee' }, month: '2026-11', state: 'out', total_seconds: 0, days: [], events: [], corrections: [] } })
    if (u === '/admin/profiles') return r.fulfill({ json: { profiles: [], total: 0 } })
    if (u === '/admin/profiles/stats') return r.fulfill({ json: { activos: 0, impago: 0, inactivos: 0 } })
    if (u === '/professor/sessions' || u === '/professor/events') return r.fulfill({ json: { sessions: [], events: [] } })
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return calls
}

const selector = (page: Page) => page.getByRole('button', { name: /^Rol activo/ })

test('alumno y profesor: ve el selector en Cuenta, cambia a profesor y aterriza en /professor', async ({ page }) => {
  const calls = await abrir(page, '/account', { role: 'alumno', roles: ['alumno', 'profesor'] })
  await expect(selector(page)).toContainText('Alumno')
  await selector(page).click()
  const menu = page.getByRole('menuitemradio')
  await expect(menu).toHaveText(['Alumno', 'Profesor'])
  await expect(page.getByRole('menuitemradio', { name: 'Alumno' })).toBeChecked()
  await page.getByRole('menuitemradio', { name: 'Profesor' }).click()
  await expect(page).toHaveURL(/\/professor$/)
  expect(calls).toEqual([{ path: '/auth/role', body: { role: 'profesor' } }])
  // El menú de abajo es el del profesor y el token nuevo ya es suyo.
  await expect(page.getByRole('link', { name: 'Informes', exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(atob(localStorage.getItem('kz.token')!.split('.')[1])).role)).toBe('profesor')
})

test('con un solo rol no hay selector', async ({ page }) => {
  await abrir(page, '/account', { role: 'alumno', roles: ['alumno'] })
  await expect(page.getByText('Ana Pérez', { exact: true })).toBeVisible()
  await expect(selector(page)).toHaveCount(0)
})

test('el selector se maneja con el teclado y anuncia el rol actual', async ({ page }) => {
  await abrir(page, '/account', { role: 'alumno', roles: ['alumno', 'tutor'] })
  await selector(page).focus()
  await expect(selector(page)).toHaveAccessibleName('Rol activo Alumno')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu', { name: /Rol activo/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(selector(page)).toContainText('Tutor')
  await expect(page).toHaveURL(/localhost:\d+\/$|\/$/)
})

test('si el servidor lo rechaza, se avisa y se sigue en el rol de antes', async ({ page }) => {
  await abrir(page, '/account', { role: 'alumno', roles: ['alumno', 'profesor'], switchTo: { status: 403, code: 'role_not_assigned' } })
  await selector(page).click()
  await page.getByRole('menuitemradio', { name: 'Profesor' }).click()
  await expect(page.getByText('Ese rol no está asignado.')).toBeVisible()
  await expect(page).toHaveURL(/\/account$/)
  await expect(selector(page)).toContainText('Alumno')
})

test('sesión demasiado vieja para el rol nuevo: a /login con su aviso, sin toast de error', async ({ page }) => {
  await abrir(page, '/account', { role: 'alumno', roles: ['alumno', 'admin'], switchTo: { status: 401, code: 'reauth_required' } })
  await selector(page).click()
  await page.getByRole('menuitemradio', { name: 'Admin' }).click()
  await expect(page).toHaveURL(/\/login\?rol=1$/)
  await expect(page.getByText('Vuelve a entrar para usar este rol.')).toBeVisible()
})

test('acceso denegado: un alumno en /admin vuelve a /', async ({ page }) => {
  await abrir(page, '/admin', { role: 'alumno', roles: ['alumno'] })
  await expect(page).toHaveURL(/\/$/)
})

test('acceso denegado: un profesor en /admin sale de /admin (a lo suyo)', async ({ page }) => {
  await abrir(page, '/admin/users', { role: 'profesor', roles: ['profesor'] })
  await expect(page).toHaveURL(/\/professor$/)
})

test.describe('escritorio 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })

  test('en el menú lateral; en Cuenta no se repite', async ({ page }) => {
    await abrir(page, '/account', { role: 'alumno', roles: ['alumno', 'tutor'] })
    await expect(selector(page)).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: /^Rol activo/ })).toBeVisible()
  })

  test('el admin con otros roles lo tiene en el panel y al elegir alumno aterriza en /', async ({ page }) => {
    await abrir(page, '/admin/users', { role: 'admin', roles: ['alumno', 'admin'] })
    await expect(selector(page)).toContainText('Admin')
    await selector(page).click()
    await page.getByRole('menuitemradio', { name: 'Alumno' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Calendario' }).first()).toBeVisible()
  })
})
