import { expect, test, type Page } from '@playwright/test'

// «Mi registro» (/clock) con la API simulada en el navegador (page.route): no escribe en la base de datos (los POST se simulan).
// Token falso con rol 'profesor'. Reloj fijo: martes 17-nov-2026 18:00 en Madrid, nunca la fecha del sistema. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'p-1', role: 'profesor', exp: 4102444800 })}.x`
const ME = { id: 'p-1', display_name: 'Kenji Sato', email: 'kenji@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role: 'profesor' }

const at = (day: number, hm: string) => new Date(`2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`).toISOString()
const E = (day: number, id: string, kind: string, hm: string, o: object = {}) => ({ id: `${day}-${id}`, kind, at: at(day, hm), origin: 'app', ...o })
const DAY = (day: number, events: object[], o: object = {}) => ({ date: `2026-11-${String(day).padStart(2, '0')}`, worked_seconds: 6.5 * 3600, pause_seconds: 1800, open: false, events, ...o })
const closed = (day: number) => DAY(day, [E(day, 'in', 'in', '09:00'), E(day, 'ps', 'pause_start', '13:00'), E(day, 'pe', 'pause_end', '13:30'), E(day, 'out', 'out', '16:00')])

type Month = { state: string; days: { events: object[] }[]; events?: object[]; corrections?: object[]; employment?: string }
const month = (m: Month) => ({
  profile: { id: 'p-1', display_name: 'Kenji Sato', employment: m.employment ?? 'employee' },
  month: '2026-11',
  state: m.state,
  total_seconds: 13 * 3600,
  days: m.days,
  events: m.events ?? m.days.flatMap((d) => d.events),
  corrections: m.corrections ?? [],
})
const OPEN_TODAY = month({ state: 'in', days: [closed(16), DAY(17, [E(17, 'in', 'in', '16:30')], { worked_seconds: 5400, pause_seconds: 0, open: true })] })

async function abrir(page: Page, o: { data?: object; fail?: boolean; post?: 'ok' | 'invalid' | 'offline' } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-17T18:00:00+01:00'))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), TOKEN)
  const posts: { path: string; body: unknown }[] = []
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    if (r.request().method() === 'POST') {
      posts.push({ path: u, body: r.request().postDataJSON() })
      if (o.post === 'offline') return r.abort('internetdisconnected')
      if (o.post === 'invalid') return r.fulfill({ status: 400, json: { code: 'invalid_field' } })
      return r.fulfill({ status: 201, json: { id: 'c-new', status: 'pending' } })
    }
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/me/clock') return o.fail ? r.fulfill({ status: 500, json: { code: 'internal' } }) : r.fulfill({ json: o.data ?? OPEN_TODAY })
    return r.fulfill({ json: {} })
  })
  await page.goto('/clock')
  await expect(page.getByRole('heading', { name: 'Mi registro', level: 1 })).toBeVisible()
  return posts
}

const resumen = (page: Page) => page.getByRole('region', { name: 'Resumen del mes' })

test('mes en curso con la jornada abierta: total y estado de hoy arriba, sin desplazar', async ({ page }) => {
  await abrir(page)
  await expect(resumen(page)).toContainText('13:00 h')
  await expect(resumen(page)).toContainText('Trabajando desde 16:30')
  await expect(page.getByRole('link', { name: 'Fichar en Sesiones' })).toHaveAttribute('href', '/professor')
  const box = (await resumen(page).boundingBox())!
  expect(box.y + box.height).toBeLessThan(812)
  // Hoy, «En curso» con texto (no solo color); un solo botón por fichaje.
  const hoy = page.getByRole('region', { name: 'Martes 17' })
  await expect(hoy.getByText('En curso')).toBeVisible()
  await expect(hoy.getByRole('button')).toHaveCount(1)
})

test('en pausa', async ({ page }) => {
  await abrir(page, { data: month({ state: 'paused', days: [DAY(17, [E(17, 'in', 'in', '16:30'), E(17, 'ps', 'pause_start', '17:45')], { open: true })] }) })
  await expect(resumen(page)).toContainText('En pausa')
  await expect(page.getByRole('region', { name: 'Martes 17' }).getByText('En pausa')).toBeVisible()
})

test('día pasado sin salida: lo dice y «Añadir la salida» abre la hoja con el día y el tipo puestos', async ({ page }) => {
  const posts = await abrir(page, { data: month({ state: 'in', days: [closed(13), DAY(16, [E(16, 'in', 'in', '09:00')], { worked_seconds: 0, pause_seconds: 0, open: true })] }) })
  await expect(resumen(page)).toContainText('Falta la salida del lunes 16')
  await page.getByRole('button', { name: 'Añadir la salida' }).click()
  await expect(page.getByRole('combobox', { name: 'Fichaje', exact: true })).toContainText('Salida')
  await expect(page.getByLabel('Día', { exact: true })).toHaveValue('2026-11-16')
  await page.getByLabel('Hora', { exact: true }).fill('17:00')
  await page.getByLabel('Motivo', { exact: true }).fill('Me fui sin fichar.')
  await page.getByRole('button', { name: 'Pedir corrección' }).click()
  await expect(page.getByText('Corrección pedida')).toBeVisible()
  expect(posts).toEqual([{ path: '/me/clock/corrections', body: { kind: 'out', at: at(16, '17:00'), reason: 'Me fui sin fichar.' } }])
})

test('Corregir → Cambiar la hora: envía event_id, at y motivo, y cierra la hoja', async ({ page }) => {
  const posts = await abrir(page)
  await page.getByRole('button', { name: 'Corregir entrada de las 09:00 del 16 nov', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Cambiar la hora' }).click()
  await expect(page.getByRole('dialog')).toContainText('Entrada de las 09:00 del 16 nov.')
  await page.getByLabel('Hora', { exact: true }).fill('08:45')
  await page.getByLabel('Motivo', { exact: true }).fill('Llegué antes.')
  await page.getByRole('button', { name: 'Pedir corrección' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(posts).toEqual([{ path: '/me/clock/corrections', body: { event_id: '16-in', at: at(16, '08:45'), reason: 'Llegué antes.' } }])
})

test('hora posterior a ahora: aviso junto al campo y no se puede enviar', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Añadir fichaje', exact: true }).click()
  await page.getByLabel('Hora', { exact: true }).fill('19:30')
  await page.getByLabel('Motivo', { exact: true }).fill('Prueba')
  await expect(page.getByText('La hora no puede ser posterior a ahora.')).toBeVisible()
  await expect(page.getByLabel('Hora', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Pedir corrección' })).toBeDisabled()
})

for (const [post, text] of [
  ['invalid', 'Revisa el día, la hora y el motivo.'],
  ['offline', 'Sin conexión. Conéctate y vuelve a intentarlo.'],
] as const) {
  test(`error al enviar (${post}): dentro de la hoja, que sigue abierta`, async ({ page }) => {
    await abrir(page, { post })
    await page.getByRole('button', { name: 'Corregir entrada de las 09:00 del 16 nov', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Anularlo' }).click()
    await page.getByLabel('Motivo', { exact: true }).fill('Fichaje doble.')
    await page.getByRole('button', { name: 'Pedir corrección' }).click()
    await expect(page.getByRole('dialog').getByText(text)).toBeVisible()
    await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('Fichaje doble.')
  })
}

test('correcciones arriba: estado con texto, fichaje corregido y motivo del rechazo', async ({ page }) => {
  const d16 = closed(16)
  const corrected = { ...d16, events: d16.events.map((e, i) => (i === 0 ? { ...e, corrected: true } : e)) }
  const original = { ...(d16.events[0] as object), at: at(16, '09:20') }
  const who = { id: 'p-1', display_name: 'Kenji Sato' }
  const C = (id: string, status: string, o: object) => ({ id, event_id: null, kind: 'in', at: at(5, '07:30'), reason: 'Motivo', created_at: at(5, '20:00'), requested_by: who, status, resolved_by: null, resolved_at: null, resolution_reason: null, ...o })
  await abrir(page, {
    data: month({
      state: 'out',
      days: [corrected],
      events: [original, ...d16.events.slice(1)],
      corrections: [
        C('a', 'applied', { event_id: '16-in', at: at(16, '09:00'), resolved_at: at(16, '12:00') }),
        C('r', 'rejected', { resolved_at: at(6, '10:00'), resolution_reason: 'Ese día abrió Laura.' }),
        C('p', 'pending', { event_id: '16-out', at: at(16, '17:00') }),
      ],
    }),
  })
  const sec = page.getByRole('region', { name: /^Correcciones/ })
  await expect(sec.getByRole('heading')).toHaveText('Correcciones · 1 pendiente')
  await expect(sec.getByRole('listitem').first()).toContainText('Pendiente')
  await expect(sec).toContainText('Aplicada')
  await expect(sec).toContainText('Motivo del rechazo: Ese día abrió Laura.')
  const dia = page.getByRole('region', { name: 'Lunes 16' })
  await expect(dia.getByText('Corregido', { exact: true })).toBeVisible()
  await expect(dia.getByText('Fichado a las 09:20')).toBeVisible()
  // La salida con una corrección pendiente no admite otra.
  await expect(dia.getByText('Corrección pendiente')).toBeVisible()
  await expect(dia.getByRole('button', { name: /^Corregir salida/ })).toHaveCount(0)
  // Correcciones antes que los días (orden del HTML = orden visual = Tab).
  expect((await sec.boundingBox())!.y).toBeLessThan((await dia.boundingBox())!.y)
})

test('autónomo: lo dice y no hay correcciones que pedir', async ({ page }) => {
  await abrir(page, { data: month({ state: 'out', days: [closed(16)], employment: 'self_employed' }) })
  await expect(page.getByText('Autónomo')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Corregir/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Añadir fichaje' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Imprimir' })).toBeVisible()
})

test('mes vacío', async ({ page }) => {
  await abrir(page, { data: month({ state: 'out', days: [] }) })
  await expect(page.getByText('Sin fichajes este mes')).toBeVisible()
  await expect(page.getByText('Ficha la entrada desde Sesiones.')).toBeVisible()
})

test('error al cargar: Reintentar', async ({ page }) => {
  await abrir(page, { fail: true })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible({ timeout: 5000 })
})

test('MonthNav: ?month, el siguiente no pasa del mes en curso y los objetivos miden 44 px', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled()
  await page.getByRole('button', { name: 'Mes anterior' }).click()
  await expect(page).toHaveURL(/month=2026-10/)
  await expect(page.getByText('Octubre de 2026')).toBeVisible()
  await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await expect(page).toHaveURL(/month=2026-11/)
  for (const el of [page.getByRole('button', { name: 'Mes anterior' }), page.getByRole('button', { name: /^Corregir/ }).first(), page.getByRole('button', { name: 'Añadir fichaje' }), page.getByRole('link', { name: 'Fichar en Sesiones' })]) {
    const box = (await el.boundingBox())!
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
  }
})
