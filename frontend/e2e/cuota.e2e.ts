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

const P = (o: object) => ({ billing_period: 'monthly', min_age: null, max_age: null, is_active: true, is_featured: false, eligible_discipline_ids: [], ...o })
const PLANS = [
  P({ id: 1, name: 'Plan 2 disciplinas', price_cents: 5900, max_disciplines: 2, min_age: 14, is_featured: true }),
  P({ id: 2, name: 'Plan ilimitado', price_cents: 7900, max_disciplines: null, min_age: 14 }),
  P({ id: 3, name: 'Kids', price_cents: 3500, max_disciplines: 1, min_age: 4, max_age: 13, eligible_discipline_ids: [1, 3] }),
  P({ id: 4, name: 'Plan 1 disciplina', price_cents: 4500, max_disciplines: 1, min_age: 14 }),
  P({ id: 5, name: 'Kids ilimitado', price_cents: 4900, max_disciplines: null, min_age: 4, max_age: 13 }),
]
const DISCIPLINAS = ['Judo', 'Jiu-jitsu', 'Kárate'].map((name, i) => ({ id: i + 1, name, min_age: null, max_age: null, is_active: true, is_open: false }))

// children: el alumno adulto con hijos también ve el selector «Para» (va por sí mismo por defecto).
// sequence: respuestas de /billing/subscription por orden (la última se repite), para el sondeo de /billing/success.
async function abrir(page: Page, o: { role?: 'alumno' | 'tutor'; subscription?: object | null; sequence?: object[]; path?: string; children?: boolean; disciplines?: object[] } = {}) {
  const role = o.role ?? 'alumno'
  const posts: unknown[] = []
  let polls = 0
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(role))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j })
    if (r.request().method() === 'POST' && u === '/billing/checkout') {
      posts.push(r.request().postDataJSON())
      return json({ url: 'https://checkout.stripe.invalid/x' })
    }
    // Cambio de plan: se apunta y no se responde, para ver el botón ocupado (nunca llega a Stripe).
    if (r.request().method() === 'POST' && /^\/billing\/subscriptions\/[^/]+\/plan$/.test(u)) {
      posts.push(r.request().postDataJSON())
      return
    }
    // Cambio de disciplina: igual, apuntado y sin responder.
    if (r.request().method() === 'POST' && /^\/billing\/subscriptions\/[^/]+\/disciplines$/.test(u)) {
      posts.push(r.request().postDataJSON())
      return
    }
    if (r.request().method() !== 'GET') return json({})
    if (u === '/me') return json({ ...ME, role })
    if (u === '/me/children') return json({ children: role === 'tutor' || o.children ? [LARA] : [] })
    if (u === '/me/profile-status') return json({ ok: true, missing: [] })
    if (u === '/billing/subscription' && o.sequence) return json(o.sequence[Math.min(polls++, o.sequence.length - 1)])
    if (u === '/billing/subscription') return o.subscription === null ? json({ code: 'subscription_not_found' }, 404) : json(o.subscription ?? CUOTA)
    if (u === '/plans') return json({ plans: PLANS })
    if (u === '/disciplines') return json({ disciplines: o.disciplines ?? DISCIPLINAS })
    return json({})
  })
  // Nunca se sigue la redirección a Stripe.
  await page.route('https://checkout.stripe.invalid/**', (r) => r.abort())
  await page.goto(o.path ?? '/billing')
  return posts
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

// ── Contratar (/billing/contract) ──

test('contratar: plan recomendado, el importe manda y el pago pide confirmación antes de Stripe', async ({ page }) => {
  const posts = await abrir(page, { subscription: null, path: '/billing/contract' })
  await expect(page.getByRole('radio', { name: 'Plan 2 disciplinas' })).toHaveAccessibleDescription('Recomendado')
  await page.getByText('Plan 2 disciplinas', { exact: true }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('0 de 2 elegidas')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Judo' }).click()
  await page.getByRole('checkbox', { name: 'Kárate' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Paso 3 de 3 · Pago' })).toBeVisible()
  await expect(page.locator('main section').getByText('59,00 €', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ir al pago' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('¿Pagar tu cuota?')
  await expect(dialog).toContainText('59,00 € al mes')
  await dialog.getByRole('button', { name: 'Volver' }).click()
  expect(posts).toHaveLength(0)
  await page.getByRole('button', { name: 'Ir al pago' }).click()
  await page.getByRole('button', { name: 'Pagar en Stripe' }).click()
  await expect.poll(() => posts).toEqual([{ plan_id: '1', discipline_ids: ['1', '3'] }])
})

test('contratar por un hijo: nombre de pila, nunca el completo fuera del selector «Para»', async ({ page }) => {
  await abrir(page, { role: 'tutor', subscription: null, path: '/billing/contract' })
  await page.getByText('Kids', { exact: true }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('checkbox', { name: 'Judo' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.locator('main section').getByText('Lara', { exact: true })).toBeVisible()
  await expect(page.locator('main section').getByText('Lara Pérez')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ir al pago' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('¿Pagar la cuota de Lara?')
})

test('contratar, alumno con hijos: el selector «Para» va por él mismo', async ({ page }) => {
  await abrir(page, { children: true, subscription: null, path: '/billing/contract' })
  await expect(page.getByRole('main').getByRole('combobox')).toHaveText('Tú')
  await expect(page.getByRole('heading', { name: 'Paso 1 de 3 · Plan' })).toBeVisible()
})

// ── Cambiar de plan (/billing/plan) ──

test('cambiar de plan, subida: diferencia en la opción, el diálogo dice importe, cuándo y qué se cobra hoy', async ({ page }) => {
  const posts = await abrir(page, { path: '/billing/plan' })
  await expect(page.getByRole('heading', { name: 'Tu plan ahora' })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(2) // el plan actual no es una opción
  await expect(page.getByText('+20,00 € al mes · desde hoy')).toBeVisible()
  await expect(page.getByText('−14,00 € al mes · desde el 5 dic 2026')).toBeVisible()
  await page.getByText('Plan ilimitado', { exact: true }).click()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('¿Pasar a Plan ilimitado?')
  await expect(dialog).toContainText('79,00 €')
  await expect(dialog.getByText('Hoy se cobra')).toBeVisible()
  await expect(dialog).toContainText('La parte proporcional')
  await dialog.getByRole('button', { name: 'Pasar a Plan ilimitado' }).click()
  await expect(dialog.getByRole('button', { name: 'Confirmando con tu banco…' })).toBeDisabled()
  await expect.poll(() => posts).toEqual([{ plan_id: 2, discipline_ids: [] }])
})

test('cambiar de plan, el banco rechaza el pago: el aviso sale una sola vez', async ({ page }) => {
  await abrir(page, { path: '/billing/plan' })
  await page.route('**/api/billing/subscriptions/*/plan', (r) => r.fulfill({ status: 402, json: { code: 'payment_failed' } }))
  await page.getByText('Plan ilimitado', { exact: true }).click()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pasar a Plan ilimitado' }).click()
  await expect(page.getByText('El banco ha rechazado el pago')).toHaveCount(1)
})

test('cambiar de plan con una bajada programada: aviso, opción marcada y el diálogo dice que la anula', async ({ page }) => {
  await abrir(page, {
    path: '/billing/plan',
    subscription: { ...CUOTA, scheduled_change: { plan_id: '4', plan_name: 'Plan 1 disciplina', discipline_ids: ['1'], scheduled_at: '2026-12-05T00:00:00Z' } },
  })
  await expect(page.getByText('Tienes programado el paso a Plan 1 disciplina el 5 dic 2026')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Plan 1 disciplina' })).toBeDisabled()
  await expect(page.getByText('Programado · 5 dic 2026')).toBeVisible()
  await page.getByText('Plan ilimitado', { exact: true }).click()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Anula el paso a Plan 1 disciplina')
})

test('cambiar de plan por un hijo: nombre de pila, nunca el completo fuera del selector «Para»', async ({ page }) => {
  await abrir(page, { role: 'tutor', path: '/billing/plan', subscription: { ...CUOTA, plan: { id: 3, name: 'Kids', price_cents: 3500, max_disciplines: 1 }, disciplines: [{ id: 1, name: 'Judo' }] } })
  await expect(page.getByRole('heading', { name: 'Plan de Lara ahora' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Plan nuevo para Lara' })).toBeVisible()
  await expect(page.locator('main section').getByText('Lara Pérez')).toHaveCount(0)
  await page.getByText('Kids ilimitado', { exact: true }).click()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('¿Cambiar el plan de Lara a Kids ilimitado?')
})

test('cambiar de plan con el cobro pendiente: el motivo y la salida a la cuota', async ({ page }) => {
  await abrir(page, { path: '/billing/plan', subscription: { ...CUOTA, status: 'past_due' } })
  await expect(page.getByText('El plan se podrá cambiar cuando el cobro esté al día.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver la cuota' })).toHaveAttribute('href', '/billing')
})

// ── Cambiar de disciplina (/billing/discipline) ──

test('cambiar de disciplina: lo actual arriba, filas de radio y el diálogo dice qué cambia, cuándo, cuánto cuesta y qué queda', async ({ page }) => {
  const posts = await abrir(page, { path: '/billing/discipline' })
  await expect(page.getByRole('heading', { name: 'Tus disciplinas ahora' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: '¿Cuál dejas?' }).getByRole('radio', { name: 'Judo' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Revisar el cambio' })).toBeDisabled()
  await page.getByRole('radiogroup', { name: '¿A cuál pasas?' }).getByRole('radio', { name: 'Kárate' }).click()
  await expect(page.getByText('Se aplica hoy y cancela las reservas de Judo.')).toBeVisible()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('¿Cambiar Judo por Kárate?')
  await expect(dialog).toContainText('CuestaNada')
  await expect(dialog).toContainText('Gasta 1 · no quedan cambios')
  await dialog.getByRole('button', { name: 'Cambiar a Kárate' }).click()
  // Pendiente: sin spinner, texto y botón deshabilitado; el diálogo no se cierra.
  await expect(dialog.getByRole('button', { name: 'Cambiando…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect.poll(() => posts).toEqual([{ from_id: '1', to_id: '3' }])
})

test('cambiar de disciplina sin cambios: el aviso dice hasta cuándo y no deja elegir', async ({ page }) => {
  await abrir(page, { path: '/billing/discipline', subscription: { ...CUOTA, discipline_changes_left: 0 } })
  await expect(page.getByText('No quedan cambios hasta el 5 dic 2026')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ver la cuota' })).toHaveAttribute('href', '/billing')
})

test('cambiar de disciplina por un hijo con una que ya no se cubre: nombre de pila y no gasta cambios', async ({ page }) => {
  await abrir(page, {
    role: 'tutor',
    path: '/billing/discipline',
    subscription: { ...CUOTA, plan: { id: 3, name: 'Kids', price_cents: 3500, max_disciplines: 1 }, disciplines: [{ id: 1, name: 'Judo' }] },
    disciplines: DISCIPLINAS.map((d) => (d.id === 1 ? { ...d, max_age: 10 } : d)),
  })
  await expect(page.getByRole('heading', { name: 'Disciplinas de Lara ahora' })).toBeVisible()
  await expect(page.getByText('Ya no se cubre', { exact: true })).toBeVisible()
  await page.getByRole('radiogroup', { name: '¿A cuál pasa Lara?' }).getByRole('radio', { name: 'Kárate' }).click()
  await page.getByRole('button', { name: 'Revisar el cambio' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('¿Cambiar Judo por Kárate para Lara?')
  await expect(page.getByRole('alertdialog')).toContainText('No gasta ninguno')
  await expect(page.locator('main section').getByText('Lara Pérez')).toHaveCount(0)
})

test('cambiar de disciplina con la cuota impagada: el motivo y la salida a la cuota', async ({ page }) => {
  await abrir(page, { path: '/billing/discipline', subscription: { ...CUOTA, status: 'unpaid' } })
  await expect(page.getByText('Ahora no se pueden cambiar las disciplinas')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver la cuota' })).toHaveAttribute('href', '/billing')
})

// ── Vuelta de Stripe (/billing/success y /billing/cancel) ──

test('vuelta del pago: confirma tras el sondeo y enseña la cuota con su importe; el aviso vivo lo dice una vez', async ({ page }) => {
  await abrir(page, { path: '/billing/success', sequence: [{ ...CUOTA, status: 'incomplete' }, CUOTA] })
  await expect(page.getByRole('status')).toHaveText('Confirmando el pago.')
  await expect(page.getByRole('heading', { name: 'Ya tienes cuota' })).toBeVisible({ timeout: 6000 })
  await expect(page.getByRole('status')).toHaveText('Pago confirmado: ya tienes cuota.')
  const card = page.locator('main section')
  await expect(card).toContainText('59,00 €')
  await expect(card).toContainText('Judo y Jiu-jitsu')
  await expect(card).toContainText('Se renueva')
  await expect(page.getByRole('link', { name: 'Reservar una sesión' })).toHaveAttribute('href', '/calendar')
})

test('vuelta del pago por un hijo: recupera a Lara de la sesión y la nombra por su nombre de pila', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kz.checkout-for', 'c-lara'))
  await abrir(page, { role: 'tutor', path: '/billing/success', subscription: { ...CUOTA, plan: { id: 3, name: 'Kids', price_cents: 3500, max_disciplines: 1 }, disciplines: [{ id: 1, name: 'Judo' }] } })
  await expect(page.getByRole('heading', { name: 'Lara ya tiene cuota' })).toBeVisible()
  await expect(page).toHaveURL(/para=c-lara/)
  await expect(page.locator('main section').getByText('Lara Pérez')).toHaveCount(0)
})

test('vuelta del pago sin aviso de Stripe: a los 20 s «puede tardar» y a los 2 min reintentar o ver la cuota', async ({ page }) => {
  await page.clock.install()
  await abrir(page, { path: '/billing/success', subscription: { ...CUOTA, status: 'incomplete' } })
  await expect(page.getByRole('heading', { name: 'Confirmando el pago…' })).toBeVisible()
  await page.clock.fastForward(21_000)
  await expect(page.getByRole('heading', { name: 'Puede tardar unos minutos' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir a Inicio' })).toBeVisible()
  await page.clock.fastForward(100_000)
  await expect(page.getByRole('heading', { name: 'No podemos comprobarlo ahora' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver la cuota' })).toHaveAttribute('href', '/billing')
})

test('pago cancelado sin cuota: no se ha cobrado nada y se puede volver a intentar', async ({ page }) => {
  await abrir(page, { path: '/billing/cancel', subscription: null })
  await expect(page.getByRole('heading', { name: 'No se ha cobrado nada' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver a intentarlo' })).toHaveAttribute('href', '/billing/contract')
})

test('pago cancelado con la cuota ya activa: sin reintentar, solo la salida a la cuota', async ({ page }) => {
  await abrir(page, { path: '/billing/cancel' })
  await expect(page.getByText('La cuota sigue como estaba.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver la cuota' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver a intentarlo' })).toHaveCount(0)
})
