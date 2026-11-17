import { expect, test, type Page } from '@playwright/test'

// Cuenta (/account) con todo simulado en el navegador (page.route): no escribe nada en la base de datos y no hace login
// (token de cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (role: string) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role, exp: 4102444800 })}.x`
const ME = { id: 'u-1', role: 'tutor', display_name: 'Ana Pérez', email: 'ana@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: true, minor: null }
const hijo = (id: string, display_name: string) => ({ id, display_name, avatar: null, birth_date: '2015-05-05', pending_claim: false })
const LARA = hijo('c-lara', 'Lara')
const NICO = hijo('c-nico', 'Nico')
const CUOTA_AL_DIA = { id: 's-1', status: 'active', plan: { id: 1, name: 'Plan', price_cents: 3000, max_disciplines: 1 }, disciplines: [], current_period_end: '2026-12-01' }

type Opciones = { me?: object; role?: string; hijos?: object[]; missing?: string[]; subscription?: object | null; patch?: { status: number; json: object } }

async function abrir(page: Page, url: string, o: Opciones = {}) {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(o.role ?? 'tutor'))
  const patches: unknown[] = [] // cuerpos de los PATCH /me recibidos
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() === 'PATCH' && u === '/me') {
      patches.push(r.request().postDataJSON())
      return o.patch ? json(o.patch.json, o.patch.status) : json(o.me ?? ME)
    }
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json(o.me ?? ME)
    if (u === '/me/children') return o.role === 'alumno' && !o.hijos ? json({ code: 'insufficient_role' }, 403) : json({ children: o.hijos ?? [LARA] })
    if (u === '/me/profile-status') return json({ ok: !o.missing?.length, missing: o.missing ?? [] })
    if (u === '/me/health') return json({ health: null })
    if (u === '/billing/subscription') return o.subscription === null ? json({ code: 'subscription_not_found' }, 404) : json(o.subscription ?? CUOTA_AL_DIA)
    return json({})
  })
  await page.goto(url)
  return patches
}

const fila = (page: Page, nombre: string) => page.getByRole('link', { name: new RegExp(`^${nombre}`) })
const FILAS = ['Mis datos', 'Contraseña', 'Mis hijos', 'Ficha de salud', 'Acuerdos', 'Su cuota']

test('ficha de identidad: nombre, email y rol con los nombres de los hijos', async ({ page }) => {
  await abrir(page, '/account', { hijos: [LARA, NICO] })
  await expect(page.getByText('Ana Pérez', { exact: true })).toBeVisible()
  await expect(page.getByText('ana@example.invalid', { exact: true })).toBeVisible()
  await expect(page.getByText('Tutor de Lara y Nico', { exact: true })).toBeVisible()
})

test('tutor sin hijos: el rol es solo «Tutor»', async ({ page }) => {
  await abrir(page, '/account', { hijos: [] })
  await expect(page.getByText('Tutor', { exact: true })).toBeVisible()
})

test('todo en orden: ninguna insignia', async ({ page }) => {
  await abrir(page, '/account')
  await expect(fila(page, 'Su cuota')).toBeVisible()
  for (const texto of ['Incompleta', 'Falta firmar', 'Impagada', 'Cobro pendiente', 'Sin cuota']) await expect(page.getByText(texto, { exact: true })).toHaveCount(0)
})

test('lo pendiente se marca en su fila: ficha incompleta y falta firmar', async ({ page }) => {
  await abrir(page, '/account', { missing: ['health_info', 'data_protection'] })
  await expect(fila(page, 'Ficha de salud')).toContainText('Incompleta')
  await expect(fila(page, 'Acuerdos')).toContainText('Falta firmar')
  await expect(fila(page, 'Su cuota')).not.toContainText(/Impagada|Cobro pendiente|Sin cuota/)
})

for (const [subscription, texto] of [
  [{ ...CUOTA_AL_DIA, status: 'unpaid' }, 'Impagada'],
  [{ ...CUOTA_AL_DIA, status: 'past_due' }, 'Cobro pendiente'],
  [null, 'Sin cuota'],
] as const)
  test(`cuota «${texto}»: insignia solo en Su cuota`, async ({ page }) => {
    await abrir(page, '/account', { subscription })
    await expect(fila(page, 'Su cuota')).toContainText(texto)
    await expect(fila(page, 'Ficha de salud')).not.toContainText(/Incompleta/)
    await expect(fila(page, 'Acuerdos')).not.toContainText(/Falta firmar/)
  })

test('con ?para= los grupos llevan el nombre del hijo', async ({ page }) => {
  await abrir(page, `/account?para=${LARA.id}`, { hijos: [LARA, NICO] })
  await expect(page.getByRole('heading', { name: 'Salud y documentos de Lara' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cuota de Lara' })).toBeVisible()
  await expect(fila(page, 'Su cuota')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Mi cuota/ })).toHaveCount(0)
})

test('con ?para= de otro hijo, el nombre cambia con él', async ({ page }) => {
  await abrir(page, `/account?para=${NICO.id}`, { hijos: [LARA, NICO] })
  await expect(page.getByRole('heading', { name: 'Salud y documentos de Nico' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cuota de Nico' })).toBeVisible()
})

test('vista de menor: solo su tarjeta, sin datos, hijos, salud, acuerdos ni cuota', async ({ page }) => {
  await abrir(page, '/account', {
    role: 'alumno',
    me: { ...ME, role: 'alumno', display_name: 'Lara', email: null, username: 'lara', birth_date: '2015-05-05', can_create_children: false, minor: { can_book: true, can_publish: false } },
  })
  await expect(page.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contraseña' })).toBeVisible() // la página ya cargó
  for (const nombre of ['Mis datos', 'Mis hijos', 'Ficha de salud', 'Acuerdos', 'Mi cuota', 'Su cuota']) await expect(page.getByRole('link', { name: nombre })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^(Salud y documentos|Cuota)/ })).toHaveCount(0)
})

test('el Tab recorre las filas en el orden en que se ven', async ({ page }) => {
  await abrir(page, '/account')
  await expect(fila(page, 'Su cuota')).toBeVisible()
  const ys: number[] = []
  for (const n of FILAS) ys.push((await fila(page, n).boundingBox())!.y)
  expect(ys, 'de arriba abajo').toEqual([...ys].sort((a, b) => a - b))
  await fila(page, 'Mis datos').focus()
  const visto = ['Mis datos']
  for (let i = 0; i < 12 && visto.length < FILAS.length; i++) {
    await page.keyboard.press('Tab')
    const activo = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '')
    const n = FILAS.find((f) => activo.startsWith(f))
    if (n) visto.push(n)
  }
  expect(visto).toEqual(FILAS)
})

test('Mis datos: el email es texto fijo, no un campo', async ({ page }) => {
  await abrir(page, '/account/data')
  await expect(page.getByText('ana@example.invalid', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(1) // solo el nombre
})

test('Mis datos: guardar sin cambios no envía nada y vuelve a Cuenta', async ({ page }) => {
  const patches = await abrir(page, '/account/data')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page).toHaveURL(/\/account$/)
  expect(patches).toEqual([])
})

test('Mis datos: cambiar el nombre lo envía y vuelve a Cuenta', async ({ page }) => {
  const patches = await abrir(page, '/account/data')
  await page.getByRole('textbox', { name: 'Nombre y apellidos' }).fill('Ana Pérez López')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page).toHaveURL(/\/account$/)
  expect(patches).toEqual([{ display_name: 'Ana Pérez López' }])
})

test('Mis datos: el servidor rechaza el nombre y el error queda en el campo con el foco', async ({ page }) => {
  await abrir(page, '/account/data', { patch: { status: 400, json: { code: 'invalid_field_type' } } })
  const nombre = page.getByRole('textbox', { name: 'Nombre y apellidos' })
  await nombre.fill('Ana Pérez López')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Escribe tu nombre.')).toBeVisible()
  await expect(nombre).toHaveAttribute('aria-invalid', 'true')
  await expect(nombre).toBeFocused()
})

test('Mis datos: un alumno sin fecha de nacimiento la ve', async ({ page }) => {
  await abrir(page, '/account/data', { role: 'alumno', me: { ...ME, role: 'alumno', birth_date: null, can_create_children: false } })
  await expect(page.getByRole('textbox', { name: 'Fecha de nacimiento' })).toBeVisible()
})

test('ficha de salud: contacto y opcionales en dos tarjetas; el contacto es obligatorio', async ({ page }) => {
  await abrir(page, '/account/health', { role: 'alumno', me: { ...ME, role: 'alumno' }, hijos: [] }) // alumno adulto: /me/children vacía, no 403
  await expect(page.getByRole('heading', { level: 1, name: 'Ficha de salud' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Contacto de emergencia' })).toContainText('Tu ficha solo la ven quienes te cuidan en la sesión.')
  await expect(page.getByRole('region', { name: /^Para cuidarte mejor/ })).toBeVisible()
  await page.getByRole('button', { name: 'Guardar ficha' }).click()
  await expect(page.getByText('Pon a quién llamamos si pasa algo.')).toBeVisible()
  await expect(page.getByLabel('Nombre')).toBeFocused()
})

test('ficha de salud con ?para=: el título y los textos nombran al hijo', async ({ page }) => {
  await abrir(page, `/account/health?para=${NICO.id}`, { hijos: [LARA, NICO] })
  await expect(page.getByRole('heading', { level: 1, name: 'Salud de Nico' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Contacto de emergencia' })).toContainText('quienes cuidan de Nico')
  await expect(page.getByRole('region', { name: /^Para cuidar mejor a Nico/ })).toBeVisible()
})

test('Contraseña: avisa antes de enviar de que se cierran las demás sesiones', async ({ page }) => {
  await abrir(page, '/account/password')
  await expect(page.getByText('Al cambiarla se cerrará tu sesión en los demás dispositivos.')).toBeVisible()
})

test('Contraseña: si la actual no es correcta, el error queda en el campo con el foco', async ({ page }) => {
  await abrir(page, '/account/password')
  await page.route('**/api/me/password', (r) => r.fulfill({ status: 401, json: { code: 'wrong_password' } }))
  const actual = page.getByLabel('Contraseña actual')
  await actual.fill('mala-1234')
  await page.getByLabel('Contraseña nueva').fill('nueva-12345')
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible()
  await expect(actual).toHaveAttribute('aria-invalid', 'true')
  await expect(actual).toBeFocused()
})

test('Contraseña: una cuenta solo con Google ve en la tarjeta que se envió el email y puede reenviarlo', async ({ page }) => {
  await abrir(page, '/account/password', { me: { ...ME, has_password: false } })
  await page.getByRole('button', { name: 'Crear contraseña' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'ana@example.invalid' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reenviar email' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear contraseña' })).toHaveCount(0)
})
