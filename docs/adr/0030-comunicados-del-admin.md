# Los comunicados del admin fijan sus destinatarios al enviar y reutilizan el outbox de avisos

Decisión del 2026-11-18 (migración 071). Desarrolla el [ADR 0008](0008-avisos-outbox-y-worker.md).

El admin envía **comunicados** desde Avisos › Comunicados: título (≤ 80) y texto plano (≤ 1000), a **Todos** (cuentas no admin
y no deshabilitadas), **Alumnos con cuota en vigor** (activa o en gracia, opcionalmente de unas disciplinas, con la regla de
Usuarios; un hijo cuenta por `notice_recipients()`: sus tutores y él si tiene acceso propio) o **Profesores**. Canales:

- **En la app**: una fila por persona en `communique_views` al enviar. Ventana modal al abrir la app que solo cierra
  «Entendido» (`seen_at`); deja de salir a los 30 días o al retirarla. La ve también el hijo con acceso propio.
- **Email**: una entrega por persona en `notice_deliveries` (acción `notice.communique`), solo a adultos con email. Es
  obligatorio (no está en `SERVICE`: una baja no lo calla) y respeta la supresión (ADR 0029). Caduca a las 24 h como el resto.
- **WhatsApp**: no hay API para grupos: `https://wa.me/?text=` con `*Título*` y el texto; el admin elige el grupo de anuncios.
  No se registra si se compartió.

Sin push, sin programar y sin editar. **Retirar** quita la ventana a quien no la vio y salta (`withdrawn`) los emails aún
pendientes. Escribe el `servicePool` (la ruta exige admin): `notice_recipients()` y `notice_deliveries` no son de `app_user`.
El usuario lee y marca lo suyo por RLS; el admin lee todo.

**LSSI**: solo comunicados de servicio (cierres, horarios, normas), como el resto de emails de la app: sin consentimiento ni
enlace de baja. Un email comercial necesitaría consentimiento expreso y baja: sería otro bloque.

Se descartaron: audiencia dinámica (sin cifra fiable de vistos, y los nuevos verían avisos viejos), email solo a quien no vio
la ventana (más lógica en el worker para poco) y filtros combinables (más UI y RLS para un gimnasio).
