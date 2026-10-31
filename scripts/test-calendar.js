// B6: calendario del alumno (CONTEXT § Clases y sesiones «Calendario»): todos ven todo, con la cobertura y la
// reserva de cada sujeto. Las rutas se prueban por HTTP con un express en memoria (sin la API levantada) y un JWT firmado.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import sessionsRouter from '../src/routes/sessions.js';
import attendanceRouter from '../src/routes/attendance.js';
import { listCalendar } from '../src/services/sessions.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

const tag = `tcal${crypto.randomBytes(3).toString('hex')}`;
// [rol, fecha de nacimiento]
const people = {
  admin: ['admin', null], prof1: ['profesor', null], prof2: ['profesor', null],
  aluNone: ['alumno', null], aluN: ['alumno', null], aluAll: ['alumno', null], aluOther: ['alumno', null],
  tutor: ['tutor', null], child1: ['alumno', yearsAgo(10)], child2: ['alumno', yearsAgo(12)], child18: ['alumno', yearsAgo(19)],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, [role, birth]] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3), ($1, $4)`,
  [U.tutor, U.child1, U.child2, U.child18]);

// A y B normales, M solo menores, R retirada.
const D = {};
for (const [k, minors, active] of [['A', false, true], ['B', false, true], ['M', true, true], ['R', false, true]]) {
  D[k] = (await servicePool.query(`INSERT INTO disciplines (name, minors_only, is_active) VALUES ($1, $2, $3) RETURNING id`,
    [`${tag}-${k}`, minors, active])).rows[0].id;
}
const planN = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, 1) RETURNING id`, [`${tag}-N`])).rows[0].id;
const planAll = (await servicePool.query( // «todas» sin lista de elegibles: cualquiera
  `INSERT INTO plans (name, price_cents) VALUES ($1, 2000) RETURNING id`, [`${tag}-all`])).rows[0].id;
const sub = { aluN: crypto.randomUUID(), aluAll: crypto.randomUUID(), child1: crypto.randomUUID() };
for (const [k, plan, payer] of [['aluN', planN, 'aluN'], ['aluAll', planAll, 'aluAll'], ['child1', planN, 'tutor']]) {
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [sub[k], U[k], U[payer], plan, `sub_test_${sub[k]}`]);
}
await servicePool.query(`INSERT INTO subscription_disciplines VALUES ($1, $2), ($3, $4)`, [sub.aluN, D.A, sub.child1, D.B]);

// Clase de B de prof1; su sesión sB la imparte prof2 (sustituto).
const classB = (await servicePool.query(
  `INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity)
   VALUES ($1, $2, 1, '18:00', 60, 10) RETURNING id`, [D.B, U.prof1])).rows[0].id;
const session = async (disc, trainer, offset, status = 'scheduled', classId = null) => (await servicePool.query(
  `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, location, status,
                               cancelled_at, class_trainer_id, class_duration_min, class_capacity, class_location)
   VALUES ($1, $2, $3, now() + $4::interval, CASE WHEN $1::uuid IS NOT NULL THEN now() + $4::interval END,
           now() + $4::interval + interval '60 min', 60, 10, 'tatami 1', $5::session_status,
           CASE WHEN $5::session_status = 'cancelled' THEN now() END,
           CASE WHEN $1::uuid IS NOT NULL THEN $3::uuid END, CASE WHEN $1::uuid IS NOT NULL THEN 60 END,
           CASE WHEN $1::uuid IS NOT NULL THEN 10 END, CASE WHEN $1::uuid IS NOT NULL THEN 'tatami 1' END) RETURNING id`,
  [classId, disc, U[trainer], offset, status])).rows[0].id;
const S = {
  a: await session(D.A, 'prof1', '2 days'),
  b: await session(D.B, 'prof2', '3 days', 'scheduled', classB),
  m: await session(D.M, 'prof1', '4 days'),
  cancelled: await session(D.A, 'prof1', '5 days', 'cancelled'),
  past: await session(D.A, 'prof1', '-2 days'),
  retired: await session(D.R, 'prof1', '-3 days'),
};
await servicePool.query(`UPDATE disciplines SET is_active = false WHERE id = $1`, [D.R]);
const book = (s, k, status = 'confirmed') => servicePool.query(
  `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, $3) RETURNING id`, [s, U[k], status]);
const bA = (await book(S.a, 'aluN')).rows[0].id;
const bB = (await book(S.b, 'child1')).rows[0].id;
await servicePool.query( // una cancelada no cuenta como reserva
  `INSERT INTO bookings (session_id, student_id, booked_by, status, cancel_reason, cancelled_at)
   VALUES ($1, $2, $2, 'cancelled', 'student', now())`, [S.a, U.aluNone]);

const RANGE = { from: day(-5), to: day(10) };
const mine = (rows) => Object.fromEntries(rows.filter((r) => Object.values(S).includes(r.id))
  .map((r) => [Object.keys(S).find((k) => S[k] === r.id), r]));
const cal = async (who, q = {}) => mine(await withRls({ uid: U[who], role: people[who][0] },
  (c) => listCalendar(c, { id: U[who], role: people[who][0] }, { ...RANGE, ...q }), { commit: false }));
const sql = (who, text, params) => withRls({ uid: U[who], role: people[who][0] },
  (c) => c.query(text, params), { commit: false });

// Montado como en index.js: el calendario antes que asistencia.
const app = express().use(express.json()).use('/sessions', sessionsRouter).use('/sessions', attendanceRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (path, who) => {
  const headers = who ? { authorization: `Bearer ${signToken({ sub: U[who], role: people[who][0] })}` } : {};
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
};
const realError = console.error; // el errorHandler registra cada 4xx esperado

try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('alumno sin suscripción ve todo (también solo menores y canceladas) con covered false', async () => {
    const s = await cal('aluNone');
    assert.deepEqual(Object.keys(s).sort(), ['a', 'b', 'cancelled', 'm', 'past']);
    for (const r of Object.values(s)) {
      assert.equal(r.covered, false);
      assert.equal(r.booking, null); // su reserva cancelada en a no cuenta
    }
    assert.equal(s.cancelled.status, 'cancelled');
    assert.deepEqual(s.a.discipline, { id: Number(D.A), name: `${tag}-A` });
    assert.equal(s.a.location, 'tatami 1');
    assert.equal(s.a.capacity, 10);
  });
  await run('celebrada: pasada y programada; la cancelada y la futura no', async () => {
    const s = await cal('aluNone');
    assert.equal(s.past.held, true);
    assert.equal(s.a.held, false);
    assert.equal(s.cancelled.held, false);
  });
  await run('nombre del profesor por trainer_names, también el sustituto', async () => {
    const s = await cal('aluNone');
    assert.deepEqual(s.a.trainer, { id: U.prof1, display_name: `${tag}-prof1` });
    assert.deepEqual(s.b.trainer, { id: U.prof2, display_name: `${tag}-prof2` });
  });
  await run('plan de N: cubre solo su disciplina; ve su reserva', async () => {
    const s = await cal('aluN');
    assert.equal(s.a.covered, true);
    assert.equal(s.past.covered, true);
    assert.equal(s.b.covered, false);
    assert.equal(s.m.covered, false);
    assert.deepEqual(s.a.booking, { id: bA, status: 'confirmed' });
    assert.equal(s.b.booking, null);
  });
  await run('plan de «todas»: cubre A y B, no la de solo menores (adulto)', async () => {
    const s = await cal('aluAll');
    assert.equal(s.a.covered, true);
    assert.equal(s.b.covered, true);
    assert.equal(s.m.covered, false);
  });
  await run('tutor: cobertura y reserva por hijo vigente (no el de 18 sin reclamar), sin cobertura propia', async () => {
    const s = await cal('tutor');
    assert.deepEqual(Object.keys(s).sort(), ['a', 'b', 'cancelled', 'm', 'past']);
    assert.deepEqual(s.b.covered, { [U.child1]: true, [U.child2]: false });
    assert.deepEqual(s.a.covered, { [U.child1]: false, [U.child2]: false });
    assert.deepEqual(s.b.booking, { [U.child1]: { id: bB, status: 'confirmed' }, [U.child2]: null });
  });
  await run('admin: sin profile_id no hay covered ni booking; con profile_id, los de ese alumno', async () => {
    const s = await cal('admin');
    assert.ok(!('covered' in s.a) && !('booking' in s.a));
    const p = await cal('admin', { profile_id: U.aluN });
    assert.equal(p.a.covered, true);
    assert.equal(p.b.covered, false);
    assert.deepEqual(p.a.booking, { id: bA, status: 'confirmed' });
  });
  await run('disciplina retirada: el alumno no ve su sesión pasada; el admin sí (aceptado)', async () => {
    assert.ok(!('retired' in await cal('aluNone')));
    assert.ok('retired' in await cal('admin'));
  });
  await run('filtro discipline_id', async () => {
    assert.deepEqual(Object.keys(await cal('aluNone', { discipline_id: String(D.B) })), ['b']);
  });
  await run('session_coverage solo responde sobre uno mismo, un hijo vigente o al admin', async () => {
    const cov = async (who, k, d) => (await sql(who, `SELECT session_coverage($1, $2) AS v`, [U[k], d])).rows[0].v;
    assert.equal(await cov('tutor', 'child1', D.B), true);
    assert.equal(await cov('tutor', 'aluN', D.A), null); // perfil ajeno
    assert.equal(await cov('tutor', 'child18', D.A), null); // 18 sin reclamar
    assert.equal(await cov('aluOther', 'aluN', D.A), null);
    assert.equal(await cov('prof1', 'aluN', D.A), null);
    assert.equal(await cov('aluN', 'aluN', D.A), true);
    assert.equal(await cov('admin', 'aluN', D.A), true);
    const { rows: [r] } = await servicePool.query(
      `SELECT has_function_privilege('app_user', 'covers(uuid, bigint)', 'EXECUTE') AS c,
              has_function_privilege('app_user', 'session_coverage(uuid, bigint)', 'EXECUTE') AS s`);
    assert.deepEqual(r, { c: false, s: true });
  });
  await run('profesor: la RLS solo le deja ver sus sesiones', async () => {
    const { rows } = await sql('prof2', `SELECT id FROM class_sessions WHERE id = ANY($1::uuid[])`, [Object.values(S)]);
    assert.deepEqual(rows.map((r) => r.id), [S.b]);
  });
  await run('rangos y parámetros inválidos → 400', async () => {
    const bad = async (q, code) => assert.rejects(cal('aluNone', q), (e) => e.status === 400 && e.code === code);
    await bad({ from: day(5), to: day(1) }, 'invalid_range');
    await bad({ from: day(0), to: day(92) }, 'invalid_range');
    await bad({ from: '2026-13-01' }, 'invalid_field');
    await bad({ discipline_id: 'x' }, 'invalid_field');
    await bad({ profile_id: U.aluN }, 'invalid_field'); // solo el admin
    await cal('aluNone', { from: day(0), to: day(91) }); // 92 días: vale
  });

  // ---------- HTTP ----------
  await run('HTTP: alumno 200 (sin perfil completo), tutor 200, admin con profile_id 200', async () => {
    const q = `from=${RANGE.from}&to=${RANGE.to}`;
    const a = await http(`/sessions/calendar?${q}`, 'aluN');
    assert.equal(a.status, 200);
    assert.equal(a.body.sessions.find((r) => r.id === S.a).covered, true);
    const t = await http(`/sessions/calendar?${q}`, 'tutor');
    assert.equal(t.status, 200);
    assert.equal(t.body.sessions.find((r) => r.id === S.b).covered[U.child1], true);
    const ad = await http(`/sessions/calendar?${q}&profile_id=${U.aluAll}`, 'admin');
    assert.equal(ad.status, 200);
    assert.equal(ad.body.sessions.find((r) => r.id === S.b).covered, true);
  });
  await run('HTTP: profesor 403, sin token 401, 400 de rango y de profile_id', async () => {
    assert.equal((await http('/sessions/calendar', 'prof1')).status, 403);
    assert.equal((await http('/sessions/calendar')).status, 401);
    const r = await http(`/sessions/calendar?from=${day(0)}&to=${day(100)}`, 'aluN');
    assert.deepEqual([r.status, r.body.code ?? r.body.error?.code ?? r.body.error], [400, 'invalid_range']);
    assert.equal((await http('/sessions/calendar?profile_id=nope', 'admin')).status, 400);
  });
  await run('HTTP: la asistencia sigue cerrada al alumno', async () => {
    assert.equal((await http(`/sessions/${S.a}/attendance`, 'aluN')).status, 403);
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [Object.values(S)]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [Object.values(S)]);
  await servicePool.query(`DELETE FROM classes WHERE id = $1`, [classB]);
  await servicePool.query(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[planN, planAll]]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [Object.values(D)]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
