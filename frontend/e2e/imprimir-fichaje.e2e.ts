import { expect, test, type Page } from '@playwright/test'

// Hoja de jornada (/clock/print y /admin/clock/print) con la API simulada (page.route): no escribe en la base de datos.
// Tokens falsos de 'profesor' y 'admin'. Reloj fijo: martes 17-nov-2026 18:00 en Madrid. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (role: string) => `${b64({ alg: 'none' })}.${b64({ sub: 'p-1', role, exp: 4102444800 })}.x`
const me = (role: string) => ({ id: 'p-1', display_name: 'Kenji Sato', email: 'kenji@example.invalid', username: null, birth_date: null, has_password: true, avatar: null, can_create_children: false, minor: null, role })

const at = (day: number, hm: string) => new Date(`2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`).toISOString()
const E = (day: number, id: string, kind: string, hm: string, o: object = {}) => ({ id: `${day}-${id}`, kind, at: at(day, hm), origin: 'app', ...o })
const DAY = (day: number, events: object[], o: object = {}) => ({ date: `2026-11-${String(day).padStart(2, '0')}`, worked_seconds: 6.5 * 3600, pause_seconds: 1800, open: false, events, ...o })
const closed = (day: number, o: object = {}) => DAY(day, [E(day, 'in', 'in', '09:00', o), E(day, 'ps', 'pause_start', '13:00'), E(day, 'pe', 'pause_end', '13:30'), E(day, 'out', 'out', '16:00')])
const who = (name: string | null) => ({ id: name ? 'p-1' : 'a-1', display_name: name })

const month = (o: { open?: boolean; corrections?: object[]; employment?: string } = {}) => {
  const days = [closed(10, o.corrections ? { corrected: true } : {}), closed(16)]
  if (o.open) days.push(DAY(17, [E(17, 'in', 'in', '16:30')], { worked_seconds: 5400, pause_seconds: 0, open: true }))
  return {
    profile: { id: 'p-1', display_name: 'Kenji Sato', employment: o.employment ?? 'employee' },
    month: '2026-11',
    state: o.open ? 'in' : 'out',
    total_seconds: 13 * 3600,
    days,
    events: days.flatMap((d) => d.events),
    corrections: o.corrections ?? [],
  }
}
const CORRECTIONS = [
  { id: 'c1', event_id: '16-out', kind: 'out', at: at(16, '17:45'), reason: 'Me quedé a recoger.', created_at: at(16, '19:00'), requested_by: who('Kenji Sato'), status: 'pending', resolved_by: null, resolved_at: null, resolution_reason: null },
  { id: 'c2', event_id: '10-in', kind: 'in', at: at(10, '09:00'), reason: 'La tablet no leyó el QR.', created_at: at(10, '09:40'), requested_by: who('Kenji Sato'), status: 'applied', resolved_by: who(null), resolved_at: at(10, '12:00'), resolution_reason: null },
  { id: 'c3', event_id: null, kind: 'in', at: at(5, '07:30'), reason: 'Abrí yo.', created_at: at(5, '20:00'), requested_by: who('Kenji Sato'), status: 'rejected', resolved_by: who(null), resolved_at: at(6, '10:00'), resolution_reason: 'No consta en la alarma.' },
]

async function abrir(page: Page, data: object, o: { role?: 'profesor' | 'admin'; url?: string } = {}) {
  const role = o.role ?? 'profesor'
  await page.clock.setFixedTime(new Date('2026-11-17T18:00:00+01:00'))
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token(role))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    if (u === '/me') return r.fulfill({ json: me(role) })
    if (u === '/me/clock' || u === '/admin/clock') return r.fulfill({ json: data })
    return r.fulfill({ json: {} })
  })
  await page.goto(o.url ?? '/clock/print?month=2026-11')
  await expect(page.getByRole('heading', { name: 'Registro de jornada', level: 1 })).toBeVisible()
}

test('mes cerrado: cabecera con total, sin borrador, firmas; imprime y vuelve a Mi registro', async ({ page }) => {
  await abrir(page, month())
  const hoja = page.getByRole('article')
  await expect(hoja).toContainText('Kaizen · CIF')
  await expect(hoja).toContainText('Kenji Sato')
  await expect(hoja).toContainText('noviembre de 2026')
  await expect(hoja.locator('header')).toContainText('13:00 h')
  await expect(page.getByText(/Borrador/)).toHaveCount(0)
  await expect(page.getByText('Firma del trabajador')).toBeVisible()
  await expect(page.getByText('Firma de la empresa')).toBeVisible()
  // Cabe a lo ancho a 375 (antes la tabla se cortaba).
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => void (window as unknown as { printed: number }).printed++
  })
  const imprimir = page.getByRole('button', { name: 'Imprimir o guardar PDF' })
  expect(Math.round((await imprimir.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await imprimir.click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)

  await page.getByRole('link', { name: 'Mi registro' }).click()
  await expect(page).toHaveURL(/\/clock\?month=2026-11$/)
})

test('mes en curso con jornada abierta y correcciones: aviso, borrador en la hoja, «*» y estados en texto', async ({ page }) => {
  await abrir(page, month({ open: true, corrections: CORRECTIONS }))
  await expect(page.getByText(/El mes no está cerrado \(1 jornada abierta · 1 corrección pendiente\)/)).toBeVisible()
  await expect(page.getByRole('article')).toContainText('Borrador: mes sin cerrar a 17 nov 2026, 18:00')
  await expect(page.getByText('Jornada abierta', { exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toContainText('09:00*')
  await expect(page.getByText('* Hora corregida')).toBeVisible()
  const lista = page.getByRole('region', { name: 'Correcciones' }).getByRole('listitem')
  await expect(lista.nth(0)).toContainText('Pendiente')
  await expect(lista.nth(1)).toContainText('Aplicada')
  await expect(lista.nth(2)).toContainText('Rechazada')
  await expect(lista.nth(2)).toContainText('Motivo del rechazo: No consta en la alarma.')
})

test('autónomo: nota informativa y sin firmas', async ({ page }) => {
  await abrir(page, month({ employment: 'self_employed' }))
  await expect(page.getByText('Profesor autónomo: registro informativo')).toBeVisible()
  await expect(page.getByText('Firma del trabajador')).toHaveCount(0)
})

test('al imprimir en modo oscuro el texto sale negro y sin botones', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await abrir(page, month({ open: true }))
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  await expect(page.getByRole('button', { name: 'Imprimir o guardar PDF' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Mi registro' })).toBeHidden()
  const color = await page.getByRole('heading', { name: 'Registro de jornada' }).evaluate((e) => getComputedStyle(e).color)
  expect(color).toBe('rgb(0, 0, 0)')
})

test('hoja del admin: vuelve a la jornada del profesor, con margen y sin desbordar', async ({ page }) => {
  await abrir(page, month({ open: true, corrections: CORRECTIONS }), { role: 'admin', url: '/admin/clock/print?profile_id=p-1&month=2026-11' })
  const box = (await page.getByRole('link', { name: 'Jornada' }).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(16)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await expect(page.getByRole('link', { name: 'Jornada' })).toHaveAttribute('href', '/admin/clock?profile_id=p-1&month=2026-11')
})

// En la app instalada de iOS window.print() no hace nada: el botón genera el PDF (jsPDF) y abre Compartir.
for (const fallo of ['ninguno', 'cancelado', 'error'] as const) {
  test(`app instalada de iOS: comparte el PDF de la hoja (Compartir: ${fallo})`, async ({ page }) => {
    await page.addInitScript((fallo) => {
      const w = window as unknown as { shared: File[]; printed: number }
      w.shared = []
      w.printed = 0
      Object.defineProperty(navigator, 'standalone', { value: true })
      Object.defineProperty(navigator, 'share', {
        value: async (d: { files: File[] }) => {
          w.shared.push(...d.files)
          if (fallo === 'cancelado') throw new DOMException('cancelado', 'AbortError')
          if (fallo === 'error') throw new DOMException('no', 'NotAllowedError')
        },
      })
      window.print = () => void w.printed++
    }, fallo)
    await abrir(page, month({ open: true, corrections: CORRECTIONS }))
    const imprimir = page.getByRole('button', { name: 'Imprimir o guardar PDF' })
    await expect(imprimir).not.toHaveAttribute('data-loading')
    await imprimir.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: File[] }).shared.length)).toBe(1)
    const shared = await page.evaluate(async () => {
      const w = window as unknown as { shared: File[]; printed: number }
      const f = w.shared[0]
      return { printed: w.printed, name: f.name, type: f.type, head: await f.slice(0, 5).text() }
    })
    expect(shared).toEqual({ printed: 0, name: 'registro-jornada-2026-11.pdf', type: 'application/pdf', head: '%PDF-' })
    const aviso = page.getByRole('alert').filter({ hasText: 'No se ha podido abrir Compartir' })
    if (fallo === 'error') await expect(aviso).toBeVisible()
    else await expect(aviso).toHaveCount(0)
  })
}
