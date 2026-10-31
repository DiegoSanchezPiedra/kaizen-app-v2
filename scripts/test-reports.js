// B17: informes (CONTEXT § Informes). Las reglas (SQL) se prueban llamando al servicio con una transacción de
// servicePool que se deshace al final; cada caso usa sus propias disciplinas y filtra por ellas, y la foto, días de
// 2020 (sin datos reales). Los permisos van por HTTP como app_user, con fixtures confirmados que se borran al acabar.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminReportsRouter from '../src/routes/admin/reports.js';
import professorRouter from '../src/routes/professor.js';
import { getSubscriptionStats, getSessionStats, getStudentStats } from '../src/services/reports.js';
import { today } from '../src/services/sessions.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const tag = `trep${crypto.randomBytes(3).toString('hex')}`;
const TZ = 'Europe/Madrid';
const local = (ts) => `'${ts}'::timestamp AT TIME ZONE '${TZ}'`;
const ZERO = { sessions: 0, capacity: 0, booked: 0, occupancy: null, present: 0, absent: 0, unrecorded: 0, late: 0 };

const fixtures = (c) => {
  const f = {
    async person(role, { name, birth = null } = {}) {
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
        [id, name ?? `${tag}-${role}-${id.slice(0, 6)}`, birth]);
      await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
      return id;
    },
    async discipline(name, { open = false, active = true } = {}) {
      return (await c.query(`INSERT INTO disciplines (name, is_open, is_active) VALUES ($1, $2, $3) RETURNING id`,
        [`${tag}-${name}`, open, active])).rows[0].id;
    },
    async cls(disc, trainer, weekday = 2, time = '19:00') {
      return (await c.query(`INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, starts_on)
                             VALUES ($1, $2, $3, $4, 60, 10, '2020-01-01') RETURNING id`, [disc, trainer, weekday, time])).rows[0].id;
    },
    // Sesión de una hora: suelta, o de una clase (cls) con su profesor habitual (classTrainer) y quizá un sustituto.
    async session(disc, at, { trainer, cap = 10, cls = null, classTrainer = null, closed = false, cancelled = false } = {}) {
      trainer ??= await f.person('profesor');
      const k = cls ? [cls, classTrainer ?? trainer, 60, cap] : [null, null, null, null]; // class_* solo con clase
      return (await c.query(
        `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status, cancelled_at,
                                     attendance_closed_at, class_id, slot, class_trainer_id, class_duration_min, class_capacity)
         VALUES ($1, $2, ${at}, ${at} + interval '1 hour', 60, $3, $4, $5, $6, $7::uuid,
                 CASE WHEN $7::uuid IS NOT NULL THEN ${at} END, $8, $9, $10)
         RETURNING id`,
        [disc, trainer, cap, cancelled ? 'cancelled' : 'scheduled', cancelled ? new Date() : null,
          closed ? new Date() : null, ...k])).rows[0].id;
    },
    // kind: 'confirmed' (con att 'present' | 'absent' | null), 'late' o 'student' (cancelada a tiempo).
    async book(session, student, kind = 'confirmed', att = null) {
      const cancelled = kind !== 'confirmed';
      const { rows: [b] } = await c.query(
        `INSERT INTO bookings (session_id, student_id, booked_by, status, cancel_reason, cancelled_at)
         VALUES ($1, $2, $2, $3, $4, CASE WHEN $5 THEN now() END) RETURNING id`,
        [session, student, cancelled ? 'cancelled' : 'confirmed', cancelled ? kind : null, cancelled]);
      if (att) {
        await c.query(`INSERT INTO attendance (session_id, student_id, booking_id, status, method) VALUES ($1, $2, $3, $4, 'manual')`,
          [session, student, b.id, att]);
      }
    },
    async students(n) { const r = []; for (let i = 0; i < n; i++) r.push(await f.person('alumno')); return r; },
  };
  return f;
};

// ======================= Reglas (transacción deshecha) =======================
const c = await servicePool.connect();
let spN = 0;
const sp = async (fn) => {
  const name = `t${spN++}`;
  await c.query(`SAVEPOINT ${name}`);
  try { await fn(); } finally { await c.query(`ROLLBACK TO ${name}`); }
};
const F = fixtures(c);
const stats = (by, disc, from, to = from, more = {}) => getSessionStats(c, { by, from, to, discipline_id: String(disc), ...more });
const code = (p, expected) => assert.rejects(p, (e) => (assert.equal(e.code, expected), true));
try {
  await c.query('BEGIN');

  // ---------- Foto ----------
  await c.query(`DELETE FROM academy_stats_daily WHERE date < '2021-01-01'`);
  const photo = (d, a, n, x, mrr) => c.query(`INSERT INTO academy_stats_daily VALUES ($1, $2, 1, 2, $3, $4, $5)`, [d, a, n, x, mrr]);
  await run('foto por día: un día sin fila sale a null, sin rellenar', () => sp(async () => {
    await photo('2020-01-01', 5, 1, 0, 5000);
    await photo('2020-01-03', 7, 2, 1, 7000);
    const r = await getSubscriptionStats(c, { group: 'day', from: '2020-01-01', to: '2020-01-03' });
    assert.deepEqual(r.rows, [
      { date: '2020-01-01', active: 5, past_due: 1, unpaid: 2, new_subscriptions: 1, cancelled_subscriptions: 0, mrr_cents: 5000 },
      { date: '2020-01-02', active: null, past_due: null, unpaid: null, new_subscriptions: null, cancelled_subscriptions: null, mrr_cents: null },
      { date: '2020-01-03', active: 7, past_due: 1, unpaid: 2, new_subscriptions: 2, cancelled_subscriptions: 1, mrr_cents: 7000 },
    ]);
  }));
  await run('foto por mes: estados y MRR de la última foto, altas y bajas sumadas; mes sin fotos a null', () => sp(async () => {
    await photo('2020-01-20', 9, 3, 2, 9000); // la última del mes, insertada primero
    await photo('2020-01-10', 4, 1, 1, 4000);
    await photo('2020-03-05', 6, 0, 0, 6000);
    const r = await getSubscriptionStats(c, { group: 'month', from: '2020-01', to: '2020-03' });
    assert.deepEqual(r.rows, [
      { month: '2020-01', active: 9, past_due: 1, unpaid: 2, new_subscriptions: 4, cancelled_subscriptions: 3, mrr_cents: 9000, days_with_data: 2, days_in_month: 31 },
      { month: '2020-02', active: null, past_due: null, unpaid: null, new_subscriptions: null, cancelled_subscriptions: null, mrr_cents: null, days_with_data: 0, days_in_month: 29 },
      { month: '2020-03', active: 6, past_due: 1, unpaid: 2, new_subscriptions: 0, cancelled_subscriptions: 0, mrr_cents: 6000, days_with_data: 1, days_in_month: 31 },
    ]);
    const cur = today();
    const now = await getSubscriptionStats(c, { group: 'month', from: cur.slice(0, 7), to: cur.slice(0, 7) });
    assert.equal(now.rows[0].days_in_month, Number(cur.slice(8)) - 1); // mes en curso: hasta ayer
    const def = await getSubscriptionStats(c, { group: 'month' }); // por defecto, 12 meses con el en curso
    assert.deepEqual([def.rows.length, def.to], [12, cur.slice(0, 7)]);
  }));

  // ---------- Sesiones ----------
  await run('sesiones: cuenta la celebrada; no la cancelada, la retroactiva, la en curso ni la futura; la suelta sí, en class_id null', () => sp(async () => {
    const X = await F.discipline('X');
    const p = await F.person('profesor');
    const C = await F.cls(X, p);
    const [s1] = await F.students(1);
    const cur = today().slice(0, 7);
    const counted = await F.session(X, `now() - interval '3 hours'`, { cls: C, classTrainer: p });
    await F.book(counted, s1);
    await F.session(X, `now() - interval '5 hours'`, { cls: C, classTrainer: p, cancelled: true }); // cancelada
    const retro = await F.session(X, `now() - interval '7 hours'`, { cls: C, classTrainer: p });
    await F.book(retro, s1);
    await c.query(`UPDATE class_sessions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [retro]); // retroactiva
    await F.session(X, `now() - interval '30 minutes'`, { cls: C, classTrainer: p }); // en curso
    await F.session(X, `now() + interval '1 day'`, { cls: C, classTrainer: p }); // futura
    await F.session(X, `now() - interval '9 hours'`); // suelta
    // Las de "now()" pueden caer en el mes anterior el día 1 de madrugada: rango de dos meses.
    const prev = (await c.query(`SELECT to_char((now() AT TIME ZONE '${TZ}') - interval '1 day', 'YYYY-MM') AS m`)).rows[0].m;
    const r = await stats('class', X, prev, cur);
    assert.deepEqual(r.rows.map((x) => [x.class_id, x.total.sessions, x.total.booked]), [[C, 1, 1], [null, 1, 0]]);
    assert.deepEqual(Object.keys(r.rows[1]), ['class_id', 'discipline', 'months', 'total']);
    assert.deepEqual([r.rows[0].weekday, r.rows[0].start_time, r.rows[0].trainer.id], [2, '19:00', p]);
    assert.deepEqual([r.total, r.limit, r.offset], [2, 25, 0]);
  }));
  await run('sesiones: cuentan en el mes de Madrid en que empiezan (31 a las 23:30 y 1 a las 00:30)', () => sp(async () => {
    const X = await F.discipline('X');
    await F.session(X, local('2026-08-31 23:30'));
    await F.session(X, local('2026-09-01 00:30')); // 31 de agosto en UTC
    await F.session(X, local('2026-09-30 23:30'));
    const r = await stats('discipline', X, '2026-08', '2026-09');
    assert.deepEqual(r.rows[0].months.map((m) => [m.month, m.sessions]), [['2026-08', 1], ['2026-09', 2]]);
    assert.deepEqual(r.rows[0].discipline, { id: X, name: `${tag}-X` });
  }));
  await run('ocupación: razón de sumas (4/4 y 0/30 no dan 0,5), null sin sesiones; meses sin sesiones con ceros', () => sp(async () => {
    const X = await F.discipline('X');
    const full = await F.session(X, local('2026-05-05 18:00'), { cap: 4 });
    for (const s of await F.students(4)) await F.book(full, s);
    await F.session(X, local('2026-05-06 18:00'), { cap: 30 });
    const r = await stats('discipline', X, '2026-04', '2026-05');
    assert.deepEqual(r.rows[0].months[0], { month: '2026-04', ...ZERO });
    assert.equal(r.rows[0].months[1].occupancy, 0.118);
    assert.deepEqual([r.rows[0].total.capacity, r.rows[0].total.booked, r.rows[0].total.occupancy], [34, 4, 0.118]);
  }));
  await run('asistencia: presentes con la lista abierta; presentes + faltas + sin registrar = reservas; tardías aparte', () => sp(async () => {
    const X = await F.discipline('X');
    const st = await F.students(7);
    const closed = await F.session(X, local('2026-05-05 18:00'), { closed: true });
    await F.book(closed, st[0], 'confirmed', 'present');
    await F.book(closed, st[1], 'confirmed', 'present');
    await F.book(closed, st[2], 'confirmed', 'absent');
    await F.book(closed, st[3], 'late'); // tardía: en mayo (su sesión), aunque se canceló hoy
    await F.book(closed, st[4], 'student'); // cancelada a tiempo: nada
    const open = await F.session(X, local('2026-05-12 18:00'));
    await F.book(open, st[0], 'confirmed', 'present');
    await F.book(open, st[1]);
    await F.book(open, st[2]);
    const gone = await F.session(X, local('2026-05-19 18:00'));
    await F.book(gone, st[5], 'late');
    await c.query(`UPDATE class_sessions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [gone]); // después
    const t = (await stats('discipline', X, '2026-05')).rows[0].total;
    assert.deepEqual(t, { sessions: 2, capacity: 20, booked: 6, occupancy: 0.3, present: 3, absent: 1, unrecorded: 2, late: 1 });
    assert.equal(t.present + t.absent + t.unrecorded, t.booked);
  }));
  await run('disciplina abierta: su sesión cuenta solo en ella', () => sp(async () => {
    const X = await F.discipline('X');
    const O = await F.discipline('O', { open: true });
    const s = await F.session(O, local('2026-05-05 18:00'));
    const [a] = await F.students(1);
    await c.query(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
                   SELECT gen_random_uuid(), $1, $1, id, 'active', 'sub_test_' || gen_random_uuid() FROM plans LIMIT 1`, [a]);
    await F.book(s, a, 'confirmed', 'present');
    await F.session(X, local('2026-05-06 18:00')); // a no viene a X: el reparto de horas de B14 no aplica
    assert.equal((await stats('discipline', O, '2026-05')).rows[0].total.sessions, 1);
    assert.deepEqual((await stats('discipline', X, '2026-05')).rows[0].total.booked, 0);
  }));

  // ---------- Alumnos ----------
  await run('alumnos: sale quien tiene reserva o tardía, por nombre; el hijo solo con el nombre; paginación', () => sp(async () => {
    const X = await F.discipline('X');
    const b = await F.person('alumno', { name: `${tag}-B` });
    const a = await F.person('alumno', { name: `${tag}-A` });
    const kid = await F.person('alumno', { name: `${tag}-C`, birth: '2015-01-01' });
    const nobody = await F.person('alumno', { name: `${tag}-0` });
    const s1 = await F.session(X, local('2026-05-05 18:00'), { closed: true });
    await F.book(s1, b, 'confirmed', 'present');
    await F.book(s1, a, 'late');
    await F.book(s1, kid, 'confirmed', 'absent');
    await F.book(s1, nobody, 'student');
    const s2 = await F.session(X, local('2026-05-12 18:00'));
    await F.book(s2, b);
    const r = await getStudentStats(c, { from: '2026-05', to: '2026-05', discipline_id: String(X) });
    assert.deepEqual(r.rows, [
      { id: a, name: `${tag}-A`, bookings: 0, present: 0, absent: 0, unrecorded: 0, late: 1 },
      { id: b, name: `${tag}-B`, bookings: 2, present: 1, absent: 0, unrecorded: 1, late: 0 },
      { id: kid, name: `${tag}-C`, bookings: 1, present: 0, absent: 1, unrecorded: 0, late: 0 },
    ]);
    const p = await getStudentStats(c, { from: '2026-05', to: '2026-05', discipline_id: String(X), limit: '1', offset: '1' });
    assert.deepEqual([p.rows.map((x) => x.id), p.total, p.limit, p.offset], [[b], 3, 1, 1]);
    const past = await getStudentStats(c, { from: '2026-05', to: '2026-05', discipline_id: String(X), offset: '10' });
    assert.deepEqual([past.rows, past.total], [[], 3]);
  }));

  // ---------- Validación ----------
  await run('validación: invalid_range, invalid_field e invalid_pagination', async () => {
    await code(getSessionStats(c, { by: 'discipline', from: '2026-05', to: '2026-04' }), 'invalid_range');
    await code(getSessionStats(c, { by: 'discipline', from: '2025-05', to: '2026-05' }), 'invalid_range'); // 13 meses
    await code(getStudentStats(c, { from: '2025-05', to: '2026-05' }), 'invalid_range');
    await code(getSubscriptionStats(c, { group: 'day', from: '2026-01-01', to: '2026-04-03' }), 'invalid_range'); // 93 días
    await getSubscriptionStats(c, { group: 'day', from: '2026-01-01', to: '2026-04-02' }); // 92 sí
    await code(getSubscriptionStats(c, { group: 'month', from: '2024-05', to: '2026-05' }), 'invalid_range'); // 25 meses
    await getSubscriptionStats(c, { group: 'month', from: '2024-06', to: '2026-05' }); // 24 sí
    await code(getSessionStats(c, { by: 'discipline', from: '2026-5' }), 'invalid_field');
    await code(getSessionStats(c, { by: 'discipline', discipline_id: 'x' }), 'invalid_field');
    await code(getSessionStats(c, { by: 'student' }), 'invalid_field');
    await code(getSubscriptionStats(c, {}), 'invalid_field');
    await code(getSubscriptionStats(c, { group: 'day', from: '2026-13-01' }), 'invalid_field');
    await code(getSubscriptionStats(c, { group: 'month', from: '2026-05-01' }), 'invalid_field');
    await code(getSessionStats(c, { by: 'class', limit: '0' }), 'invalid_pagination');
    await code(getStudentStats(c, { limit: '101' }), 'invalid_pagination');
    await code(getStudentStats(c, { offset: '-1' }), 'invalid_pagination');
    const future = await getSessionStats(c, { by: 'discipline', from: '2030-01', to: '2030-02' }); // futuro: no es error
    assert.deepEqual(future.rows, []);
  });
} finally {
  await c.query('ROLLBACK');
  c.release();
}

// ======================= Permisos por HTTP (fixtures confirmados) =======================
const H = fixtures(servicePool);
const who = {};
const role = {};
const created = [];
const person = async (k, r, opts) => { role[k] = r; who[k] = await H.person(r, opts); created.push(who[k]); };
for (const [k, r] of [['admin', 'admin'], ['p1', 'profesor'], ['p2', 'profesor'], ['p3', 'profesor'],
  ['alu', 'alumno'], ['tutor', 'tutor']]) await person(k, r);
await person('child', 'alumno', { birth: '2015-01-01' });
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [who.tutor, who.child]);
const OFF = await H.discipline('off');
const OFF2 = await H.discipline('off2');
const D = await H.discipline('D');
const C = await H.cls(D, who.p1);
const sessions = [
  await H.session(OFF, local('2026-06-02 18:00'), { trainer: who.p1 }),
  await H.session(D, local('2026-06-03 18:00'), { trainer: who.p2 }),
  // Sesión de la clase de p1 en la que lo sustituye p3: es de p3.
  await H.session(D, local('2026-06-09 19:00'), { trainer: who.p3, cls: C, classTrainer: who.p1 }),
];
await H.session(OFF2, local('2026-06-04 18:00'), { trainer: who.p2 }).then((id) => sessions.push(id));
await H.book(sessions[2], who.child, 'confirmed', 'present');
await servicePool.query(`UPDATE disciplines SET is_active = false WHERE id = ANY($1::bigint[])`, [[OFF, OFF2]]);

const app = express().use(express.json()).use('/admin/reports', adminReportsRouter).use('/professor', professorRouter)
  .use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (path, k) => {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${signToken({ sub: who[k], role: role[k] })}` } });
  return { status: res.status, body: await res.json() };
};
const realError = console.error; // el errorHandler registra cada 4xx esperado
const Q = 'from=2026-06&to=2026-06';
try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('profesor: solo sus sesiones; la sustituida es del sustituto, con la clase del habitual', async () => {
    const mine = async (k, by = 'discipline') => (await http(`/professor/reports/sessions?by=${by}&${Q}`, k)).body.rows;
    assert.deepEqual((await mine('p1')).map((r) => [r.discipline.name, r.total.sessions]), [[`${tag}-off`, 1]]);
    assert.deepEqual((await mine('p2')).map((r) => [r.discipline.name, r.total.sessions]),
      [[`${tag}-D`, 1], [`${tag}-off2`, 1]]);
    const p3 = await mine('p3', 'class');
    assert.deepEqual(p3.map((r) => [r.class_id, r.discipline.id, r.total.sessions, r.total.present]), [[C, D, 1, 1]]);
    assert.deepEqual(p3[0].trainer, { id: who.p1, name: null }); // el nombre de otro profesor no lo ve
    // El admin ve las cuatro, con el nombre del habitual.
    const all = (await http(`/admin/reports/sessions?by=class&${Q}&discipline_id=${D}`, 'admin')).body.rows;
    assert.deepEqual(all.map((r) => [r.class_id, r.total.sessions]), [[C, 1], [null, 1]]);
    assert.equal(all[0].trainer.name, `${tag}-profesor-${who.p1.slice(0, 6)}`);
  });
  await run('profesor: ve la disciplina desactivada de su sesión pasada (024) en informes y /professor/sessions', async () => {
    const list = await http('/professor/sessions?from=2026-06-01&to=2026-06-30', 'p1');
    assert.deepEqual(list.body.sessions.map((s) => [s.id, s.discipline_name]), [[sessions[0], `${tag}-off`]]);
    const one = await http(`/professor/sessions/${sessions[0]}`, 'p1');
    assert.deepEqual([one.status, one.body.session?.discipline_name], [200, `${tag}-off`]);
    const seen = (uid) => withRls({ uid, role: 'profesor' }, async (cl) =>
      (await cl.query(`SELECT id FROM disciplines WHERE id = ANY($1::bigint[]) ORDER BY id`, [[OFF, OFF2]])).rows.map((r) => r.id));
    assert.deepEqual(await seen(who.p1), [OFF]); // la desactivada sin sesiones suyas (OFF2), no
    assert.deepEqual(await seen(who.p3), []);
  });
  await run('admin: foto y alumnos por HTTP; un hijo sale solo con el nombre', async () => {
    const sub = await http('/admin/reports/subscriptions?group=day&from=2026-06-01&to=2026-06-02', 'admin');
    assert.deepEqual([sub.status, sub.body.rows.length], [200, 2]);
    const st = await http(`/admin/reports/students?${Q}&discipline_id=${D}`, 'admin');
    assert.deepEqual(st.body.rows.map((r) => Object.keys(r)), [['id', 'name', 'bookings', 'present', 'absent', 'unrecorded', 'late']]);
    assert.equal(st.body.rows[0].id, who.child);
  });
  await run('403: profesor, alumno y tutor en /admin/reports; alumno, tutor y admin en /professor/reports', async () => {
    for (const k of ['p1', 'alu', 'tutor']) {
      for (const p of ['subscriptions?group=day', 'sessions?by=discipline', 'students']) {
        assert.equal((await http(`/admin/reports/${p}`, k)).status, 403, `${k} ${p}`);
      }
    }
    for (const k of ['alu', 'tutor', 'admin']) {
      assert.equal((await http('/professor/reports/sessions?by=discipline', k)).status, 403, k);
    }
  });
  await run('reports.js no menciona salud, fecha de nacimiento ni servicePool', async () => {
    const src = readFileSync(new URL('../src/services/reports.js', import.meta.url), 'utf8');
    for (const w of ['student_health_info', 'birth_date', 'servicePool']) assert.ok(!src.includes(w), w);
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM classes WHERE id = $1`, [C]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [[OFF, OFF2, D]]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [created]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
