import { expect, test, type Page } from '@playwright/test'

// Informes del profesor (/professor/reports) con la API simulada en el navegador (page.route): no escribe en la base de datos.
// Token falso con rol 'profesor'. Reloj fijo: martes 17-nov-2026, 18:00 de Madrid (nunca la fecha del sistema).
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'p-1', role: 'profesor', exp: 4102444800 })}.x`
const ME = { id: 'p-1', display_name: 'Kenji Sato', email: 'kenji@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'profesor' }
const DISC = [{ id: 1, name: 'Judo' }, { id: 2, name: 'Grappling' }]

function monthsOf(from: string, to: string) {
  const out: string[] = []
  for (let [y, m] = from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? ((m = 1), y++) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`)
  return out
}
const fig = (o: { empty?: boolean; noSeats?: boolean } = {}) =>
  o.empty
    ? { sessions: 0, capacity: 0, booked: 0, occupancy: null, present: 0, absent: 0, unrecorded: 0, late: 0 }
    : { sessions: 10, capacity: o.noSeats ? 0 : 200, booked: 100, occupancy: o.noSeats ? null : 0.5, present: 80, absent: 15, unrecorded: 5, late: 1 }
const row = (months: string[], o: Parameters<typeof fig>[0], extra: object) => {
  const f = fig(o)
  const sum = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' && k !== 'occupancy' ? v * months.length : v]))
  return { ...extra, months: months.map((month) => ({ month, ...f })), total: sum }
}
const CLASSES = Array.from({ length: 30 }, (_, i) => ({ discipline: DISC[i % 2], class_id: `c${i}`, weekday: (i % 6) + 1, start_time: `${17 + (i % 4)}:00`, trainer: { id: 'p-1', name: 'Kenji Sato' } }))

type Opts = { api?: 'empty' | 'noSeats' | 'range' | 'error'; failMore?: boolean }
async function abrir(page: Page, o: Opts = {}) {
  const calls: URLSearchParams[] = []
  await page.clock.setFixedTime(new Date('2026-11-17T18:00:00+01:00'))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url())
    const u = url.pathname.replace(/^\/api/, '')
    const p = url.searchParams
    if (r.request().method() !== 'GET') return r.fulfill({ status: 405, json: { code: 'not_in_test' } })
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/me/clock') return r.fulfill({ json: {} })
    if (u === '/disciplines') return r.fulfill({ json: { disciplines: DISC } })
    if (u !== '/professor/reports/sessions') return r.fulfill({ json: {} })
    calls.push(p)
    if (o.api === 'range') return r.fulfill({ status: 400, json: { code: 'invalid_range', message: 'Rango no válido' } })
    if (o.api === 'error') return r.fulfill({ status: 500, json: { code: 'internal' } })
    if (o.failMore && p.get('offset') === '25') return r.fulfill({ status: 500, json: { code: 'internal' } })
    const months = monthsOf(p.get('from')!, p.get('to')!)
    const ro = { empty: o.api === 'empty', noSeats: o.api === 'noSeats' }
    const d = p.get('discipline_id')
    if (p.get('by') === 'discipline') return r.fulfill({ json: { by: 'discipline', from: p.get('from'), to: p.get('to'), rows: DISC.filter((x) => !d || String(x.id) === d).map((x) => row(months, ro, { discipline: x })) } })
    const cs = CLASSES.filter((c) => !d || String(c.discipline.id) === d)
    const off = Number(p.get('offset'))
    return r.fulfill({ json: { by: 'class', from: p.get('from'), to: p.get('to'), total: cs.length, limit: 25, offset: off, rows: cs.slice(off, off + 25).map((c) => row(months, ro, c)) } })
  })
  await page.goto('/professor/reports')
  await expect(page.getByRole('heading', { name: 'Informes', level: 1 })).toBeVisible()
  return calls
}

const pick = async (page: Page, label: string, option: string) => {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('este mes: un solo mes, cifras del periodo y sin gráficas', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText('Noviembre de 2026 · sesiones ya celebradas')).toBeVisible()
  await expect(page.getByText('Cancelaciones tardías')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ocupación por mes' })).toHaveCount(0)
  // Por disciplina en el móvil: una tarjeta por disciplina con sus cifras.
  await expect(page.getByRole('heading', { name: 'Judo', level: 3 })).toBeVisible()
})

test('últimos 6 meses: periodo abreviado y gráficas con una parada de Tab y flechas', async ({ page }) => {
  await abrir(page)
  await pick(page, 'Periodo', 'Últimos 6 meses')
  await expect(page.getByText('Junio – noviembre de 2026 · sesiones ya celebradas')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ocupación por mes' })).toBeVisible()
  const bars = page.getByRole('button', { name: /de 2026: Ocupación/ })
  await expect(bars).toHaveCount(6)
  await expect(bars.and(page.locator('[tabindex="0"]'))).toHaveCount(1)
  await bars.last().focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: /^octubre de 2026: Ocupación/ })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('button', { name: /^junio de 2026: Ocupación/ })).toBeFocused()
})

test('rango no válido: dice qué está mal, marca los meses y no pide nada', async ({ page }) => {
  const calls = await abrir(page)
  await pick(page, 'Periodo', 'Elegir meses…')
  await pick(page, 'Hasta', 'agosto de 2026')
  const before = calls.length
  await expect(page.getByRole('alert')).toContainText('«Hasta» es anterior a «Desde»')
  await expect(page.getByRole('combobox', { name: 'Hasta', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await pick(page, 'Desde', 'agosto de 2025')
  await expect(page.getByRole('alert')).toContainText('son 13 meses y como mucho caben 12')
  expect(calls.length).toBe(before)
})

test('400 invalid_range: aviso de fechas, sin «Reintentar»', async ({ page }) => {
  await abrir(page, { api: 'range' })
  await expect(page.getByRole('alert')).toContainText('Revisa las fechas.')
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('error del servidor: estado de error con «Reintentar»', async ({ page }) => {
  await abrir(page, { api: 'error' })
  await expect(page.getByText('Algo ha fallado')).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

test('vacío: sin sesiones en el periodo', async ({ page }) => {
  await abrir(page, { api: 'empty' })
  await expect(page.getByText('Sin sesiones en este periodo')).toBeVisible()
})

test('ocupación null: «–», «sin plazas» y sin gráfica de ocupación', async ({ page }) => {
  await abrir(page, { api: 'noSeats' })
  await pick(page, 'Periodo', 'Últimos 6 meses')
  await expect(page.getByText('Ocupación · sin plazas')).toBeVisible()
  await expect(page.getByText('Sin plazas en el periodo: no hay ocupación que mostrar.')).toBeVisible()
  await expect(page.getByRole('button', { name: /de 2026: Ocupación/ })).toHaveCount(0)
})

test('una disciplina: sin pestañas, directamente por clase', async ({ page }) => {
  await abrir(page)
  await pick(page, 'Disciplina', 'Judo')
  await expect(page.getByRole('heading', { name: 'Por clase', level: 2 })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^Judo · / }).first()).toBeVisible()
})

test('por clase: más de 25 se cargan aparte y, si falla, la lista se queda', async ({ page }) => {
  await abrir(page, { failMore: true })
  await page.getByRole('tab', { name: 'Por clase' }).click()
  await expect(page.locator('main li')).toHaveCount(25)
  await page.getByRole('button', { name: 'Cargar más clases (quedan 5)' }).click()
  await expect(page.getByText('No se pudieron cargar más clases')).toBeVisible({ timeout: 8000 })
  await expect(page.locator('main li')).toHaveCount(25)
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

test('tablet (768): las filas son una tabla para comparar', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await abrir(page)
  const table = page.getByRole('table', { name: 'Por disciplina' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader')).toHaveText(['Disciplina', 'Asistencia', 'Sesiones', 'Ocupación', 'Presentes', 'Faltas', 'Sin registrar', 'Tardías'])
  await expect(table.getByRole('row', { name: /Judo/ }).getByRole('cell').nth(3)).toHaveText('50 %')
})
