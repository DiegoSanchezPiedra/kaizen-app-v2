import { expect, test, type Page } from '@playwright/test'

// /onboarding con todo simulado en el navegador (page.route): no escribe en la base de datos y no hace login (token de
// cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. Hora fija en Madrid.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (role: string) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role, exp: 4102444800 })}.x`
const ALUMNO = ['display_name', 'health_info', 'emergency_contact', 'data_protection', 'rights_of_image']

type Opciones = { role?: 'alumno' | 'tutor'; missing: string[]; url?: string; status500?: boolean }

// `missing` es el estado del servidor: el PATCH /me quita display_name, como haría el backend.
async function abrir(page: Page, { role = 'alumno', missing, url = '/onboarding', status500 }: Opciones) {
  let actual = missing
  let conNombre = !missing.includes('display_name')
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(role))
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() === 'PATCH' && u === '/me') {
      actual = actual.filter((m) => m !== 'display_name')
      conNombre = true
      return json({})
    }
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json({ id: 'u-1', role, display_name: conNombre ? 'Prueba' : null, email: 'p@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: role === 'tutor', minor: null })
    if (u === '/me/children') return json({ children: [] })
    if (u === '/me/profile-status') return status500 ? json({ code: 'internal_error' }, 500) : json(actual.length ? { ok: false, missing: actual } : { ok: true })
    if (u === '/me/health') return json({ health: null })
    if (u === '/billing/subscription') return json({ code: 'not_found' }, 404)
    return json({})
  })
  await page.goto(url)
}

const pasos = (page: Page) => page.getByRole('list', { name: 'Pasos' }).getByRole('listitem')

test('alumno con todo pendiente: tres pasos y, al guardar «Datos», entra la ficha sin aviso y con el foco en su título', async ({ page }) => {
  await abrir(page, { missing: ALUMNO })
  await expect(pasos(page)).toHaveCount(3)
  await expect(pasos(page)).toHaveText([/Datos/, /Ficha/, /Acuerdos/])
  await expect(pasos(page).nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(pasos(page).nth(1)).not.toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('heading', { level: 2, name: 'Tus datos' })).toBeVisible()
  await expect(page.getByText('Paso 1 de 3 · Puedes salir y volver cuando quieras.')).toBeVisible()

  await page.getByLabel('Nombre y apellidos').fill('Marta Ruiz')
  await page.getByRole('button', { name: 'Continuar' }).click()

  const titulo = page.getByRole('heading', { level: 2, name: 'Ficha de salud' })
  await expect(titulo).toBeVisible()
  await expect(titulo).toBeFocused()
  await expect(pasos(page).nth(1)).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('Paso 2 de 3')).toBeVisible()
  await expect(page.getByText('Datos guardados')).toHaveCount(0)
  // Contacto de emergencia primero; el resto, opcional.
  await expect(page.locator('form input, form textarea').first()).toHaveAttribute('name', 'emergency_contact_name')
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible()
  // Pie fijo: «Continuar» cabe en la ventana sin bajar por los campos opcionales.
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByText('(opcional)').first()).toBeVisible()
})

test('tutor: dos pasos (Datos y Acuerdos)', async ({ page }) => {
  await abrir(page, { role: 'tutor', missing: ['display_name', 'data_protection'] })
  await expect(pasos(page)).toHaveCount(2)
  await expect(pasos(page)).toHaveText([/Datos/, /Acuerdos/])
  await expect(pasos(page).nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('Paso 1 de 2')).toBeVisible()
})

test('sin pendientes: «Perfil completo» con «Ver calendario»', async ({ page }) => {
  await abrir(page, { missing: [] })
  await expect(page.getByRole('heading', { level: 2, name: 'Perfil completo' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver calendario' })).toHaveAttribute('href', '/calendar')
  // Botones a todo el ancho de la tarjeta, como el resto de acciones principales en móvil.
  const anchos = await Promise.all(['Ver calendario', 'Ir al inicio'].map(async (n) => (await page.getByRole('link', { name: n }).boundingBox())!.width))
  expect(Math.abs(anchos[0] - anchos[1])).toBeLessThan(1)
  expect(anchos[0]).toBeGreaterThan(250)
  await expect(page.getByRole('link', { name: 'Ir al inicio' })).toBeVisible()
})

test('con ?volver= y sin pendientes: redirige a donde estaba', async ({ page }) => {
  await abrir(page, { missing: [], url: '/onboarding?volver=/billing' })
  await expect(page).toHaveURL(/\/billing$/)
})

test('error 500: «Algo ha fallado» con Reintentar', async ({ page }) => {
  await abrir(page, { missing: ALUMNO, status500: true })
  await expect(page.getByText('Algo ha fallado')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Reintentar/ })).toBeVisible()
})
