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

const PERFIL = { is_public: true, eligible: true, visible_fields: { photo: true, bio: true, social_links: false, disciplines: false, member_since: false, achievements: false, ranking: true } as Record<string, boolean>, bio: 'Cinturón azul.', social_links: { instagram: 'https://instagram.com/ana' } }

type Opciones = { me?: object; role?: string; hijos?: object[]; missing?: string[]; subscription?: object | null; perfil?: typeof PERFIL; patch?: { status: number; json: object } }

async function abrir(page: Page, url: string, o: Opciones = {}) {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(o.role ?? 'tutor'))
  const patches: unknown[] = [] // cuerpos de los PATCH /me y /me/profile recibidos
  const perfil = structuredClone(o.perfil ?? PERFIL)
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() === 'PATCH' && (u === '/me' || u === '/me/profile')) {
      const body = r.request().postDataJSON()
      patches.push(body)
      if (o.patch) return json(o.patch.json, o.patch.status)
      if (u === '/me') return json(o.me ?? ME)
      Object.assign(perfil, body, { visible_fields: { ...perfil.visible_fields, ...body.visible_fields } }) // el servidor fusiona
      return json(perfil)
    }
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json(o.me ?? ME)
    if (u === '/me/children') return o.role === 'alumno' ? json({ code: 'insufficient_role' }, 403) : json({ children: o.hijos ?? [LARA] })
    if (u === '/me/profile') return json(perfil)
    if (u === '/me/profile-status') return json({ ok: !o.missing?.length, missing: o.missing ?? [] })
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

const ALUMNO = { role: 'alumno', hijos: [], me: { ...ME, role: 'alumno', can_create_children: false } }

test('perfil público: cada interruptor guarda al momento solo su campo', async ({ page }) => {
  const patches = await abrir(page, '/account/profile', ALUMNO)
  const redes = page.getByRole('switch', { name: 'Redes' })
  await redes.click()
  await expect(redes).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => patches).toEqual([{ visible_fields: { social_links: true } }])
})

test('perfil público: apagado, «Qué se ve» se pliega y el Tab lo salta', async ({ page }) => {
  await abrir(page, '/account/profile', { ...ALUMNO, perfil: { ...PERFIL, is_public: false } })
  await expect(page.getByTestId('profile-fields')).toHaveAttribute('inert')
  await expect(page.getByText('Se verán cuando tu perfil sea público.')).toBeVisible()
  await page.getByRole('switch', { name: /Visible para otros alumnos/ }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Presentación' })).toBeFocused()
})

test('perfil público: si el servidor falla, el interruptor vuelve', async ({ page }) => {
  const patches = await abrir(page, '/account/profile', { ...ALUMNO, patch: { status: 500, json: {} } })
  const logros = page.getByRole('switch', { name: 'Logros' })
  await logros.click()
  await expect.poll(() => patches.length).toBe(1)
  await expect(logros).toHaveAttribute('aria-checked', 'false')
})

test('perfil público: guardar sin cambios no envía nada; con cambios, solo presentación y redes', async ({ page }) => {
  const patches = await abrir(page, '/account/profile', ALUMNO)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Perfil guardado')).toBeVisible()
  expect(patches).toEqual([])
  await page.getByRole('textbox', { name: 'Presentación' }).fill('Cinturón morado.')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect.poll(() => patches).toEqual([{ bio: 'Cinturón morado.', social_links: { instagram: 'https://instagram.com/ana' } }])
})

test('perfil público: un enlace sin https queda marcado y no se envía', async ({ page }) => {
  const patches = await abrir(page, '/account/profile', ALUMNO)
  const web = page.getByRole('textbox', { name: 'Web' })
  await web.fill('http://ana.example')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Usa un enlace que empiece por https://')).toBeVisible()
  await expect(web).toHaveAttribute('aria-invalid', 'true')
  expect(patches).toEqual([])
})

test('perfil público del profesor: sin logros ni rankings', async ({ page }) => {
  await abrir(page, '/account/profile', { role: 'profesor', hijos: [], me: { ...ME, role: 'profesor' } })
  await expect(page.getByRole('switch', { name: 'Desde cuándo estoy en la academia' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Logros' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Aparecer en los rankings' })).toHaveCount(0)
})
