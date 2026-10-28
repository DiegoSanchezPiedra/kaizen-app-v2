// Extiende el horizonte de sesiones de todas las clases vigentes (ADR 0004). Pensado para cron diario.
import 'dotenv/config';
import { servicePool, closePools } from '../src/config/database.js';
import { extendHorizon } from '../src/services/sessions.js';

try {
  const r = await extendHorizon(servicePool);
  console.log(`sesiones creadas: ${r.created}; clases con error: ${r.failed.length}`);
  r.failed.forEach((f) => console.error(f));
  process.exitCode = r.failed.length ? 1 : 0;
} finally {
  await closePools();
}
