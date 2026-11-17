import { expect, test, type Page } from '@playwright/test'

// Ficha pública (/profiles/:id) con todo simulado en el navegador (page.route): no escribe nada en la base de datos y
// no hace login (token de cliente falso: la app solo decodifica el rol). Solo necesita E2E_BASE_URL. Hora fija en Madrid.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'alumno', exp: 4102444800 })}.x`
const medallas = (id: number, name: string, codes: string[], best: number) => ({
  id: String(id),
  name,
  theme: null,
  streak: { current: 3, best },
  badges: codes.map((code, i) => ({ code, earned_at: `2026-0${i + 1}-10` })),
})
const COMPLETO = {
  id: 'p0',
  display_name: 'Marta Ruiz',
  avatar: null,
  role: 'profesor',
  bio: 'Llevo más de veinte años en el tatami.',
  social_links: { instagram: 'https://instagram.com/kaizen', tiktok: 'https://tiktok.com/@kaizen', youtube: 'https://youtube.com/@kaizen', web: 'https://kaizen.example.com' },
  disciplines: [{ id: 1, name: 'Judo' }, { id: 2, name: 'Kárate' }],
  member_since: '2021-03',
  achievements: {
    streak: { current: 3, best: 14 },
    // Judo: 7 medallas y Kárate: 2 (9 en total); en la escalera, «Tres meses» (12 semanas) es la más alta de las de Judo.
    disciplines: [
      medallas(1, 'Judo', ['first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'streak_4', 'streak_12'], 14),
      medallas(2, 'Kárate', ['first_day', 'hours_10'], 5),
    ],
  },
}
const MINIMO = { id: 'p0', display_name: 'Iván Soto', role: 'alumno' }
const NOMBRES = ['Marta Ruiz', 'Iván Soto', 'Lucía Prieto']
const filas = NOMBRES.map((display_name, i) => ({ rank: i + 1, id: `p${i}`, display_name, hours: 100 - i * 10 }))

async function abrir(page: Page, perfil: object | 404, url = '/profiles/p0') {
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.clock.install({ time: new Date('2026-11-18T12:00:00+01:00') })
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json({ id: 'u-1', role: 'alumno', display_name: 'Prueba', email: 'p@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: false, minor: null })
    if (u === '/me/children') return json({ children: [] })
    if (u === '/me/profile') return json({ is_public: true, visible_fields: { ranking: true } })
    if (u === '/disciplines') return json({ disciplines: [{ id: 1, name: 'Judo', is_active: true, is_open: false, max_age: null }] })
    if (/^\/rankings\/\d+$/.test(u)) return json({ discipline: { id: 1, name: 'Judo' }, month: '2026-11', rows: filas, total: filas.length, limit: 20 })
    if (/^\/profiles\/[^/]+$/.test(u)) return perfil === 404 ? json({ code: 'profile_not_found' }, 404) : json({ profile: perfil })
    return json({})
  })
  await page.goto(url)
}

test('perfil completo: nombre, cifras, redes y la mejor medalla primero', async ({ page }) => {
  await abrir(page, COMPLETO)
  await expect(page.getByRole('heading', { level: 2, name: 'Marta Ruiz' })).toBeVisible()
  await expect(page.getByText('Profesor · Con nosotros desde marzo de 2021')).toBeVisible()
  // Las cifras son una <dl>: cada etiqueta (dt) con su número (dd).
  await expect(page.locator('dl > div').filter({ hasText: 'medallas' })).toContainText('9')
  await expect(page.locator('dl > div').filter({ hasText: 'semanas de mejor racha' })).toContainText('14')
  const redes = page.getByRole('list', { name: 'Redes' }).getByRole('link')
  await expect(redes).toHaveCount(4)
  for (const a of await redes.all()) {
    await expect(a).toHaveAttribute('target', '_blank')
    await expect(a).toHaveAttribute('rel', /noopener/)
  }
  const judo = page.getByRole('region', { name: 'Medallas' }).locator('div', { has: page.getByRole('heading', { level: 4, name: /Judo/ }) }).last().getByRole('listitem')
  await expect(judo).toHaveCount(7)
  await expect(judo.first()).toContainText('Tres meses')
  await expect(judo.last()).toContainText('Primer paso')
})

test('perfil mínimo: solo lo que hay y sin sección de medallas', async ({ page }) => {
  await abrir(page, MINIMO)
  await expect(page.getByRole('heading', { level: 2, name: 'Iván Soto' })).toBeVisible()
  await expect(page.getByText('No ha compartido nada más en su perfil.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Medallas' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Redes' })).toHaveCount(0)
})

test('perfil inexistente: mensaje claro', async ({ page }) => {
  await abrir(page, 404)
  await expect(page.getByText('Este perfil no existe o no es público.')).toBeVisible()
})

test('«Rankings» desde la app vuelve por el historial y conserva ?ver=mes', async ({ page }) => {
  await abrir(page, COMPLETO, '/rankings/1?ver=mes')
  await page.getByRole('link', { name: /Marta Ruiz/ }).first().click()
  await expect(page).toHaveURL(/\/profiles\/p0$/)
  await page.getByRole('link', { name: 'Rankings' }).click()
  await expect(page).toHaveURL(/\/rankings\/1\?ver=mes$/)
})

test('«Rankings» con la URL directa sigue el enlace a /rankings', async ({ page }) => {
  await abrir(page, COMPLETO)
  await expect(page.getByRole('link', { name: 'Rankings' })).toHaveAttribute('href', '/rankings')
  await page.getByRole('link', { name: 'Rankings' }).click()
  await expect(page).toHaveURL(/\/rankings/)
})

test('teclado: Tab sigue el orden visual (Rankings, redes)', async ({ page }) => {
  await abrir(page, COMPLETO)
  const volver = page.getByRole('link', { name: 'Rankings' })
  await volver.focus()
  await expect(volver).toBeFocused()
  for (const red of ['Instagram', 'TikTok', 'YouTube', 'Web']) {
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: new RegExp(`^${red}`) })).toBeFocused()
  }
})
