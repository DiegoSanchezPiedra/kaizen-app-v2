import { expect, test, type Page } from '@playwright/test'

// Informes del panel (/admin/reports) sin tocar la BD ni staging: token falso de admin en `kz.token` y la API simulada con page.route.
// Reloj: miércoles 18 de noviembre de 2026, 18:10 en Madrid (la foto más nueva es la del 17).
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const NOW = new Date('2026-11-18T18:10:00+01:00')
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }
const DISC = [{ id: 1, name: 'Judo' }, { id: 2, name: 'Grappling' }]

const pad = (n: number) => String(n).padStart(2, '0')
function monthsOf(from: string, to: string) {
  const out: string[] = []
  for (let [y, m] = from.split('-').map(Number); `${y}-${pad(m)}` <= to; m === 12 ? ((m = 1), y++) : m++) out.push(`${y}-${pad(m)}`)
  return out
}
function daysOf(from: string, to: string) {
  const out: string[] = []
  for (const d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
const dim = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate()
const NULLS = { active: null, past_due: null, unpaid: null, new_subscriptions: null, cancelled_subscriptions: null }
const stat = { active: 150, past_due: 6, unpaid: 2, new_subscriptions: 3, cancelled_subscriptions: 1 }
// Sin foto: del 3 al 5 de noviembre y mayo de 2025. El mes en curso va por 17 de 30 días.
function subs(p: URLSearchParams) {
  const [group, from, to] = ['group', 'from', 'to'].map((k) => p.get(k)!)
  if (group === 'day') return { group, from, to, trained: 212, rows: daysOf(from, to).map((date) => ({ date, trained: 30, ...(['2026-11-03', '2026-11-04', '2026-11-05'].includes(date) ? NULLS : stat) })) }
  return { group, from, to, trained: 389, rows: monthsOf(from, to).map((month) => {
    const gap = month === '2025-05'
    return { month, trained: 150, days_with_data: gap ? 0 : month === '2026-11' ? 17 : dim(month), days_in_month: dim(month), ...(gap ? NULLS : stat) }
  }) }
}
const fig = { sessions: 10, capacity: 200, booked: 100, occupancy: 0.5, present: 80, absent: 15, unrecorded: 5, late: 1 }
const row = (months: string[], extra: object) => ({ ...extra, months: months.map((month) => ({ month, ...fig })), total: fig })
const CLASSES = [
  { discipline: DISC[0], class_id: 'c1', weekday: 1, start_time: '18:00', trainer: { id: 'p-1', name: 'Kenji Sato' } },
  { discipline: DISC[1], class_id: 'c2', weekday: 3, start_time: '19:00', trainer: { id: null, name: null } },
]
const LONG = 'Francisco Javier de la Torre y Fernández-Villaverde de Castilla'
const STUDENTS = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: i === 0 ? LONG : `Alumno ${pad(i)}`, bookings: 12, present: 10, absent: 1, unrecorded: 1, late: 0 }))

type Opts = { range?: boolean }
async function open(page: Page, url: string, o: Opts = {}) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const calls: URL[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const q = u.searchParams
    if (r.request().method() !== 'GET') return r.fulfill({ status: 405, json: { code: 'not_in_test' } })
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (p === '/disciplines') return r.fulfill({ json: { disciplines: DISC } })
    if (!p.startsWith('/admin/reports/')) return r.fulfill({ json: {} })
    calls.push(u)
    if (o.range) return r.fulfill({ status: 400, json: { code: 'invalid_range', message: 'Rango no válido' } })
    if (p === '/admin/reports/subscriptions') return r.fulfill({ json: subs(q) })
    if (p === '/admin/reports/students') {
      const off = Number(q.get('offset')), lim = Number(q.get('limit'))
      return r.fulfill({ json: { from: q.get('from'), to: q.get('to'), total: STUDENTS.length, limit: lim, offset: off, rows: STUDENTS.slice(off, off + lim) } })
    }
    const months = monthsOf(q.get('from')!, q.get('to')!)
    const d = q.get('discipline_id')
    if (q.get('by') === 'discipline') return r.fulfill({ json: { by: 'discipline', from: q.get('from'), to: q.get('to'), rows: DISC.filter((x) => !d || String(x.id) === d).map((x) => row(months, { discipline: x })) } })
    const cs = CLASSES.filter((c) => !d || String(c.discipline.id) === d)
    return r.fulfill({ json: { by: 'class', from: q.get('from'), to: q.get('to'), total: cs.length, limit: 25, offset: 0, rows: cs.map((c) => row(months, c)) } })
  })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Informes', level: 1 })).toBeVisible()
  return calls
}

const pick = async (page: Page, label: string, option: string) => {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
const main = (page: Page) => page.getByRole('main')

test('abre en Suscripciones: la última foto y el periodo por separado, y el hueco sin foto no es un cero', async ({ page }) => {
  await open(page, '/admin/reports')
  await expect(page.getByRole('tab', { name: 'Suscripciones', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Última foto · 17 nov 2026' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'En el periodo' })).toBeVisible()
  // 3, 4 y 5 de noviembre sin foto: su columna dice «Sin dato» y la leyenda lo explica.
  await expect(main(page).getByRole('button', { name: /^martes, 3 de noviembre: Sin dato$/ })).toHaveCount(1)
  await expect(main(page).getByText('Sin dato', { exact: true }).first()).toBeVisible()
})

test('24 meses: rango en la URL, mes incompleto con «N de M días» y la tabla en filas en el móvil', async ({ page }) => {
  const calls = await open(page, '/admin/reports')
  await pick(page, 'Periodo', 'Últimos 24 meses')
  await expect(page).toHaveURL(/rango=24m/)
  await expect.poll(() => calls.at(-1)?.searchParams.get('group')).toBe('month')
  await expect(page.getByRole('heading', { name: /Última foto · noviembre de 2026/ })).toContainText('17 de 30 días')
  await expect(main(page).getByRole('button', { name: /^mayo de 2025: Sin dato$/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'Ver tabla', exact: true }).click()
  const fila = main(page).getByRole('listitem').filter({ hasText: 'mayo de 2025' })
  await expect(fila.getByText('Sin dato', { exact: true })).toHaveCount(5)
  await expect(main(page).getByRole('listitem').filter({ hasText: 'noviembre de 2026' }).getByText('17 de 30 días')).toBeVisible()
  // Sin scroll horizontal de la página a 375.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Periodo', exact: true })).toHaveText(/Últimos 24 meses/)
})

test('invalid_range: el texto de b19, sin «Reintentar»', async ({ page }) => {
  await open(page, '/admin/reports', { range: true })
  await expect(page.getByText('Revisa las fechas: como mucho 92 días o 24 meses.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('la disciplina elegida en Sesiones sigue en Alumnos y al recargar', async ({ page }) => {
  const calls = await open(page, '/admin/reports?tab=sessions')
  await pick(page, 'Disciplina', 'Grappling')
  await expect(page).toHaveURL(/disciplina=2/)
  // Por clase (filtrada): la clase sin profesor lo dice.
  await expect(main(page).getByText('Sin profesor habitual').filter({ visible: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Alumnos', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Disciplina', exact: true })).toHaveText(/Grappling/)
  await expect.poll(() => calls.filter((u) => u.pathname.endsWith('/students')).at(-1)?.searchParams.get('discipline_id')).toBe('2')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Disciplina', exact: true })).toHaveText(/Grappling/)
})

test('Alumnos en el móvil: una fila por alumno que abre su ficha, nombre largo entero y cambiar filtro vuelve a la página 1', async ({ page }) => {
  const calls = await open(page, '/admin/reports?tab=students&page=2')
  await expect(page.getByText('Página 2 de 2 · 30 en total')).toBeVisible()
  await page.goto('/admin/reports?tab=students')
  const fila = main(page).getByRole('link', { name: new RegExp(LONG) })
  await expect(fila).toBeVisible()
  expect((await fila.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(fila).toHaveAttribute('href', '/admin/users/s0')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await page.getByRole('link', { name: /Siguiente/ }).click()
  await expect(page).toHaveURL(/page=2/)
  await pick(page, 'Periodo', 'Mes pasado')
  await expect(page).not.toHaveURL(/page=/)
  await expect.poll(() => calls.at(-1)?.searchParams.get('offset')).toBe('0')
})
