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
import sessionsRouter from './routes/sessions.js';
import attendanceRouter from './routes/attendance.js';
import adminCheckinRouter from './routes/admin/checkin.js';
import adminBillingRouter from './routes/admin/billing.js';
import adminProfilesRouter from './routes/admin/profiles.js';
import profilesRouter from './routes/profiles.js';
import rankingsRouter from './routes/rankings.js';
import tabletRouter from './routes/tablet.js';
import checkinRouter from './routes/checkin.js';
import billingRouter from './routes/billing.js';
import webhooksRouter from './routes/webhooks.js';
import { startNoticeWorker } from './services/notices.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use('/webhooks', webhooksRouter); // antes de express.json: necesita el cuerpo crudo
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
app.use('/admin', adminCheckinRouter);
app.use('/admin', adminBillingRouter);
app.use('/admin', adminProfilesRouter);
app.use('/tablet', tabletRouter);
app.use('/checkin', checkinRouter);
app.use('/professor', professorRouter);
app.use('/bookings', bookingsRouter);
app.use('/billing', billingRouter);
app.use('/sessions', sessionsRouter); // antes que attendanceRouter: su requireRole cierra todo /sessions
app.use('/sessions', attendanceRouter);
app.use('/profiles', profilesRouter);
app.use('/rankings', rankingsRouter);
app.use('/', catalogRouter);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[kaizen] escuchando en http://127.0.0.1:${PORT}`);
});
const stopNoticeWorker = startNoticeWorker(); // avisos por email (B10.6, ADR 0008)

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