import { expect, test, type Page } from '@playwright/test'

// Inicio del alumno con las reservas simuladas en el navegador (page.route): no escribe nada en la base de datos.
// Necesita E2E_BASE_URL, E2E_EMAIL y E2E_PASSWORD; el sujeto es la propia cuenta.
async function entrar(page: Page) {
  const { E2E_EMAIL, E2E_PASSWORD } = process.env
  await page.goto('/login')
  await page.getByLabel('Email o usuario').fill(E2E_EMAIL!)
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Tres reservas: dentro de 95 min, mañana y dentro de tres días en espera. El alumno es el del token o el `profile_id`.
async function simularReservas(page: Page) {
  const yo = await page.evaluate(() => JSON.parse(atob(localStorage.getItem('kz.token')!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string)
  await page.route(/\/api\/bookings\?/, async (route) => {
    const alumno = new URL(route.request().url()).searchParams.get('profile_id') ?? yo
    const ahora = Date.now()
    const reserva = (id: number, min: number, disciplina: string, status = 'booked') => ({
      id: `b${id}`,
      session_id: `s${id}`,
      student_id: alumno,
      status,
      cancel_reason: null,
      discipline_id: 1,
      discipline_name: disciplina,
      starts_at: new Date(ahora + min * 60_000).toISOString(),
      ends_at: new Date(ahora + (min + 60) * 60_000).toISOString(),
      location: 'Sala 2',
      session_status: 'scheduled',
    })
    await route.fulfill({ json: { bookings: [reserva(1, 95, 'Judo infantil'), reserva(2, 26 * 60, 'Kárate'), reserva(3, 72 * 60, 'Boxeo', 'waitlisted')] } })
  })
}

test('el Inicio pone la próxima sesión arriba y la lista no repite «Reservada»', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Faltan E2E_BASE_URL, E2E_EMAIL o E2E_PASSWORD')
  await entrar(page)
  await simularReservas(page)
  await page.goto('/')

  // El hueco principal es la primera sesión, con el día y la hora grandes, y lleva a Reservas.
  const principal = page.getByRole('link', { name: /^\S+ · \d{2}:\d{2}\s*Judo infantil/ })
  await expect(principal).toBeVisible()
  await expect(principal).toHaveAttribute('href', /\/bookings/)

  // La lista trae las otras dos; la reserva firme no repite el estado y la que espera, sí.
  const lista = page.getByRole('region', { name: 'Próximas reservas' })
  await expect(lista.getByText('Kárate')).toBeVisible()
  await expect(lista.getByText('Reservada')).toHaveCount(0)
  await expect(lista.getByText('En espera')).toBeVisible()

  // El orden de tabulación es el visual: desde la sesión principal se llega a «Ver todas» sin saltos.
  await principal.focus()
  const paradas: string[] = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    paradas.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()))
  }
  expect(paradas).toContain('Ver todas')

  // Las otras pantallas siguen con su estado en la tarjeta.
  await page.goto('/bookings')
  await expect(page.getByText('Reservada').first()).toBeVisible()
})

test('con movimiento reducido el Inicio no escalona la entrada', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Faltan E2E_BASE_URL, E2E_EMAIL o E2E_PASSWORD')
  await entrar(page)
  await simularReservas(page)
  const entradas = () => page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'rise').length)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Racha' })).toBeVisible()
  expect(await entradas()).toBeGreaterThan(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Racha' })).toBeVisible()
  expect(await entradas()).toBe(0)
})
