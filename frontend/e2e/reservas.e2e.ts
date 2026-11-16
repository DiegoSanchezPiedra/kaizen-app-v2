import { expect, test, type Page } from '@playwright/test'

// Reservas con todo simulado en el navegador (page.route): no escribe nada en la base de datos y no hace login (token de
// cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. La hora se fija en Madrid: miércoles 18-nov-2026 12:00.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`

const iso = (mes: number, dia: number, hm: string) => new Date(`2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${hm}:00+01:00`).toISOString()
type Reserva = { id: string; session_id: string; student_id: string; status: string; cancel_reason: string | null; discipline_id: number; discipline_name: string; starts_at: string; ends_at: string; location: string; session_status: string }
const reserva = (id: string, mes: number, dia: number, hm: string, name: string, extra: Partial<Reserva> = {}): Reserva => {
  const start = new Date(iso(mes, dia, hm))
  return { id, session_id: `s-${id}`, student_id: 'u-1', status: 'confirmed', cancel_reason: null, discipline_id: 1, discipline_name: name, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), location: 'Sala 2', session_status: 'scheduled', ...extra }
}

// Hoy (miércoles): una a las 12:20 (el check-in está al caer) y otra en espera; mañana, una; y historial de dos meses.
const PROXIMAS = [reserva('b1', 11, 18, '12:20', 'Judo adultos'), reserva('b2', 11, 18, '19:00', 'Kárate', { status: 'waitlisted' }), reserva('b3', 11, 19, '18:30', 'Boxeo'), reserva('b4', 11, 21, '10:00', 'Judo adultos')]
const PASADAS = [
  reserva('p1', 11, 17, '19:00', 'Judo adultos'),
  reserva('p2', 11, 15, '18:30', 'Kárate', { status: 'cancelled', cancel_reason: 'student' }),
  reserva('p3', 11, 13, '10:00', 'Boxeo', { status: 'cancelled', cancel_reason: 'late' }),
  reserva('p4', 10, 29, '19:00', 'Kárate'),
]
const EVENTO = { id: 'e1', title: 'Seminario de kata', description: null, starts_at: iso(11, 22, '10:00'), ends_at: iso(11, 22, '13:00'), location: 'Dojo central', discipline: { id: 1, name: 'Judo' }, trainer: null, capacity: 30, taken: 12, audience: 'all', price_cents: 2500, member_price_cents: 1500, registration_deadline: null, status: 'scheduled', cancel_note: null, registration: { id: 'r1', status: 'confirmed', amount_cents: 1500 } }

type Opciones = { menor?: boolean; fallo?: 'bookings' | 'events'; cancelaciones?: string[] }
async function simular(page: Page, { menor = false, fallo, cancelaciones = [] }: Opciones = {}) {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const url = new URL(r.request().url())
    const u = url.pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (u === '/me') return json({ id: 'u-1', role: 'alumno', display_name: 'Prueba', email: 'p@example.invalid', username: null, birth_date: menor ? '2012-05-01' : '1990-01-01', has_password: true, avatar: null, can_create_children: false, minor: menor ? { can_book: false, can_publish: false } : null })
    if (u === '/me/children') return json({ children: [] })
    if (u === '/events') return fallo === 'events' ? json({ code: 'internal_error' }, 500) : json({ events: [EVENTO] })
    const cancel = u.match(/^\/bookings\/([^/]+)\/cancel$/)
    if (cancel) {
      cancelaciones.push(cancel[1])
      return json({ booking: { ...PROXIMAS.find((b) => b.id === cancel[1])!, status: 'cancelled', cancel_reason: 'student' } })
    }
    if (u === '/bookings') {
      if (fallo === 'bookings') return json({ code: 'internal_error' }, 500)
      const desde = url.searchParams.get('from')!
      const hasta = url.searchParams.get('to')!
      // Lo cancelado sigue en la lista, con su estado y su motivo (como la API real).
      const todas = [...PROXIMAS, ...PASADAS].map((b) => (cancelaciones.includes(b.id) ? { ...b, status: 'cancelled', cancel_reason: 'student' } : b))
      return json({ bookings: todas.filter((b) => b.starts_at.slice(0, 10) >= desde && b.starts_at.slice(0, 10) <= hasta) })
    }
    return json({})
  })
}

test('la próxima reserva domina, el check-in está a mano y lo accionable queda sobre el pliegue', async ({ page }) => {
  await simular(page)
  await page.goto('/bookings')

  // El hueco principal es la sesión de las 12:20 y lleva el check-in como acción principal (empieza en 20 min).
  const hueco = page.getByRole('region', { name: 'Lo siguiente' })
  await expect(hueco).toContainText('Hoy · 12:20')
  await expect(hueco).toContainText('en 20 min')
  const checkin = hueco.getByRole('link', { name: 'Hacer check-in' })
  await expect(checkin).toHaveAttribute('href', '/checkin')
  // Sobre el pliegue de 812 px (la barra inferior mide ~64 px) y con un objetivo de al menos 44 px.
  const caja = (await checkin.boundingBox())!
  expect(caja.y + caja.height).toBeLessThan(812 - 64)
  expect(caja.height).toBeGreaterThanOrEqual(44)
  // Además, el acceso discreto de la cabecera.
  await expect(page.getByRole('link', { name: 'Check-in', exact: true })).toHaveAttribute('href', '/checkin')

  // El resto va agrupado por día, sin repetir «Reservada» en cada fila ni la fecha larga en cada una.
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mañana' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /sábado, 21 de noviembre/i })).toBeVisible()
  await expect(page.getByText('Reservada', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Kárate' }).getByText('En espera')).toBeVisible()

  // Los eventos inscritos van mezclados en su día.
  await expect(page.getByRole('link', { name: /Seminario de kata/ })).toBeVisible()
})

test('cancelar pide confirmación, avisa de la cancelación tardía y relega la reserva al día, tachada', async ({ page }) => {
  const cancelaciones: string[] = []
  await simular(page, { cancelaciones })
  await page.goto('/bookings')

  const hueco = page.getByRole('region', { name: 'Lo siguiente' })
  await hueco.getByRole('button', { name: /^Cancelar/ }).click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo).toContainText('¿Cancelar la reserva?')
  await expect(dialogo).toContainText('puede contar como cancelación tardía')
  // «Volver» no cancela nada.
  await dialogo.getByRole('button', { name: 'Volver' }).click()
  expect(cancelaciones).toEqual([])

  await hueco.getByRole('button', { name: /^Cancelar/ }).click()
  await page.getByRole('button', { name: 'Cancelar reserva' }).click()
  await expect.poll(() => cancelaciones).toEqual(['b1'])
  // La que sigue sube al hueco principal (la de espera, con su aviso) y la cancelada queda tachada en su día.
  await expect(hueco).toContainText('Hoy · 19:00')
  await expect(hueco).toContainText('En espera')
  await expect(page.getByRole('listitem').filter({ hasText: 'Cancelada por ti' }).getByRole('heading', { name: 'Judo adultos' })).toHaveClass(/line-through/)
})

test('un menor sin permiso ve un solo aviso y ningún botón de cancelar', async ({ page }) => {
  await simular(page, { menor: true })
  await page.goto('/bookings')
  await expect(page.getByText('Tu tutor no te ha dado permiso para reservar')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Cancelar/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Salir de la espera/ })).toHaveCount(0)
  // El check-in sigue a mano.
  await expect(page.getByRole('region', { name: 'Lo siguiente' }).getByRole('link', { name: 'Hacer check-in' })).toBeVisible()
})

test('pasadas: filas compactas por mes, con estado en icono y texto, y carga de meses anteriores', async ({ page }) => {
  await simular(page)
  await page.goto('/bookings')
  await page.getByRole('tab', { name: 'Pasadas' }).click()

  await expect(page.getByRole('heading', { name: 'Noviembre de 2026' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Octubre de 2026' })).toBeVisible()
  await expect(page.getByText('Celebrada').first()).toBeVisible()
  await expect(page.getByText('Cancelada por ti')).toBeVisible()
  await expect(page.getByText('Cancelación tardía')).toBeVisible()
  // Una fila compacta mide mucho menos que la tarjeta anterior (~115 px).
  const fila = page.getByRole('listitem').filter({ hasText: 'Celebrada' }).first()
  expect((await fila.boundingBox())!.height).toBeLessThan(80)
  await expect(page.getByRole('button', { name: 'Cargar meses anteriores' })).toBeVisible()
})

test('si fallan las reservas hay error con reintento', async ({ page }) => {
  await simular(page, { fallo: 'bookings' })
  await page.goto('/bookings')
  await expect(page.getByText('Algo ha fallado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

test('abrir la pantalla sin conexión muestra «Sin conexión» con reintento, no un esqueleto eterno', async ({ page }) => {
  await simular(page)
  // El evento `offline` desde el arranque deja las consultas de TanStack en pausa, como al abrir la app sin red.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false })
    setInterval(() => window.dispatchEvent(new Event('offline')), 100)
  })
  await page.goto('/bookings')
  await expect(page.getByText('Sin conexión')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

test('los eventos inscritos van sin la franja verde lateral de 3 px', async ({ page }) => {
  await simular(page)
  await page.goto('/bookings')
  const evento = page.getByRole('link', { name: /Seminario de kata/ })
  await expect(evento).toBeVisible()
  // Un solo borde de 1 px de color: sin la sombra interior de 3 px del lado izquierdo.
  expect(await evento.evaluate((e) => getComputedStyle(e).boxShadow)).not.toContain('inset')
})

test('si solo fallan los eventos, las sesiones siguen y hay un aviso con reintento', async ({ page }) => {
  await simular(page, { fallo: 'events' })
  await page.goto('/bookings')
  await expect(page.getByRole('region', { name: 'Lo siguiente' })).toContainText('Hoy · 12:20')
  await expect(page.getByText('No hemos podido cargar tus eventos')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})
