// src/app.js — la app de Express sin efectos al importarla (ni listen ni worker de avisos): la usan index.js y los E2E.
import 'dotenv/config';
import express from 'express';
import { pingAll } from './config/database.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { slowLog } from './middleware/slowLog.js';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import agreementsRouter from './routes/agreements.js';
import adminAgreementsRouter from './routes/admin/agreements.js';
import adminCatalogRouter from './routes/admin/catalog.js';
import catalogRouter from './routes/catalog.js';
import adminClassesRouter from './routes/admin/classes.js';
import adminSessionsRouter from './routes/admin/sessions.js';
import professorRouter from './routes/professor.js';
import bookingsRouter from './routes/bookings.js';
import sessionsRouter from './routes/sessions.js';
import attendanceRouter from './routes/attendance.js';
import adminCheckinRouter from './routes/admin/checkin.js';
import adminBillingRouter from './routes/admin/billing.js';
import adminProfilesRouter from './routes/admin/profiles.js';
import adminReportsRouter from './routes/admin/reports.js';
import adminPanelRouter from './routes/admin/panel.js';
import adminEventsRouter from './routes/admin/events.js';
import eventsRouter from './routes/events.js';
import avatarsRouter from './routes/avatars.js';
import profilesRouter from './routes/profiles.js';
import rankingsRouter from './routes/rankings.js';
import tabletRouter from './routes/tablet.js';
import checkinRouter from './routes/checkin.js';
import clockRouter from './routes/clock.js';
import adminClockRouter from './routes/admin/clock.js';
import billingRouter from './routes/billing.js';
import webhooksRouter from './routes/webhooks.js';
import pushRouter from './routes/push.js';

const app = express();

app.use(slowLog);
app.use('/webhooks', webhooksRouter); // antes de express.json: necesita el cuerpo crudo
app.use(express.json({ limit: '1mb' }));
// Saltos de proxy de confianza para req.ip (el rate limiting depende de ella): 1 = Nginx en el VPS; 2 = Tailscale Funnel + Nginx (staging).
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

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
app.use('/me/clock', clockRouter); // antes que /me
app.use('/me', meRouter);
app.use('/agreements', agreementsRouter);
app.use('/admin/agreements', adminAgreementsRouter);
app.use('/admin', adminCatalogRouter);
app.use('/admin', adminClassesRouter);
app.use('/admin', adminSessionsRouter);
app.use('/admin', adminCheckinRouter);
app.use('/admin', adminBillingRouter);
app.use('/admin', adminProfilesRouter);
app.use('/admin', adminPanelRouter);
app.use('/admin', adminEventsRouter);
app.use('/admin', adminClockRouter);
app.use('/admin/reports', adminReportsRouter);
app.use('/tablet', tabletRouter);
app.use('/checkin', checkinRouter);
app.use('/professor', professorRouter);
app.use('/bookings', bookingsRouter);
app.use('/events', eventsRouter);
app.use('/billing', billingRouter);
app.use('/sessions', sessionsRouter); // antes que attendanceRouter: su requireRole cierra todo /sessions
app.use('/sessions', attendanceRouter);
app.use('/profiles', profilesRouter);
app.use('/avatars', avatarsRouter); // sin token (ADR 0019)
app.use('/rankings', rankingsRouter);
app.use('/push', pushRouter);
app.use('/', catalogRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
