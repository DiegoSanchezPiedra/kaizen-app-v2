import { expect, test, type Page } from '@playwright/test'

// Inicio del panel (/admin) sin tocar la BD ni staging: token falso de admin en `kz.token` y toda la API simulada con page.route.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (hm: string, d = '2026-11-18') => new Date(`${d}T${hm}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const session = (id: string, name: string, from: string, to: string, extra: object = {}) => ({
  id, starts_at: at(from), ends_at: at(to), discipline: { id, name }, trainer: { id: 't', display_name: 'Kenji Sato' }, location: 'Tatami 1', capacity: 20, status: 'scheduled', booked: 12, present: 0, ...extra,
})

type Opts = { mfa?: boolean; home?: 'ok' | 'error'; sessions?: 'none' | 'live' | 'later'; attention?: 'none' | 'some'; quiet?: boolean }

async function open(page: Page, o: Opts = {}, url = '/admin') {
  const { mfa = true, home = 'ok', sessions = 'later', attention = 'some', quiet = false } = o
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const audit: string[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const none = attention === 'none'
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: mfa } })
    if (p === '/admin/home') {
      if (home === 'error') return r.fulfill({ status: 500, json: { code: 'internal' } })
      const today = sessions === 'none' ? [] : [session('s1', 'Judo infantil', '10:00', '11:00', { present: 12 }), session('s2', sessions === 'live' ? 'Muay Thai' : 'Brazilian Jiu-Jitsu', sessions === 'live' ? '18:00' : '19:00', '20:00', { present: 5 })]
      const next = sessions === 'none' ? { ...session('n1', 'Kickboxing', '19:00', '20:00'), starts_at: at('19:00', '2026-11-19'), ends_at: at('20:00', '2026-11-19') } : null
      return r.fulfill({ json: { trained: { last_30: 187, previous_30: 172, series: [] }, students: { activos: 214, impago: none ? 0 : 3, inactivos: none ? 0 : 11 }, attendance: { today: 27, last_week: 31 }, sessions: today, next } })
    }
    if (p === '/admin/billing/delinquents') return r.fulfill({ json: { total: none ? 0 : 3, rows: [] } })
    if (p === '/admin/notices') return r.fulfill({ json: { rows: none ? [] : [{ id: 'n1', created_at: at('09:12'), action: 'notice.clock_correction_requested', resource_type: 'clock', resource_id: 'x', details: {} }] } })
    if (p === '/admin/events') return r.fulfill({ json: { events: quiet ? [] : [{ id: 'e1', title: 'Seminario de BJJ', description: null, starts_at: at('11:00', '2026-11-21'), ends_at: at('14:00', '2026-11-21'), location: 'Tatami 1', discipline: null, trainer: null, capacity: 30, taken: 22, audience: 'all', price_cents: 0 }], total: quiet ? 0 : 1 } })
    if (p === '/admin/audit') {
      audit.push(u.searchParams.get('action') ?? '')
      return r.fulfill({ json: { rows: quiet ? [] : [{ id: 'a1', created_at: at('12:05'), action: 'subscription.cancel_now', actor: { id: 'u', display_name: 'Lucía Pérez' }, resource_type: 'subscription', resource_id: '1', changes: null }], total: quiet ? 0 : 1 } })
    }
    return r.fulfill({ json: { total: 0, rows: [] } })
  })
  await page.goto(url)
  return { audit }
}

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test('lo primero es «Requiere atención», antes que «Ahora»; sin cifra de impago ni atajos', async ({ page }) => {
  await open(page)
  await expect(section(page, 'Requiere atención').getByText('Morosos', { exact: true })).toBeVisible()
  const order = await page.locator('main section[aria-label]').evaluateAll((s) => s.map((e) => e.getAttribute('aria-label')))
  expect(order.slice(0, 4)).toEqual(['Requiere atención', 'Ahora', 'Cifras', 'Hoy'])
  await expect(section(page, 'Cifras').getByRole('link')).toHaveCount(3)
  await expect(section(page, 'Cifras').getByText('Impago')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sesión suelta' })).toHaveCount(0)
  // Estados con icono y texto
  await expect(section(page, 'Hoy').getByText('Celebrada', { exact: true })).toBeVisible()
  await expect(section(page, 'Hoy').getByText('Programada', { exact: true }).locator('svg')).toHaveCount(1)
})

test('todo a cero: «Nada pendiente»', async ({ page }) => {
  await open(page, { attention: 'none' })
  await expect(section(page, 'Requiere atención').getByText('Nada pendiente')).toBeVisible()
})

test('si falla /admin/home sale un solo error y lo demás se sigue viendo', async ({ page }) => {
  await open(page, { home: 'error' })
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(1, { timeout: 15_000 })
  await expect(section(page, 'Requiere atención').getByText('Morosos', { exact: true })).toBeVisible()
  await expect(section(page, 'Próximos eventos')).toBeVisible()
})

test('sin sesiones hoy: «Hoy no hay sesiones» y en Ahora la de mañana', async ({ page }) => {
  await open(page, { sessions: 'none' })
  await expect(section(page, 'Hoy').getByText('Hoy no hay sesiones.')).toBeVisible()
  await expect(section(page, 'Ahora').getByText('Kickboxing')).toBeVisible()
  await expect(section(page, 'Ahora').getByText(/jue, 19 nov · 19:00–20:00/)).toBeVisible()
  await expect(section(page, 'Ahora').getByRole('link', { name: 'Ver sesión', exact: true })).toBeVisible()
})

test('con una sesión en curso: «Pasar lista» y cuántos hay dentro', async ({ page }) => {
  await open(page, { sessions: 'live' })
  const now = section(page, 'Ahora')
  await expect(now.getByText('En curso', { exact: true })).toBeVisible()
  await expect(now.getByText('5 dentro · 12 reservas · 20 plazas')).toBeVisible()
  await expect(now.getByRole('link', { name: 'Pasar lista', exact: true })).toHaveAttribute('href', '/admin/sessions/s2')
})

test('«Hoy en la academia» pide las bajas con el nombre que escribe la API', async ({ page }) => {
  const { audit } = await open(page)
  await expect(section(page, 'Hoy en la academia').getByText('Dio de baja una suscripción')).toBeVisible()
  expect(audit[0].split(',')).toEqual(expect.arrayContaining(['subscription.cancel_now', 'subscription.cancel_at_period_end']))
  expect(audit[0].split(',')).not.toContain('subscription.cancel')
})

test('sin eventos ni actividad, esos bloques no salen', async ({ page }) => {
  await open(page, { quiet: true })
  await expect(section(page, 'Hoy').getByText('Judo infantil')).toBeVisible()
  await expect(section(page, 'Próximos eventos')).toHaveCount(0)
  await expect(section(page, 'Hoy en la academia')).toHaveCount(0)
})

test('sin MFA: el aviso lleva a configurarlo con un botón de 44 px', async ({ page }) => {
  await open(page, { mfa: false })
  const go = page.getByRole('link', { name: 'Activar', exact: true })
  expect(Math.round((await go.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await go.click()
  await expect(page).toHaveURL(/\/admin\/mfa$/)
})

test('ruta del panel que no existe: «Ir al Inicio»', async ({ page }) => {
  await open(page, {}, '/admin/no-existe')
  await expect(page.getByText('No lo encontramos')).toBeVisible()
  await page.getByRole('link', { name: 'Ir al Inicio', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible()
})
