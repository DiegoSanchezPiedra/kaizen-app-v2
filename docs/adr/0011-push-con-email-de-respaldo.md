# El push se entrega por destinatario a todos sus dispositivos, con email de respaldo decidido al crear el aviso

En B15 los avisos de reservas y el de re-firma van por **push**. Muchos destinatarios no tendrán ningún dispositivo suscrito: en iOS solo hay push con la PWA instalada, y quien entra desde el navegador del ordenador puede no dar permiso. Para ellos, una sesión cancelada no les llegaría por ninguna vía. Por eso el canal se decide **al crear el aviso**, en una función SQL interna: cada destinatario recibe una entrega `push` si tiene al menos un dispositivo, o una de `email` si no tiene ninguno. Si sus dispositivos caducan después, la entrega acaba `skipped` (`no_subscription`) y no se vuelve a decidir.

La entrega sigue siendo **una por aviso, destinatario y canal** (el `UNIQUE` de ADR 0008). El worker la reparte al enviar entre todos los dispositivos que el destinatario tenga en ese momento. Queda `sent` si alguno la acepta. Un 404/410 borra ese dispositivo y un error transitorio reintenta la entrega entera. Para que un reintento no se vea dos veces en un dispositivo que ya la recibió, la notificación lleva `tag` y `Topic` = id del aviso.

Un dispositivo (`endpoint`) pertenece a **un solo perfil**. Al suscribirse en un móvil donde había otra persona, la fila pasa al usuario actual (upsert por `endpoint` en una función `SECURITY DEFINER`, porque la RLS no deja ver la fila ajena). Así el siguiente usuario no recibe los avisos del anterior aunque este no cerrara sesión.

Se descartaron:
- **Solo push, `skipped` sin dispositivo**: el aviso de una sesión cancelada se perdería para cualquiera sin la PWA instalada.
- **Push y email siempre**: quien tiene push recibe cada aviso dos veces.
- **Decidir el respaldo al enviar** (el worker cambia de canal si no hay dispositivo): la entrega dejaría de decir por dónde salió, y la regla de canales quedaría repartida entre la creación y el envío.
- **Una entrega por dispositivo**: rompe el `UNIQUE (audit_id, recipient_id, channel)`, deja sin el aviso a un dispositivo registrado después de crearlo y obliga a borrar entregas al caducar un dispositivo.
- **Varias filas por `endpoint`** (una por perfil que se suscribió): un móvil compartido recibiría los avisos de todos los que pasaron por él.

El precio es que un destinatario que instala la PWA mientras hay avisos pendientes los recibe por email, que un reintento puede llegar dos veces a un dispositivo que no respete el `tag`, y que si el cliente no se da de baja al cerrar sesión (no hay logout en el servidor) ese dispositivo sigue recibiendo avisos hasta que otro usuario se suscriba en él o caduque. Volver a una entrega por dispositivo, o al respaldo decidido al enviar, supone migrar las entregas pendientes y rehacer el envío del worker.
