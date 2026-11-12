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
  invalid_credentials: 'El email, el usuario o la contraseña no son correctos.', // propuesto
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
  not_eligible: 'Este perfil todavía no puede ser público.', // propuesto
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
  age_out_of_range: 'No tiene la edad de esta disciplina el día de la sesión.',
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
  subscription_required: 'Primero hace falta una cuota.', // propuesto
  not_a_student: 'Un tutor contrata la cuota de sus hijos, no la suya.', // propuesto
  not_new_payer: 'Este pago no es para ti.',
  payer_change_expired: 'Este enlace ha caducado.',
  payer_change_cancelled: 'Este cambio se ha anulado.',
  payer_change_paid: 'Este cambio ya está pagado.',
  payer_change_not_found: 'No lo encontramos.',
  stripe_unavailable: 'No se ha podido abrir la confirmación del banco. Inténtalo de nuevo.', // propuesto (no es de la API)
})

// B18.4. Los marcados «propuesto» salen del canvas (nota b184n6) y están pendientes de confirmar.
Object.assign(TEXTS, {
  session_not_started: 'La lista aún no se ha abierto.', // propuesto (en pantalla: «La lista se abre a las HH:MM»)
  session_cancelled: 'Sesión cancelada.', // propuesto
  no_active_booking: 'Esa reserva ya no está activa. Hemos actualizado la lista.', // propuesto
  attendance_not_closed: 'La lista aún no está cerrada.', // propuesto
  no_change: 'No había nada que cambiar: ya estaba así.', // propuesto
  reason_required: 'Escribe el motivo.', // propuesto
  correction_window_expired: 'Ya no se puede corregir. Pídelo a la academia.',
})

const FALLBACK = 'Algo ha fallado; inténtalo de nuevo.'

// `{clave}` del texto se rellena con `details[clave]`; sin el dato, se quita (« ({per_year})» → «»).
export function errorText(code: string | undefined, details: Record<string, unknown> = {}): string {
  if (code === 'push_disabled') return ''
  const text = (code && TEXTS[code]) || FALLBACK
  return text.replace(/ ?\(\{(\w+)\}\)/g, (_, k: string) => (details[k] === undefined ? '' : ` (${String(details[k])})`))
}

// B18.5. Propuesto en el canvas (nota b185n4), pendiente de confirmar.
Object.assign(TEXTS, {
  invalid_link_code: 'Este código no vale: ha caducado o ya se ha usado. Pide uno nuevo a la academia.', // propuesto
})

// B19 (docs/pantallas-b19.md § Mapa de errores nuevos).
Object.assign(TEXTS, {
  insufficient_role: 'No tienes acceso a esto.',
  invalid_totp: 'El código no es correcto; revisa la hora del móvil.',
  same_role: 'Ya tiene ese rol.',
  admin_role_locked: 'El rol de administración no se quita desde la app.',
  mfa_required: 'Para dar el rol de administración, activa antes el doble factor en tu cuenta.',
  mfa_login_required: 'Para dar el rol de administración, sal y vuelve a entrar con el código del doble factor.',
  child_role_locked: 'Un hijo siempre es alumno.',
  trainer_has_sessions: 'Antes, reasigna o retira sus clases y sesiones futuras.',
  student_has_subscription: 'Tiene una cuota viva; dala de baja antes.',
  not_a_child: 'Solo se vincula un adulto con acceso propio a un menor.',
  invalid_guardian: 'Solo se vincula un adulto con acceso propio a un menor.',
  already_guardian: 'Ya es su tutor.',
  last_guardian: 'Un hijo siempre tiene al menos un tutor.',
  guardian_is_payer: 'Paga su cuota: cambia antes el pagador.',
  requires_payer_action: 'El pagador recibirá un email para autorizar el pago.',
  // Los del admin sobre la cuota que la UI de B18 no tenía (propuestos: no están en el mapa de B19).
  same_payer: 'Ya paga esa persona.', // propuesto
  invalid_payer: 'Esa persona no puede pagar esta cuota.', // propuesto
  no_payer_change: 'Ya no hay ningún cambio de pagador.', // propuesto
  subscription_cancelled: 'La cuota ya está dada de baja.', // propuesto
})

// B19.5 (docs/pantallas-b19.md § Horario). Los marcados «propuesto» no tienen texto en el documento.
Object.assign(TEXTS, {
  capacity_below_bookings: 'Hay más reservas que ese aforo.',
  trainer_overlap: 'Ese profesor ya tiene otra sesión a esa hora.',
  session_not_adjustable: 'La sesión está cancelada o ya ha empezado: no se puede ajustar.', // propuesto
  session_not_cancelled: 'La sesión no está cancelada.', // propuesto
  slot_passed: 'La hora que le toca según su clase ya ha pasado.', // propuesto
  loose_session: 'Una sesión suelta no tiene clase a la que volver.', // propuesto
  class_retired: 'Su clase está retirada en esa fecha: crea una sesión suelta.', // propuesto
  already_retired: 'La clase ya termina antes de esa fecha.', // propuesto
  discipline_inactive: 'Esa disciplina está desactivada.', // propuesto
  class_not_found: 'No lo encontramos.',
})

// B19.6 (docs/pantallas-b19.md § Mapa de errores). Los marcados «propuesto» no tienen texto en el documento; salen de
// src/services/catalog.js, agreements.js, checkin.js y billing.js.
Object.assign(TEXTS, {
  duplicate_document: 'Ese PDF ya está subido.',
  version_exists_different_content: 'Esa versión ya existe con otro PDF; usa otra versión.',
  document_not_found: 'No encontramos ese documento.', // propuesto
  already_published: 'Ese documento ya está publicado o retirado.', // propuesto
  invalid_type: 'Elige el tipo de documento.', // propuesto
  invalid_file: 'El archivo no es un PDF válido.', // propuesto
  tablet_not_found: 'No encontramos esa tablet.', // propuesto
  discipline_not_found: 'No encontramos esa disciplina.', // propuesto
  discipline_in_use: 'Hay cuotas que la tienen elegida: no puede ser abierta.', // propuesto
  name_taken: 'Ya hay uno con ese nombre.', // propuesto
  theme_taken: 'Esa temática ya la tiene otra disciplina activa: elige otra o «Kaizen».',
  plan_has_subscriptions: 'El plan tiene suscriptores: no cambia de disciplinas ni de edad, ni baja a 0 €. Crea otro plan.', // propuesto
  eligible_too_few: 'Hacen falta al menos tantas disciplinas elegibles como incluye el plan.', // propuesto
  unknown_discipline: 'Alguna de las disciplinas ya no existe.', // propuesto
  empty_patch: 'No hay nada que cambiar.', // propuesto
})

// B20 (rate limiting): 429 en el login, el MFA, recuperar contraseña y vincular la tablet.
Object.assign(TEXTS, {
  too_many_requests: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  rate_limited: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.', // propuesto
})

// B21.1 (docs/api.md § Eventos). Los marcados «propuesto» no tienen texto en el documento.
Object.assign(TEXTS, {
  event_not_found: 'No lo encontramos.', // un evento o, en el registro de jornada, un fichaje
  registration_not_found: 'No encontramos esta inscripción.', // propuesto
  event_cancelled: 'El evento está cancelado.', // propuesto
  event_full: 'El evento está completo.', // propuesto
  already_registered: 'Ya está inscrito en este evento.', // propuesto
  audience_mismatch: 'Este evento no es para su edad.', // propuesto
  registration_closed: 'Las inscripciones de este evento ya están cerradas.', // propuesto
  capacity_below_registrations: 'Hay más inscripciones que ese aforo.', // propuesto
  event_not_started: 'La lista se abre cuando empieza el evento.', // propuesto
  event_started: 'El evento ya ha empezado.', // propuesto
  already_cancelled: 'Ya estaba cancelada y no hay nada pagado que devolver.', // propuesto
  paid_registration: 'Está pagada: para cancelarla, pídelo a la academia.', // propuesto (B21.2: el panel nunca llega a este código)
})

// B24 (foto de perfil y cambio de contraseña).
Object.assign(TEXTS, {
  invalid_image: 'No hemos podido usar esa foto. Prueba con otra.',
  too_large: 'La foto pesa demasiado. Prueba con otra.',
  wrong_password: 'La contraseña actual no es correcta.',
  no_password: 'Tu cuenta no tiene contraseña: créala con el email que te enviamos.',
})

// B31 (docs/api.md § Registro de jornada). Todos propuestos: el documento no les da texto.
Object.assign(TEXTS, {
  not_employee: 'Solo los profesores empleados fichan y piden correcciones.', // propuesto
  invalid_sequence: 'Ese fichaje no encaja con el anterior. Actualiza la pantalla y revisa el orden.', // propuesto
  already_resolved: 'Esa corrección ya estaba resuelta.', // propuesto
  correction_not_found: 'No encontramos esa corrección.', // propuesto
  not_professor: 'Esta persona no es profesora.', // propuesto
})

// B30 (docs/api.md § Pausa). Todos propuestos: el documento aún no les da texto. «Cuota de mantenimiento», nunca «cuota» a secas.
Object.assign(TEXTS, {
  paused: 'No se puede durante la pausa de la membresía.', // propuesto (reservar, 403; cambiar plan, disciplina o pagador, 409)
  pause_not_configured: 'La academia no ofrece pausas ahora.', // propuesto
  change_scheduled: 'Ya hay un cambio programado: una bajada de plan o una pausa.', // propuesto
  pause_year_limit: 'Ya se ha usado el máximo de pausas de este año ({per_year}).', // propuesto
  pause_ending: 'La pausa ya termina en la siguiente fecha de cobro.', // propuesto
  no_pause: 'Ya no hay ninguna pausa que anular.', // propuesto
  subscription_not_found: 'No hay una cuota en vigor.', // propuesto
  pause_not_found: 'No encontramos esa pausa.', // propuesto
  pause_not_live: 'Esa pausa ya ha terminado o se anuló.', // propuesto
  pause_exempt: 'Esa pausa ya está sin cuota de mantenimiento.', // propuesto
  pause_nothing_to_exempt: 'No queda ninguna cuota de mantenimiento por cobrar en esa pausa.', // propuesto
})

// B32 (docs/api.md § Acceso propio del menor). Todos propuestos: el documento no les da texto. Los que habla de «él o ella» los
// ve el tutor; `minor_restricted` y `session_revoked` los ve el menor.
Object.assign(TEXTS, {
  invalid_username: 'El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.', // propuesto
  email_requires_14: 'Aún no tiene la edad para tener email propio.', // propuesto
  access_exists: 'Ya tiene acceso propio.', // propuesto
  username_taken: 'Ese usuario ya está en uso. Prueba con otro.', // propuesto
  access_not_found: 'No tiene acceso propio.', // propuesto
  email_already_set: 'Ya tienes un email en tu cuenta.', // propuesto
  minor_restricted: 'Esto lo hace tu tutor.', // propuesto
  session_revoked: 'Tu acceso ha cambiado; vuelve a entrar.', // propuesto
})
