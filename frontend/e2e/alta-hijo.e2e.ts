import { expect, test } from '@playwright/test'

// Sin el permiso de crear hijos (lo da el admin), el 403 se queda a la vista en el formulario, no solo en un toast que se va.
// Registra un adulto nuevo por la API en cada pasada (sin /register en la app, ADR 0032): solo donde el registro esté abierto
// (desarrollo; en staging está cerrado y se salta).
test('alta de hijo sin permiso muestra el error en el formulario', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
  const n = Date.now()

  const res = await page.request.post('/api/auth/register', {
    data: { email: `e2e.sinpermiso.${n}@example.com`, password: 'kaizen-e2e-1', displayName: `E2E Sin Permiso ${n}`, birthDate: '1985-01-01' },
  })
  test.skip(res.status() === 403, 'registro cerrado en este entorno')
  const { token } = await res.json()
  await page.addInitScript((t) => localStorage.setItem('kz.token', t), token)

  await page.goto('/account/children/new')
  await page.getByLabel('Nombre y apellidos').fill('Hijo E2E')
  await page.getByLabel('Fecha de nacimiento').pressSequentially('01012015')
  await page.getByRole('button', { name: 'Añadir' }).click()

  // En `main`: el toast va en un portal fuera de él.
  await expect(page.getByRole('main').getByText('Para añadir hijos, contacta con administración.')).toBeVisible()
  await expect(page).toHaveURL(/\/account\/children\/new$/)
})
