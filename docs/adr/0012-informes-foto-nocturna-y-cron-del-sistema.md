# Los informes solo guardan una foto nocturna de las suscripciones; el resto se calcula al leer, y lo lanza el cron del sistema

Los informes (B17) necesitan la evolución de las suscripciones (activas, en gracia, impagadas, altas, bajas, MRR), pero `subscriptions` solo guarda su estado actual y `plans.price_cents` se sobrescribe: ese pasado no se puede reconstruir. Por eso B16 guarda cada noche una **foto diaria** en `academy_stats_daily`, que no cambia nunca después; un día sin foto queda en hueco. Todo lo que sale de la asistencia y las sesiones (ocupación, presentes, faltas, horas) **no se agrega**: se calcula al leer, como la racha y las horas de B14, de modo que una corrección, una cancelación retroactiva o un ajuste de sesión se aplican solos. `student_stats_daily` se borró por eso.

La foto la toma `scripts/nightly.js`, que lanza el **cron del sistema** a las 03:00 de Madrid (`CRON_TZ=Europe/Madrid`) junto con `extend-horizon` (ADR 0004), que hasta entonces nadie programaba. Es idempotente (`ON CONFLICT DO NOTHING`), así que relanzarlo no cambia nada.

## Considered Options

- **Agregar también la asistencia por alumno y día** (el `student_stats_daily` de 001) y recalcular N días hacia atrás cada noche, o marcar días «sucios» al corregir: cualquier corrección fuera de la ventana dejaría el informe mal, y a cambio solo se ahorra leer unas miles de filas de un gimnasio.
- **Rellenar los días saltados** con el estado del día en que se relanza: sería inventar el pasado.
- **Un planificador dentro de la API**, como el worker de avisos (ADR 0008): sin infraestructura extra, pero un reinicio a las 03:00 se salta el día y dos instancias lo correrían dos veces. A diferencia de los avisos, aquí la latencia no importa.
- **`pg_cron`**: una extensión más en el contenedor de Postgres y la lógica fuera del repo de Node.

## Consequences

El servidor necesita una línea de crontab (documentada en `scripts/README.md`); si falta o falla, no hay foto ese día y el horizonte no avanza, y nada lo avisa hasta B20. El histórico de la foto empieza el día en que se instala: lo anterior no existe. Pasar a agregar asistencia más adelante es posible (se recalcula de los datos), pero volver a reconstruir el pasado de las suscripciones no.
