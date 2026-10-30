# Modelo y effort por bloque

> Guía para elegir modelo de Claude y nivel de *effort* en cada chat de trabajo. Recomendación del 2026-10-30, tras B11.
> Es orientativa: si un bloque se complica (aparece dinero, RLS o datos de menores), se sube.

## Regla general

| Tipo de trabajo | Modelo | Effort |
|---|---|---|
| **Diseñar un bloque** (grill con los docs, ADR, `CONTEXT.md`, plan) | Opus | alto |
| **Implementar** algo con dinero, RLS, funciones `SECURITY DEFINER`, datos de menores o de salud, o migraciones difíciles de deshacer | Opus | medio (alto si toca Stripe o seguridad) |
| **Implementar** un bloque ya diseñado, sin nada de lo anterior | Sonnet | medio |
| **Depurar** un test rojo o un fallo de Stripe que no se entiende | Opus | alto |
| **E2E** con Chrome, `stripe listen` y *test clock* | Opus | medio |
| Tareas mecánicas: limpiar docs, renombrar, commits, actualizar la tabla de estados | Sonnet | bajo |

Qué sube el nivel: dinero real o Stripe, permisos (RLS, quién ve qué), menores o salud, concurrencia (bloqueos, carreras), migraciones con datos.
Qué lo baja: especificación cerrada en el plan, código que sigue un patrón ya existente y tests que cubren el comportamiento.

`max` y `xhigh` solo para revisiones de seguridad completas o para incidentes con dinero de por medio. En el resto cuestan más y no aportan.

## Bloques pendientes

| Bloque | Diseño (grill) | Implementación | Por qué |
|---|---|---|---|
| **B6** — calendario del alumno (lo que falta) | — (sin diseño nuevo) | Sonnet, medio | Lectura sobre sesiones y reservas que ya existen. |
| **B10.7** — migración de los clientes de maat | Opus, **xhigh** | Opus, **alto** | Cuenta de producción de un tercero con clientes pagando, dinero real y ajustes de toda la cuenta (reintentos, emails, descriptor). Un error no se deshace. |
| **B13** — perfiles públicos y directorio | Opus, alto | Opus, medio | Privacidad: los hijos nunca son públicos, la salud no puede filtrarse y hay que decidir qué ve el profesor. Es RLS pura. |
| **B14** — racha, horas, badges, ranking opt-in y disciplina abierta | Opus, medio | Opus, medio | Diseñado: toca `covers()` (reservas y cobros), amplía la vista pública `public_profiles`, añade funciones `SECURITY DEFINER` que leen asistencia de menores, y las reglas de semana y mes dependen de la hora de Madrid. |
| **B15** — push | Opus, alto | Opus, **alto** | Diseñado: se engancha al outbox (ADR 0008, 0011) y a `booking_notice` en SQL; RLS con traspaso del dispositivo por una función `SECURITY DEFINER`, SSRF (endpoint del cliente) y destinatarios de la re-firma con menores. Toca seguridad, así que sube. |
| **B16** — agregaciones de informes y cron nocturno | Opus, medio | Sonnet, alto | SQL de agregación con rendimiento e idempotencia del cron; lógica sencilla pero fácil de equivocar en los bordes (zonas horarias, días sin datos). |
| **B17** — endpoints de informes | Sonnet, medio | Sonnet, medio | Lectura sobre B16; solo hay que cuidar quién ve qué. |
| **B18** — PWA (manifest, Service Worker) | Sonnet, medio | Sonnet, medio | Estándar web; la caché del Service Worker es la única parte delicada. |
| **B19** — panel admin | Opus, alto | Sonnet, alto | Bloque grande que junta todo (morosos, entregas fallidas, auditoría, cambios de pagador caducados). El diseño decide qué entra; la implementación es mayormente de lectura. |
| **B20** — hardening | Opus, **xhigh** para la auditoría de RLS y seguridad | Opus, alto (rate limiting); Sonnet, medio (backups) | Es la revisión de todo lo anterior: conviene la máxima profundidad en la parte de seguridad. |

## Cómo usarlo

- Un chat por fase: diseñar con el grill y, en otro chat, implementar con la especificación ya cerrada en el plan. El chat de implementación no necesita el contexto del diseño, solo el plan, el ADR y `CONTEXT.md`.
- Si a mitad de una implementación con Sonnet aparece una decisión de diseño que el plan no resuelve, se para y se decide en un chat de Opus (o se pregunta), en vez de improvisar.
