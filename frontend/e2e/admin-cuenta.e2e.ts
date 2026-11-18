import { expect, test, type Page } from '@playwright/test'

// Cuenta y doble factor del admin (/admin/account, /admin/mfa) sin tocar la BD ni staging: token falso de admin en `kz.token`
// y la API simulada con page.route. Nada activa el MFA de verdad. Reloj: 18 de noviembre de 2026, 18:10 en Madrid.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const NOW = new Date('2026-11-18T18:10:00+01:00')
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const URI = 'otpauth://totp/Kaizen:admin?secret=JBSWY3DPEHPK3PXP&issuer=Kaizen'
const CODES = Array.from({ length: 10 }, (_, i) => `code-${i}${i}${i}${i}`)

type Opts = { mfa?: boolean; google?: boolean; meError?: boolean; setup?: 'reauth' | 'already' }
async function open(page: Page, url: string, o: Opts = {}) {
  const calls: string[] = []
  const state = { mfa: !!o.mfa }
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', async (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const m = r.request().method()
    calls.push(`${m} ${p}`)
    if (p === '/me' && m === 'GET') {
      if (o.meError) return r.fulfill({ status: 500, json: { code: 'internal' } })
      return r.fulfill({ json: { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: !o.google, avatar: null, can_create_children: false, minor: null, role: 'admin' } })
    }
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: state.mfa } })
    if (p === '/me/password') return r.fulfill({ json: { token: TOKEN } })
    if (p === '/auth/mfa/setup') {
      if (o.setup === 'reauth') return r.fulfill({ status: 403, json: { code: 'reauth_required' } })
      if (o.setup === 'already') return r.fulfill({ status: 409, json: { code: 'mfa_already_enabled' } })
      if (r.request().postDataJSON()?.password === 'mala') return r.fulfill({ status: 400, json: { code: 'wrong_password' } })
      return r.fulfill({ status: 201, json: { otpauth_uri: URI, recovery_codes: CODES } })
    }
    if (p === '/auth/mfa/activate') {
      if (r.request().postDataJSON().code === '000000') return r.fulfill({ status: 400, json: { code: 'invalid_totp' } })
      state.mfa = true
      return r.fulfill({ json: { enabled: true, token: TOKEN } })
    }
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return calls
}
const main = (page: Page) => page.getByRole('main')
const confirmPassword = async (page: Page, pw: string) => {
  await page.getByLabel('Contraseña actual').fill(pw)
  await page.getByRole('button', { name: 'Seguir', exact: true }).click()
}

test('Cuenta sin MFA: el doble factor va primero, con su estado y «Activar», sin el aviso repetido', async ({ page }) => {
  await open(page, '/admin/account')
  const titles = main(page).getByRole('heading', { level: 2 })
  await expect(titles).toHaveText(['Doble factor', 'Contraseña', 'Tus datos'])
  await expect(main(page).getByText('Sin activar', { exact: true })).toBeVisible()
  await expect(main(page).getByText('Activa el doble factor: protege los datos de la academia')).toHaveCount(0)
  await expect(main(page).getByRole('link', { name: 'Activar el doble factor', exact: true })).toBeVisible()
})

test('Cuenta con MFA: «Activo» y sin botón', async ({ page }) => {
  await open(page, '/admin/account', { mfa: true })
  await expect(main(page).getByText('Activo', { exact: true })).toBeVisible()
  await expect(main(page).getByRole('link', { name: 'Activar el doble factor' })).toHaveCount(0)
})

test('Cuenta con /me caído: un solo error y «Cerrar sesión» sigue', async ({ page }) => {
  await open(page, '/admin/account', { meError: true })
  await expect(main(page).getByRole('button', { name: 'Reintentar' })).toHaveCount(1, { timeout: 8000 })
  await expect(main(page).getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible()
})

test('Cambiar la contraseña se queda en Cuenta con el formulario vacío', async ({ page }) => {
  const calls = await open(page, '/admin/account')
  await page.getByLabel('Contraseña actual').fill('vieja-123')
  await page.getByLabel('Contraseña nueva').fill('nueva-12345')
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click()
  await expect(page.getByText('Contraseña cambiada. Se han cerrado tus otras sesiones.')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/account$/)
  await expect(page.getByLabel('Contraseña actual')).toHaveValue('')
  expect(calls).toContain('POST /me/password')
})

test('Cuenta solo con Google: «Contraseña» explica cómo crearla', async ({ page }) => {
  await open(page, '/admin/account', { google: true })
  await expect(main(page).getByText(/Entras con Google y aún no tienes contraseña/)).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Crear contraseña', exact: true })).toBeVisible()
})

test('Activar el MFA desde Cuenta: contraseña, 3 pasos, código erróneo en su campo y vuelta a Cuenta con «Activo»', async ({ page }) => {
  const calls = await open(page, '/admin/account')
  await main(page).getByRole('link', { name: 'Activar el doble factor', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/mfa$/)

  await confirmPassword(page, 'mala')
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible({ timeout: 8000 })
  await confirmPassword(page, 'buena')

  const steps = page.getByRole('list', { name: 'Pasos' })
  await expect(steps.locator('[aria-current=step]')).toContainText('Escanear')
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()

  await expect(steps.locator('[aria-current=step]')).toContainText('Códigos')
  await expect(page.getByRole('heading', { name: 'Guarda los códigos de recuperación' })).toBeFocused()
  await expect(main(page).getByText(CODES[9])).toBeVisible()
  const next = page.getByRole('button', { name: 'Siguiente', exact: true })
  await expect(next).toBeDisabled()
  await page.getByText('Los he guardado').click()
  await next.click()

  await expect(steps.locator('[aria-current=step]')).toContainText('Activar')
  await page.keyboard.type('000000')
  await expect(page.getByText('El código no es correcto; revisa la hora del móvil.')).toBeVisible({ timeout: 8000 })
  const slots = page.locator('[data-slot=otp-field-input]')
  await expect(slots.first()).toHaveValue('')
  await expect(slots.first()).toBeFocused()

  await page.keyboard.type('123456')
  await expect(page).toHaveURL(/\/admin\/account$/)
  await expect(page.getByText('Doble factor activado')).toBeVisible()
  await expect(main(page).getByText('Activo', { exact: true })).toBeVisible()
  // Una sola petición de secreto para el intento bueno (más la de la contraseña mala).
  expect(calls.filter((c) => c === 'POST /auth/mfa/setup')).toHaveLength(2)
})

test('Pegar los 6 dígitos activa; las casillas piden teclado numérico', async ({ page }) => {
  await open(page, '/admin/mfa', { google: true })
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await page.getByText('Los he guardado').click()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  const first = page.locator('[data-slot=otp-field-input]').first()
  await expect(first).toHaveAttribute('inputmode', 'numeric')
  await first.focus()
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', '123456')
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByText('Doble factor activado')).toBeVisible()
})

test('«Ahora no» en el paso de los códigos pide confirmación', async ({ page }) => {
  await open(page, '/admin/mfa')
  await confirmPassword(page, 'buena')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await page.getByRole('button', { name: 'Ahora no', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('¿Salir sin activar?')
  await dialog.getByRole('button', { name: 'Seguir aquí', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Guarda los códigos de recuperación' })).toBeVisible()
  await page.getByRole('button', { name: 'Ahora no', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Salir sin activar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
})

test('Solo Google con login antiguo: «Vuelve a entrar»', async ({ page }) => {
  await open(page, '/admin/mfa', { google: true, setup: 'reauth' })
  await expect(page.getByRole('heading', { name: 'Vuelve a entrar' })).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible()
})

test('Ya activo: lo dice y vuelve', async ({ page }) => {
  await open(page, '/admin/mfa', { google: true, setup: 'already' })
  await expect(page.getByText('El doble factor ya está activo')).toBeVisible()
  await expect(page).toHaveURL(/\/admin$/)
})
