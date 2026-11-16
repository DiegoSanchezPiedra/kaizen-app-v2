---
name: rediseno
description: Lanza el prompt de rediseño de un grupo de pantallas de Kaizen. Úsalo cuando el usuario escriba "rediseno <grupo> <pantalla>" (por ejemplo "rediseno 1 /login" o "rediseno entrada /login"), o pida rediseñar un grupo de pantallas.
---

# Rediseño de pantallas

Los prompts viven en `.claude/prompts-rediseno/`, uno por grupo. Cada uno es autocontenido.

| Nº | Nombre | Fichero | Marcadores a sustituir |
|---|---|---|---|
| 1 | entrada | `1-entrada.md` | `<ELIGE UNA DE LA LISTA DE ABAJO>`, rama `feat/entrada` ya fija |
| 2 | nucleo-alumno (calendario, reservas, checkin…) | `2-nucleo-alumno.md` | pantalla y `<pantalla>` |
| 3 | cuenta | `3-cuenta.md` | pantalla y `<pantalla>` |
| 4 | cuota | `4-cuota.md` | pantalla y `<pantalla>` |
| 5 | profesor | `5-profesor.md` | pantalla y `<pantalla>` |
| 6 | tablet | `6-tablet.md` | ninguno |
| 7 | admin | `7-admin.md` | pantalla y `<pantalla>` (rama `feat/admin-<pantalla>`) |
| 8 | transversales | `8-transversales.md` | ninguno |

## Pasos

1. Del mensaje saca el grupo (número o nombre) y la pantalla. Si falta el grupo, pregunta cuál; si falta la pantalla en un grupo que la necesita, pregunta cuál.
2. Lee SOLO el fichero de ese grupo. No leas los demás ni el documento del Escritorio.
3. Sustituye los marcadores por la pantalla pedida. Si el nombre de la pantalla es una ruta (`/login`), para el nombre de rama usa una versión corta sin barras (`login`).
4. Sigue ese prompt tal cual, con su Fase 1 (diseño en modo plan) y su Fase 2 (carga la skill `orquestacion`). No empieces la Fase 2 hasta que el usuario apruebe el plan.
5. Una pantalla por sesión. Al terminarla (commit y push hechos), dilo y recuerda que la siguiente va en una sesión nueva.
