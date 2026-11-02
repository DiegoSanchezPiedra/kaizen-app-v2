# Un evento se cobra con un Checkout de pago único por inscripción, la plaza se retiene hasta el webhook y solo la academia decide un reembolso

Los eventos (B21) se pagan aparte de la suscripción. Decisión del 2026-11-02, en el diseño de B21.

Se hace así:

- **Un Checkout `mode: payment` por inscripción**, con `price_data` (importe y título del evento en línea). El evento no tiene Product ni Price en Stripe. Lo paga el actor adulto con su cliente de Stripe de siempre. El importe lo calcula Kaizen al inscribir: precio de socio o precio general.
- **Sin recibo de Kaizen**: el justificante es el de Stripe. Los recibos (`invoices`) siguen siendo solo de suscripción y seguro.
- **La plaza se retiene** desde que se abre el Checkout. La inscripción queda pendiente y cuenta en el aforo hasta que el webhook la resuelve: `checkout.session.completed` la confirma y `checkout.session.expired` la cancela. Lo decide el webhook, no la hora: un pago completado justo antes de caducar no pierde su plaza aunque el aviso llegue tarde.
- **Reembolsos solo por decisión de la academia**: siempre del importe entero. Se devuelve todo al cancelar el evento, lo que pague tarde una inscripción ya cancelada, y lo que el admin elija al cancelar una inscripción. El alumno no cancela una inscripción pagada. Cada reembolso lleva una clave de idempotencia por inscripción.

## Considered Options

- **Un Product y un Price de Stripe por evento** (como los planes): obliga a sincronizarlos al cambiar el precio o el precio de socio, y no aporta nada a un cobro único.
- **Factura o recibo de Kaizen** (`invoice_creation` del Checkout): mete en el webhook facturas que hoy se tratan como de suscripción, y no hay factura legal (CONTEXT § Cobros).
- **No retener la plaza** y confirmar solo al pagar: dos personas pagan la última plaza y una hay que devolverla. Con lista de espera además habría que cobrar a alguien que no está delante.
- **Retener la plaza solo hasta `expires_at`**: más simple de contar, pero un pago completado justo antes de caducar, con el webhook retrasado, perdería su plaza frente a otro.
- **Cancelación con reembolso por el propio alumno hasta N días antes**: un plazo y una regla de dinero más; el usuario prefirió que lo decida la academia en cada caso.

## Consequences

- El webhook gana una rama (`mode: payment` con `metadata.kind = 'event'`) y un evento nuevo, `checkout.session.expired`, que hay que suscribir en el endpoint de Stripe (sandbox, staging y, en B10.7, producción).
- Si se pierde un `expired` (se agotan los reintentos de Stripe), la plaza queda pendiente hasta que el admin cancela esa inscripción. Se asume, igual que los webhooks perdidos de B20.
- `charge.refunded` distingue los reembolsos de Kaizen (de una inscripción, sin aviso de riesgo) de los hechos en el Dashboard (con `notice.stripe_risk`, como hoy).
- Los ingresos de eventos no están en los informes de Kaizen; se ven en el Dashboard de Stripe.
