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
    'Puedes retirarle el acceso, cambiarle la contraseña o quitarle el permiso de reservar cuando quieras. Al retirarlo, su sesión se cierra al momento.',
    'Los demás tutores del menor reciben un aviso de cada cambio, incluida la foto que ponga.',
    'Guardamos el registro de tu consentimiento: quién lo da, cuándo, desde qué conexión y la versión de este texto.',
  ],
  accept: 'He leído este texto y activo el acceso propio de mi hijo o hija.',
} as const
