// B22.3: KPIs y filtros de Usuarios (GET /admin/profiles/stats, filtros de /admin/profiles). Solo alumnos (menores
// incluidos); «impago» = los alumnos que salen en Cobros › Morosos. Por HTTP con un express en memoria y JWT firmados,
// con fixtures confirmados que se borran al acabar.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminProfilesRouter from '../src/routes/admin/profiles.js';
import adminBillingRouter from '../src/routes/admin/billing.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const q = (sql, params) => servicePool.query(sql, params);

const tag = `tust${crypto.randomBytes(3).toString('hex')}`;
// [rol en user_roles (null = sin fila, cuenta como alumno), fecha de nacimiento]
const people = {
  admin: ['admin', null], prof: ['profesor', null], tutor: ['tutor', yearsAgo(40)],
  act: ['alumno', yearsAgo(30)], idle: ['alumno', yearsAgo(30)], all: ['alumno', yearsAgo(30)],
  grace: ['alumno', yearsAgo(30)], ins: ['alumno', yearsAgo(30)], other: ['alumno', yearsAgo(30)],
  gone: ['alumno', yearsAgo(30)], kid: [null, yearsAgo(10)], kid2: [null, yearsAgo(9)],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
const D = {};
const P = {};
const subs = [];
const sessions = [];
let insurance;
const realError = console.error;

const app = express().use(express.json()).use('/admin', adminProfilesRouter, adminBillingRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (url, who = 'admin') => {
  const res = await fetch(base + url, {
    headers: { authorization: `Bearer ${signToken({ sub: U[who], role: people[who][0] ?? 'alumno' })}` },
  });
  return { status: res.status, body: await res.json() };
};

try {
for (const [k, [role, birth]] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  if (role) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3)`, [U.tutor, U.kid, U.kid2]);

const disc = async (name) => (await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-${name}`])).rows[0].id;
D.X = await disc('X');
D.Y = await disc('Y');
// Las cuotas «de todas» de otros datos de la base también cubren X e Y: se cuenta lo que añaden estos fixtures.
const stats = async (d) => (await http(`/admin/profiles/stats?discipline_id=${d}`)).body;
const before = { X: await stats(D.X), Y: await stats(D.Y) };
const added = (now, was) => Object.fromEntries(Object.keys(now).map((k) => [k, now[k] - was[k]]));
const plan = async (name, max) => (await q(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, $2) RETURNING id`, [`${tag}-${name}`, max])).rows[0].id;
P.one = await plan('one', 1);
P.all = await plan('all', null); // sin elegibles = cualquiera
const sub = async (student, payer, planId, status, discipline) => {
  const id = crypto.randomUUID();
  subs.push(id);
  await q(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
           VALUES ($1, $2, $3, $4, $5, $6)`, [id, U[student], U[payer], planId, status, `sub_test_${id}`]);
  if (discipline) await q(`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [id, discipline]);
};
await sub('act', 'act', P.one, 'active', D.X);
await sub('idle', 'idle', P.one, 'active', D.X);
await sub('all', 'all', P.all, 'active');
await sub('grace', 'grace', P.one, 'past_due', D.X); // en gracia: no es moroso
await sub('ins', 'ins', P.one, 'active', D.X); // moroso por su seguro impagado
await sub('other', 'other', P.one, 'active', D.Y);
await sub('gone', 'gone', P.one, 'cancelled', D.X);
await sub('kid', 'tutor', P.one, 'past_due', D.X); // el tutor es moroso por kid2: kid también sale en Morosos
await sub('kid2', 'tutor', P.one, 'unpaid', D.X);
await sub('tutor', 'tutor', P.one, 'active', D.X); // tutores y profesores no cuentan
await sub('prof', 'prof', P.one, 'active', D.X);
insurance = crypto.randomUUID();
await q(`INSERT INTO insurances (id, student_id, payer_id, status, bracket, stripe_subscription_id)
         VALUES ($1, $2, $2, 'unpaid', 'adult', $3)`, [insurance, U.ins, `sub_test_${insurance}`]);

const attend = async (student, ago, status = 'scheduled') => {
  const { rows: [s] } = await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status, cancelled_at)
     VALUES ($1, $2, now() - $3::interval, now() - $3::interval + interval '60 min', 60, 10, $4::session_status,
             CASE WHEN $4::session_status = 'cancelled' THEN now() END) RETURNING id, starts_at`,
    [D.X, U.prof, ago, status]);
  sessions.push(s.id);
  const { rows: [b] } = await q(
    `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed') RETURNING id`,
    [s.id, U[student]]);
  await q(`INSERT INTO attendance (session_id, student_id, booking_id, status, method) VALUES ($1, $2, $3, 'present', 'manual')`,
    [s.id, U[student], b.id]);
  return s.starts_at;
};
const actAt = await attend('act', '2 days');
await attend('idle', '20 days');
await attend('idle', '1 day', 'cancelled'); // sesión cancelada: no cuenta
await attend('grace', '3 days');
await attend('ins', '26 hours');
await attend('other', '28 hours');
await attend('tutor', '30 hours');

const names = (r) => r.body.profiles.map((p) => p.display_name.slice(tag.length + 1)).sort();
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('stats por disciplina: activos, impago e inactivos; menores sí, tutores y profesores no', async () => {
    assert.equal((await http(`/admin/profiles/stats?discipline_id=${D.X}`)).status, 200);
    // activos: act, idle, all (plan de todas), grace; inactivos: idle (la cancelada no cuenta), all; impago: kid, kid2, ins
    assert.deepEqual(added(await stats(D.X), before.X), { activos: 4, impago: 3, inactivos: 2 });
    assert.deepEqual(added(await stats(D.Y), before.Y), { activos: 2, impago: 0, inactivos: 1 }); // other y all
  });

  await run('impago sin disciplina = alumnos distintos de Cobros › Morosos', async () => {
    const students = new Set();
    for (let offset = 0; ; offset += 100) {
      const r = await http(`/admin/billing/delinquents?limit=100&offset=${offset}`);
      for (const p of r.body.payers) for (const i of p.items) students.add(i.student_id);
      if (offset + 100 >= r.body.total) break;
    }
    for (const k of ['kid', 'kid2', 'ins']) assert.ok(students.has(U[k]), k);
    assert.ok(!students.has(U.grace));
    assert.equal((await http('/admin/profiles/stats')).body.impago, students.size);
  });

  await run('lista: estado, plan y última asistencia por fila', async () => {
    const r = await http(`/admin/profiles?q=${tag}&limit=100`);
    const by = Object.fromEntries(r.body.profiles.map((p) => [p.display_name.slice(tag.length + 1), p]));
    assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, p]) => [k, p.estado])), {
      admin: null, prof: null, tutor: null, act: 'activo', idle: 'inactivo', all: 'inactivo', grace: 'activo',
      ins: 'impago', other: 'activo', gone: 'sin_plan', kid: 'impago', kid2: 'impago',
    });
    assert.equal(by.act.plan_name, `${tag}-one`);
    assert.equal(by.all.plan_id, String(P.all));
    assert.equal(by.kid2.plan_name, `${tag}-one`); // la impagada es su plan
    assert.equal(by.gone.plan_name, null);
    assert.equal(new Date(by.act.last_attendance_at).getTime(), actAt.getTime());
    assert.equal(by.all.last_attendance_at, null);
  });

  await run('lista: filtros de disciplina, plan y estado (activo incluye inactivos)', async () => {
    const list = (f) => http(`/admin/profiles?q=${tag}&limit=100&${f}`);
    assert.deepEqual(names(await list(`discipline_id=${D.X}&estado=activo`)), ['act', 'all', 'grace', 'idle']);
    assert.deepEqual(names(await list(`discipline_id=${D.X}&estado=inactivo`)), ['all', 'idle']);
    assert.deepEqual(names(await list(`discipline_id=${D.X}&estado=impago`)), ['ins', 'kid', 'kid2']);
    assert.deepEqual(names(await list('estado=sin_plan')), ['gone']);
    assert.deepEqual(names(await list(`plan_id=${P.all}`)), ['all']);
    const page = await http(`/admin/profiles?q=${tag}&discipline_id=${D.X}&role=alumno&limit=2&offset=2`);
    assert.equal(page.body.profiles.length, 2);
    assert.equal(page.body.total, 7); // act, all, grace, idle, ins, kid, kid2
  });

  await run('validación de los filtros', async () => {
    for (const url of ['/admin/profiles?discipline_id=abc', '/admin/profiles?plan_id=1.5', '/admin/profiles?estado=prueba',
      '/admin/profiles/stats?discipline_id=-1']) {
      const r = await http(url);
      assert.deepEqual([r.status, r.body.code], [400, 'invalid_field'], url);
    }
  });

  await run('solo admin: 403 a alumno, tutor y profesor', async () => {
    for (const who of ['act', 'tutor', 'prof']) assert.equal((await http('/admin/profiles/stats', who)).status, 403, who);
  });
} finally {
  console.error = realError;
  server.close();
  await q(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM insurances WHERE id = $1`, [insurance]);
  await q(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await q(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [Object.values(P)]);
  await q(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [Object.values(D)]);
  await q(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tutor]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
