import { expect, test, type Page } from '@playwright/test'

// Lo transversal (estados de pantalla, 404, AppCrash, tema y marco) con todo simulado en el navegador (page.route): no escribe
// nada en la base de datos y no hace login (token de cliente falso). Solo necesita E2E_BASE_URL. Hora fija en Madrid: 18-nov-2026 12:00.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES', colorScheme: 'light' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`
const at = (dia: number, hm: string) => new Date(`2026-11-${dia}T${hm}:00+01:00`)
const reserva = (id: string, dia: number, hm: string, name: string) => ({
  id, session_id: `s-${id}`, student_id: 'u-1', status: 'confirmed', cancel_reason: null, discipline_id: 1, discipline_name: name,
  starts_at: at(dia, hm).toISOString(), ends_at: new Date(at(dia, hm).getTime() + 3_600_000).toISOString(), location: 'Sala 2', session_status: 'scheduled',
})
const RESERVAS = [reserva('b1', 18, '19:00', 'Judo adultos'), reserva('b2', 21, '10:00', 'Boxeo')]

// bookings: 'vacio' | 'cuelga' (no responde) | 'falla' (500 mientras `estado.falla`) | 'ok'. progress: 'roto' revienta el Inicio.
type Opciones = { bookings?: 'vacio' | 'cuelga' | 'falla' | 'ok'; progress?: 'roto' }
async function simular(page: Page, { bookings = 'ok', progress }: Opciones = {}) {
  const estado = { falla: bookings === 'falla' }
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.clock.install({ time: at(18, '12:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (u === '/me') return json({ id: 'u-1', role: 'alumno', display_name: 'Ana Pérez', email: 'ana@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: false, minor: null })
    if (u === '/me/children') return json({ children: [] })
    if (u === '/me/progress') return progress === 'roto' ? json({}) : json({ streak: { current: 4, best: 9 }, disciplines: [], hours: { month: '2026-11', disciplines: [] }, medals_seen: [] })
    if (u === '/bookings/rules') return json({ cancellation_notice_minutes: 60 })
    if (u === '/checkin/window') return json({ opens_minutes: 30, closes_minutes: 10 })
    if (u === '/events') return json({ events: [] })
    if (u === '/sessions/calendar') return json({ sessions: [] })
    if (u === '/disciplines') return json({ disciplines: [] })
    if (u === '/bookings') {
      if (bookings === 'cuelga') return
      if (estado.falla) return json({ code: 'internal_error' }, 500)
      return json({ bookings: bookings === 'vacio' ? [] : RESERVAS })
    }
    return json({})
  })
  return estado
}

test('vacío: título en sans (no en la condensada) y salida a Calendario', async ({ page }) => {
  await simular(page, { bookings: 'vacio' })
  await page.goto('/bookings')
  const titulo = page.getByText('Aún no tienes reservas', { exact: true })
  await expect(titulo).toBeVisible()
  expect(await titulo.evaluate((e) => getComputedStyle(e).fontFamily)).not.toContain('Barlow')
  await expect(page.getByRole('link', { name: 'Ver calendario' })).toHaveAttribute('href', '/calendar')
})

test('error con Reintentar: el aviso es un alert y, al reintentar, llega la lista', async ({ page }) => {
  const estado = await simular(page, { bookings: 'falla' })
  await page.goto('/bookings')
  // retry: 1 en el cliente: el error llega tras un reintento (~1 s).
  const alerta = page.getByRole('alert').filter({ hasText: 'Algo ha fallado' })
  await expect(alerta).toBeVisible({ timeout: 10_000 })
  expect(await alerta.getByText('Algo ha fallado').evaluate((e) => getComputedStyle(e).fontFamily)).not.toContain('Barlow')
  estado.falla = false
  await alerta.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(page.getByText('Boxeo')).toBeVisible()
  await expect(alerta).toHaveCount(0)
})

test('cargando: esqueleto con aria-busy mientras la API no responde', async ({ page }) => {
  await simular(page, { bookings: 'cuelga' })
  await page.goto('/bookings')
  await expect(page.locator('[aria-busy="true"][aria-label="Cargando"]').first()).toBeVisible()
})

test('AppCrash: marca, tarjeta a su medida y dos salidas', async ({ page }) => {
  await simular(page, { progress: 'roto' })
  await page.goto('/')
  const alerta = page.getByRole('alert').filter({ hasText: 'Algo ha fallado' })
  await expect(alerta).toBeVisible()
  await expect(page.getByText('Kaizen', { exact: true })).toBeVisible()
  // «Ir al inicio» es un enlace normal (recarga la app entera, por si lo roto es el router).
  const inicio = alerta.getByRole('link', { name: 'Ir al inicio' })
  await expect(inicio).toHaveAttribute('href', '/')
  for (const b of [inicio, alerta.getByRole('button', { name: 'Actualizar y recargar' })]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // Ya no se estira a toda la altura.
  expect((await alerta.boundingBox())!.height).toBeLessThan(812 * 0.75)
})

test('404: una ruta que no existe dice «No lo encontramos» y vuelve al Inicio', async ({ page }) => {
  await simular(page)
  await page.goto('/nada')
  await expect(page.getByText('No lo encontramos', { exact: true })).toBeVisible()
  await expect(page.getByText(/llega en/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Ir al Inicio', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('tema: en «Como el sistema» el botón dice el tema que se ve; al elegir Oscuro cambia la app', async ({ page }) => {
  await simular(page)
  await page.goto('/bookings')
  const boton = page.getByRole('button', { name: 'Tema: Como el sistema (claro)', exact: true })
  await expect(boton).toBeVisible()
  await boton.click()
  await page.getByRole('menuitemradio', { name: 'Oscuro', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(page.getByRole('button', { name: 'Tema: Oscuro', exact: true })).toBeVisible()
})

test('marco en móvil: la barra inferior lleva a Calendario y marca la pestaña', async ({ page }) => {
  await simular(page)
  await page.goto('/bookings')
  const menu = page.getByRole('navigation', { name: 'Principal' })
  const caja = (await menu.boundingBox())!
  expect(caja.y + caja.height).toBeGreaterThan(812 - 2) // pegada abajo
  await menu.getByRole('link', { name: 'Calendario', exact: true }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(menu.getByRole('link', { name: 'Calendario', exact: true })).toHaveAttribute('aria-current', 'page')
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })

  test('marco: el menú es lateral, a la izquierda del contenido, y lleva a Reservas', async ({ page }) => {
    await simular(page)
    await page.goto('/calendar')
    const menu = page.getByRole('navigation', { name: 'Principal' })
    const nav = (await menu.boundingBox())!
    const main = (await page.getByRole('main').boundingBox())!
    expect(nav.x + nav.width).toBeLessThanOrEqual(main.x + 1)
    expect(nav.width).toBe(256)
    await menu.getByRole('link', { name: 'Reservas', exact: true }).click()
    await expect(page).toHaveURL(/\/bookings$/)
    await expect(menu.getByRole('link', { name: 'Reservas', exact: true })).toHaveAttribute('aria-current', 'page')
  })
})
