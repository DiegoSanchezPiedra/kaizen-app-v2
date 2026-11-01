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

// B18.2. Los marcados «propuesto» salen del canvas (notas b182n7) y están pendientes de confirmar.
Object.assign(TEXTS, {
  not_covered: 'Tu cuota no incluye esta disciplina.',
  no_risk_cover: 'Necesitas el seguro o firmar la exención.',
  profile_incomplete: 'Completa el perfil para poder reservar.',
  session_not_bookable: 'Esta sesión ya no se puede reservar.', // propuesto
  outside_booking_window: 'Aún no se puede reservar esta sesión.',
  already_booked: 'Ya tienes esta sesión reservada.', // propuesto
  booking_overlap: 'Ya tienes otra reserva a esa hora.',
  session_started: 'La sesión ya ha empezado.', // propuesto
  booking_not_active: 'Esta reserva ya no está activa.', // propuesto
  booking_conflict_retry: 'Inténtalo de nuevo.',
  invalid_qr: 'El código ha caducado, vuelve a escanear.',
  no_candidates: 'No tienes ninguna reserva con el check-in abierto.',
  attendance_closed: 'La lista ya está cerrada; habla con el profesor.',
  profile_not_found: 'Este perfil no existe o no es público.',
  not_eligible: 'Tu perfil todavía no puede ser público.', // propuesto
  child_must_be_minor: 'Tiene que ser menor de edad. Un adulto se registra con su propia cuenta.', // propuesto
  child_not_found: 'No encontramos a esa persona.', // propuesto
  birth_date_already_set: 'La fecha de nacimiento ya estaba puesta.', // propuesto
  agreement_already_signed: 'Ya estaba firmado.', // propuesto
  invalid_version: 'Hay una versión nueva del documento. Léela y vuelve a firmar.', // propuesto
  not_allowed_to_sign: 'No puedes firmar este documento.', // propuesto
  no_current_document: 'La academia aún no ha publicado este documento.',
})

// B18.3. Los marcados «propuesto» salen del canvas (nota b183n6) y están pendientes de confirmar.
Object.assign(TEXTS, {
  portal_not_configured: 'Ahora no se pueden gestionar los pagos. Inténtalo más tarde.', // propuesto
  no_billing_account: 'Lo gestiona quien paga la cuota.',
  subscription_exists: 'Ya hay una cuota contratada.', // propuesto
  plan_minors_only: 'Este plan es solo para menores.', // propuesto
  plan_not_purchasable: 'Este plan ya no se puede contratar.', // propuesto
  plan_not_found: 'Este plan ya no se puede contratar.', // propuesto
  discipline_not_eligible: 'Esa disciplina no entra en este plan.', // propuesto
  risk_cover_required: 'Elige el seguro o firma la exención.', // propuesto
  payment_failed: 'El banco ha rechazado el pago. No ha cambiado nada.', // propuesto (el decline_message va en inglés)
  not_payer: 'Solo puede hacerlo quien paga la cuota.', // propuesto
  upgrade_pending: 'Hay otro cambio de plan a medias.', // propuesto
  period_ending_soon: 'La cuota se renueva en menos de 2 horas.', // propuesto
  same_plan: 'Ya tienes este plan.', // propuesto
  subscription_not_active: 'Ahora no se puede cambiar el plan.', // propuesto
  cancel_scheduled: 'La cuota termina: ya no se puede cambiar el plan.', // propuesto
  subscription_not_in_force: 'Ahora no se pueden cambiar las disciplinas.', // propuesto
  payer_change_pending: 'Con un cambio de pagador en marcha no se puede cambiar nada.', // propuesto
  discipline_change_limit: 'No te quedan cambios de disciplina en este periodo.', // propuesto
  discipline_not_chosen: 'Esa disciplina ya no está en la cuota.', // propuesto
  plan_all_disciplines: 'Este plan incluye todas las disciplinas.', // propuesto
  no_scheduled_change: 'Ya no hay ningún cambio programado.', // propuesto
  insurance_disabled: 'Ahora la academia no ofrece el seguro.',
  insurance_exists: 'Ya hay un seguro en vigor.', // propuesto
  subscription_required: 'Primero hace falta una cuota.', // propuesto
  not_a_student: 'Un tutor contrata la cuota de sus hijos, no la suya.', // propuesto
  not_new_payer: 'Este pago no es para ti.',
  payer_change_expired: 'Este enlace ha caducado.',
  payer_change_cancelled: 'Este cambio se ha anulado.',
  payer_change_paid: 'Este cambio ya está pagado.',
  payer_change_not_found: 'No lo encontramos.',
  stripe_unavailable: 'No se ha podido abrir la confirmación del banco. Inténtalo de nuevo.', // propuesto (no es de la API)
})

const FALLBACK = 'Algo ha fallado; inténtalo de nuevo.'

export function errorText(code: string | undefined): string {
  if (code === 'push_disabled') return ''
  return (code && TEXTS[code]) || FALLBACK
}
