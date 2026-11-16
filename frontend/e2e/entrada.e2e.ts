import { expect, test, type Page } from '@playwright/test'

// Pantallas de entrada (/login …) sin sesión. Las respuestas de la API se simulan con page.route: no escribe nada
// en la base de datos. Necesita solo E2E_BASE_URL. Por defecto, iPhone 13 (puntero táctil); el escritorio se fuerza aparte.

const PANTALLAS = ['/login', '/register', '/forgot-password', '/reset-password?token=abc']

async function credencialesErroneas(page: Page) {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials' }) }),
  )
}

test.describe('móvil 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('las cuatro pantallas comparten una sola altura de cabecera', async ({ page }) => {
    for (const ruta of PANTALLAS) {
      await page.goto(ruta)
      const aside = await page.locator('aside').boundingBox()
      expect(aside?.height, ruta).toBe(136)
    }
  })

  test('el login cabe sin scroll y los controles miden al menos 44 px', async ({ page }) => {
    await page.goto('/login')
    const crear = page.getByRole('link', { name: 'Crear cuenta' })
    const box = (await crear.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    for (const el of [
      page.getByRole('button', { name: 'Entrar' }),
      page.getByRole('link', { name: '¿Has olvidado tu contraseña?' }),
      crear,
    ]) {
      const b = (await el.boundingBox())!
      expect(Math.round(b.height), await el.innerText().catch(() => '')).toBeGreaterThanOrEqual(44)
    }
    // El ojo mide 32 px a la vista; su zona de toque de 44 px es un pseudoelemento (after:-inset-1.5): se prueba tocando.
    const ojo = (await page.getByRole('button', { name: 'Mostrar contraseña' }).boundingBox())!
    const cx = ojo.x + ojo.width / 2
    const cy = ojo.y + ojo.height / 2
    for (const dy of [-21, 21]) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), [cx, cy + dy])
      expect(hit, `toque a ${dy}px del centro`).toBe('Mostrar contraseña')
    }
  })

  test('teclado: email o usuario con inputmode=email, sin foco inicial en táctil', async ({ page }) => {
    await page.goto('/login')
    const id = page.getByLabel('Email o usuario')
    await expect(id).toHaveAttribute('inputmode', 'email')
    await expect(id).toHaveAttribute('autocomplete', 'username')
    await expect(id).not.toHaveAttribute('type', 'email') // admite usuarios sin @
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
    await expect(id).not.toBeFocused()
  })

  test('credenciales erróneas: los dos campos inválidos y enlazados al aviso, con el texto de siempre', async ({ page }) => {
    await credencialesErroneas(page)
    await page.goto('/login')
    await page.getByLabel('Email o usuario').fill('alguien@example.com')
    await page.getByLabel('Contraseña', { exact: true }).fill('mal-pass-1')
    await page.getByRole('button', { name: 'Entrar' }).click()
    const aviso = page.getByRole('alert')
    await expect(aviso).toContainText('El email, el usuario o la contraseña no son correctos')
    await expect(aviso).toContainText('Revísalos e inténtalo de nuevo.')
    const id = await aviso.getAttribute('id')
    expect(id).toBeTruthy()
    for (const campo of [page.getByLabel('Email o usuario'), page.getByLabel('Contraseña', { exact: true })]) {
      await expect(campo).toHaveAttribute('aria-invalid', 'true')
      expect(await campo.getAttribute('aria-describedby')).toContain(id!)
    }
    // Escribir limpia el estado inválido.
    await page.getByLabel('Email o usuario').fill('otro@example.com')
    await expect(page.getByLabel('Email o usuario')).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('la entrada escalonada solo se juega en la primera pantalla de la sesión', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('main .auth-rise')).toHaveCount(1)
    await page.getByRole('link', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(/\/register/)
    await expect(page.locator('main .auth-rise')).toHaveCount(0)
  })

  test('con movimiento reducido no hay animación de entrada', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/login')
    const nombre = await page.locator('.auth-rise > *').first().evaluate((el) => getComputedStyle(el).animationName)
    expect(nombre).toBe('none')
  })
})

test.describe('escritorio 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })

  test('foco inicial en el campo y panel de marca visible', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email o usuario')).toBeFocused()
    await expect(page.getByText('Disciplina, fuerza y evolución.')).toBeVisible()
  })
})
