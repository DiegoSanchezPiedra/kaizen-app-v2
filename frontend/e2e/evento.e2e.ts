import { expect, test, type Page } from '@playwright/test'

// Detalle de evento (/events/:id) con todo simulado en el navegador (page.route): no escribe nada en la base de datos y no
// hace login (token de cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. La hora se fija en Madrid:
// miércoles 18-nov-2026 12:00; el evento es el domingo 22 de 10:00 a 13:00.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`
const iso = (dia: number, hm: string) => new Date(`2026-11-${dia}T${hm}:00+01:00`).toISOString()
const HIJOS = [
  { id: 'c1', display_name: 'Pau', avatar: null, birth_date: '2014-03-02', pending_claim: false },
  { id: 'c2', display_name: 'Lucía', avatar: null, birth_date: '2016-09-20', pending_claim: false },
]
const TITULO = 'Seminario de kata con el maestro Tanaka'
const PARRAFO = 'El seminario recorre los kata del programa de cinturón negro, con correcciones individuales y trabajo en parejas sobre el bunkai de cada uno. Se pide puntualidad, ropa de entrenar limpia, agua y ganas de aprender. '
const LARGA = Array.from({ length: 6 }, (_, i) => `${i + 1}. ${PARRAFO}`).join('\n\n')
const evento = (extra: object = {}) => ({
  id: 'e1', title: TITULO, description: 'Seminario de kata con el maestro invitado. Trae tu cinturón y ropa de entrenar.',
  starts_at: iso(22, '10:00'), ends_at: iso(22, '13:00'), location: 'Dojo central',
  discipline: { id: 1, name: 'Judo' }, trainer: { id: 't1', display_name: 'Marta Ruiz' },
  capacity: 20, taken: 12, audience: 'all', price_cents: 2500, member_price_cents: 1500,
  registration_deadline: iso(20, '23:59'), status: 'scheduled', cancel_note: null, registration: null, ...extra,
})
const reg = (status: string, amount_cents: number) => ({ id: 'r1', status, amount_cents })

type Opciones = { ev?: object; missing?: string[]; fallo?: 'loading' | '404'; menor?: { can_book: boolean; can_publish: boolean }; mismatch?: boolean }
async function simular(page: Page, { ev, missing, fallo, menor, mismatch }: Opciones = {}) {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() !== 'GET') return mismatch && u === '/events/e1/registrations' ? json({ code: 'audience_mismatch' }, 422) : json({})
    if (u === '/me') return json({ id: 'u-1', role: 'alumno', display_name: 'Prueba', email: 'p@example.invalid', username: null, birth_date: menor ? '2012-05-01' : '1985-01-01', has_password: true, avatar: null, can_create_children: false, minor: menor ?? null })
    if (u === '/me/children') return json({ children: menor ? [] : HIJOS })
    if (u === '/me/profile-status') return json(missing ? { ok: false, missing } : { ok: true })
    if (u === '/billing/subscription') return json({ code: 'not_found' }, 404)
    if (u === '/events/e1') {
      if (fallo === 'loading') return new Promise<void>(() => {}) // nunca responde
      if (fallo === '404') return json({ code: 'not_found' }, 404)
      return json({ event: evento(ev) })
    }
    if (u === '/events') return json({ events: [evento(ev)] })
    return json({})
  })
}
const abrir = async (page: Page, opts: Opciones = {}, url = '/events/e1') => {
  await simular(page, opts)
  await page.goto(url)
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible()
  // La entrada escalonada (Rise) mueve los bloques unos píxeles: se mide con todo ya en su sitio.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))))
}
const caja = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!
const PIE = 812 - 64 // la barra inferior mide 64 px: el pie fijo se pega encima

test('open, sin ser socio: precio con la nota de socio y el botón sobre el pliegue', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText('15,00 € para socios')).toBeVisible()
  const fila = page.locator('dl > div').filter({ hasText: 'Precio' })
  await expect(fila).toContainText('25,00 €')
  const boton = page.getByRole('button', { name: 'Inscribirse · 25,00 €' })
  await expect(boton).toBeInViewport({ ratio: 1 })
  const b = await caja(boton)
  expect(b.y + b.height).toBeLessThanOrEqual(PIE)
  expect(b.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(page.getByText('Pagas con tarjeta en la página segura de Stripe')).toBeVisible()
})

test('un h1, el título del evento como h2 y «Sobre el evento» como h3', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evento')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(TITULO)
  await expect(page.getByRole('heading', { level: 3, name: 'Sobre el evento' })).toBeVisible()
})

test('open-long: con una descripción larga la cabecera con la fecha y el botón siguen sobre el pliegue', async ({ page }) => {
  await abrir(page, { ev: { description: LARGA } })
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(812)
  const fecha = page.getByText('dom 22 nov · 10:00', { exact: true })
  await expect(fecha).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'Inscribirse · 25,00 €' })).toBeInViewport({ ratio: 1 })
})

test('registered-free: la nota «Estás inscrito» cabe entera en la ventana y por encima del pie fijo', async ({ page }) => {
  await abrir(page, { ev: { price_cents: 0, member_price_cents: null, registration: reg('confirmed', 0) } })
  const nota = page.getByRole('status').filter({ hasText: 'Estás inscrito' })
  await expect(nota).toBeVisible()
  const cancelar = page.getByRole('button', { name: 'Cancelar inscripción' })
  const pie = await caja(cancelar.locator('..'))
  const n = await caja(nota)
  expect(n.y).toBeGreaterThanOrEqual(0)
  expect(n.y + n.height).toBeLessThanOrEqual(pie.y)
  expect(pie.y + pie.height).toBeLessThanOrEqual(PIE + 1)
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('pending: aviso de pago pendiente y pie para cancelar', async ({ page }) => {
  await abrir(page, { ev: { registration: reg('pending', 2500) } })
  await expect(page.getByRole('status').filter({ hasText: 'Falta pagar la inscripción' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancelar inscripción' })).toBeInViewport({ ratio: 1 })
})

test('paid: «Estás inscrito» con lo pagado y sin acción en el pie', async ({ page }) => {
  await abrir(page, { ev: { registration: reg('confirmed', 2500) } })
  const nota = page.getByRole('status').filter({ hasText: 'Estás inscrito' })
  await expect(nota).toContainText('Pagado 25,00 €')
  await expect(nota).toContainText('Para cancelar, pídelo a la academia')
  await expect(page.getByRole('button', { name: /Inscribirse|Cancelar inscripción/ })).toHaveCount(0)
})

test('full: «Completo» y sin botón', async ({ page }) => {
  await abrir(page, { ev: { capacity: 10, taken: 10 } })
  await expect(page.getByRole('status').filter({ hasText: 'No quedan plazas' })).toContainText('Completo')
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('closed: inscripciones cerradas con la fecha del plazo y sin botón', async ({ page }) => {
  await abrir(page, { ev: { registration_deadline: iso(17, '23:59') } })
  const nota = page.getByRole('status').filter({ hasText: 'Las inscripciones están cerradas' })
  await expect(nota).toContainText('El plazo terminó el')
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('cancelled: evento cancelado, con alerta y sin botón', async ({ page }) => {
  await abrir(page, { ev: { status: 'cancelled', cancel_note: 'Maestro enfermo' } })
  await expect(page.getByRole('alert').filter({ hasText: 'Evento cancelado' })).toContainText('Ya no se puede inscribir nadie')
  await expect(page.getByRole('button', { name: /Inscribirse|Cancelar inscripción/ })).toHaveCount(0)
})

test('profile: el aviso de perfil incompleto lleva su enlace y no hay botón de inscripción', async ({ page }) => {
  await abrir(page, { missing: ['health_info', 'emergency_contact'] })
  const aviso = page.getByRole('status').filter({ hasText: 'Completa el perfil' })
  await expect(aviso).toContainText('Hace falta para inscribirse')
  const enlace = aviso.getByRole('link', { name: 'Completar perfil' })
  await expect(enlace).toHaveAttribute('href', /\/onboarding/)
  await expect(enlace).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('audience: si el servidor responde audience_mismatch queda la nota de público y desaparece el botón', async ({ page }) => {
  await abrir(page, { mismatch: true, ev: { audience: 'minors' } })
  await expect(page.getByText('Solo menores', { exact: true })).toBeVisible() // la etiqueta de público de la cabecera
  await page.getByRole('button', { name: 'Inscribirse · 25,00 €' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Este evento no es para tu edad.' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('un menor sin permiso de reservar ve el motivo en lugar del botón', async ({ page }) => {
  await abrir(page, { menor: { can_book: false, can_publish: false } })
  await expect(page.getByRole('status').filter({ hasText: 'Tu tutor no te ha dado permiso para reservar' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('un menor con permiso ante un evento de pago: lo inscribe el tutor', async ({ page }) => {
  await abrir(page, { menor: { can_book: true, can_publish: false } })
  await expect(page.getByRole('status').filter({ hasText: 'Este evento es de pago: lo inscribe tu tutor' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Inscribirse/ })).toHaveCount(0)
})

test('un hijo (?para=): el botón dice «Inscribir a <nombre>» y la petición lleva su perfil', async ({ page }) => {
  const pedidas: string[] = []
  page.on('request', (r) => r.url().includes('/api/events/e1') && pedidas.push(r.url()))
  await abrir(page, {}, '/events/e1?para=c1')
  const boton = page.getByRole('button', { name: 'Inscribir a Pau · 25,00 €' })
  await expect(boton).toBeInViewport({ ratio: 1 })
  expect(pedidas.some((u) => u.includes('profile_id=c1'))).toBe(true)
  await expect(page.getByRole('link', { name: 'Eventos' })).toHaveAttribute('href', /tab=events&para=c1/)
})

test('cargando: esqueleto aria-busy mientras no responde la API', async ({ page }) => {
  await simular(page, { fallo: 'loading' })
  await page.goto('/events/e1')
  const esqueleto = page.locator('[aria-busy="true"][aria-label="Cargando"]')
  await expect(esqueleto).toBeVisible()
  await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0)
})

test('404: «No lo encontramos» con la salida a Inicio', async ({ page }) => {
  await simular(page, { fallo: '404' })
  await page.goto('/events/e1')
  await expect(page.getByRole('alert').filter({ hasText: 'No lo encontramos' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible()
})

test('sin conexión: «Sin conexión» con Reintentar y, al volver la red, el evento', async ({ page, context }) => {
  await abrir(page)
  // Bajo SubjectGate: con la red cortada se cambia de hijo (?para=c1) sin caché de ese evento.
  await context.setOffline(true)
  await page.evaluate(() => {
    history.pushState({}, '', '/events/e1?para=c1')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  const estado = page.getByRole('status').filter({ hasText: 'Sin conexión' })
  await expect(estado).toBeVisible()
  await expect(estado.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Inscribir a Pau · 25,00 €' })).toBeVisible()
})

test('lg: los datos van a la derecha de la cabecera, arriba con ella, y el pie queda en la columna izquierda', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await abrir(page)
  const cabecera = await caja(page.getByRole('heading', { name: TITULO }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]'))
  const datos = await caja(page.locator('dl').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]'))
  expect(datos.x).toBeGreaterThanOrEqual(cabecera.x + cabecera.width)
  expect(Math.abs(datos.y - cabecera.y)).toBeLessThanOrEqual(1)
  expect(Math.round(datos.width)).toBe(336) // 21 rem
  const boton = await caja(page.getByRole('button', { name: 'Inscribirse · 25,00 €' }))
  expect(boton.x + boton.width).toBeLessThanOrEqual(datos.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
})
