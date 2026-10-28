// src/index.js
import 'dotenv/config';
import express from 'express';
import { pingAll, closePools } from './config/database.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import agreementsRouter from './routes/agreements.js';
import adminAgreementsRouter from './routes/admin/agreements.js';
import adminCatalogRouter from './routes/admin/catalog.js';
import catalogRouter from './routes/catalog.js';
import adminClassesRouter from './routes/admin/classes.js';
import professorRouter from './routes/professor.js';
import bookingsRouter from './routes/bookings.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1); // detrás de Nginx en el VPS

// GET /health — comprueba ambos pools
app.get('/health', async (_req, res) => {
  const db = await pingAll();
  const healthy = db.app.ok && db.service.ok;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db,
    timestamp: new Date().toISOString(),
  });
});

app.use('/auth', authRouter);
app.use('/me', meRouter);
app.use('/agreements', agreementsRouter);
app.use('/admin/agreements', adminAgreementsRouter);
app.use('/admin', adminCatalogRouter);
app.use('/admin', adminClassesRouter);
app.use('/professor', professorRouter);
app.use('/bookings', bookingsRouter);
app.use('/', catalogRouter);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[kaizen] escuchando en http://127.0.0.1:${PORT}`);
});

// Cierre limpio
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[kaizen] ${sig} recibido, cerrando…`);
    server.close();
    await closePools();
    process.exit(0);
  });
}