# PLAN_FAMILIA — Cuenta Familiar (rediseño de B4.6)

> Decidido el 2026-10-27, antes de empezar B5. Vocabulario en `CONTEXT.md`; razón de fondo en `docs/adr/0002-hijo-sin-credenciales.md`.
> Este documento es el plan. **No hay código escrito todavía.**

## 1. Qué cambia

| Antes (B4.6, commit `bc4685d`) | Ahora (Cuenta Familiar) |
|---|---|
| El menor tiene login propio | El hijo **no tiene credenciales**: ni email ni login |
| Un menor puede registrarse | El registro propio exige **≥ 18** (local y onboarding de Google) |
| Solo el admin crea vínculos tutor→menor | El tutor **crea al hijo** y queda vinculado; el admin añade o quita más tutores |
| El tutor solo firma acuerdos | El tutor gestiona **todo**: perfil, ficha de salud, acuerdos, cuota, reservas, eventos y avisos |
| Edición de la ficha de salud por el tutor: B8 | En **B4.6** |
| Rol `tutor` siempre completo | El rol `tutor` firma su propio `data_protection` |

## 2. Decisiones

| # | Decisión |
|---|---|
| D1 | El hijo es un `profile` + `user_roles('alumno')` + `guardianships`, **sin** `auth_credentials`. El tutor actúa con su JWT. |
| D2 | Registro propio solo para ≥ 18. Si en el onboarding de Google se declara una edad < 18, se rechaza. |
| D3 | Tutor = capacidad que da la relación (el ADR 0001 sigue en pie). Cualquier adulto (`alumno` o `tutor`) puede crear hijos. |
| D4 | Quien crea al hijo queda vinculado automáticamente. El admin añade o quita más tutores. Todos tienen los mismos poderes. La invitación de un 2º tutor queda aplazada. |
| D5 | **Una suscripción por hijo** (`subscriptions.student_id` = hijo) + `payer_id`. Un cliente Stripe por pagador (`profiles.stripe_customer_id`, B10). Sin descuentos familiares. El pagador es quien contrata; cambiarlo lo hace solo el admin (B11). |
| D6 | Avisos del hijo → todos sus tutores. Facturación → solo el pagador. Nunca al hijo. |
| D7 | Se reescribe `006_minors_guardians.js` en el sitio (no hay nada desplegado). |
| D8 | "Cuenta familiar" es un término de UI; no hay tabla `families`. |
| D9 | A los 18 caen los poderes del tutor (se calcula con `birth_date`, sin job). El adulto **reclama** su perfil por invitación y conserva su historial. El tutor puede seguir siendo el pagador. |
| D10 | Sin límite de hijos ni edad mínima. Al crear un hijo: `birth_date` obligatoria y < 18. |
| D11 | Perfil completo del rol `tutor` = `display_name` + `data_protection` propio. |
| D12 | El tutor no borra hijos (la baja RGPD la hace el admin). El admin no puede quitar el último tutor de un menor. |
| D13 | `profile_id` **opcional** (sujeto; por defecto, uno mismo) en `/me/*`, reservas, inscripciones y checkout. Nuevas rutas: `GET/POST /me/children` y `PATCH /me/children/:id`. |
| D14 | `payer_id` ∈ {el propio alumno adulto, un perfil vinculado en `guardianships`}. |
| D15 | Para reservar o pagar por un hijo deben estar completos el hijo (sujeto) **y** el tutor (actor). |
| D16 | Hijo con 18 años sin reclamar su perfil: el tutor lo ve en `/me/children` ("pendiente de reclamar") y ve y paga sus suscripciones; no puede editar, firmar, reservar ni ver su salud. |

## 3. Modelo de datos objetivo

- **`profiles.birth_date`**: se mantiene.
- **`guardianships (tutor_id, minor_id)`**: se mantiene. Ya no se inserta directamente: se crea con `create_child` (tutor) o por el admin (tutores adicionales).
- **`create_child(id, display_name, birth_date)`**: función SQL `SECURITY DEFINER` con owner `service_role` (el mismo patrón que `student_health_professor_view`). Comprueba que el llamante (`app.current_user_id`) es adulto y que `birth_date` es de menor de 18. Inserta en una sola operación `profiles` + `user_roles('alumno')` + `guardianships(uid, id)`. Así no hay que abrir `profiles_insert` ni `guardianships_insert` a vínculos arbitrarios.
- **`is_guardian_of(profile_id)`**: helper SQL para RLS. Es cierto si existe `guardianships(tutor_id = uid, minor_id = profile_id)` y el sujeto es menor de 18. Sustituye a los `EXISTS` repetidos. Para D16 hace falta una variante "vínculo histórico" (sin la condición de edad), usada solo para listar al hijo y para la facturación.
- **`user_agreements.signed_by`**: se mantiene, junto con la unicidad `(profile_id, signed_by, type, version)`.
- **`subscriptions.payer_id uuid NOT NULL → profiles`** (B10). La regla D14 se aplica en la RLS o en el servicio.
- **Cliente Stripe por pagador** (B10): `profiles.stripe_customer_id` (decidido en el diseño de B10; un perfil nunca tiene más de un cliente).
- **Actor en las tablas operativas**: `bookings.booked_by` (B7) y `event_registrations.registered_by`, con el mismo sentido que `signed_by`.

## 4. Código de B4.6: mantener / refactorizar / borrar

| Archivo | Acción | Detalle |
|---|---|---|
| `migrations/006_minors_guardians.js` | **Reescribir** | **Se mantiene**: enum `tutor`, `birth_date`, `guardianships`, `signed_by` + backfill, unicidad con el firmante, `profiles_select_guardian`. **Cambia**: la política `user_agreements_insert` usa `is_guardian_of`; `guardianships_insert_admin` se queda (los tutores adicionales los añade el admin) y el alta normal va por `create_child`. **Se añade**: `create_child`, `is_guardian_of`, políticas de tutor en `student_health_info` (SELECT/INSERT/UPDATE con `is_guardian_of`), `profiles_update_guardian`, y que `profiles_select_guardian` use el vínculo histórico (D16). |
| `src/services/auth.js` | **Refactorizar** | `registerLocal`: además de "fecha pasada", exigir ≥ 18 (`400 minor_cannot_register`). El onboarding de Google aplica la misma regla al fijar `birth_date`. |
| `src/services/profile.js` | **Refactorizar** | `getProfileStatus`: el rol `tutor` deja de devolver `{ ok: true }` directamente; comprueba `display_name` + `data_protection`. La regla menor/adulto de las firmas se mantiene. |
| `src/routes/me.js` | **Ampliar** | Se mantiene `profile_id` en `POST /me/agreements`. Se añade `profile_id` a `POST /me/health` y `GET /me/profile-status`. Nuevas: `GET /me/children`, `POST /me/children` (llama a `create_child`), `PATCH /me/children/:id`. Se reutiliza `validateAgreementSubject`, renombrado a un validador genérico del sujeto. |
| `src/middleware/requireCompleteProfile.js` | **Refactorizar** (antes de B7) | Comprobar el sujeto (`body.profile_id ?? req.user.id`) y, si el sujeto es distinto, también el actor (D15). |
| `src/services/agreements.js` | Mantener | `signAgreement` con `signedBy` ya encaja. |
| `src/routes/auth.js` | Mantener | Ya pasa `birthDate`. |
| `scripts/test-minors.js` | **Refactorizar** | Cambia "solo admin crea vínculos" → "el tutor crea un hijo con `create_child` pero no puede vincularse a un perfil existente". Nuevos casos: un adulto no puede ser hijo; un menor no puede crear hijos; el tutor lee y edita la salud del hijo; otro tutor no; a los 18 el tutor pierde la edición y la firma pero sigue viendo al hijo en la lista; el tutor sin `data_protection` está incompleto. Se mantiene "el menor no firma" como defensa en profundidad. |
| `scripts/test-rls.js` | Revisar | Casos de `user_agreements` y `student_health_info` tras la reescritura. |
| **Borrar** | — | No se borra ningún archivo. Desaparece la **suposición** de "menor con login": el texto de los docs y la posibilidad de registrar un menor. |

Orden de ejecución al reabrir B4.6: `migrate:down` (006) → reescribir 006 → `migrate` → reiniciar el servidor → servicios y rutas → `npm run test:minors` + `npm run test:rls` → verificación HTTP (tutor se registra → firma `data_protection` → crea hijo → rellena su ficha → firma sus 3 acuerdos → `GET /me/profile-status?profile_id=` → `{ ok: true }`).

## 5. Impacto en bloques futuros

### B5 — Catálogo
Sin cambios de esquema. Sin rangos de edad por disciplina (D10); **revisado en B5**: existen disciplinas y planes "solo menores" (ver `CONTEXT.md`), validados al elegir disciplinas y al suscribirse.

### B7 — Reservas
- `bookings.student_id` = sujeto; nueva columna `booked_by` = actor.
- RLS: `student_id = uid OR is_guardian_of(student_id) OR admin` (y profesor según su política).
- `create_booking` recibe el sujeto; `requireCompleteProfile` comprueba sujeto + actor (D15).
- "Mis reservas" = las mías + las de mis hijos.
- `event_registrations`: el mismo patrón (`registered_by`).

### B8 — Asistencia
Sin cambios para el profesor. La edición de la salud del hijo por el tutor **sale de B8** (ya está en B4.6). `student_health_professor_view` ya incluye a los hijos.

### B9 — QR (afectado, se decide allí)
El hijo no tiene móvil ni login. Opciones: el check-in lo hace el tutor con su JWT + `profile_id`, o el profesor lo marca a mano (B8).

### B10 / B10.1 / B10.2 — Stripe
- `subscriptions.payer_id`; cliente Stripe **por pagador** (un tutor ve todas las cuotas familiares en el portal).
- `POST /billing/checkout` con `profile_id` (sujeto); comprueba D14 y D15.
- RLS de `subscriptions` e `invoices`: alumno, tutor vinculado (incluido el histórico, D16) o pagador.
- Lista de morosos: agrupar por pagador.

### B10.6 / B15 — Emails y push
Destinatario = pagador (facturación) o todos los tutores (avisos del hijo, re-firma, cumplir 18). Nunca el hijo.

### B12 — Eliminado
Los consentimientos se validan con el perfil completo del sujeto (y D15 sobre el actor); el `waiver` pasa a la elección seguro / `waiver` de B10.3.

### B13 / B14 — Perfil público y social
Un hijo nunca es público ni aparece en el feed, la racha pública o los rankings (`is_public` forzado a false). Añadir a sus checklists.

### Sin bloque asignado
- Invitación para **reclamar el perfil** a los 18 (D9): crea `auth_credentials` para un perfil existente.
- Invitación de un **segundo tutor** por el primero (D4).

## 6. Riesgos nuevos

- `create_child` es `SECURITY DEFINER`: si se rompe la comprobación del llamante, cualquiera podría crear perfiles vinculados. Se cubre con un test en `test-minors.js`.
- Un hijo que cumple 18 y no reclama su perfil queda bloqueado en silencio. Hay que avisar a los tutores: B15 lo aplaza al bloque que cree el flujo de reclamar el perfil (sin ese flujo el aviso pediría algo imposible, y necesita un disparador por fecha).
- Si el admin quitara el último tutor de un menor, el perfil quedaría inaccesible. Lo impide D12 (una comprobación en la app; valorar un trigger).
- B9 asume "un alumno, un móvil". Hay que reabrirlo con este modelo.
