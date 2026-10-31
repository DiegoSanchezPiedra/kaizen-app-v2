# Modelo y effort por bloque

> Guía para elegir modelo de Claude y nivel de *effort* en cada chat de trabajo. Recomendación del 2026-10-30, tras B11. Revisada el 2026-10-31, tras B16: B17 sube a Opus en el diseño y el frontend se diseña en Claude Design.
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
| **B10.7** — migración de los clientes de maat | Opus, **xhigh** | Opus, **alto** | Cuenta de producción de un tercero con clientes pagando, dinero real y ajustes de toda la cuenta (reintentos, emails, descriptor). Un error no se deshace. |
| **B17** — endpoints de informes | Opus, medio | Sonnet, medio | Revisado tras B16 (2026-10-31): no es solo leer la foto. Decide qué ve el profesor (sus sesiones y sustituciones, nada de dinero, ¿nombres de alumnos?), si lee por RLS o por funciones `SECURITY DEFINER`, la asistencia de menores y los bordes de la ocupación (canceladas, retroactivas, sueltas, huecos, hora de Madrid). Con el plan cerrado, implementarlo es lectura con tests. |
| **B18** — frontend PWA (alumno, tutor, profesor, tablet) | Técnico: Opus, alto. Visual: Claude Design (ver abajo) | Opus, medio (sesión, push, Service Worker); Sonnet, alto (pantallas) | Es el primer frontend: decide el stack, el build, dónde vive el token, el i18n y la caché del Service Worker (no debe cachear respuestas con datos de otro usuario ni de salud). Un error aquí se repite en todas las pantallas. Muy grande: conviene partirlo en el diseño (base y sesión, alumno y tutor, profesor, tablet). |
| **B19** — panel admin | Técnico: Opus, alto. Visual: Claude Design, con el sistema de diseño de B18 | Sonnet, alto; Opus, medio en la gestión de usuarios y roles | Bloque grande que junta todo (morosos, entregas fallidas, auditoría, cambios de pagador caducados, documentos legales, informes de B17). El diseño decide qué entra; casi todo es lectura, pero cambiar roles y perfiles es escritura con permisos. |
| **B20** — hardening | Opus, **xhigh** para la auditoría de RLS y seguridad | Opus, alto (rate limiting); Sonnet, medio (backups) | Es la revisión de todo lo anterior: conviene la máxima profundidad en la parte de seguridad. |

Cerrados (ya no hace falta elegir): B6, B13, B14, B15 y B16.

## Frontend con Claude Design

El frontend (B18, B19) se diseña visualmente en Claude Design y se trae a Claude Code por su MCP y sus skills. Cada bloque con pantallas tiene tres fases, cada una en su chat:

1. **Técnico** (Claude Code, grill; modelo de la tabla): qué pantallas hay, qué endpoint usa cada una, estados (cargando, vacío, error, sin permiso, perfil incompleto, sin cobertura) y lo que no se ve (token, push, caché). Sale en `plan-de-bloques.md`, como el resto.
2. **Visual** (Claude Design): primero un **sistema de diseño** único para toda la app (antes de B18), y después las pantallas del bloque con él. Se le pasa la lista de pantallas y estados de la fase 1, y las reglas que también valen en la UI: solo español, nada de salud, edad ni fecha de nacimiento fuera de donde ya se permite, y el push en pantalla de bloqueo sin datos sensibles.
3. **Implementación** (Claude Code, modelo de la tabla): lee el diseño por el MCP y lo implementa contra la API existente. Si el diseño pide un dato que la API no da, se para y se decide en la fase 1 (no se añade un endpoint improvisado).

## Cómo usarlo

- Un chat por fase: diseñar con el grill y, en otro chat, implementar con la especificación ya cerrada en el plan. El chat de implementación no necesita el contexto del diseño, solo el plan, el ADR y `CONTEXT.md`.
- Si a mitad de una implementación con Sonnet aparece una decisión de diseño que el plan no resuelve, se para y se decide en un chat de Opus (o se pregunta), en vez de improvisar.
