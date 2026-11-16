import { expect, test, type Page } from '@playwright/test'

// Progreso con todo simulado en el navegador (page.route): no escribe nada en la base de datos.
// Necesita E2E_BASE_URL, E2E_EMAIL y E2E_PASSWORD (una cuenta de alumno); solo el login y /me son reales. La hora se fija en Madrid: miércoles 18-nov-2026 12:00.
// El login se hace una sola vez por ejecución y se reutiliza: la API limita los inicios de sesión (429).
const SESION = 'test-results/progreso-sesion.json'
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

const LADDER = ['first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000', 'streak_4', 'streak_12', 'streak_26', 'streak_52']
const disc = (id: string, name: string, theme: string | null, hours: number, current: number, best: number, codes: string[]) => ({
  id,
  name,
  theme,
  hours,
  streak: { current, best },
  badges: codes.map((code, i) => ({ code, earned_at: `2026-0${1 + (i % 9)}-1${i % 9}T18:00:00+01:00` })),
})
type Estado = { streak: { current: number; best: number }; disciplines: ReturnType<typeof disc>[]; hours: { month: string; disciplines: { id: string; name: string; hours: number }[] } }
const hrs = (list: [string, string, number][]) => ({ month: '2026-11', disciplines: list.map(([id, name, hours]) => ({ id, name, hours })) })

const DATOS: Estado = {
  streak: { current: 4, best: 7 },
  disciplines: [
    disc('d1', 'Judo', 'naruto', 124.5, 4, 7, ['first_day', 'hours_10', 'hours_50', 'hours_100', 'streak_4']),
    disc('d2', 'Kárate', null, 18, 2, 3, ['first_day', 'hours_10']),
    disc('d3', 'Boxeo', 'ippo', 3.5, 1, 1, ['first_day']),
  ],
  hours: hrs([['d1', 'Judo', 9.5], ['d2', 'Kárate', 4], ['d3', 'Boxeo', 2.5]]),
}
const HIJO: Estado = { streak: { current: 1, best: 1 }, disciplines: [disc('d2', 'Kárate', null, 6, 1, 1, ['first_day'])], hours: hrs([['d2', 'Kárate', 2]]) }
const VACIO: Estado = { streak: { current: 0, best: 0 }, disciplines: [], hours: hrs([]) }
const MUCHOS: Estado = {
  streak: { current: 14, best: 20 },
  disciplines: [
    disc('d1', 'Judo', 'naruto', 1200, 14, 60, LADDER),
    disc('d2', 'Kárate', null, 240, 8, 12, ['first_day', 'hours_10', 'hours_50', 'hours_100', 'streak_4', 'streak_12']),
    disc('d3', 'Boxeo', 'ippo', 60, 3, 5, ['first_day', 'hours_10', 'hours_50', 'streak_4']),
    disc('d4', 'Taekwondo', 'saiyan', 30, 2, 4, ['first_day', 'hours_10']),
    disc('d5', 'Jiu-jitsu brasileño', 'titanes', 8, 1, 2, ['first_day']),
    disc('d6', 'Kickboxing', 'hunter', 0.5, 0, 0, []),
  ],
  hours: hrs([['d1', 'Judo', 20], ['d2', 'Kárate', 12], ['d3', 'Boxeo', 8], ['d4', 'Taekwondo', 4], ['d5', 'Jiu-jitsu brasileño', 2], ['d6', 'Kickboxing', 0.5]]),
}
const HIJOS = [
  { id: 'c1', display_name: 'Pau', avatar: null, birth_date: '2014-03-02', pending_claim: false },
  { id: 'c2', display_name: 'Lucía', avatar: null, birth_date: '2016-09-20', pending_claim: false },
]

// `responder` decide cada petición de progreso; por defecto devuelve el estado (el del hijo si pide profile_id=c2).
type Responder = (url: URL, route: Parameters<Parameters<Page['route']>[1]>[0]) => Promise<void> | void
async function simular(page: Page, estado: Estado, responder?: Responder) {
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  // Escrituras cortadas (nada llega a la API); las lecturas no simuladas pasan a la real.
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.fallback() : r.fulfill({ json: {} })))
  await page.route(/\/api\/me\/children/, (r) => r.fulfill({ json: { children: HIJOS } }))
  await page.route(/\/api\/me\/progress\/seen/, (r) => r.fulfill({ json: {} }))
  await page.route(/\/api\/me\/progress(\?|$)/, async (r) => {
    const url = new URL(r.request().url())
    if (responder) return responder(url, r)
    const base = url.searchParams.get('profile_id') === 'c2' ? HIJO : estado
    await r.fulfill({ json: cuerpo(base, url) })
  })
}
// medals_seen: todas vistas, para que no salga el diálogo de celebración.
const cuerpo = (e: Estado, url: URL) => ({
  ...e,
  hours: { ...e.hours, month: url.searchParams.get('month') ?? e.hours.month },
  medals_seen: e.disciplines.flatMap((d) => d.badges.map((b) => `${d.id}:${b.code}`)),
})

test('con datos: elegir otra disciplina cambia el héroe y el título de las escaleras', async ({ page }) => {
  await simular(page, DATOS)
  await page.goto('/progress')
  const heroe = page.locator('section[aria-labelledby="next-medal"]')
  await expect(page.getByRole('heading', { name: 'Medallas de Judo' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Judo/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(heroe).toContainText('Judo')
  const antes = await heroe.getByRole('heading').innerText()

  await page.getByRole('button', { name: /^Kárate/ }).click()
  await expect(page.getByRole('heading', { name: 'Medallas de Kárate' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Kárate/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(heroe).toContainText('Kárate')
  await expect(heroe).not.toContainText('Judo')
  expect(await heroe.getByRole('heading').innerText()).not.toBe(antes)
  await expect(page.locator('section[aria-label="Racha"]')).toBeVisible()
})

test('un hijo: ?para=<id> pide su progreso y el héroe dice «Próxima medalla de <nombre>»', async ({ page }) => {
  await simular(page, DATOS)
  const pedidas: string[] = []
  page.on('request', (r) => r.url().includes('/api/me/progress?') && pedidas.push(r.url()))
  await page.goto('/progress?para=c2')
  await expect(page.locator('section[aria-labelledby="next-medal"]')).toContainText('Próxima medalla de Lucía')
  expect(pedidas.at(-1)).toContain('profile_id=c2')
  // Una sola disciplina: no hay selector de disciplina.
  await expect(page.getByRole('group', { name: 'Medallas de la disciplina' })).toHaveCount(0)
})

test('vacío: franja de racha compacta, invitación y sin héroe', async ({ page }) => {
  await simular(page, VACIO)
  await page.goto('/progress')
  await expect(page.getByText('Tu primera sesión empieza la racha')).toBeVisible()
  const calendario = page.getByRole('link', { name: 'Ver calendario' }).or(page.getByRole('button', { name: 'Ver calendario' }))
  await expect(calendario).toBeVisible()
  await expect(page.locator('section[aria-labelledby="next-medal"]')).toHaveCount(0)
  const racha = page.locator('section[aria-label="Racha"]')
  await expect(racha).toBeVisible()
  expect((await racha.boundingBox())!.height).toBeLessThan(120)
  await expect(page.getByText('Sin horas este mes.')).toBeVisible()
})

test('error 500: «Reintentar» con la ruta ya arreglada muestra los datos', async ({ page }) => {
  let roto = true
  await simular(page, DATOS, (url, r) => (roto ? r.fulfill({ status: 500, json: { error: 'internal_error' } }) : r.fulfill({ json: cuerpo(DATOS, url) })))
  await page.goto('/progress')
  await expect(page.getByRole('alert').getByText('Algo ha fallado')).toBeVisible({ timeout: 15_000 })
  roto = false
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('heading', { name: 'Medallas de Judo' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('sin conexión: mensaje de red y el reintento recupera los datos', async ({ page }) => {
  let caido = true
  await simular(page, DATOS, (url, r) => (caido ? r.abort('internetdisconnected') : r.fulfill({ json: cuerpo(DATOS, url) })))
  await page.goto('/progress')
  const estado = page.getByRole('status').filter({ hasText: 'Sin conexión' })
  await expect(estado).toBeVisible({ timeout: 15_000 })
  await expect(estado.getByText('Conéctate a internet y vuelve a intentarlo.')).toBeVisible()
  caido = false
  await estado.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('heading', { name: 'Medallas de Judo' })).toBeVisible()
})

test('muchos datos: seis disciplinas y la escalera completa dice «Todas conseguidas»', async ({ page }) => {
  await simular(page, MUCHOS)
  await page.goto('/progress')
  const picker = page.getByRole('group', { name: 'Medallas de la disciplina' })
  await expect(picker.getByRole('button')).toHaveCount(6)
  await expect(picker.getByRole('button', { name: /^Judo/ })).toContainText('11/11')
  const heroe = page.locator('section[aria-labelledby="next-medal"]')
  await expect(heroe.getByRole('heading', { name: 'Todas conseguidas' })).toBeVisible()
  await expect(heroe.getByText('Medallas de constancia: todas conseguidas')).toBeVisible()
  await picker.getByRole('button', { name: /^Boxeo/ }).click()
  await expect(heroe.getByRole('heading', { name: 'Todas conseguidas' })).toHaveCount(0)
})

test('cambiar de mes mantiene las horas atenuadas, sin esqueleto, y la pestaña elegida', async ({ page }) => {
  let soltar!: () => void
  const retenida = new Promise<void>((ok) => (soltar = ok))
  const pedidos: string[] = []
  await simular(page, DATOS, async (url, r) => {
    pedidos.push(url.searchParams.get('month') ?? '')
    if (url.searchParams.get('month') === '2026-10') await retenida
    await r.fulfill({ json: cuerpo(DATOS, url) })
  })
  await page.goto('/progress')
  await page.getByRole('tab', { name: /^Constancia/ }).click()
  await expect(page.getByRole('tab', { name: /^Constancia/ })).toHaveAttribute('aria-selected', 'true')

  const horas = page.locator('section[aria-labelledby="hours"]')
  await expect(horas).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: 'Mes anterior' }).click()
  await expect.poll(() => pedidos).toContain('2026-10')
  await expect(horas).toHaveAttribute('aria-busy', 'true')
  await expect(horas).toBeVisible()
  await expect(horas.getByText('Judo')).toBeVisible() // las horas previas siguen ahí
  await expect(page.locator('[aria-label="Cargando"]')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /^Constancia/ })).toHaveAttribute('aria-selected', 'true')

  soltar()
  await expect(horas).toHaveAttribute('aria-busy', 'false')
  await expect(horas).toContainText('octubre')
  await expect(page.getByRole('tab', { name: /^Constancia/ })).toHaveAttribute('aria-selected', 'true')
})

test('el héroe cabe en la primera pantalla a 375 px', async ({ page }) => {
  await simular(page, DATOS)
  await page.goto('/progress')
  const heroe = page.locator('section[aria-labelledby="next-medal"]')
  await expect(heroe).toBeVisible()
  // Espera a que acabe la entrada escalonada (el bloque sube con transform).
  await expect.poll(async () => {
    const b = (await heroe.boundingBox())!
    return Math.round(b.y + b.height)
  }).toBeLessThanOrEqual(812)
  const b = (await heroe.boundingBox())!
  expect(b.y + b.height).toBeLessThanOrEqual(812)
})

test('en escritorio el Tab sigue el orden del HTML: selector, racha, pestañas, mes anterior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await simular(page, DATOS)
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Medallas de Judo' })).toBeVisible()

  // Recorre con Tab hasta «Mes anterior» anotando, de cada foco, su posición en el documento.
  const vistos: { nombre: string; pos: number; racha: boolean }[] = []
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab')
    const foco = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const todos = [...document.querySelectorAll('*')]
      return { nombre: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '', pos: todos.indexOf(el), racha: !!el.closest('section[aria-label="Racha"]') }
    })
    vistos.push(foco)
    if (foco.nombre === 'Mes anterior') break
  }
  const nombres = vistos.map((v) => v.nombre)
  const idx = (re: RegExp) => nombres.findIndex((n) => re.test(n))
  expect(idx(/^Mes anterior$/), nombres.join(' | ')).toBeGreaterThan(-1)
  expect(idx(/^Judo · \d+\/11/)).toBeGreaterThan(-1)
  expect(idx(/^Judo · \d+\/11/)).toBeLessThan(idx(/^Horas · /))
  expect(idx(/^Horas · /)).toBeLessThan(idx(/^Mes anterior$/))
  // Orden de lectura = orden de tabulación.
  const pos = vistos.map((v) => v.pos)
  expect(pos).toEqual([...pos].sort((a, z) => a - z))
})
