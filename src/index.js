// src/index.js
import 'dotenv/config';
import app from './app.js';
import { closePools } from './config/database.js';
import { startNoticeWorker } from './services/notices.js';

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`[kaizen] escuchando en http://127.0.0.1:${PORT}`);
});
const stopNoticeWorker = startNoticeWorker(); // avisos por email y push (B10.6 y B15, ADRs 0008 y 0011)

// Cierre limpio
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[kaizen] ${sig} recibido, cerrando…`);
    server.close();
    await stopNoticeWorker();
    await closePools();
    process.exit(0);
  });
}