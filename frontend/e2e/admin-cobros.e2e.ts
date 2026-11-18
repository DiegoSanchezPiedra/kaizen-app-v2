import { expect, test, type Page } from '@playwright/test'

// Cobros del panel (/admin/billing) sin tocar la BD, staging ni Stripe: token falso de admin en `kz.token` y toda la
// API simulada con page.route. Las escrituras se anotan y se responden aquí; nada cobra ni da de baja.
// Reloj fijo: miércoles 18 de noviembre de 2026, 18:10 en Madrid.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (d: string, hm = '10:00') => new Date(`${d}T${hm}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const item = (id: string, student: string, label: string, status: string) => ({ kind: 'subscription', id, student_id: `u-${id}`, student_name: student, label, status, current_period_end: at('2026-11-30'), cancel_at_period_end: false })
const inv = (id: string, item_id: string, cents: number, attempts: number, extra: object = {}) => ({ id, item_id, amount_due_cents: cents, attempt_count: attempts, next_payment_attempt: null, last_payment_error: null, hosted_invoice_url: `https://invoice.stripe.com/i/test/${id}`, ...extra })
const DELINQ = [
  {
    payer_id: 'p1', display_name: 'Carlos Vidal',
    items: [item('s1', 'Lucía Vidal', 'Mensual 2 disciplinas', 'unpaid'), item('s2', 'Hugo Vidal', 'Mensual 1 disciplina', 'past_due')],
    invoices: [inv('in1', 's1', 6500, 4, { last_payment_error: 'Fondos insuficientes' }), inv('in2', 's1', 6500, 1), inv('in3', 's2', 4500, 2, { next_payment_attempt: at('2026-11-20', '09:00') })],
  },
  { payer_id: 'p2', display_name: null, items: [item('s3', 'Martina López', 'Infantil', 'unpaid')], invoices: [] },
]
const GRACE = [{ payer_id: 'p4', display_name: 'Sara Molina', items: [item('s5', 'Sara Molina', 'Mensual 2 disciplinas', 'past_due')], invoices: [inv('in5', 's5', 6500, 1)] }]
const ref = (id: string, display_name: string) => ({ id, display_name })
const chg = (id: string, status: string, extra: object = {}) => ({
  id, status, subscription_id: `sub-${id}`, student: ref('u1', 'Lucía Vidal'), old_payer: ref('p1', 'Carlos Vidal'), new_payer: ref('p9', 'Elena Ruiz'), plan: { id: 'pl1', name: 'Mensual 2 disciplinas' },
  starts_at: at('2026-12-01'), deadline: at('2026-11-25', '23:59'), cancel_reason: null, updated_at: at('2026-11-15'), ...extra,
})
const LIVE = [chg('c1', 'requested'), chg('c2', 'paid', { student: ref('u7', 'Álvaro Ruiz'), old_payer: ref('p7', 'Irene Gómez'), new_payer: ref('u7', 'Álvaro Ruiz') })]
const EXPIRED = [chg('c3', 'expired', { student: ref('u4', 'Martina López'), old_payer: ref('p3', 'Ana López'), new_payer: ref('p8', 'Jorge Martín') })]

type Opts = { empty?: boolean; fail?: boolean; saveError?: boolean }
async function open(page: Page, url: string, o: Opts = {}) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.context().route('https://invoice.stripe.com/**', (r) => r.abort())
  const writes: string[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const m = r.request().method()
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin' }, mfa_enabled: true } })
    if (m !== 'GET') {
      writes.push(`${m} ${p}`)
      return r.fulfill(o.saveError ? { status: 500, json: { code: 'internal' } } : { json: { ok: true } })
    }
    if (o.fail) return r.fulfill({ status: 500, json: { code: 'internal' } })
    const paged = (k: string, rows: unknown[]) => r.fulfill({ json: { [k]: o.empty ? [] : rows, total: o.empty ? 0 : rows.length, limit: 25, offset: 0 } })
    if (p === '/admin/billing/delinquents') return paged('payers', DELINQ)
    if (p === '/admin/billing/grace') return paged('payers', GRACE)
    if (p === '/admin/payer-changes') return paged('rows', u.searchParams.get('status') === 'expired' ? EXPIRED : LIVE)
    return r.fulfill({ json: {} })
  })
  await page.goto(url)
  return { writes }
}

const payer = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test('morosos: cuánto debe cada pagador arriba; cada cuota con sus recibos; el recibo se abre en otra pestaña', async ({ page }) => {
  await open(page, '/admin/billing')
  await expect(page.getByText('2 pagadores deben', { exact: true })).toBeVisible()
  const carlos = payer(page, 'Carlos Vidal')
  await expect(carlos.getByText('175,00 €', { exact: true })).toBeVisible()
  await expect(carlos.getByText('3 recibos', { exact: true })).toBeVisible()
  await expect(carlos.getByText('Último error: Fondos insuficientes')).toBeVisible()
  await expect(carlos.getByText('2 intentos · siguiente 20 nov a las 9:00')).toBeVisible()
  // Los dos recibos de Lucía van bajo su cuota.
  const lucia = carlos.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Lucía Vidal', exact: true }) })
  await expect(lucia.getByRole('list', { name: 'Recibos pendientes' }).getByRole('listitem')).toHaveCount(2)
  const recibo = carlos.getByRole('link', { name: /Abrir el recibo/ }).first()
  await expect(recibo).toHaveAttribute('target', '_blank')
  await expect(recibo).toHaveAttribute('href', 'https://invoice.stripe.com/i/test/in1')
  await expect(recibo).toContainText('(se abre en otra pestaña)')
  await expect(payer(page, 'Sin nombre').getByText('Sin recibos abiertos')).toBeVisible()
})

test('baja inmediata: la confirmación dice de quién es la cuota y a quién se avisa; luego el POST', async ({ page }) => {
  const { writes } = await open(page, '/admin/billing')
  await payer(page, 'Carlos Vidal').getByRole('button', { name: 'Baja inmediata', exact: true }).first().click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Termina ya la cuota de Lucía Vidal (Mensual 2 disciplinas)')
  await expect(dialog).toContainText('Se avisa a Carlos Vidal.')
  await dialog.getByRole('button', { name: 'Dar de baja ya', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/subscriptions/s1/cancel-now'])
  await expect(page.getByText('Cuota dada de baja')).toBeVisible()
})

test('error al guardar: la baja falla con un toast de error y la lista sigue', async ({ page }) => {
  const { writes } = await open(page, '/admin/billing', { saveError: true })
  await payer(page, 'Carlos Vidal').getByRole('button', { name: 'Baja inmediata', exact: true }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Dar de baja ya', exact: true }).click()
  await expect.poll(() => writes).toHaveLength(1)
  await expect(page.getByText(/Algo ha fallado/)).toBeVisible()
  await expect(payer(page, 'Carlos Vidal')).toBeVisible()
})

test('en gracia: Stripe sigue reintentando y sin baja inmediata', async ({ page }) => {
  await open(page, '/admin/billing?tab=grace')
  await expect(page.getByText('1 pagador en gracia', { exact: true })).toBeVisible()
  await expect(page.getByText(/Stripe sigue reintentando el cobro hasta el 30 nov 2026/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baja inmediata', exact: true })).toHaveCount(0)
})

test('cambios de pagador en curso: estado con icono; Anular solo si no está pagado; sin scroll lateral en móvil', async ({ page }) => {
  const { writes } = await open(page, '/admin/billing?tab=payer-changes')
  await expect(page.getByRole('button', { name: 'En curso', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const rows = page.getByRole('list').filter({ visible: true }).filter({ hasText: 'Lucía Vidal' })
  await expect(rows.getByText('Pendiente de pago').locator('svg')).toHaveCount(1)
  await expect(rows.getByText('Pagado', { exact: true }).locator('svg')).toHaveCount(1)
  await expect(rows.getByRole('button', { name: 'Anular', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await rows.getByRole('button', { name: 'Anular', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Elena Ruiz deja de poder pagarlo y Carlos Vidal sigue pagando la cuota de Lucía Vidal. Se avisa a los dos.')
  await dialog.getByRole('button', { name: 'Anular el cambio', exact: true }).click()
  await expect.poll(() => writes).toEqual(['DELETE /admin/subscriptions/sub-c1/payer-change'])
})

test('caducados: quién sigue pagando y «Volver a pedirlo» abre la cuota del alumno; en escritorio, la tabla', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/admin/billing?tab=payer-changes')
  await page.getByRole('button', { name: 'Caducados', exact: true }).click()
  await expect(page).toHaveURL(/view=expired/)
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  await expect(table.getByText('No pagó a tiempo; sigue pagando Ana López.')).toBeVisible()
  await expect(table.getByText('Caducado', { exact: true }).locator('svg')).toHaveCount(1)
  await expect(table.getByRole('link', { name: 'Volver a pedirlo', exact: true })).toHaveAttribute('href', '/admin/users/u4?tab=billing')
})

test('vacíos de las cuatro vistas', async ({ page }) => {
  await open(page, '/admin/billing', { empty: true })
  await expect(page.getByText('Nadie debe nada')).toBeVisible()
  await page.getByRole('tab', { name: 'En gracia', exact: true }).click()
  await expect(page.getByText('Nadie está en gracia')).toBeVisible()
  await page.getByRole('tab', { name: 'Cambios de pagador', exact: true }).click()
  await expect(page.getByText('No hay cambios en curso')).toBeVisible()
  await page.getByRole('button', { name: 'Caducados', exact: true }).click()
  await expect(page.getByText('Ninguno ha caducado')).toBeVisible()
})

test('error al cargar: se puede reintentar', async ({ page }) => {
  await open(page, '/admin/billing', { fail: true })
  await expect(page.getByRole('button', { name: /Reintentar|Volver a intentar/i })).toBeVisible()
})
