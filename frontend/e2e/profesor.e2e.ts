import { expect, test, type Page } from '@playwright/test'

// Sesiones del profesor (/professor) con la API simulada en el navegador (page.route): no escribe en la base de datos.
// Token falso con rol 'profesor' (la app solo decodifica el rol). Reloj fijo con hora de Madrid, nunca la del sistema.
// Solo necesita E2E_BASE_URL. Móvil 375 px (iPhone 13 del config: isMobile y táctil).
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'p-1', role: 'profesor', exp: 4102444800 })}.x`
const ME = { id: 'p-1', display_name: 'Kenji Sato', email: 'kenji@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'profesor' }

// Martes 17-nov-2026, hora de Madrid (UTC+1).
const at = (day: number, hm: string) => new Date(`2026-11-${day}T${hm}:00+01:00`).toISOString()
const S = (id: string, day: number, a: string, b: string, name: string, o: object = {}) => ({
  id, class_id: 'c', discipline_id: 1, discipline_name: name, starts_at: at(day, a), ends_at: at(day, b), duration_min: 60, capacity: 20, location: 'Tatami 1', status: 'scheduled', ...o,
})
const SESSIONS = [
  S('s1', 17, '17:00', '18:00', 'Judo infantil'),
  S('s2', 17, '18:00', '19:30', 'Jiu-jitsu', { location: 'Tatami 2' }),
  S('s4', 17, '21:00', '22:00', 'Grappling', { status: 'cancelled' }),
]
const EVENT = {
  id: 'e1', title: 'Seminario de judo', description: null, starts_at: at(17, '10:00'), ends_at: at(17, '13:00'), location: 'Tatami 1', discipline: { id: 1, name: 'Judo' },
  trainer: null, capacity: 30, taken: 12, audience: 'all', price_cents: 2000, member_price_cents: null, registration_deadline: null, status: 'scheduled', registration: null,
}
const clock = (employment: string) => ({ profile: { id: 'p-1', display_name: 'Kenji Sato', employment }, month: '2026-11', state: 'in', total_seconds: 0, days: [], events: [{ id: 'k', kind: 'in', at: at(17, '16:30'), origin: 'app' }], corrections: [] })

async function abrir(page: Page, o: { now?: string; sessions?: object[]; events?: object[]; fail?: boolean; employment?: string } = {}) {
  await page.clock.setFixedTime(new Date(`2026-11-17T${o.now ?? '18:30'}:00+01:00`))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url())
    const u = url.pathname.replace(/^\/api/, '')
    const inRange = (x: { starts_at: string }) => x.starts_at.slice(0, 10) >= url.searchParams.get('from')! && x.starts_at.slice(0, 10) <= url.searchParams.get('to')!
    if (r.request().method() !== 'GET') return r.fulfill({ status: 405, json: { code: 'not_in_test' } })
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/me/clock') return r.fulfill({ json: clock(o.employment ?? 'employee') })
    if (o.fail && u.startsWith('/professor/')) return r.fulfill({ status: 500, json: { code: 'internal' } })
    if (u === '/professor/sessions') return r.fulfill({ json: { sessions: (o.sessions ?? SESSIONS).filter(inRange) } })
    if (u === '/professor/events') return r.fulfill({ json: { events: (o.events ?? []).filter(inRange) } })
    return r.fulfill({ json: {} })
  })
  await page.goto('/professor')
  await expect(page.getByRole('heading', { name: 'Sesiones', level: 1 })).toBeVisible()
}

const pasarLista = (page: Page) => page.getByRole('link', { name: 'Pasar lista', exact: true })

test('sesión en curso: un solo hueco arriba, que lleva a pasar lista', async ({ page }) => {
  await abrir(page)
  await expect(pasarLista(page)).toHaveCount(1)
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/sessions/s2')
  await expect(page.getByText('Hoy · 18:00')).toBeVisible()
  // En la lista, la fila sigue con «En curso»; la llamada a pasar lista solo va en el hueco.
  await expect(page.getByText('En curso', { exact: true })).toBeVisible()
  await expect(page.getByText('Terminada')).toBeVisible()
  await expect(page.getByText('Cancelada')).toBeVisible()
  // El hueco va antes que la Jornada (orden del HTML = orden visual = Tab).
  const hero = await pasarLista(page).boundingBox()
  const jornada = await page.getByRole('region', { name: 'Jornada' }).boundingBox()
  expect(hero!.y).toBeLessThan(jornada!.y)
})

test('evento en curso: el hueco lleva a su asistencia', async ({ page }) => {
  await abrir(page, { now: '11:00', events: [EVENT] })
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/events/e1')
  await expect(page.getByText('Seminario de judo').first()).toBeVisible()
})

test('solo próximas: sin hueco; la cancelada se ve tachada con su insignia', async ({ page }) => {
  await abrir(page, { now: '09:00' })
  await expect(page.getByText('Judo infantil')).toBeVisible()
  await expect(pasarLista(page)).toHaveCount(0)
  await expect(page.getByText('Cancelada')).toBeVisible()
})

test('cambio de semana: el hueco de la sesión en curso se queda', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Semana siguiente' }).first().click()
  await expect(page.getByText('No hay sesiones esta semana')).toBeVisible()
  await expect(pasarLista(page)).toBeVisible()
})

test('dos en curso a la vez: un solo hueco con un botón por cada una', async ({ page }) => {
  await abrir(page, { sessions: [...SESSIONS, S('s5', 17, '18:15', '19:15', 'Kárate')] })
  await expect(page.getByText('Hoy · 18:00')).toHaveCount(1)
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/sessions/s2')
  await expect(page.getByRole('link', { name: 'Pasar lista de Kárate' })).toHaveAttribute('href', '/professor/sessions/s5')
})

test('semana vacía: sin hueco; título del vacío en sans, no en la condensada', async ({ page }) => {
  await abrir(page, { sessions: [] })
  const title = page.getByText('No hay sesiones esta semana')
  await expect(title).toBeVisible()
  await expect(title).not.toHaveCSS('font-family', /Barlow/)
  await expect(pasarLista(page)).toHaveCount(0)
})

test('error de la API: reintentar, sin hueco', async ({ page }) => {
  await abrir(page, { fail: true })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(pasarLista(page)).toHaveCount(0)
})

test('autónomo: sin tarjeta de Jornada; el hueco sigue', async ({ page }) => {
  await abrir(page, { employment: 'self_employed' })
  await expect(pasarLista(page)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Jornada' })).toHaveCount(0)
})

test('objetivos táctiles de 44 px o más', async ({ page }) => {
  await abrir(page)
  const targets = [
    pasarLista(page),
    page.getByRole('button', { name: 'Pausa' }),
    page.getByRole('button', { name: 'Salir' }),
    page.getByRole('button', { name: 'Semana anterior' }),
    page.getByRole('button', { name: /^martes, 17/i }),
    page.getByRole('link', { name: /Jiu-jitsu/ }).last(),
  ]
  for (const t of targets) {
    const box = await t.boundingBox()
    expect(Math.round(box!.height), await t.textContent()).toBeGreaterThanOrEqual(44)
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44)
  }
})
