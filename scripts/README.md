# scripts/

Scripts de operación (backups, cron nocturno, mantenimiento).
No van aquí las migraciones: esas viven en `migrations/`.

## Tareas nocturnas (`npm run nightly`, B16, ADR 0012)

`scripts/nightly.js` lanza, cada una aunque la otra falle:

1. `extendHorizon`: genera las sesiones de las clases vigentes hasta el horizonte (ADR 0004).
2. La **foto diaria** de ayer de Madrid en `academy_stats_daily` (`snapshot_academy_stats`).

Imprime `sesiones creadas: N; clases con error: M` y `foto YYYY-MM-DD: creada | ya existía`; los errores van a
`stderr` y el código de salida es 1 si algo falló. No necesita la API en marcha.

### Crontab

Lo lanza el cron del sistema a las 03:00 de Madrid (`crontab -e` del usuario que tiene el repo y el `.env`):

```cron
CRON_TZ=Europe/Madrid
0 3 * * * cd /ruta/al/repo && npm run nightly >> /var/log/kaizen/nightly.log 2>&1
```

Las 03:00 de Madrid existen y ocurren una sola vez también en los cambios de hora.

**`CRON_TZ` solo lo entiende cronie** (Fedora, RHEL, Arch). El `cron` de Debian y Ubuntu lo ignora y usa la zona del
sistema: ahí la hora de Madrid sale de `timedatectl set-timezone Europe/Madrid` (compruébalo con
`timedatectl show -p Timezone`). Con un servidor en UTC la línea correría a las 03:00 UTC (04:00 o 05:00 de Madrid); la
foto seguiría siendo la de ayer de Madrid, porque esa fecha se calcula en SQL.

El directorio del log tiene que
existir y ser escribible por ese usuario. Si `npm` no está en el `PATH` del cron, pon la ruta completa
(`which npm`).

### `--date`

`npm run nightly -- --date=YYYY-MM-DD` hace la foto de ese día, que solo puede ser **ayer u hoy** de Madrid (otra
fecha → `invalid_date`). Una foto existente no se cambia nunca: relanzar imprime `ya existía`.

### Si falla

- Mira el log: la línea de error dice qué tarea falló.
- **Foto**: relanza `npm run nightly` esa misma mañana (hace la de ayer). Si ya es el día siguiente, el día queda en
  hueco («sin dato» en los informes): no se puede rellenar sin inventar el pasado.
- **extend-horizon**: cada clase con error sale en `stderr` (p. ej. un solape del profesor). Arregla la clase y
  relanza `npm run nightly` o `npm run extend-horizon`; es idempotente. Si no se corrige, esa clase deja de generar
  sesiones al final de su horizonte.
- Nada avisa todavía de un fallo del cron (B20).
