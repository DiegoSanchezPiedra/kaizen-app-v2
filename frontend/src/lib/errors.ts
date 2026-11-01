// Texto de la UI por `code` (docs/pantallas-b18.md § Mapa de errores). El `message` de la API nunca se enseña.
// Los marcados «propuesto» no tienen texto en el documento: pendientes de confirmar.
const TEXTS: Record<string, string> = {
  // genéricos
  invalid_payload: 'Revisa los datos.',
  invalid_field: 'Revisa los datos.',
  invalid_field_type: 'Revisa los datos.',
  no_fields: 'Revisa los datos.',
  invalid_id: 'No lo encontramos.',
  not_found: 'No lo encontramos.',
  session_not_found: 'No lo encontramos.',
  booking_not_found: 'No lo encontramos.',
  not_allowed: 'No tienes acceso a esto.',
  not_guardian: 'No tienes acceso a esto.',
  forbidden: 'No tienes acceso a esto.',
  invalid_range: 'Revisa las fechas.',
  invalid_pagination: 'Revisa las fechas.',
  network: 'Sin conexión. Conéctate y vuelve a intentarlo.',
  // sesión
  invalid_credentials: 'El email o la contraseña no son correctos.', // propuesto
  invalid_google_token: 'No hemos podido entrar con Google. Inténtalo de nuevo.', // propuesto
  link_required: 'Ya hay una cuenta con ese email: entra con tu contraseña.',
  invalid_mfa_code: 'El código no es correcto. Escribe el que se ve ahora en la app.', // propuesto
  invalid_mfa_token: 'El código ha caducado, vuelve a entrar.',
  email_taken: 'Ya hay una cuenta con este email.', // propuesto
  weak_password: 'Usa al menos 8 caracteres.', // propuesto (el backend pide ≥ 8)
  invalid_birth_date: 'Revisa la fecha de nacimiento.', // propuesto
  minor_cannot_register: 'Un menor lo da de alta su padre, madre o tutor.',
  invalid_reset_token: 'El enlace ha caducado o ya se ha usado. Pide otro.',
}

const FALLBACK = 'Algo ha fallado; inténtalo de nuevo.'

export function errorText(code: string | undefined): string {
  if (code === 'push_disabled') return ''
  return (code && TEXTS[code]) || FALLBACK
}
