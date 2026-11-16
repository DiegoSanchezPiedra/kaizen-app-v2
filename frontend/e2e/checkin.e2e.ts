import { expect, test, type Page } from '@playwright/test'

// Check-in con todo simulado en el navegador (page.route): no escribe en la base de datos ni hace login (token de cliente
// falso). Necesita E2E_BASE_URL de un servidor de desarrollo (`vite`): el QR se envía por el campo «solo en desarrollo» y la
// cámara es la falsa de Chromium. La hora se fija en Madrid: miércoles 18-nov-2026 12:00.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({
  viewport: { width: 375, height: 812 },
  timezoneId: 'Europe/Madrid',
  locale: 'es-ES',
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
})

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`
const TOKEN_TUTOR = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'tutor', exp: 4102444800 })}.x`

const cand = (id: string, student: string, name: string, disc: string, checked: string | null = null) => ({ booking_id: id, student_id: student, display_name: name, discipline: disc, starts_at: '2026-11-18T11:30:00.000Z', checked_in_at: checked })
const YO = cand('b1', 'u-1', 'Prueba', 'Judo adultos')
const HIJOS = [cand('b2', 'k-1', 'Mateo', 'Judo infantil'), cand('b3', 'k-2', 'Lucía', 'Kárate infantil'), cand('b5', 'k-4', 'Sofía', 'Judo infantil'), cand('b6', 'k-5', 'Hugo', 'Kárate infantil')]
const YA = cand('b4', 'k-3', 'Alejandro Fernández-Valdés', 'Boxeo juvenil', '2026-11-18T11:31:00.000Z')

type Respuesta = { status?: number; json: unknown }
type Camara = 'on' | 'denied' | 'none'

type Sujeto = { rol?: 'alumno' | 'tutor'; menor?: boolean }
async function abrir(page: Page, { camara = 'on', respuesta, enviados = [], rol = 'alumno', menor = false }: { camara?: Camara; respuesta?: Respuesta; enviados?: unknown[] } & Sujeto = {}) {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), rol === 'tutor' ? TOKEN_TUTOR : TOKEN)
  if (camara !== 'on') {
    await page.addInitScript((c) => {
      const md = navigator.mediaDevices
      md.enumerateDevices = async () => (c === 'none' ? [] : [{ kind: 'videoinput', deviceId: 'x', label: 'cam', groupId: 'g' } as MediaDeviceInfo])
      if (c === 'denied') md.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'))
    }, camara)
  }
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (u === '/me') return json({ id: 'u-1', role: rol, display_name: 'Prueba', email: 'p@example.invalid', username: null, birth_date: menor ? '2012-05-01' : '1990-01-01', has_password: true, avatar: null, can_create_children: rol === 'tutor', minor: menor ? { can_book: false, can_publish: false } : null })
    if (u === '/me/children') return json({ children: rol === 'tutor' ? HIJOS.map((h) => ({ id: h.student_id, display_name: h.display_name, birth_date: '2015-01-01', pending_claim: false })) : [] })
    if (u === '/checkin' && r.request().method() === 'POST') {
      enviados.push(r.request().postDataJSON())
      return json(respuesta?.json, respuesta?.status ?? 200)
    }
    return json({})
  })
  await page.goto('/checkin')
}

const escanear = async (page: Page) => {
  const campo = page.getByLabel('Código (solo en desarrollo)')
  // Primero la pantalla (la ruta es diferida); el campo solo existe en un servidor de desarrollo, no en una build.
  await page.getByRole('main').getByRole('link', { name: 'Reservas' }).waitFor()
  test.skip((await campo.count()) === 0, 'Sin el campo «solo en desarrollo» (build): hace falta un servidor de desarrollo')
  await campo.fill('CODIGO')
  await campo.press('Enter')
}

test('el visor es lo dominante y la salida está a mano', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText('Apunta al código QR de la tablet')).toBeVisible()
  const volver = page.getByRole('main').getByRole('link', { name: 'Reservas' })
  await expect(volver).toHaveAttribute('href', '/bookings')
  expect((await volver.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('éxito: hora de hoy, acción sobre el pliegue y objetivo de 44 px', async ({ page }) => {
  await abrir(page, { respuesta: { json: { status: 'done', results: [{ ...YO, already: false }] } } })
  await escanear(page)
  await expect(page.getByRole('heading', { name: 'Check-in hecho' })).toBeVisible()
  await expect(page.getByText('Judo adultos · Hoy · 12:30')).toBeVisible()
  const volver = page.getByRole('link', { name: 'Volver a mis reservas' })
  const caja = (await volver.boundingBox())!
  expect(caja.y + caja.height).toBeLessThan(812)
  expect(caja.height).toBeGreaterThanOrEqual(44)
})

test('ya registrado: título propio y hora a la que constaba', async ({ page }) => {
  await abrir(page, { respuesta: { json: { status: 'done', results: [{ ...YO, already: true, checked_in_at: '2026-11-18T11:20:00.000Z' }] } } })
  await escanear(page)
  await expect(page.getByRole('heading', { name: 'Ya estaba registrado' })).toBeVisible()
  await expect(page.getByText('Registrado a las 12:20')).toBeVisible()
})

test('un error que escanear no arregla ofrece volver a Reservas; uno que sí, reescanear', async ({ page }) => {
  await abrir(page, { respuesta: { status: 409, json: { code: 'no_candidates' } } })
  await escanear(page)
  await expect(page.getByText('No tienes ninguna reserva con el check-in abierto.')).toBeVisible()
  const botones = page.getByRole('link', { name: 'Volver a mis reservas' })
  await expect(botones).toHaveAttribute('href', '/bookings')
  await expect(page.getByRole('button', { name: 'Escanear de nuevo' })).toBeVisible()

  const otra = await page.context().newPage()
  await abrir(otra, { respuesta: { status: 400, json: { code: 'invalid_qr' } } })
  await escanear(otra)
  await expect(otra.getByRole('button', { name: 'Escanear de nuevo' })).toBeVisible()
  await expect(otra.getByRole('link', { name: 'Volver a mis reservas' })).toHaveCount(0)
})

test('hijos: nada marcado, «Marcar todos» desde 3, ya registradas al final y botón a la vista', async ({ page }) => {
  const enviados: unknown[] = []
  await abrir(page, { enviados, respuesta: { json: { status: 'choose', candidates: [YA, YO, ...HIJOS] } } })
  await escanear(page)
  const hoja = page.getByRole('dialog')
  await expect(hoja.getByRole('heading', { name: '¿A quién registras?' })).toBeVisible()
  // El foco inicial va al título, no a una casilla (sin anillo sorpresa en táctil), y el cierre está en español.
  await expect(hoja.getByRole('heading', { name: '¿A quién registras?' })).toBeFocused()
  await expect(hoja.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  const filas = hoja.locator('label')
  await expect(filas.last()).toContainText('Alejandro Fernández-Valdés')
  await expect(filas.last().getByRole('checkbox')).toBeDisabled()
  await expect(hoja.getByRole('checkbox', { checked: true })).toHaveCount(1) // solo la ya registrada
  const registrar = hoja.getByRole('button', { name: 'Registrar' })
  await expect(registrar).toBeDisabled()
  expect((await registrar.boundingBox())!.y + 44).toBeLessThanOrEqual(812)

  await hoja.getByRole('button', { name: 'Marcar todos' }).click()
  await expect(hoja.getByRole('button', { name: 'Registrar a 5' })).toBeEnabled()
  await hoja.getByRole('button', { name: 'Registrar a 5' }).click()
  await expect.poll(() => enviados.length).toBe(2)
  expect((enviados[1] as { booking_ids: string[] }).booking_ids.sort()).toEqual(['b1', 'b2', 'b3', 'b5', 'b6'])
})

test('con 2 pendientes no sale «Marcar todos»', async ({ page }) => {
  await abrir(page, { respuesta: { json: { status: 'choose', candidates: [YO, HIJOS[0]] } } })
  await escanear(page)
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Marcar todos' })).toHaveCount(0)
})

test('sin red el visor avisa y se reanuda solo al volver', async ({ page, context }) => {
  await abrir(page)
  await expect(page.getByText('Apunta al código QR de la tablet')).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Sin conexión. Seguimos en cuanto vuelva.')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Apunta al código QR de la tablet')).toBeVisible()
})

test('cámara denegada: pasos concretos y una salida; sin cámara: Reservas', async ({ page }) => {
  await abrir(page, { camara: 'denied' })
  await expect(page.getByRole('heading', { name: 'No podemos usar la cámara' })).toBeVisible()
  await expect(page.getByText('Cambia «Cámara» a «Permitir».')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Volver a intentarlo' })).toBeVisible()

  const otra = await page.context().newPage()
  await abrir(otra, { camara: 'none' })
  await expect(otra.getByRole('heading', { name: 'No encontramos cámara' })).toBeVisible()
  await expect(otra.getByText('pídeselo al profesor')).toBeVisible()
  await expect(otra.getByRole('link', { name: 'Volver a mis reservas' })).toHaveAttribute('href', '/bookings')
})

test('el foco entra en el resultado y el orden del DOM es el visual', async ({ page }) => {
  await abrir(page, { respuesta: { json: { status: 'done', results: [{ ...YO, already: false }] } } })
  await escanear(page)
  const tarjeta = page.getByRole('status').filter({ hasText: 'Check-in hecho' })
  await expect(tarjeta).toBeFocused() // el campo del que venía el foco desaparece: no se pierde
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Volver a mis reservas' })).toBeFocused()
  // «Reservas» (arriba) va antes en el DOM que la tarjeta (abajo), igual que en pantalla.
  const [dom, y] = await page.evaluate(() => {
    const back = [...document.querySelectorAll('main a')].find((a) => a.textContent?.trim() === 'Reservas')!
    const card = document.querySelector('main [role=status]')!
    return [!!(back.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING), back.getBoundingClientRect().y < card.getBoundingClientRect().y]
  })
  expect(dom && y).toBe(true)
})

test('el menú queda inerte bajo el visor: Tab nunca entra en él', async ({ page }) => {
  await abrir(page, { respuesta: { json: { status: 'done', results: [{ ...YO, already: false }] } } })
  await escanear(page)
  await expect(page.getByRole('status').filter({ hasText: 'Check-in hecho' })).toBeFocused()
  await expect(page.locator('nav#menu')).toHaveAttribute('inert', '')
  const dentro: boolean[] = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    dentro.push(await page.evaluate(() => !!document.activeElement?.closest('nav#menu')))
  }
  expect(dentro).not.toContain(true)
})

test('tutor con hijos: nadie es «Tú» y se registra a los hijos marcados', async ({ page }) => {
  const enviados: unknown[] = []
  const hijos = HIJOS.slice(0, 3)
  await abrir(page, { rol: 'tutor', enviados, respuesta: { json: { status: 'choose', candidates: hijos } } })
  await escanear(page)
  const hoja = page.getByRole('dialog')
  await expect(hoja.getByText('Tú', { exact: true })).toHaveCount(0)
  for (const h of hijos) await expect(hoja.getByText(h.display_name, { exact: true })).toBeVisible()
  await hoja.getByRole('button', { name: 'Marcar todos' }).click()
  await expect(hoja.getByRole('button', { name: 'Registrar a 3' })).toBeEnabled()
})

test('menor con acceso propio: su check-in sale sin nombre y sin cuota ni pasos de perfil', async ({ page }) => {
  await abrir(page, { menor: true, respuesta: { json: { status: 'done', results: [{ ...YO, already: false }] } } })
  await escanear(page)
  await expect(page.getByRole('heading', { name: 'Check-in hecho' })).toBeVisible()
  await expect(page.getByText('Judo adultos · Hoy · 12:30')).toBeVisible()
  await expect(page.getByText('Tú', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Volver a mis reservas' })).toHaveAttribute('href', '/bookings')
})

test('fuera de /checkin el menú sigue activo (el shell no cambia)', async ({ page }) => {
  await abrir(page)
  await page.goto('/bookings')
  await expect(page.locator('nav#menu')).toBeVisible()
  await expect(page.locator('nav#menu')).not.toHaveAttribute('inert', /.*/)
  await expect(page.getByRole('link', { name: 'Ir al menú' })).not.toHaveAttribute('inert', /.*/)
})
