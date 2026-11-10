# Sin seguro ni `waiver`: solo membresías

Decisión del 2026-11-10, en el diseño de B28 (migración 057). Sustituye a 0005 y 0006.

La academia solo cobra **membresías** (suscripciones). Desaparecen el seguro de la academia, el acuerdo `waiver` y la
**cobertura de riesgo**: para reservar basta con el perfil completo (`data_protection`, `rights_of_image` y la ficha) y
una suscripción que cubra la sesión. La promoción desde la lista de espera y la inscripción a eventos dejan de mirar la
cobertura de riesgo. El `waiver` no se sustituye por otro documento.

- **Todo se borra, sin copia.** Antes de producción solo hay datos de staging y del sandbox de Stripe: la 057 borra los
  seguros, sus recibos, sus avisos, sus ajustes, las firmas y los documentos `waiver` (y sus PDF), y el tipo `waiver`.
  Un script de un solo uso canceló en el sandbox los seguros vivos y archivó el Product «Seguro» y sus Prices.
- **Un campo retirado es un error.** `POST /billing/checkout` con `insurance` (o cualquier campo desconocido) → 400
  `invalid_field`, no se ignora en silencio.

## Considered Options

- **Mantener el `waiver` obligatorio para todos, sin seguro**: protege algo más a la academia, pero es otro documento que
  firmar; la responsabilidad civil la cubre la póliza propia de la academia, fuera de la app.
- **Dejar el seguro desactivado y el código dormido**: no hay clientes que lo usen y mantenerlo cuesta (webhook, avisos,
  morosos, pantallas).

## Consequences

- La academia necesita su propia póliza de responsabilidad civil (ver `docs/research/legal-fichaje-menores.md` §3).
- Morosos y «en gracia» solo cuentan suscripciones; el webhook ya no trata `invoice.upcoming` ni suscripciones con
  `metadata.kind = 'insurance'`.
- ADR 0007 sigue vigente; su mención al 3DS del seguro queda como historia.
