// Tareas nocturnas (ADR 0012): extiende el horizonte de sesiones (ADR 0004) y toma la foto diaria de ayer de Madrid.
// Lo lanza el cron del sistema a las 03:00 de Madrid (scripts/README.md). Cada tarea en su try: si una falla, la otra
// corre igual; código de salida 1 si alguna falló. --date=YYYY-MM-DD (solo ayer u hoy) repite la foto a mano.
import 'dotenv/config';
import { servicePool, closePools } from '../src/config/database.js';
import { extendHorizon } from '../src/services/sessions.js';

const date = process.argv.find((a) => a.startsWith('--date='))?.slice('--date='.length) ?? null;
let failed = false;

try {
  try {
    const r = await extendHorizon(servicePool);
    console.log(`sesiones creadas: ${r.created}; clases con error: ${r.failed.length}`);
    r.failed.forEach((f) => console.error(f));
    if (r.failed.length) failed = true;
  } catch (err) {
    console.error(`extend-horizon: ${err.message}`);
    failed = true;
  }
  try {
    const { rows: [r] } = await servicePool.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS d, snapshot_academy_stats(d) AS created
         FROM (SELECT COALESCE($1::date, (now() AT TIME ZONE 'Europe/Madrid')::date - 1) AS d) x`, [date]);
    console.log(`foto ${r.d}: ${r.created ? 'creada' : 'ya existía'}`);
  } catch (err) {
    console.error(`foto${date ? ` ${date}` : ''}: ${err.message}`);
    failed = true;
  }
} finally {
  await closePools();
}
process.exitCode = failed ? 1 : 0;
