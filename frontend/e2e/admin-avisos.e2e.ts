import { expect, test, type Page } from '@playwright/test'

// Avisos (/admin/notices) y Auditoría (/admin/audit) del panel sin tocar la BD ni staging: token falso de admin en
// `kz.token` y la API simulada con page.route. Solo lecturas. Reloj fijo: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (d: string, h = '10:00') => new Date(`${d}T${h}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const notice = (id: string, action: string, d: string, details: object = {}) => ({ id, created_at: at(d, '09:41'), action, resource_type: 'subscription', resource_id: 'r', details })
const NOTICES = [
  notice('n1', 'notice.stripe_risk', '2026-11-18'),
  notice('n2', 'notice.checkout_race_refunded', '2026-11-17', { student_id: 's1' }),
  notice('n3', 'notice.clock_open', '2025-12-30', { profile_id: 't1' }),
]
const delivery = (id: string, channel: string, name: string | null, attempts: number, err: string | null) => ({ id, created_at: at('2026-11-16', '08:05'), action: 'notice.payment_failed', channel, recipient: { id: `p-${id}`, display_name: name }, attempts, last_error: err })
const DELIVERIES = [
  delivery('d1', 'email', 'Lucía Fernández', 5, 'smtp: 550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient address'),
  delivery('d2', 'push', null, 1, 'email_suppressed'),
]
const audit = (id: string, action: string, actor: [string, string | null] | null, type: string, changes: object | null = null) => ({ id, created_at: at('2026-11-18', '11:22'), action, actor: actor ? { id: actor[0], display_name: actor[1] } : { id: null, display_name: null }, resource_type: type, resource_id: 'x', changes })
const AUDIT = [
  audit('x1', 'attendance.correct', ['t1', 'Jorge Profesor'], 'session', { from: 'present', to: 'absent', reason: 'Se marcó por error al pasar lista' }),
  audit('x2', 'health.view', ['a-1', 'Marta Admin'], 'profile', { student_ids: ['s1'] }),
  audit('x3', 'subscription.cancel_now', null, 'subscription'),
]

async function open(page: Page, url: string, o: { empty?: boolean } = {}) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const reads: string[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    reads.push(`${p}${u.search}`)
    const paged = (rows: object[], total = rows.length) => r.fulfill({ json: { rows, total, limit: 25, offset: Number(u.searchParams.get('offset') ?? 0) } })
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (p.startsWith('/admin/profiles/')) return r.fulfill({ json: { profile: { id: p.split('/').pop(), display_name: p.endsWith('/t1') ? 'Jorge Profesor' : 'Marta Admin' } } })
    if (p === '/admin/notices') return paged(NOTICES)
    if (p === '/admin/notice-deliveries') return u.searchParams.get('limit') === '1' ? paged([], 3) : paged(DELIVERIES)
    if (p === '/admin/audit') {
      if (o.empty) return paged([])
      const actor = u.searchParams.get('actor_id')
      const rows = AUDIT.filter((a) => !actor || a.actor.id === actor)
      return paged(rows, rows.length === AUDIT.length ? 60 : rows.length)
    }
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return { reads }
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('avisos a 375: lo grave con icono y «Revisar», fechas con año y la cifra de fallidas de 30 días en la pestaña', async ({ page }) => {
  const { reads } = await open(page, '/admin/notices')
  const rows = page.getByRole('main').getByRole('listitem')
  await expect(rows.first()).toContainText('Revisar')
  await expect(rows.first()).toContainText('Riesgo de Stripe')
  await expect(rows.nth(1)).not.toContainText('Revisar')
  await expect(rows.nth(2)).toContainText('30 dic 2025 · 9:41')
  await expect(rows.nth(1).getByRole('link', { name: 'Ver la ficha', exact: true })).toHaveAttribute('href', '/admin/users/s1')
  await expect(page.getByRole('tab', { name: 'Entregas fallidas 3 en los últimos 30 días', exact: true })).toBeVisible()
  expect(reads).toContain('/admin/notice-deliveries?from=2026-10-19&limit=1')
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('el enlace del Inicio (?tab=deliveries) abre las entregas fallidas: canal con texto, intentos, error y «Sin nombre»', async ({ page }) => {
  await open(page, '/admin/notices?tab=deliveries')
  await expect(page.getByRole('tab', { name: /^Entregas fallidas/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('No se reintentan: un aviso caduca a las 24 h; si importa, avisa a la persona por otro medio.')).toBeVisible()
  const rows = page.getByRole('main').getByRole('listitem')
  await expect(rows.first()).toContainText('Email')
  await expect(rows.first()).toContainText('5 intentos')
  await expect(rows.first()).toContainText('double-checking')
  await expect(rows.nth(1)).toContainText('Push')
  await expect(rows.nth(1)).toContainText('1 intento · Dirección suprimida')
  await expect(rows.nth(1).getByRole('link', { name: 'Sin nombre', exact: true })).toHaveAttribute('href', '/admin/users/p-d2')
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('un enlace guardado con el nombre antiguo (?tab=failed) también abre las entregas fallidas', async ({ page }) => {
  await open(page, '/admin/notices?tab=failed')
  await expect(page.getByRole('tab', { name: /^Entregas fallidas/ })).toHaveAttribute('aria-selected', 'true')
})

test('entregas fallidas en escritorio: tabla desde xl con el error entero', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await open(page, '/admin/notices?tab=deliveries')
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  await expect(table.getByRole('row').nth(1)).toContainText('double-checking the recipient address')
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main .overflow-x-auto')].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.scrollWidth - e.clientWidth))
  expect(Math.max(...overflow)).toBe(0)
})

test('auditoría a 375: fila por línea, sistema, salud sin dato, y el embudo filtra por persona con su nombre', async ({ page }) => {
  await open(page, '/admin/audit')
  const rows = page.getByRole('main').getByRole('listitem')
  await expect(rows.first()).toContainText('Corrigió una asistencia')
  await expect(rows.first()).toContainText('presente → ausente · Se marcó por error al pasar lista')
  await expect(rows.nth(1)).toHaveText(/Vio las fichas de salud.*Marta Admin.*Ficha$/)
  await expect(rows.nth(2)).toContainText('Sistema')
  expect(await noHorizontalScroll(page)).toBe(0)

  await rows.first().getByRole('link', { name: 'Ver solo lo de Jorge Profesor', exact: true }).click()
  await expect(page).toHaveURL(/actor=t1/)
  const chip = page.getByRole('button', { name: 'Quitar el filtro: solo lo de Jorge Profesor', exact: true })
  await expect(chip).toBeVisible()
  await expect(rows).toHaveCount(1)
  await chip.click()
  await expect(page).not.toHaveURL(/actor=/)
  await expect(rows).toHaveCount(3)
})

test('auditoría: el filtro por recurso no enseña el id, y la paginación conserva los filtros', async ({ page }) => {
  await open(page, '/admin/audit?category=attendance&resource_type=profile&resource_id=7c1f0e7a-1111-4222-8333-944445555666')
  await expect(page.getByRole('button', { name: 'Quitar el filtro: solo esta ficha', exact: true })).toBeVisible()
  await expect(page.getByText('7c1f0e7a')).toHaveCount(0)
  await page.getByRole('link', { name: 'Siguiente' }).click()
  await expect(page).toHaveURL(/category=attendance/)
  await expect(page).toHaveURL(/resource_id=7c1f0e7a/)
  await expect(page).toHaveURL(/page=2/)
})

test('auditoría filtrada por una persona sin filas: el chip dice su nombre igualmente', async ({ page }) => {
  await open(page, '/admin/audit?actor=t1', { empty: true })
  await expect(page.getByRole('button', { name: 'Quitar el filtro: solo lo de Jorge Profesor', exact: true })).toBeVisible()
  await expect(page.getByText('Nada registrado con estos filtros')).toBeVisible()
})

test('auditoría vacía con filtros: «Quitar los filtros» vuelve al registro entero', async ({ page }) => {
  await open(page, '/admin/audit?category=health&from=2026-11-01', { empty: true })
  await expect(page.getByText('Nada registrado con estos filtros')).toBeVisible()
  await page.getByRole('button', { name: 'Quitar los filtros', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/audit$/)
  await expect(page.getByText('Aún no hay nada registrado')).toBeVisible()
})
