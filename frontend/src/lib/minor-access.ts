// Texto informativo del acceso propio de un menor (ADR 0026). El tutor lo lee y lo acepta antes de activarlo; la API
// guarda quién lo aceptó, cuándo, desde qué IP y esta versión (`notice_version`).
// TEXTO PROPUESTO: validar con el abogado. Si cambia el texto, sube la versión (y el backend, que hoy solo admite '1.0').
export const ACCESS_NOTICE_VERSION = '1.0'

export const ACCESS_NOTICE = {
  intro: 'Vas a darle un usuario y una contraseña para que entre en la app de Kaizen con su propia cuenta. Lee esto antes de activarlo.',
  can: {
    title: 'Qué podrá hacer',
    items: [
      'Ver el calendario y su progreso: racha y medallas.',
      'Reservar y cancelar sesiones y apuntarse a eventos gratuitos, solo si tú le dejas.',
      'Hacer el check-in al llegar a clase.',
      'Cambiar su foto y ver la comunidad.',
    ],
  },
  cannot: {
    title: 'Qué no podrá hacer',
    items: ['Pagos y cuota, ni pausarla.', 'Firmar documentos.', 'Ver ni cambiar su ficha de salud.', 'Cambiar su nombre ni ver a sus tutores.'],
  },
  rest: [
    'El perfil público, la foto pública y los rankings están desactivados por defecto. Los decides tú hasta que tenga la edad de decidirlo; después, también puede decidirlos él o ella desde su cuenta.',
    'Solo recibirá avisos de reservas, sesiones y eventos, y esos avisos también te llegan a ti. En la app no hay mensajería privada.',
    'Puedes retirarle el acceso, cambiarle la contraseña o quitarle el permiso de reservar cuando quieras. Al retirarlo, su sesión se cierra al momento.',
    'Los demás tutores del menor reciben un aviso de cada cambio, incluida la foto que ponga.',
    'Guardamos el registro de tu consentimiento: quién lo da, cuándo, desde qué conexión y la versión de este texto.',
    'La academia es la responsable de estos datos. Puedes pedir acceso, corrección o borrado escribiendo a la academia.',
  ],
  accept: 'He leído este texto y activo el acceso propio de mi hijo o hija.',
} as const

// Lo que lee el propio menor en su Cuenta, en lenguaje sencillo (art. 12 RGPD). Cambia solo la línea del perfil público.
// TEXTO PROPUESTO: validar con el abogado.
export const minorNotice = (canPublish: boolean) => ({
  title: 'Tu cuenta',
  intro: 'Tu tutor te ha abierto esta cuenta de Kaizen. Así funciona:',
  items: [
    'Puedes ver el calendario, tu progreso y tus medallas, hacer el check-in cuando llegas a clase y cambiar tu foto.',
    'Tu tutor decide si puedes reservar sesiones y apuntarte a eventos.',
    canPublish
      ? 'Tú decides si tu perfil es público y qué se ve de él. Si no lo cambias, no lo ve nadie.'
      : 'Tu tutor decide si tu perfil es público y qué se ve de él, hasta que tengas la edad de decidirlo tú.',
    'Los avisos de tus reservas, sesiones y eventos también le llegan a tu tutor.',
    'En la app no hay mensajes privados con nadie.',
    'Si algo te preocupa o no lo entiendes, díselo a tu tutor o a la academia.',
  ],
})
