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

// /register: nunca se envía el formulario real; POST /auth/register siempre se simula.
async function simularRegistro(page: Page, status: number, body: object, onRequest?: (data: unknown) => void) {
  await page.route('**/api/auth/register', (route) => {
    onRequest?.(route.request().postDataJSON())
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function rellenarRegistro(page: Page) {
  await page.getByLabel('Nombre y apellidos').fill('Ana Pérez Ruiz')
  await page.getByLabel('Email').fill('ana@example.com')
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-segura-1')
  await page.getByLabel('Fecha de nacimiento').pressSequentially('01011990') // la máscara pone las barras
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
}

test.describe('register móvil 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('teclado: atributos correctos, sin foco inicial en táctil y sin icono de calendario', async ({ page }) => {
    await page.goto('/register')
    const email = page.getByLabel('Email')
    await expect(email).toHaveAttribute('type', 'email')
    await expect(email).toHaveAttribute('inputmode', 'email')
    await expect(email).toHaveAttribute('autocapitalize', 'none')
    await expect(page.getByLabel('Nombre y apellidos')).toHaveAttribute('autocapitalize', 'words')
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    const fecha = page.getByLabel('Fecha de nacimiento')
    await expect(fecha).toHaveAttribute('inputmode', 'numeric')
    await expect(fecha).toHaveAttribute('autocomplete', 'bday')
    await expect(fecha).toHaveAttribute('enterkeyhint', 'go')
    await expect(page.getByLabel('Nombre y apellidos')).not.toBeFocused()
    // El grupo de la contraseña lleva el ojo; el de la fecha ya no lleva calendario.
    await expect(page.locator('[data-slot=input-group]').filter({ has: fecha }).locator('svg')).toHaveCount(0)
  })

  test('el marcador de la fecha llega a 4,5:1: usa el mismo color que el texto apagado', async ({ page }) => {
    await page.goto('/register')
    const marcador = await page.getByLabel('Fecha de nacimiento').evaluate((el) => getComputedStyle(el, '::placeholder').color)
    const apagado = await page.locator('main p').first().evaluate((el) => getComputedStyle(el).color)
    expect(marcador).toBe(apagado)
  })

  test('envía el formulario con la fecha en ISO (respuesta simulada)', async ({ page }) => {
    let cuerpo: unknown
    await simularRegistro(page, 500, { code: 'unknown' }, (d) => (cuerpo = d))
    await page.goto('/register')
    await rellenarRegistro(page)
    await expect(page.getByRole('alert')).toBeVisible()
    expect(cuerpo).toEqual({ displayName: 'Ana Pérez Ruiz', email: 'ana@example.com', password: 'clave-segura-1', birthDate: '1990-01-01' })
  })

  test('email ya registrado: campo inválido con el foco, el texto de siempre y enlace a Entrar', async ({ page }) => {
    await simularRegistro(page, 409, { code: 'email_taken' })
    await page.goto('/register')
    await rellenarRegistro(page)
    const email = page.getByLabel('Email')
    await expect(page.getByText('Ya hay una cuenta con este email.')).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(email).toBeFocused()
    await expect(page.getByRole('link', { name: 'Entrar' }).first()).toBeVisible()
  })

  test('contraseña débil y fecha no válida: el foco va al campo señalado', async ({ page }) => {
    for (const [code, etiqueta, exact] of [
      ['weak_password', 'Contraseña', true],
      ['invalid_birth_date', 'Fecha de nacimiento', false],
    ] as const) {
      await page.unrouteAll()
      await simularRegistro(page, 422, { code })
      await page.goto('/register')
      await rellenarRegistro(page)
      const campo = page.getByLabel(etiqueta, { exact })
      await expect(campo, code).toBeFocused()
      await expect(campo, code).toHaveAttribute('aria-invalid', 'true')
    }
  })

  test('menor: el aviso conserva su texto y la fecha queda inválida y enlazada a él', async ({ page }) => {
    await simularRegistro(page, 403, { code: 'minor_cannot_register' })
    await page.goto('/register')
    await rellenarRegistro(page)
    const aviso = page.locator('#register-notice')
    await expect(aviso).toContainText('Un menor lo da de alta su padre, madre o tutor')
    await expect(aviso).toContainText('Si lo eres, crea tu cuenta y añade después a tu hijo o hija.')
    const fecha = page.getByLabel('Fecha de nacimiento')
    await expect(fecha).toHaveAttribute('aria-invalid', 'true')
    expect(await fecha.getAttribute('aria-describedby')).toContain('register-notice')
    await fecha.fill('01/01/199') // corregir la fecha quita el estado inválido
    await expect(fecha).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('sin conexión: aviso general y sin error de campo', async ({ page }) => {
    await page.route('**/api/auth/register', (route) => route.abort('failed'))
    await page.goto('/register')
    await rellenarRegistro(page)
    await expect(page.getByRole('status')).toBeVisible()
    await expect(page.locator('[aria-invalid=true]')).toHaveCount(0)
  })

  test('todo se alcanza con scroll y los enlaces miden 44 px', async ({ page }) => {
    await page.goto('/register')
    const entrar = page.getByRole('link', { name: 'Entrar' })
    await entrar.scrollIntoViewIfNeeded()
    expect(Math.round((await entrar.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
    expect(Math.round((await page.getByRole('button', { name: 'Crear cuenta' }).boundingBox())!.height)).toBeGreaterThanOrEqual(44)
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
