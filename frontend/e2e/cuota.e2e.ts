import { expect, test, type Page } from '@playwright/test'

// Cuota (/billing) con la API simulada en el navegador (page.route): no escribe en la base de datos ni toca Stripe.
// Token de cliente falso: la app solo decodifica el rol. Solo necesita E2E_BASE_URL. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (role: string) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role, exp: 4102444800 })}.x`
const ME = { id: 'u-1', display_name: 'Ana Pérez', email: 'ana@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: true, minor: null }
const LARA = { id: 'c-lara', display_name: 'Lara Pérez', avatar: null, birth_date: '2015-05-05', pending_claim: false }
const CUOTA = {
  id: 's-1',
  status: 'active',
  plan: { id: 1, name: 'Plan 2 disciplinas', price_cents: 5900, max_disciplines: 2 },
  disciplines: [{ id: 1, name: 'Judo' }, { id: 2, name: 'Jiu-jitsu' }],
  current_period_end: '2026-12-05T00:00:00Z',
  discipline_changes_left: 1,
  pause_settings: { price_cents: 1500, max_months: 3, per_year: 1 },
}

async function abrir(page: Page, o: { role?: 'alumno' | 'tutor'; subscription?: object | null } = {}) {
  const role = o.role ?? 'alumno'
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(role))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json({ ...ME, role })
    if (u === '/me/children') return json({ children: role === 'tutor' ? [LARA] : [] })
    if (u === '/me/profile-status') return json({ ok: true, missing: [] })
    if (u === '/billing/subscription') return o.subscription === null ? json({ code: 'subscription_not_found' }, 404) : json(o.subscription ?? CUOTA)
    return json({})
  })
  await page.goto('/billing')
}

test('alumno: el importe manda y las filas llevan a cambiar plan y disciplina', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('heading', { name: 'Tu cuota' })).toBeVisible()
  await expect(page.getByText('59,00 €', { exact: true })).toBeVisible()
  await expect(page.getByText('Activa', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Cambiar de plan/ })).toHaveAttribute('href', '/billing/plan')
  await expect(page.getByRole('link', { name: /^Cambiar de disciplina/ })).toContainText('Queda 1 cambio este periodo')
  await expect(page.getByRole('button', { name: /^Pausar membresía/ })).toContainText('Mantenimiento: 15,00 € al mes')
})

test('tutor: actúa por el primer hijo y lo nombra por su nombre de pila', async ({ page }) => {
  await abrir(page, { role: 'tutor' })
  await expect(page.getByRole('heading', { name: 'Cuota de Lara' })).toBeVisible()
  // El selector «Para» sí lleva el nombre completo; la cuota, no.
  await expect(page.locator('main section').getByText('Lara Pérez')).toHaveCount(0)
})

test('cobro pendiente: plan y pausa bloqueados con su motivo, sin enlace; la disciplina sigue', async ({ page }) => {
  await abrir(page, { subscription: { ...CUOTA, status: 'past_due' } })
  await expect(page.getByText('El plan se podrá cambiar cuando el cobro esté al día.')).toBeVisible()
  await expect(page.getByText('Se podrá pausar cuando el cobro esté al día.')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Cambiar de plan/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Pausar membresía/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Cambiar de disciplina/ })).toBeVisible()
})

test('impagada: el aviso lo dice con su título', async ({ page }) => {
  await abrir(page, { subscription: { ...CUOTA, status: 'unpaid' } })
  await expect(page.getByRole('alert')).toContainText('La cuota está impagada')
})

test('tutor sin cuota del hijo: invita a contratarla', async ({ page }) => {
  await abrir(page, { role: 'tutor', subscription: null })
  await expect(page.getByText('Lara aún no tiene cuota', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Contratar una cuota' })).toBeVisible()
})
