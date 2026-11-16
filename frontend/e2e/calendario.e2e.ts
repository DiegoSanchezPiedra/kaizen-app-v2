import { expect, test, type Page } from '@playwright/test'

// Calendario con todo simulado en el navegador (page.route): no escribe nada en la base de datos.
// Necesita E2E_BASE_URL, E2E_EMAIL y E2E_PASSWORD; solo el login es real. La hora se fija en Madrid: miércoles 18-nov-2026 12:00.
// El login se hace una sola vez por ejecución y se reutiliza: la API limita los inicios de sesión (429).
const SESION = 'test-results/calendario-sesion.json'
test.skip(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Faltan E2E_BASE_URL, E2E_EMAIL o E2E_PASSWORD')
test.use({ viewport: { width: 375, height: 812 }, storageState: SESION })

test.beforeAll(async ({ browser }) => {
  const { E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD } = process.env
  const page = await browser.newPage({ baseURL: E2E_BASE_URL, storageState: undefined })
  await page.goto('/login')
  await page.getByLabel('Email o usuario').fill(E2E_EMAIL!)
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.context().storageState({ path: SESION })
  await page.close()
})

type Sesion = { id: string; starts_at: string; ends_at: string; discipline: { id: number; name: string }; trainer: { id: string; display_name: string }; location: string; capacity: number; taken: number; status: 'scheduled' | 'cancelled'; held: boolean; covered: boolean; booking: { id: string; status: 'confirmed' | 'waitlisted' } | null }
const sesion = (id: string, dia: number, hm: string, name: string, extra: Partial<Sesion> = {}): Sesion => {
  const start = new Date(`2026-11-${dia}T${hm}:00+01:00`)
  return { id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), discipline: { id: 1, name }, trainer: { id: 't1', display_name: 'Marta Ruiz' }, location: 'Sala 2', capacity: 12, taken: 7, status: 'scheduled', held: false, covered: true, booking: null, ...extra }
}

// Hoy (miércoles): una celebrada, una en curso, una reservada, una en espera y una no cubierta; mañana, una disponible.
const SESIONES = [
  sesion('s1', 18, '09:00', 'Judo infantil', { held: true }),
  sesion('s2', 18, '11:30', 'Kárate'),
  sesion('s3', 18, '18:00', 'Judo infantil', { booking: { id: 'b3', status: 'confirmed' } }),
  sesion('s4', 18, '19:00', 'Boxeo', { taken: 12, booking: { id: 'b4', status: 'waitlisted' } }),
  sesion('s5', 18, '20:00', 'Kárate', { covered: false }),
  sesion('s6', 19, '18:00', 'Judo adultos'),
]

async function simular(page: Page, { sinCuota = true, reservadas = new Set<string>() } = {}) {
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route(/\/api\/disciplines/, (r) => r.fulfill({ json: { disciplines: [1, 2, 3].map((id) => ({ id, name: ['Judo', 'Kárate', 'Boxeo'][id - 1], min_age: null, max_age: null, is_active: true, is_open: true })) } }))
  await page.route(/\/api\/sessions\/calendar/, (r) => r.fulfill({ json: { sessions: SESIONES.map((s) => (reservadas.has(s.id) ? { ...s, booking: { id: `bk-${s.id}`, status: 'confirmed' } } : s)) } }))
  if (sinCuota) await page.route(/\/api\/billing\/subscription/, (r) => r.fulfill({ status: 404, json: { code: 'subscription_not_found' } }))
  await page.route(/\/api\/bookings$/, async (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    const { session_id } = r.request().postDataJSON() as { session_id: string }
    reservadas.add(session_id)
    await r.fulfill({ json: { booking: { id: `bk-${session_id}`, session_id, status: 'confirmed' } } })
  })
}

test('sin cuota: el aviso es una fila, las celebradas se pliegan y lo accionable queda sobre el pliegue', async ({ page }) => {
  await simular(page)
  await page.goto('/calendar')

  // El aviso es una sola fila pulsable (no la tarjeta con botón de ~140 px) y lleva a la cuota.
  const aviso = page.getByRole('link', { name: /Contrata una cuota para reservar/ })
  await expect(aviso).toHaveAttribute('href', /\/billing/)
  expect((await aviso.boundingBox())!.height).toBeLessThan(100)

  // La celebrada de hoy va plegada; «En curso» y lo reservable, a la vista.
  const plegable = page.getByRole('button', { name: /1 sesión celebrada/ })
  await expect(plegable).toHaveAttribute('aria-expanded', 'false')
  // Plegado = inerte y transparente (Playwright da por visible lo recortado, por eso se mira el panel).
  const panel = page.locator(`[id="${await plegable.getAttribute('aria-controls')}"]`)
  await expect(panel).toHaveAttribute('inert', '')
  await expect(panel).toHaveCSS('opacity', '0')
  await expect(page.getByText('En curso')).toBeVisible()
  const cancelar = page.getByRole('button', { name: 'Cancelar' })
  await expect(cancelar).toBeVisible()
  const caja = (await cancelar.boundingBox())!
  expect(caja.y + caja.height).toBeLessThan(812 - 64)

  // Al abrirla aparece la celebrada.
  await plegable.click()
  await expect(plegable).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).not.toHaveAttribute('inert', '')
  await expect(panel).toHaveCSS('opacity', '1')
  await expect(panel.getByText('Celebrada', { exact: true })).toBeVisible()

  // La tira marca el día con reserva y no el que solo tiene clases.
  await expect(page.getByRole('button', { name: /18 de noviembre.*con reserva/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /19 de noviembre, con clases$/ })).toBeVisible()
})

test('reservar cambia el estado de la fila y marca el día en la tira', async ({ page }) => {
  await simular(page)
  await page.goto('/calendar')
  await page.getByRole('button', { name: /19 de noviembre/ }).click()
  // Los días no elegidos siguen en el DOM (ocultos): se acota al del jueves.
  const jueves = page.getByRole('region', { name: /19 de noviembre/ })
  await jueves.getByRole('button', { name: 'Reservar' }).click()
  await expect(jueves.getByText('Reservada', { exact: true })).toBeVisible()
  await expect(jueves.getByRole('button', { name: 'Cancelar' })).toBeVisible()
  await expect(page.getByRole('button', { name: /19 de noviembre.*con reserva/ })).toBeVisible()
})

test('un hijo: el calendario pide las sesiones del hijo elegido', async ({ page }) => {
  await simular(page, { sinCuota: false })
  await page.route(/\/api\/me\/children/, (r) => r.fulfill({ json: { children: [{ id: 'hijo-1', display_name: 'Mateo', birth_date: '2016-04-01', pending_claim: false }] } }))
  const pedidas: string[] = []
  page.on('request', (r) => r.url().includes('/api/sessions/calendar') && pedidas.push(r.url()))
  await page.goto('/calendar?para=hijo-1')
  await expect(page.getByText('Marta Ruiz').first()).toBeVisible()
  expect(pedidas.at(-1)).toContain('profile_id=hijo-1')
})

test('un menor sin permiso de reservar ve el motivo, no el botón ni el aviso de cuota', async ({ page }) => {
  await simular(page, { sinCuota: false })
  await page.route(/\/api\/me$/, async (r) => {
    const real = await r.fetch()
    await r.fulfill({ response: real, json: { ...(await real.json()), minor: { can_book: false, can_publish: false } } })
  })
  await page.goto('/calendar')
  await expect(page.getByText('Tu tutor no te ha dado permiso para reservar')).toBeVisible()
  await page.getByRole('button', { name: /19 de noviembre/ }).click()
  await expect(page.getByText('Sin permiso')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reservar' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Contrata una cuota/ })).toHaveCount(0)
})

test('sin conexión dice «Sin conexión» en vez de quedarse en esqueleto, y se recupera sola', async ({ page, context }) => {
  await simular(page)
  await page.goto('/calendar')
  await expect(page.getByRole('button', { name: /sesión celebrada/ })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(page.getByText('Sin conexión')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Sin conexión')).toBeHidden()
})

test('la entrada escalonada se juega una vez por sesión y no con movimiento reducido', async ({ page }) => {
  await simular(page)
  const entradas = () => page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'rise').length)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/calendar')
  await expect(page.getByRole('button', { name: /sesión celebrada/ })).toBeVisible()
  expect(await entradas()).toBeGreaterThan(0)
  // Ir a Eventos y volver no la repite.
  await page.getByRole('tab', { name: 'Eventos' }).click()
  await page.getByRole('tab', { name: 'Sesiones' }).click()
  await expect(page.getByRole('button', { name: /sesión celebrada/ })).toBeVisible()
  expect(await entradas()).toBe(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/calendar')
  await expect(page.getByRole('button', { name: /sesión celebrada/ })).toBeVisible()
  expect(await entradas()).toBe(0)
})
