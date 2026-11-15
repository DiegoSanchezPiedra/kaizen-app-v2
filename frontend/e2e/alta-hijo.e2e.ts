import { expect, test } from '@playwright/test'

// Sin el permiso de crear hijos (lo da el admin), el 403 se queda a la vista en el formulario, no solo en un toast que se va.
// Registra un adulto nuevo en cada pasada: no necesita ninguna cuenta preparada.
test('alta de hijo sin permiso muestra el error en el formulario', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL, 'Falta E2E_BASE_URL')
  const n = Date.now()

  await page.goto('/register')
  await page.getByLabel('Nombre y apellidos').fill(`E2E Sin Permiso ${n}`)
  await page.getByLabel('Email').fill(`e2e.sinpermiso.${n}@example.com`)
  await page.getByLabel('Contraseña', { exact: true }).fill('kaizen-e2e-1')
  await page.getByLabel('Fecha de nacimiento').pressSequentially('01011985')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page).not.toHaveURL(/\/register/)

  await page.goto('/account/children/new')
  await page.getByLabel('Nombre y apellidos').fill('Hijo E2E')
  await page.getByLabel('Fecha de nacimiento').pressSequentially('01012015')
  await page.getByRole('button', { name: 'Añadir' }).click()

  // En `main`: el toast va en un portal fuera de él.
  await expect(page.getByRole('main').getByText('Para añadir hijos, contacta con administración.')).toBeVisible()
  await expect(page).toHaveURL(/\/account\/children\/new$/)
})
