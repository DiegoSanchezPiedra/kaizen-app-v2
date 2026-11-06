// B23: Inicio del admin en vivo (GET /admin/home) y academy_stats_now, que solo deja pasar al admin. Por HTTP con un
// express en memoria y JWT firmados, con fixtures confirmados que se borran al acabar. Las cifras se comparan con las de
// antes de los fixtures: la base puede tener otros datos.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { appPool, servicePool, closePools } from '../src/config/database.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminPanelRouter from '../src/routes/admin/panel.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params);

const tag = `thome${crypto.randomBytes(3).toString('hex')}`;
const people = { admin: 'admin', prof: 'profesor', tutor: 'tutor', ana: 'alumno', leo: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
const subs = [];
const sessions = [];
let disc;
let plan;
const realError = console.error;

const app = express().use(express.json()).use('/admin', adminPanelRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (url, who = 'admin') => {
  const res = await fetch(base + url, { headers: { authorization: `Bearer ${signToken({ sub: U[who], role: people[who] })}` } });
  return { status: res.status, body: await res.json() };
};
// La función con el contexto RLS de un rol, como withRlsContext.
const statsAs = async (role) => {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true)`, [U.admin, role]);
    return (await c.query('SELECT * FROM academy_stats_now()')).rows[0];
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
};
// Mediodía de Madrid de hoy + `days`.
const noon = (days) => `(((now() AT TIME ZONE 'Europe/Madrid')::date + ${days}) + time '12:00') AT TIME ZONE 'Europe/Madrid'`;

try {
  for (const [k, role] of Object.entries(people)) {
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [U[k], `${tag}-${k}`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  }
  disc = (await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-bjj`])).rows[0].id;
  plan = (await q(`INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 4200, null) RETURNING id`, [`${tag}-p`])).rows[0].id;
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  const before = (await http('/admin/home')).body;

  const sub = async (student, status) => {
    const id = crypto.randomUUID();
    subs.push(id);
    await q(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
             VALUES ($1, $2, $2, $3, $4, $5)`, [id, U[student], plan, status, `sub_test_${id}`]);
  };
  await sub('ana', 'active');
  await sub('leo', 'past_due');

  const session = async (days, status = 'scheduled', at = noon(days)) => {
    const { rows: [s] } = await q(
      `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status, cancelled_at)
       VALUES ($1, $2, ${at}, ${at} + interval '60 min', 60, 12, $3::session_status,
               CASE WHEN $3::session_status = 'cancelled' THEN now() END) RETURNING id`, [disc, U.prof, status]);
    sessions.push(s.id);
    return s.id;
  };
  const book = async (sessionId, student, present) => {
    const { rows: [b] } = await q(
      `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed') RETURNING id`,
      [sessionId, U[student]]);
    if (present) {
      await q(`INSERT INTO attendance (session_id, student_id, booking_id, status, method) VALUES ($1, $2, $3, 'present', 'manual')`,
        [sessionId, U[student], b.id]);
    }
  };
  const today = await session(0);
  await book(today, 'ana', true);
  await book(today, 'leo', false);
  const cancelled = await session(0, 'cancelled');
  await book(cancelled, 'leo', true); // sesión cancelada: no cuenta como asistencia
  // Hace 7 días, una hora antes y un minuto después de esta hora (sin solaparse: mismo profesor): solo cuenta lo que ya
  // había empezado a esta hora.
  // shortcut: en la primera hora del día la de antes cae en el día anterior y el test fallaría; no lanzarlo de madrugada.
  const lastWeek = await session(-7, 'scheduled', `now() - interval '7 days 61 minutes'`);
  await book(lastWeek, 'ana', true);
  await book(lastWeek, 'leo', true);
  const lastWeekLater = await session(-7, 'scheduled', `now() - interval '7 days' + interval '1 minute'`);
  await book(lastWeekLater, 'ana', true);
  await session(-6); // la sesión de ayer de hace una semana no es «el mismo día»

  const home = (await http('/admin/home')).body;

  await run('cifras en vivo: la cuota nueva cuenta al momento, sin esperar a la foto', async () => {
    assert.equal(home.figures.active - before.figures.active, 1);
    assert.equal(home.figures.past_due - before.figures.past_due, 1);
    assert.equal(home.figures.new_subscriptions - before.figures.new_subscriptions, 2);
    assert.equal(home.figures.mrr_cents - before.figures.mrr_cents, 8400); // activa y en gracia
    assert.deepEqual(Object.keys(home.students).sort(), ['activos', 'impago', 'inactivos']);
    assert.equal(home.students.activos - before.students.activos, 2);
  });

  await run('asistencias de hoy y del mismo día de la semana pasada hasta esta hora (sin las canceladas)', async () => {
    assert.equal(home.attendance.today - before.attendance.today, 1);
    assert.equal(home.attendance.last_week - before.attendance.last_week, 2);
  });

  await run('sesiones de hoy con reservas y entradas; la cancelada también sale', async () => {
    const s = home.sessions.find((x) => x.id === today);
    assert.deepEqual([s.booked, s.present, s.capacity, s.status], [2, 1, 12, 'scheduled']);
    assert.equal(s.discipline.name, `${tag}-bjj`);
    assert.equal(s.trainer.display_name, `${tag}-prof`);
    assert.equal(home.sessions.find((x) => x.id === cancelled).status, 'cancelled');
    assert.ok(!home.sessions.some((x) => x.id === lastWeek));
  });

  await run('next: la próxima sesión programada que no ha empezado', async () => {
    if (home.next) {
      assert.equal(home.next.status, 'scheduled');
      assert.ok(new Date(home.next.starts_at) > new Date());
    }
  });

  await run('solo admin: 403 a alumno, tutor y profesor', async () => {
    for (const who of ['ana', 'tutor', 'prof']) assert.equal((await http('/admin/home', who)).status, 403, who);
  });

  await run('academy_stats_now: la RLS de un no admin recibe not_allowed (42501)', async () => {
    assert.equal((await statsAs('admin')).active, home.figures.active);
    for (const role of ['alumno', 'tutor', 'profesor', '']) {
      await assert.rejects(statsAs(role), (e) => e.code === '42501' && e.message === 'not_allowed', role);
    }
  });
} finally {
  console.error = realError;
  server.close();
  await q(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  if (plan) await q(`DELETE FROM plans WHERE id = $1`, [plan]);
  if (disc) await q(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
