import { expect, test, type Page } from '@playwright/test'

// Usuarios del panel (/admin/users y la ficha) sin tocar la BD ni staging: token falso de admin en `kz.token`
// y toda la API simulada con page.route. Las escrituras no salen de aquí: se anotan y se responden.
const NOW = new Date('2026-11-18T18:10:00+01:00')
const at = (hm: string, d = '2026-11-18') => new Date(`${d}T${hm}:00+01:00`).toISOString()
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'a-1', role: 'admin', exp: 4102444800 })}.x`
const ME = { id: 'a-1', display_name: 'Marta Admin', email: 'admin@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'admin' }

const row = (id: string, display_name: string, extra: object = {}) => ({
  id, display_name, avatar: null, email: `${id}@example.invalid`, roles: ['alumno'], is_minor: false, pending_claim: false, disabled: false, has_password: true,
  created_at: at('10:00', '2025-09-01'), subscription_status: 'active', plan_id: '1', plan_name: 'Ilimitado', estado: 'activo', last_attendance_at: at('19:00', '2026-11-17'), ...extra,
})
const ROWS = [row('u1', 'Lucía Pérez'), row('u2', 'Hugo Sánchez', { estado: 'impago', subscription_status: 'unpaid' }), row('u3', 'Martina López', { is_minor: true, email: null })]
const SUB = {
  id: 'sub1', status: 'unpaid', plan: { id: 2, name: '2 disciplinas', price_cents: 5400, max_disciplines: 2 }, disciplines: [{ id: 1, name: 'Judo' }, { id: 2, name: 'Muay Thai' }],
  current_period_end: at('00:00', '2026-12-01'), cancel_at_period_end: false, scheduled_change: null, discipline_changes_left: 1, payer_change: null, pause: null,
  pause_settings: { price_cents: 1000, max_months: 3, per_year: 1 }, payer: { id: 'u1', display_name: 'Lucía Pérez', email: 'u1@example.invalid' },
}
const profile = (extra: object = {}) => ({ ...row('u1', 'Lucía Pérez'), is_public: true, has_google: false, can_create_children: false, ...extra })
const FILES: Record<string, object> = {
  u1: { profile: profile(), status: { ok: true }, guardians: [], children: [], subscription: SUB },
  u4: { profile: profile({ id: 'u4', display_name: 'Ada Admin', roles: ['alumno', 'admin'], plan_name: null, estado: null }), status: { ok: true }, guardians: [], children: [], subscription: null },
  'a-1': { profile: profile({ id: 'a-1', display_name: 'Marta Admin', roles: ['admin'], plan_name: null, estado: null }), status: { ok: true }, guardians: [], children: [], subscription: null },
  u3: { profile: profile({ id: 'u3', display_name: 'Martina López', is_minor: true, email: null, has_password: false }), status: { ok: true }, guardians: [{ id: 'u9', display_name: 'Carlos Vidal', email: 'u9@example.invalid' }], children: [], subscription: null },
}

type Opts = { total?: number; save?: 'ok' | 'error' | 'locked' }
async function open(page: Page, url: string, o: Opts = {}) {
  const { total = ROWS.length, save = 'ok' } = o
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const writes: string[] = []
  const files = structuredClone(FILES) as Record<string, { profile: { roles: string[] } }>
  const lists: URLSearchParams[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api/, '')
    const m = r.request().method()
    if (p === '/me') return r.fulfill({ json: ME })
    if (p === '/auth/me') return r.fulfill({ json: { user: { id: 'a-1', role: 'admin', roles: ['admin'] }, mfa_enabled: true } })
    if (m !== 'GET') {
      writes.push(`${m} ${p}`)
      const roles = p.match(/^\/admin\/profiles\/([^/]+)\/roles(?:\/(\w+))?$/)
      if (roles && save === 'locked') return r.fulfill({ status: 409, json: { code: 'student_has_subscription' } })
      if (roles && save === 'ok') {
        const prof = files[roles[1]].profile
        prof.roles = m === 'POST' ? [...prof.roles, r.request().postDataJSON().role] : prof.roles.filter((x) => x !== roles[2])
        return r.fulfill({ json: { profile: prof } })
      }
      return r.fulfill(save === 'error' ? { status: 500, json: { code: 'internal' } } : { json: { ok: true } })
    }
    if (p === '/admin/profiles/stats') return r.fulfill({ json: { activos: 214, impago: 3, inactivos: 11 } })
    if (p === '/admin/profiles') {
      lists.push(u.searchParams)
      const empty = u.searchParams.get('q') === 'zzz'
      return r.fulfill({ json: { profiles: empty ? [] : ROWS, total: empty ? 0 : total } })
    }
    const f = p.match(/^\/admin\/profiles\/([^/]+)$/)
    if (f) return files[f[1]] ? r.fulfill({ json: files[f[1]] }) : r.fulfill({ status: 404, json: { code: 'profile_not_found' } })
    if (p === '/bookings') return r.fulfill({ json: { bookings: [] } })
    return r.fulfill({ json: { plans: [], disciplines: [], rows: [], total: 0 } })
  })
  await page.goto(url)
  return { writes, lists }
}

const chip = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name })

test('lista: la búsqueda va primero; los chips de estado llevan cifra, ponen y quitan ?estado', async ({ page }) => {
  const { lists } = await open(page, '/admin/users')
  const search = page.getByRole('searchbox', { name: 'Buscar por nombre o email' })
  await expect(search).toBeVisible()
  // Orden visual = orden del HTML: búsqueda antes que los chips.
  const [s, c] = await Promise.all([search.boundingBox(), chip(page, /^Impago/).boundingBox()])
  expect(Math.round(s!.y)).toBeLessThan(Math.round(c!.y))
  await expect(chip(page, /^Impago/)).toHaveText('Impago3')
  await expect(chip(page, /^Todos$/)).toHaveAttribute('aria-pressed', 'true')
  await chip(page, /^Impago/).click()
  await expect(page).toHaveURL(/estado=impago/)
  await expect(chip(page, /^Impago/)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('3 personas · impago por alumno, no por pagador', { exact: true })).toBeVisible()
  expect(lists.at(-1)?.get('estado')).toBe('impago')
  await chip(page, /^Impago/).click()
  await expect(page).not.toHaveURL(/estado=/)
  // Estados con icono y texto; las marcas, sin edad.
  await expect(page.getByRole('listitem').getByText('Impago', { exact: true }).locator('svg')).toHaveCount(1)
  await expect(page.getByText('Alumno · Menor · Ilimitado', { exact: true })).toBeVisible()
})

test('lista: sin resultados con filtros → «Quitar filtros» limpia la URL', async ({ page }) => {
  await open(page, '/admin/users?q=zzz&role=tutor')
  await expect(page.getByText('Nadie coincide con «zzz»', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar filtros', exact: true }).last().click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('listitem').getByText('Lucía Pérez', { exact: true })).toBeVisible()
})

test('lista: varias páginas → «Siguiente» lleva a ?page=2 conservando el estado', async ({ page }) => {
  const { lists } = await open(page, '/admin/users?estado=activo', { total: 87 })
  await expect(page.getByText('Página 1 de 4 · 87 en total', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Siguiente' }).click()
  await expect(page).toHaveURL(/estado=activo&page=2/)
  await expect.poll(() => lists.at(-1)?.get('offset')).toBe('25')
})

test('ficha: cabecera con la cuota; pestañas Resumen, Cuota, Reservas (sin Familia en un adulto sin hijos)', async ({ page }) => {
  await open(page, '/admin/users/u1')
  await expect(page.getByRole('heading', { name: 'Lucía Pérez', level: 1 })).toBeVisible()
  await expect(page.getByText('Impagada', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('tab')).toHaveText(['Resumen', 'Cuota', 'Reservas'])
  await page.getByRole('tab', { name: 'Cuota', exact: true }).click()
  await expect(page).toHaveURL(/tab=billing/)
  await expect(page.getByText('Con la cuota impagada no se puede cambiar nada.', { exact: true })).toBeVisible()
})

test('ficha de un hijo: Familia al final y sin Cuota viva, «Sin cuota»', async ({ page }) => {
  await open(page, '/admin/users/u3')
  await expect(page.getByRole('tab')).toHaveText(['Resumen', 'Cuota', 'Reservas', 'Familia'])
  await expect(page.getByText('Sin cuota', { exact: true })).toBeVisible()
  await expect(page.getByText('Menor', { exact: true })).toBeVisible()
})

test('ficha: perfil que no existe', async ({ page }) => {
  await open(page, '/admin/users/999')
  await expect(page.getByText('Este perfil no existe', { exact: true })).toBeVisible()
})

const roleBox = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true })

test('roles de la ficha: añadir «Tutor» pide confirmar, llama a POST /roles y actualiza las etiquetas', async ({ page }) => {
  const { writes } = await open(page, '/admin/users/u1')
  await expect(page.getByText('Alumno', { exact: true }).first()).toBeVisible()
  await expect(roleBox(page, 'Alumno')).toBeChecked()
  await expect(roleBox(page, 'Tutor')).not.toBeChecked()
  await expect(roleBox(page, 'Tutor')).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: 'Profesor' })).toHaveCount(0) // profesor solo sale si lo tiene
  await roleBox(page, 'Tutor').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText('¿Dar el rol de tutor a Lucía Pérez?')).toBeVisible()
  expect(writes).toEqual([]) // nada hasta confirmar
  await dialog.getByRole('button', { name: 'Dar el rol', exact: true }).click()
  await expect.poll(() => writes).toEqual(['POST /admin/profiles/u1/roles'])
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(roleBox(page, 'Tutor')).toBeChecked()
  await expect(page.getByText('Alumno', { exact: true })).toHaveCount(2) // cabecera: una etiqueta por rol (más la casilla)
  await expect(page.getByText('Tutor', { exact: true })).toHaveCount(2)
})

test('roles de la ficha: quitar un rol (hay otro) pide confirmar y llama a DELETE', async ({ page }) => {
  const { writes } = await open(page, '/admin/users/u4')
  await roleBox(page, 'Alumno').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText('¿Quitar el rol de alumno a Ada Admin?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Volver', exact: true }).click() // cancelar no escribe
  expect(writes).toEqual([])
  await roleBox(page, 'Alumno').click()
  await dialog.getByRole('button', { name: 'Quitar el rol', exact: true }).click()
  await expect.poll(() => writes).toEqual(['DELETE /admin/profiles/u4/roles/alumno'])
})

test('roles de la ficha: la casilla admin de un admin está deshabilitada y dice por qué', async ({ page }) => {
  await open(page, '/admin/users/u4')
  const admin = roleBox(page, 'Admin')
  await expect(admin).toBeChecked()
  await expect(admin).toBeDisabled()
  await expect(admin).toHaveAccessibleDescription('El rol de administración no se quita desde la app.')
  await expect(roleBox(page, 'Tutor')).toBeEnabled()
})

test('roles de la ficha: el propio perfil no se cambia (un motivo para todas) y un hijo solo es alumno', async ({ page }) => {
  await open(page, '/admin/users/a-1')
  for (const n of ['Alumno', 'Tutor', 'Admin']) {
    await expect(roleBox(page, n)).toBeDisabled()
    await expect(roleBox(page, n)).toHaveAccessibleDescription('No puedes cambiar tus propios roles.')
  }
  await expect(page.getByText('No puedes cambiar tus propios roles.')).toHaveCount(1)
  await open(page, '/admin/users/u3')
  await expect(roleBox(page, 'Tutor')).toBeDisabled()
  await expect(roleBox(page, 'Tutor')).toHaveAccessibleDescription('Un hijo solo es alumno.')
})

test('roles de la ficha: si el servidor lo rechaza, se avisa con su texto y nada cambia', async ({ page }) => {
  await open(page, '/admin/users/u1', { save: 'locked' })
  await roleBox(page, 'Admin').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Dar el rol', exact: true }).click()
  await expect(page.getByText('Tiene una cuota viva; dala de baja antes.')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(roleBox(page, 'Admin')).not.toBeChecked()
})

test('baja inmediata: confirmación que dice qué pasa y a quién se avisa', async ({ page }) => {
  const { writes } = await open(page, '/admin/users/u1?tab=billing')
  await page.getByRole('button', { name: 'Baja inmediata', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText(/anula los recibos pendientes y cancela sus reservas futuras\. Se avisa al pagador\./)).toBeVisible()
  await dialog.getByRole('button', { name: 'Volver', exact: true }).click()
  expect(writes).toEqual([])
})
