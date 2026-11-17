import { expect, test, type Page } from '@playwright/test'

// Sesiones del profesor (/professor) con la API simulada en el navegador (page.route): no escribe en la base de datos.
// Token falso con rol 'profesor' (la app solo decodifica el rol). Reloj fijo con hora de Madrid, nunca la del sistema.
// Solo necesita E2E_BASE_URL. Móvil 375 px (iPhone 13 del config: isMobile y táctil).
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'p-1', role: 'profesor', exp: 4102444800 })}.x`
const ME = { id: 'p-1', display_name: 'Kenji Sato', email: 'kenji@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'profesor' }

// Martes 17-nov-2026, hora de Madrid (UTC+1).
const at = (day: number, hm: string) => new Date(`2026-11-${day}T${hm}:00+01:00`).toISOString()
const S = (id: string, day: number, a: string, b: string, name: string, o: object = {}) => ({
  id, class_id: 'c', discipline_id: 1, discipline_name: name, starts_at: at(day, a), ends_at: at(day, b), duration_min: 60, capacity: 20, location: 'Tatami 1', status: 'scheduled', ...o,
})
const SESSIONS = [
  S('s1', 17, '17:00', '18:00', 'Judo infantil'),
  S('s2', 17, '18:00', '19:30', 'Jiu-jitsu', { location: 'Tatami 2' }),
  S('s4', 17, '21:00', '22:00', 'Grappling', { status: 'cancelled' }),
]
const EVENT = {
  id: 'e1', title: 'Seminario de judo', description: null, starts_at: at(17, '10:00'), ends_at: at(17, '13:00'), location: 'Tatami 1', discipline: { id: 1, name: 'Judo' },
  trainer: null, capacity: 30, taken: 12, audience: 'all', price_cents: 2000, member_price_cents: null, registration_deadline: null, status: 'scheduled', registration: null,
}
const clock = (employment: string) => ({ profile: { id: 'p-1', display_name: 'Kenji Sato', employment }, month: '2026-11', state: 'in', total_seconds: 0, days: [], events: [{ id: 'k', kind: 'in', at: at(17, '16:30'), origin: 'app' }], corrections: [] })

async function abrir(page: Page, o: { now?: string; sessions?: object[]; events?: object[]; fail?: boolean; employment?: string } = {}) {
  await page.clock.setFixedTime(new Date(`2026-11-17T${o.now ?? '18:30'}:00+01:00`))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url())
    const u = url.pathname.replace(/^\/api/, '')
    const inRange = (x: { starts_at: string }) => x.starts_at.slice(0, 10) >= url.searchParams.get('from')! && x.starts_at.slice(0, 10) <= url.searchParams.get('to')!
    if (r.request().method() !== 'GET') return r.fulfill({ status: 405, json: { code: 'not_in_test' } })
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/me/clock') return r.fulfill({ json: clock(o.employment ?? 'employee') })
    if (o.fail && u.startsWith('/professor/')) return r.fulfill({ status: 500, json: { code: 'internal' } })
    if (u === '/professor/sessions') return r.fulfill({ json: { sessions: (o.sessions ?? SESSIONS).filter(inRange) } })
    if (u === '/professor/events') return r.fulfill({ json: { events: (o.events ?? []).filter(inRange) } })
    return r.fulfill({ json: {} })
  })
  await page.goto('/professor')
  await expect(page.getByRole('heading', { name: 'Sesiones', level: 1 })).toBeVisible()
}

const pasarLista = (page: Page) => page.getByRole('link', { name: 'Pasar lista', exact: true })

test('sesión en curso: un solo hueco arriba, que lleva a pasar lista', async ({ page }) => {
  await abrir(page)
  await expect(pasarLista(page)).toHaveCount(1)
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/sessions/s2')
  await expect(page.getByText('Hoy · 18:00')).toBeVisible()
  // En la lista, la fila sigue con «En curso»; la llamada a pasar lista solo va en el hueco.
  await expect(page.getByText('En curso', { exact: true })).toBeVisible()
  await expect(page.getByText('Terminada')).toBeVisible()
  await expect(page.getByText('Cancelada')).toBeVisible()
  // El hueco va antes que la Jornada (orden del HTML = orden visual = Tab).
  const hero = await pasarLista(page).boundingBox()
  const jornada = await page.getByRole('region', { name: 'Jornada' }).boundingBox()
  expect(hero!.y).toBeLessThan(jornada!.y)
})

test('evento en curso: el hueco lleva a su asistencia', async ({ page }) => {
  await abrir(page, { now: '11:00', events: [EVENT] })
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/events/e1')
  await expect(page.getByText('Seminario de judo').first()).toBeVisible()
})

test('solo próximas: sin hueco; la cancelada se ve tachada con su insignia', async ({ page }) => {
  await abrir(page, { now: '09:00' })
  await expect(page.getByText('Judo infantil')).toBeVisible()
  await expect(pasarLista(page)).toHaveCount(0)
  await expect(page.getByText('Cancelada')).toBeVisible()
})

test('cambio de semana: el hueco de la sesión en curso se queda', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Semana siguiente' }).first().click()
  await expect(page.getByText('No hay sesiones esta semana')).toBeVisible()
  await expect(pasarLista(page)).toBeVisible()
})

test('dos en curso a la vez: un solo hueco con un botón por cada una', async ({ page }) => {
  await abrir(page, { sessions: [...SESSIONS, S('s5', 17, '18:15', '19:15', 'Kárate')] })
  await expect(page.getByText('Hoy · 18:00')).toHaveCount(1)
  await expect(pasarLista(page)).toHaveAttribute('href', '/professor/sessions/s2')
  await expect(page.getByRole('link', { name: 'Pasar lista de Kárate' })).toHaveAttribute('href', '/professor/sessions/s5')
})

test('semana vacía: sin hueco; título del vacío en sans, no en la condensada', async ({ page }) => {
  await abrir(page, { sessions: [] })
  const title = page.getByText('No hay sesiones esta semana')
  await expect(title).toBeVisible()
  await expect(title).not.toHaveCSS('font-family', /Barlow/)
  await expect(pasarLista(page)).toHaveCount(0)
})

test('error de la API: reintentar, sin hueco', async ({ page }) => {
  await abrir(page, { fail: true })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(pasarLista(page)).toHaveCount(0)
})

test('autónomo: sin tarjeta de Jornada; el hueco sigue', async ({ page }) => {
  await abrir(page, { employment: 'self_employed' })
  await expect(pasarLista(page)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Jornada' })).toHaveCount(0)
})

test('objetivos táctiles de 44 px o más', async ({ page }) => {
  await abrir(page)
  const targets = [
    pasarLista(page),
    page.getByRole('button', { name: 'Pausa' }),
    page.getByRole('button', { name: 'Salir' }),
    page.getByRole('button', { name: 'Semana anterior' }),
    page.getByRole('button', { name: /^martes, 17/i }),
    page.getByRole('link', { name: /Jiu-jitsu/ }).last(),
  ]
  for (const t of targets) {
    const box = await t.boundingBox()
    expect(Math.round(box!.height), await t.textContent()).toBeGreaterThanOrEqual(44)
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44)
  }
})

// ── Detalle de una sesión (/professor/sessions/:id): pasar lista ──────────────────────────────────────────────
// Misma API simulada; aquí los PUT/POST se apuntan en `calls` y se responden simulados (nunca llegan a la BD).
const R = (i: number, name: string, o: object = {}) => ({
  booking_id: `b${i}`, student_id: `st${i}`, display_name: name, avatar: null, status: null, method: null, corrected_at: null, correction_reason: null, ...o,
})
const ROWS = [
  R(1, 'Lucía Fernández', { status: 'present', method: 'qr' }),
  R(2, 'Mateo García', { status: 'present', method: 'manual' }),
  R(3, 'Alejandro Martínez-Ruiz de la Torre'),
  R(4, 'Sofía López'),
  R(5, 'Hugo Sánchez', { status: 'present', method: 'manual' }),
  R(6, 'Valeria Gómez'),
]
const CLOSED = ROWS.map((r) => ({ ...r, status: r.status ?? 'absent' }))
const HEALTH = [
  { student_id: 'st1', display_name: 'Lucía Fernández', injuries: 'Hombro derecho', conditions: null, allergies: null, medication: null, emergency_contact_name: 'Ana', emergency_contact_phone: '+34 600 111 222' },
  { student_id: 'st4', display_name: 'Sofía López', injuries: null, conditions: null, allergies: null, medication: null, emergency_contact_name: null, emergency_contact_phone: null },
]

type SesOpts = { now?: string; day?: number; rows?: object[]; closed?: boolean; until?: string; cancelled?: boolean; put?: 'ok' | 'offline'; correct?: 'ok' | 'expired' }
async function abrirSesion(page: Page, o: SesOpts = {}) {
  const calls: string[] = []
  const gets: string[] = []
  const ses = S('s2', o.day ?? 17, '18:00', '19:30', 'Jiu-jitsu', { location: 'Tatami 2', capacity: 16, status: o.cancelled ? 'cancelled' : 'scheduled' })
  await page.clock.setFixedTime(new Date(`2026-11-17T${o.now ?? '18:30'}:00+01:00`))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  await page.route('**/api/**', (r) => {
    const req = r.request()
    const u = new URL(req.url()).pathname.replace(/^\/api/, '')
    if (req.method() !== 'GET') {
      calls.push(`${req.method()} ${u} ${req.postData() ?? ''}`)
      if (o.put === 'offline') return r.abort('internetdisconnected')
      if (u.endsWith('/close')) return r.fulfill({ json: { present: 3, absent: 3 } })
      if (u.endsWith('/correct') && o.correct === 'expired') return r.fulfill({ status: 403, json: { code: 'correction_window_expired' } })
      return r.fulfill({ json: { ok: true } })
    }
    gets.push(u)
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/professor/sessions/s2') return r.fulfill({ json: { session: ses } })
    if (u === '/sessions/s2/attendance') return r.fulfill({ json: { closed_at: o.closed ? at(17, '19:35') : null, correctable_until: o.until ?? null, students: o.rows ?? (o.closed ? CLOSED : ROWS) } })
    if (u === '/professor/sessions/s2/health') return r.fulfill({ json: { students: HEALTH } })
    return r.fulfill({ json: {} })
  })
  await page.goto('/professor/sessions/s2')
  await expect(page.getByRole('heading', { name: 'Jiu-jitsu', level: 1 })).toBeVisible()
  return { calls, gets }
}

const contador = (page: Page) => page.locator('p[aria-live]')
const sw = (page: Page, name: string) => page.getByRole('switch', { name: `Presente: ${name}` })

test('pasar lista en curso: hueco, contador único y la marca cambia el contador al momento', async ({ page }) => {
  const { calls } = await abrirSesion(page)
  await expect(page.getByText('Hoy · 18:00')).toBeVisible()
  await expect(page.getByText('En curso · pasa lista')).toHaveCount(0)
  await expect(contador(page)).toContainText('3 de 6 presentes')
  await expect(page.locator('main [aria-live]')).toHaveCount(1)
  const box = await sw(page, 'Sofía López').boundingBox()
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
  await sw(page, 'Sofía López').click()
  await expect(sw(page, 'Sofía López')).toBeChecked()
  await expect(contador(page)).toContainText('4 de 6 presentes')
  expect(calls).toEqual(['PUT /sessions/s2/attendance/st4 {"present":true}'])
  // El orden del HTML es el visual del móvil: «Cerrar lista» (abajo, fija) va después de la lista.
  const order = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[role=switch], button')].map((e) => e.getAttribute('aria-label') ?? e.textContent)
    return [els.indexOf('Presente: Valeria Gómez'), els.indexOf('Cerrar lista')]
  })
  expect(order[0]).toBeLessThan(order[1])
})

test('cerrar la lista: confirmación con los que pasan a falta', async ({ page }) => {
  const { calls } = await abrirSesion(page)
  await page.getByRole('button', { name: 'Cerrar lista' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText('Quien no esté marcado pasa a falta.')).toBeVisible()
  await expect(dialog.getByText('Sofía López')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cerrar lista' }).click()
  await expect.poll(() => calls).toContain('POST /sessions/s2/attendance/close ')
})

test('sin conexión al marcar: aviso, el interruptor vuelve y el contador también', async ({ page }) => {
  await abrirSesion(page, { put: 'offline' })
  await sw(page, 'Sofía López').click()
  await expect(page.getByText('Sin conexión: no se ha guardado. Vuelve a intentarlo.')).toBeVisible()
  await expect(sw(page, 'Sofía López')).not.toBeChecked()
  await expect(contador(page)).toContainText('3 de 6 presentes')
  // Quitar a quien llegó por check-in y fallar no le borra la insignia.
  await sw(page, 'Lucía Fernández').click()
  await expect(sw(page, 'Lucía Fernández')).toBeChecked()
  await expect(page.getByText('Llegó por check-in')).toBeVisible()
})

test('antes del inicio: aviso primero y solo lectura', async ({ page }) => {
  await abrirSesion(page, { now: '17:30' })
  await expect(page.getByRole('switch')).toHaveCount(0)
  const aviso = await page.getByText('La lista se abre a las 18:00').boundingBox()
  const lista = await page.getByText('6 reservas · 1 con check-in').boundingBox()
  expect(aviso!.y).toBeLessThan(lista!.y)
})

test('lista cerrada: corregir pide motivo y lo envía; caducado quita los «Corregir»', async ({ page }) => {
  const { calls } = await abrirSesion(page, { now: '19:45', closed: true, correct: 'expired' })
  await expect(page.getByText('Lista cerrada')).toBeVisible()
  await page.getByRole('button', { name: 'Corregir la asistencia de Mateo García' }).click()
  await page.getByRole('button', { name: 'Guardar corrección' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /motivo/i })).toBeVisible()
  expect(calls).toHaveLength(0)
  await page.getByLabel('Motivo (obligatorio)').fill('Se fue antes')
  await page.getByRole('button', { name: 'Guardar corrección' }).click()
  await expect.poll(() => calls).toEqual(['POST /sessions/s2/attendance/st2/correct {"status":"absent","reason":"Se fue antes"}'])
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await expect(page.getByText('Ya no se puede corregir. Pídelo a la academia.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Corregir la asistencia/ })).toHaveCount(0)
})

test('fichas de salud: solo se piden al tocar, sin edad; otro día no hay botón', async ({ page }) => {
  const { gets } = await abrirSesion(page)
  expect(gets.filter((u) => u.endsWith('/health'))).toHaveLength(0)
  await page.getByRole('button', { name: /Ver fichas de salud/ }).click()
  await expect(page.getByRole('heading', { name: 'Fichas de salud', level: 1 })).toBeVisible()
  await expect(page.getByText('Hombro derecho')).toBeVisible()
  expect(gets.filter((u) => u.endsWith('/health'))).toHaveLength(1)
  await expect(page.getByText(/edad|nacimiento|años/i)).toHaveCount(0)
  const call = await page.getByRole('link', { name: /Llamar al contacto/ }).first().boundingBox()
  expect(Math.round(call!.height)).toBeGreaterThanOrEqual(44)
})

test('sesión de otro día: sin fichas', async ({ page }) => {
  await abrirSesion(page, { day: 16, closed: true })
  await expect(page.getByText('Lista cerrada')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ver fichas de salud/ })).toHaveCount(0)
})

test('cancelada: sin lista y sin pedirla', async ({ page }) => {
  const { gets } = await abrirSesion(page, { cancelled: true })
  await expect(page.getByText('Sesión cancelada')).toBeVisible()
  expect(gets).not.toContain('/sessions/s2/attendance')
})

test('plazo de corrección conocido: hasta cuándo, y pasado el plazo sin «Corregir» desde el principio', async ({ page }) => {
  await abrirSesion(page, { now: '19:45', closed: true, until: at(19, '19:35') })
  await expect(page.getByText('Puedes corregir hasta el jueves, 19 de noviembre a las 19:35')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Corregir la asistencia/ })).toHaveCount(6)
})

test('plazo pasado: aviso y ningún «Corregir», sin intentar nada', async ({ page }) => {
  const { calls } = await abrirSesion(page, { now: '19:45', closed: true, until: at(17, '19:40') })
  await expect(page.getByText('Ya no se puede corregir. Pídelo a la academia.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Corregir la asistencia/ })).toHaveCount(0)
  await expect(page.getByText(/Puedes corregir hasta/)).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('fichas: el «atrás» del navegador vuelve a la lista; al recargar en ellas no se piden', async ({ page }) => {
  const { gets } = await abrirSesion(page)
  await page.getByRole('button', { name: /Ver fichas de salud/ }).click()
  await expect(page.getByRole('heading', { name: 'Fichas de salud', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Jiu-jitsu', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/professor\/sessions\/s2$/)
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Fichas de salud', level: 1 })).toBeVisible()
  const before = gets.filter((u) => u.endsWith('/health')).length
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Jiu-jitsu', level: 1 })).toBeVisible()
  expect(gets.filter((u) => u.endsWith('/health')).length).toBe(before)
  // El enlace de vuelta de las fichas también deshace la entrada del historial.
  await page.getByRole('button', { name: /Ver fichas de salud/ }).click()
  await page.getByRole('button', { name: /Jiu-jitsu · 18:00/ }).click()
  await expect(page.getByRole('heading', { name: 'Jiu-jitsu', level: 1 })).toBeVisible()
})
