import { expect, test, type Page } from '@playwright/test'

// Horario del panel (/admin/sessions, el detalle de una sesión y el de un evento) sin tocar la BD ni staging: token
// falso de admin en `kz.token` y toda la API simulada con page.route. Las escrituras no salen de aquí: se anotan y se
// responden. Reloj fijo: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (hm: string, d = '2026-11-18') => new Date(`${d}T${hm}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const DISC = [
  { id: 1, name: 'Judo', min_age: null, max_age: null, is_active: true, is_open: false },
  { id: 2, name: 'Muay Thai', min_age: null, max_age: null, is_active: true, is_open: false },
]
const KENJI = { id: 't1', display_name: 'Kenji Sato' }
const ses = (id: string, d: string, from: string, to: string, name: string, extra: object = {}) => ({
  id, class_id: 'c1', starts_at: at(from, d), ends_at: at(to, d), discipline: { id: name === 'Judo' ? 1 : 2, name }, trainer: KENJI, location: 'Tatami 1', capacity: 20, taken: 8, status: 'scheduled', held: false, ...extra,
})
const CAL = [
  ses('held', '2026-11-18', '10:00', '11:00', 'Muay Thai', { held: true }),
  ses('live', '2026-11-18', '18:00', '19:00', 'Judo', { taken: 5 }),
  ses('full', '2026-11-18', '19:30', '20:30', 'Judo', { taken: 20 }),
  ses('off', '2026-11-18', '20:30', '21:30', 'Muay Thai', { status: 'cancelled', taken: 0 }),
  ses('next', '2026-11-19', '19:00', '20:00', 'Judo', { taken: 2 }),
]
const detail = (s: (typeof CAL)[number], extra: object = {}) => ({ ...s, duration_min: 60, adjusted_fields: [], class_values: { trainer_id: 't1', starts_at: s.starts_at, duration_min: 60, capacity: 20, location: 'Tatami 1' }, cancel_note: null, ...extra })
const bk = (id: string, name: string, status = 'confirmed') => ({ id, student: { id: `u-${id}`, display_name: name }, status, created_at: at('09:10', '2026-11-10') })
const SESSIONS: Record<string, object> = {
  next: { session: detail(CAL[4]), bookings: [bk('b1', 'Lucía Pérez'), bk('b2', 'Hugo Sánchez'), bk('w1', 'Irene Gómez', 'waitlisted')] },
  live: { session: detail(CAL[1]), bookings: [bk('b3', 'Martina López')] },
}
const ATT = { closed_at: null, students: [{ booking_id: 'b3', student_id: 'u-b3', display_name: 'Martina López', status: null, method: null, corrected_at: null, correction_reason: null }] }
const reg = (id: string, name: string, extra: object = {}) => ({
  id, student: { id: `u-${id}`, display_name: name }, status: 'confirmed', amount_cents: 3500, guest: false, payer: null, refund_status: null, refunded_cents: 0, attended: null, cancel_reason: null, created_at: at('12:00', '2026-11-10'), ...extra,
})
const EVENT = {
  id: 'e1', title: 'Seminario de judo', description: null, starts_at: at('10:00', '2026-11-21'), ends_at: at('14:00', '2026-11-21'), location: 'Tatami 1', discipline: null, trainer: null,
  capacity: 30, taken: 3, audience: 'all', price_cents: 3500, member_price_cents: null, registration_deadline: null, status: 'scheduled', cancel_note: null,
}
const REGS = [
  reg('r1', 'Lucía Pérez'),
  reg('r2', 'Hugo Sánchez', { status: 'pending', amount_cents: 2500 }),
  reg('r3', 'Paula Romero', { guest: true, amount_cents: 0 }),
  reg('r4', 'Álvaro Ruiz', { status: 'cancelled', cancel_reason: 'admin', refund_status: 'failed' }),
]

async function open(page: Page, url: string) {
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
      writes.push(`${m} ${p}`)
      return r.fulfill({ json: { ok: true, notified: 0, promoted: 0 } })
    }
    if (p === '/admin/disciplines') return r.fulfill({ json: { disciplines: DISC } })
    if (p === '/admin/profiles') return r.fulfill({ json: { profiles: [{ id: 't1', display_name: 'Kenji Sato', role: 'profesor', disabled: false }], total: 1 } })
    if (p === '/sessions/calendar') return r.fulfill({ json: { sessions: CAL } })
    if (p === '/admin/events') return r.fulfill({ json: { events: [], total: 0 } })
    if (p === '/admin/classes') return r.fulfill({ json: { classes: [] } })
    let f = p.match(/^\/admin\/sessions\/([^/]+)$/)
    if (f) return SESSIONS[f[1]] ? r.fulfill({ json: SESSIONS[f[1]] }) : r.fulfill({ status: 404, json: { code: 'session_not_found' } })
    if (/^\/sessions\/[^/]+\/attendance$/.test(p)) return r.fulfill({ json: ATT })
    f = p.match(/^\/admin\/events\/([^/]+)$/)
    if (f) return r.fulfill({ json: { event: EVENT, registrations: REGS } })
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return { writes }
}

const today = (page: Page) => page.getByRole('region', { name: /miércoles, 18 de noviembre/i })

test('semana: hoy abierto; solo lo que se sale lleva insignia (en curso, celebrada, cancelada) y la ocupación con «Llena»', async ({ page }) => {
  await open(page, '/admin/sessions')
  const d = today(page)
  await expect(d.getByText('En curso', { exact: true })).toBeVisible()
  await expect(d.getByText('Celebrada', { exact: true })).toBeVisible()
  await expect(d.getByText('Cancelada', { exact: true })).toBeVisible()
  await expect(d.getByText('20/20 · Llena')).toBeVisible()
  await expect(d.getByText('5/20 plazas')).toBeVisible()
  await expect(page.getByText('Programada', { exact: true })).toHaveCount(0)
})

test('«Nuevo» abre un menú con las tres cosas; «Clase suelta» abre su hoja y valida al crear', async ({ page }) => {
  const { writes } = await open(page, '/admin/sessions')
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  const items = page.getByRole('menuitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Clase semanal')
  await page.getByRole('menuitem', { name: /^Clase suelta/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Clase suelta' })
  await sheet.getByRole('button', { name: 'Crear la clase', exact: true }).click()
  await expect(sheet.getByText('Elige una disciplina.')).toBeVisible()
  expect(writes).toEqual([])
})

test('Semana | Clases semanales: cambia ?vista y conserva la disciplina', async ({ page }) => {
  await open(page, '/admin/sessions?disciplina=1')
  await page.getByRole('tab', { name: 'Clases semanales', exact: true }).click()
  await expect(page).toHaveURL(/vista=clases/)
  await expect(page).toHaveURL(/disciplina=1/)
  await expect(page.getByText('No hay clases', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Semana', exact: true }).click()
  await expect(page).not.toHaveURL(/vista=clases/)
  await expect(page).toHaveURL(/disciplina=1/)
})

test('sesión futura: reservas y espera antes que los datos; cancelar la sesión dice a quién avisa', async ({ page }) => {
  const { writes } = await open(page, '/admin/sessions/next')
  await expect(page.getByText(/jueves, 19 de noviembre/i).first()).toBeVisible()
  await expect(page.getByText('1 en espera', { exact: true })).toBeVisible()
  const reservas = page.getByRole('region', { name: /^Reservas/ })
  await expect(reservas.getByRole('link', { name: 'Lucía Pérez', exact: true })).toBeVisible()
  await expect(reservas.getByRole('combobox', { name: 'Reservar a un alumno' })).toBeVisible()
  const datos = page.getByRole('region', { name: 'Datos de la sesión' })
  expect((await reservas.boundingBox())!.y).toBeLessThan((await datos.boundingBox())!.y)
  await page.getByRole('button', { name: 'Cancelar la sesión', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('se avisa a quien las tenía')
  await expect(dialog).toContainText('3 reservas')
  await dialog.getByRole('button', { name: 'Cancelar la sesión', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/sessions/next/cancel'])
})

test('sesión en curso: la lista de asistencia y sin el bloque de reservas', async ({ page }) => {
  await open(page, '/admin/sessions/live')
  await expect(page.getByText('En curso', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Lista de asistencia' })).toBeVisible()
  await expect(page.getByRole('region', { name: /^Reservas/ })).toHaveCount(0)
})

test('sesión que no existe: lo dice, con la vuelta al horario', async ({ page }) => {
  await open(page, '/admin/sessions/zz')
  await expect(page.getByRole('link', { name: 'Horario', exact: true })).toBeVisible()
  await expect(page.getByText('Esta sesión no existe', { exact: true })).toBeVisible()
})

test('evento de pago: cifras de inscritos y cobros; el reembolso fallido destaca; cancelar dice cuánto se devuelve', async ({ page }) => {
  const { writes } = await open(page, '/admin/events/e1')
  const cifras = page.getByLabel('Cifras', { exact: true })
  await expect(cifras).toContainText('3/30')
  await expect(cifras).toContainText('35,00 €')
  await expect(cifras).toContainText('25,00 €')
  await expect(cifras).toContainText('1 fallido')
  const inscritos = page.getByRole('region', { name: /^Inscritos/ })
  await expect(inscritos.getByText('Reembolso fallido', { exact: true })).toBeVisible()
  await expect(inscritos.getByRole('button', { name: 'Reintentar el reembolso de Álvaro Ruiz', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar el evento', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Se devuelve todo lo pagado: 35,00 €')
  await dialog.getByRole('button', { name: 'Cancelar el evento', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/events/e1/cancel'])
})
