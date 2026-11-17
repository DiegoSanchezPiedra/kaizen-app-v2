import { expect, test, type Page } from '@playwright/test'

// Ficha del hijo (/account/children/:id) con todo simulado (page.route): no escribe en la base de datos ni hace login.
// Solo necesita E2E_BASE_URL. Móvil 375 px.
test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Madrid', locale: 'es-ES' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', role: 'tutor', exp: 4102444800 })}.x`
const ME = { id: 'u-1', role: 'tutor', display_name: 'Ana Pérez', email: 'ana@example.invalid', username: null, birth_date: '1985-01-01', has_password: true, avatar: null, can_create_children: true, minor: null }

async function abrir(page: Page) {
  const lara = { id: 'c-lara', display_name: 'Lara Pérez', avatar: null, birth_date: '2014-03-02', pending_claim: false, access: { username: 'lara.perez', email: null, can_book: true }, can_publish: false, is_public: false, visible_fields: { photo: true }, social_links: null }
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token)
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()).pathname.replace(/^\/api/, '')
    if (r.request().method() === 'PATCH' && u === '/me/children/c-lara/profile') {
      Object.assign(lara, r.request().postDataJSON())
      return r.fulfill({ json: { is_public: lara.is_public, visible_fields: lara.visible_fields, social_links: null } })
    }
    if (r.request().method() !== 'GET') return r.fulfill({ json: {} })
    if (u === '/me') return r.fulfill({ json: ME })
    if (u === '/me/children') return r.fulfill({ json: { children: [lara] } })
    return r.fulfill({ json: {} })
  })
  await page.goto('/account/children/c-lara')
}

test('el título nombra al hijo y la ficha va en tres secciones', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Lara Pérez' })).toBeVisible()
  for (const s of ['Datos', 'Acceso propio', 'Perfil público']) await expect(page.getByRole('heading', { level: 2, name: s })).toBeVisible()
})

test('con el perfil apagado, lo que se ve está plegado y fuera del Tab; al encenderlo aparece', async ({ page }) => {
  await abrir(page)
  const foto = page.getByRole('switch', { name: 'Foto pública' })
  const pliegue = page.getByTestId('child-public-fields')
  const alto = async () => (await pliegue.boundingBox())?.height ?? 0
  // Plegado: alto 0 (lo recorta overflow-hidden, que Playwright no cuenta como oculto) e inert.
  await expect(pliegue).toHaveAttribute('inert', '')
  await expect.poll(alto).toBe(0)
  await page.getByRole('switch', { name: 'Visible para otros alumnos' }).click()
  await expect(pliegue).not.toHaveAttribute('inert')
  await expect.poll(alto).toBeGreaterThan(300)
  await expect(foto).toBeChecked() // conserva el valor que tenía
})

test('retirar el acceso pide confirmación', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Retirar el acceso' }).click()
  await expect(page.getByRole('alertdialog', { name: '¿Retirar el acceso?' })).toBeVisible()
})
