# Subir de plan con *pending update*, bajar con *Subscription Schedule*; las disciplinas las escribe Kaizen

Subir de plan es inmediato y con prorrateo, y bajar se aplica en la siguiente facturación (CONTEXT § Suscripción). La subida se pide a Stripe como **pending update** (`payment_behavior: pending_if_incomplete`, `proration_behavior: always_invoice`): Stripe cobra la diferencia al momento y **solo aplica el cambio si se paga**, con 3DS por `handleNextAction` como el seguro (ADR 0006). La bajada se programa con un **Subscription Schedule** de dos fases (la actual y la nueva desde el fin de periodo, `end_behavior: release`). En los dos casos, el plan y las disciplinas nuevas van en la `metadata` (del pending update o de la fase 2), y el webhook los aplica cuando `metadata.plan_id` deja de coincidir con el plan local. Así se mantiene la regla de B10: el estado de cobro solo lo escribe el webhook. Hay como mucho un cambio programado a la vez.

El **cambio de disciplina** no pasa por el cobro, así que lo escribe el endpoint en una transacción (sustitución, límite por periodo, cancelación de reservas con motivo «cambio de disciplina» y `audit_log`). La `metadata` de Stripe queda como espejo. Si lo escribiera el webhook, no podría distinguir un cambio de disciplina de otros cambios de la suscripción ni aplicar el motivo y el límite.

Se descartaron:
- `create_prorations`, porque da el plan nuevo antes de cobrarlo.
- Guardar la bajada en local y aplicarla con un job al renovar, porque reimplementa lo que el Schedule ya hace y deja a Stripe cobrando el precio viejo si el job falla.
- Dos endpoints de subida y bajada, porque decide el precio y no el cliente.

El precio de esta decisión es que, con un Schedule adjunto, Stripe pide modificar la suscripción **a través del Schedule**. Por eso la baja admin lo libera primero (la bajada se descarta, con aviso) y el cambio de precio de un plan actualiza sus fases. También hay columnas `scheduled_*` que el webhook mantiene a partir de los eventos `subscription_schedule.*`. Volver atrás supondría migrar los Schedules vivos y rehacer los endpoints y los handlers de B10.5.
