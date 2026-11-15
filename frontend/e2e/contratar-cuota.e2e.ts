import { expect, test } from '@playwright/test'

// Bug: al contratar la cuota de un hijo, «Completar perfil» llevaba siempre a la ficha de salud,
// también cuando ya solo faltaba firmar. Cubre los tres casos en orden con un hijo recién creado:
// nada hecho → ficha; ficha hecha y acuerdos pendientes → firmar; todo hecho → contratar sin pasos.
test('contratar cuota de un hijo lleva al siguiente paso pendiente', async ({ page }) => {
  const { E2E_EMAIL, E2E_PASSWORD } = process.env
  test.skip(!process.env.E2E_BASE_URL || !E2E_EMAIL || !E2E_PASSWORD, 'Faltan E2E_BASE_URL, E2E_EMAIL o E2E_PASSWORD')
  const child = `E2E Hijo ${Date.now()}`

  await page.goto('/login')
  await page.getByLabel('Email o usuario').fill(E2E_EMAIL!)
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).not.toHaveURL(/\/login/)

  // Precondición: el perfil propio completo, que el pago por un hijo también exige. Si ya lo está, no hace nada.
  await page.goto('/onboarding')
  const firmar = page.getByRole('button', { name: /^Firmar/ })
  const guardar = page.getByRole('button', { name: 'Guardar ficha' })
  await expect(page.getByText(/Ir al inicio|Paso \d de \d/).first()).toBeVisible()
  if (await guardar.isVisible()) {
    await page.getByLabel('Nombre').last().fill('Contacto E2E')
    await page.getByLabel('Teléfono').fill('600111222')
    await guardar.click()
  }
  await expect(page.getByText(/Ir al inicio|Acuerdos: ahora/).first()).toBeVisible()
  await signAll()

  await page.goto('/account/children/new')
  await page.getByLabel('Nombre y apellidos').fill(child)
  await page.getByLabel('Fecha de nacimiento').pressSequentially('01012015')
  await page.getByRole('button', { name: 'Añadir' }).click()
  await expect(page).toHaveURL(/\/account\/children$/)

  await page.goto('/billing/contract')
  await page.getByRole('combobox', { name: 'Para' }).click()
  await page.getByRole('option', { name: child }).click()
  const completar = page.getByRole('link', { name: 'Completar perfil' })

  // 1. Nada hecho: primero la ficha de salud.
  await completar.click()
  await expect(page).toHaveURL(/\/account\/health\?para=/)
  await page.getByLabel('Nombre').last().fill('Contacto E2E')
  await page.getByLabel('Teléfono').fill('600111222')
  await page.getByRole('button', { name: 'Guardar ficha' }).click()

  // 2. Ficha hecha, acuerdos pendientes: a firmar, no otra vez a la ficha.
  await expect(page).toHaveURL(/\/billing\/contract/)
  await expect(page.getByText('Falta la protección de datos y los derechos de imagen.')).toBeVisible()
  await completar.click()
  await expect(page).toHaveURL(/\/agreements\?para=/)
  await expect(firmar.first()).toBeVisible()
  await signAll()

  // 3. Todo hecho: la contratación sigue sin pasos intermedios.
  await page.goBack()
  await expect(page).toHaveURL(/\/billing\/contract/)
  await expect(page.getByRole('radiogroup', { name: 'Plan' })).toBeVisible()
  await expect(page.getByText(/Antes de pagar hay que completar/)).toHaveCount(0)

  // Firma todo lo pendiente en pantalla, uno a uno.
  async function signAll() {
    while ((await firmar.count()) > 0) {
      const n = await firmar.count()
      await page.getByRole('checkbox', { name: /He leído y acepto/ }).first().check()
      await firmar.first().click()
      await expect(firmar).toHaveCount(n - 1)
    }
  }
})
