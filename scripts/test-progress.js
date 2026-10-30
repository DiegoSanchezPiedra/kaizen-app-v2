// B14: racha, horas, badges, ranking mensual y disciplina abierta (CONTEXT § Racha y logros, § Disciplina abierta).
// Las reglas (SQL) se prueban en una transacción de servicePool que se deshace al final: la racha mira toda la
// academia, así que dentro se cancelan las sesiones ajenas. Lo que va por HTTP (privacidad, ficha, ranking de una
// disciplina desactivada) usa fixtures confirmados que se borran al acabar.
// Las semanas relativas a hoy fallan si se ejecuta el lunes entre 00:00 y 00:01 de Madrid.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import meRouter from '../src/routes/me.js';
import profilesRouter from '../src/routes/profiles.js';
import rankingsRouter from '../src/routes/rankings.js';
import { getRanking } from '../src/services/progress.js';
import { updateDiscipline } from '../src/services/catalog.js';
import { createCheckout } from '../src/services/billing.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const tag = `tprog${crypto.randomBytes(3).toString('hex')}`;
const TZ = 'Europe/Madrid';
// Martes 18:00 (Madrid) de la semana k anterior a la actual; k = 0 → hace un minuto (semana en curso).
const wk = (k) => (k === 0 ? `now() - interval '1 minute'`
  : `(date_trunc('week', now() AT TIME ZONE '${TZ}') - interval '${k} weeks' + interval '1 day 18 hours') AT TIME ZONE '${TZ}'`);
const local = (ts) => `'${ts}'::timestamp AT TIME ZONE '${TZ}'`;
const monday = (k) => `(date_trunc('week', now() AT TIME ZONE '${TZ}') - interval '${k} weeks') AT TIME ZONE '${TZ}'`;

// Fixtures sobre un client (c): perfiles, sesiones (cada una con su profesor: el solape no aplica) y presentes.
const fixtures = (c) => {
  const f = {
    async person(role, { birth = null, pub = false, flags = {}, creds = true, name } = {}) {
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO profiles (id, display_name, birth_date, is_public, visible_fields) VALUES ($1, $2, $3, $4, $5)`,
        [id, name ?? `${tag}-${role}-${id.slice(0, 6)}`, birth, pub, flags]);
      await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
      if (creds) {
        await c.query(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@t.test`]);
      }
      return id;
    },
    async discipline(name, { open = false, minors = false, active = true } = {}) {
      return (await c.query(`INSERT INTO disciplines (name, is_open, minors_only, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
        [`${tag}-${name}`, open, minors, active])).rows[0].id;
    },
    async session(disc, at, min = 60) {
      const trainer = await f.person('profesor');
      return (await c.query(
        `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
         VALUES ($1, $2, ${at}, ${at} + $3 * interval '1 minute', $3, 10, 'scheduled') RETURNING id`,
        [disc, trainer, min])).rows[0].id;
    },
    async present(student, session) {
      const { rows: [b] } = await c.query(
        `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed') RETURNING id`,
        [session, student]);
      await c.query(`INSERT INTO attendance (session_id, student_id, booking_id, status, method)
                     VALUES ($1, $2, $3, 'present', 'manual')`, [session, student, b.id]);
      return session;
    },
    async attend(student, disc, at, min = 60) { return f.present(student, await f.session(disc, at, min)); },
    async subscribe(student, plan, chosen = []) {
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
                     VALUES ($1, $2, $2, $3, 'active', $4)`, [id, student, plan, `sub_test_${id}`]);
      for (const d of chosen) await c.query(`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [id, d]);
      return id;
    },
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
const as = (uid, role) =>
  c.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true)`, [uid, role]);
const F = fixtures(c);
try {
  await c.query('BEGIN');
  await c.query(`UPDATE class_sessions SET status = 'cancelled' WHERE status = 'scheduled'`);
  const admin = await F.person('admin');
  const X = await F.discipline('X');
  const Y = await F.discipline('Y');
  const O = await F.discipline('O', { open: true });
  const progress = async (student, month = null) => {
    await as(admin, 'admin');
    return (await c.query(`SELECT student_progress($1, $2::date) AS p`, [student, month])).rows[0].p;
  };
  const streak = async (s) => (await progress(s)).streak;
  const badges = async (s) => Object.fromEntries((await progress(s)).badges.map((b) => [b.code, b.earned_at]));
  const ts = async (expr) => (await c.query(`SELECT to_jsonb(${expr}) AS t`)).rows[0].t;
  const rankingOf = async (disc, month, opts = {}) => getRanking(c, { disciplineId: disc, month, ...opts });

  // ---------- Racha ----------
  await run('racha: semanas seguidas (con la en curso); dos presentes en una semana cuentan una', () => sp(async () => {
    const s = await F.person('alumno');
    for (const k of [3, 2, 1, 0]) await F.attend(s, X, wk(k));
    await F.attend(s, Y, `${wk(2)} + interval '1 day'`);
    assert.deepEqual(await streak(s), { current: 4, best: 4 });
  }));
  await run('racha: una semana sin presente la rompe; best > current', () => sp(async () => {
    const s = await F.person('alumno');
    const other = await F.person('alumno');
    for (const k of [7, 6, 5, 2, 1]) await F.attend(s, X, wk(k));
    for (const k of [4, 3]) await F.attend(other, X, wk(k)); // la academia celebró sesiones esas semanas
    assert.deepEqual(await streak(s), { current: 2, best: 3 });
  }));
  await run('racha: una semana sin sesiones en la academia se salta', () => sp(async () => {
    const s = await F.person('alumno');
    for (const k of [4, 3, 1]) await F.attend(s, X, wk(k));
    await F.session(X, `${wk(2)} + interval '2 hours'`, 60); // sesión cancelada: no cuenta como celebrada
    await c.query(`UPDATE class_sessions SET status = 'cancelled' WHERE starts_at = ${wk(2)} + interval '2 hours'`);
    assert.deepEqual(await streak(s), { current: 3, best: 3 });
  }));
  await run('racha: la semana en curso sin presente no la rompe', () => sp(async () => {
    const s = await F.person('alumno');
    const other = await F.person('alumno');
    for (const k of [2, 1]) await F.attend(s, X, wk(k));
    await F.attend(other, X, wk(0));
    assert.deepEqual(await streak(s), { current: 2, best: 2 });
  }));
  await run('racha: el corte es el lunes 00:00 de Madrid (también en los cambios de hora)', () => sp(async () => {
    // Domingo 23:30 y lunes 00:30 de Madrid caen el mismo domingo en UTC: en Madrid son dos semanas.
    for (const [sun, mon] of [['2025-10-26 23:30', '2025-10-27 00:30'], ['2026-03-29 23:30', '2026-03-30 00:30']]) {
      await sp(async () => {
        const s = await F.person('alumno');
        await F.attend(s, X, local(sun));
        await F.attend(s, X, local(mon));
        assert.equal((await streak(s)).best, 2, sun);
        // Y dos sesiones de la misma semana de Madrid (lunes 00:30 y domingo 23:30) cuentan una.
        const t = await F.person('alumno');
        await F.attend(t, X, local(mon));
        await F.attend(t, X, `${local(mon)} + interval '6 days 23 hours'`);
        assert.equal((await streak(t)).best, 1, mon);
      });
    }
  }));
  await run('racha: un presente sin cerrar suma; desmarcado, no', () => sp(async () => {
    const s = await F.person('alumno');
    for (const k of [2, 1]) await F.attend(s, X, wk(k));
    const open = await F.attend(s, X, wk(3)); // lista sin cerrar (attendance_closed_at NULL)
    assert.equal((await streak(s)).best, 3);
    await c.query(`DELETE FROM attendance WHERE session_id = $1`, [open]); // desmarcar antes del cierre
    assert.deepEqual(await streak(s), { current: 2, best: 2 });
  }));
  await run('racha: corrección presente → falta y cancelación retroactiva cambian el pasado', () => sp(async () => {
    const s = await F.person('alumno');
    const other = await F.person('alumno');
    const S = {};
    for (const k of [3, 2, 1]) S[k] = await F.attend(s, X, wk(k));
    await F.attend(other, X, `${wk(2)} + interval '2 hours'`);
    assert.equal((await streak(s)).current, 3);
    await c.query(`UPDATE attendance SET status = 'absent' WHERE session_id = $1`, [S[2]]);
    assert.deepEqual(await streak(s), { current: 1, best: 1 });
    await c.query(`UPDATE attendance SET status = 'present' WHERE session_id = $1`, [S[2]]);
    await c.query(`UPDATE class_sessions SET status = 'cancelled' WHERE id = $1`, [S[1]]);
    assert.deepEqual(await streak(s), { current: 2, best: 2 }); // la semana 1 ya no tiene sesiones: se salta
  }));

  // ---------- Horas ----------
  await run('horas: duración real (1 h 30 = 1.5) y mes por starts_at en Madrid', () => sp(async () => {
    const s = await F.person('alumno');
    await F.attend(s, X, local('2026-08-31 23:30'), 90); // acaba en septiembre: cuenta entera en agosto
    await F.attend(s, X, local('2026-09-01 00:30'), 60); // aún es 31 de agosto en UTC: cuenta en septiembre
    const aug = (await progress(s, '2026-08-01')).hours;
    assert.deepEqual(aug, { month: '2026-08', disciplines: [{ id: Number(X), name: `${tag}-X`, hours: 1.5 }] });
    assert.deepEqual((await progress(s, '2026-09-01')).hours.disciplines.map((d) => d.hours), [1]);
  }));
  await run('horas: la abierta suma en cada disciplina con presente ese mes, y en ninguna si solo hizo la abierta', () => sp(async () => {
    const s = await F.person('alumno');
    await F.attend(s, X, local('2026-05-05 18:00'), 60);
    await F.attend(s, Y, local('2026-05-06 18:00'), 30);
    await F.attend(s, O, local('2026-05-07 18:00'), 120);
    await F.attend(s, O, local('2026-04-07 18:00'), 120);
    const may = (await progress(s, '2026-05-01')).hours.disciplines;
    assert.deepEqual(may.map((d) => [d.name, d.hours]), [[`${tag}-X`, 3], [`${tag}-Y`, 2.5]]);
    assert.deepEqual((await progress(s, '2026-04-01')).hours, { month: '2026-04', disciplines: [] });
  }));

  // ---------- Badges ----------
  await run('badges de horas: cada umbral con el earned_at del presente que lo cruzó', () => sp(async () => {
    const s = await F.person('alumno');
    const at = {};
    const steps = [['a', 9], ['b', 1], ['c', 40], ['d', 50], ['e', 150], ['f', 250], ['g', 499], ['h', 1]];
    for (const [i, [k, h]] of steps.entries()) {
      at[k] = local(`2024-01-${String(1 + i * 2).padStart(2, '0')} 10:00`);
      await F.attend(s, X, at[k], h * 60);
    }
    const b = await badges(s);
    assert.equal(b.first_day, await ts(at.a));
    for (const [code, k] of [['hours_10', 'b'], ['hours_50', 'c'], ['hours_100', 'd'], ['hours_250', 'e'],
      ['hours_500', 'f'], ['hours_1000', 'h']]) {
      assert.equal(b[code], await ts(at[k]), code);
    }
  }));
  await run('badges: la abierta cuenta una vez en las totales; una corrección hace perder uno', () => sp(async () => {
    const s = await F.person('alumno');
    await F.attend(s, X, local('2024-03-05 10:00'), 6 * 60);
    const o = await F.attend(s, O, local('2024-03-06 10:00'), 4 * 60); // en marzo, X suma 10 h, pero en total son 10
    assert.equal((await progress(s, '2024-03-01')).hours.disciplines[0].hours, 10);
    assert.ok((await badges(s)).hours_10);
    await c.query(`UPDATE attendance SET status = 'absent' WHERE session_id = $1`, [o]);
    const b = await badges(s);
    assert.equal(b.hours_10, undefined);
    assert.ok(b.first_day);
  }));
  await run('badges de racha: sobre la mejor, con el lunes de la semana que la alcanzó', () => sp(async () => {
    const s = await F.person('alumno');
    const trainer = await F.person('profesor');
    // 53 semanas seguidas (de la 60 a la 8), luego un hueco con sesiones de la academia y una semana suelta.
    await c.query(
      `WITH x AS (INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
                  SELECT $1, $2, w.at, w.at + interval '1 hour', 60, 10, 'scheduled'
                    FROM generate_series(8, 60) k, LATERAL (SELECT (date_trunc('week', now() AT TIME ZONE '${TZ}')
                         - k * interval '1 week' + interval '1 day 18 hours') AT TIME ZONE '${TZ}') w (at) RETURNING id),
            b AS (INSERT INTO bookings (session_id, student_id, booked_by, status) SELECT id, $3, $3, 'confirmed' FROM x
                  RETURNING id, session_id)
       INSERT INTO attendance (session_id, student_id, booking_id, status, method) SELECT session_id, $3, id, 'present', 'manual' FROM b`,
      [X, trainer, s]);
    const other = await F.person('alumno');
    for (const k of [7, 6, 5, 4, 3, 2]) await F.attend(other, X, wk(k));
    await F.attend(s, X, wk(1));
    assert.deepEqual(await streak(s), { current: 1, best: 53 });
    const b = await badges(s);
    for (const [code, n] of [['streak_4', 4], ['streak_12', 12], ['streak_26', 26], ['streak_52', 52]]) {
      assert.equal(b[code], await ts(monday(60 - n + 1)), code);
    }
  }));

  // ---------- Ranking ----------
  await run('ranking: solo opt-in públicos elegibles con > 0 h; empates 1, 2, 2, 4; mes pasado; retirar el opt-in', () => sp(async () => {
    const on = { ranking: true };
    const P = {
      a: await F.person('alumno', { pub: true, flags: on, name: `${tag}-a` }),
      c: await F.person('alumno', { pub: true, flags: on, name: `${tag}-c` }),
      b: await F.person('alumno', { pub: true, flags: on, name: `${tag}-b` }),
      d: await F.person('alumno', { pub: true, flags: on, name: `${tag}-d` }),
      hidden: await F.person('alumno', { pub: true, flags: { achievements: true } }),
      priv: await F.person('alumno', { flags: on }),
      zero: await F.person('alumno', { pub: true, flags: on }),
      child: await F.person('alumno', { pub: true, flags: on, birth: '2014-01-01', creds: false }),
      child18: await F.person('alumno', { pub: true, flags: on, birth: '2000-01-01', creds: false }),
      prof: await F.person('profesor', { pub: true, flags: on }),
    };
    for (const [k, h] of [['a', 4], ['b', 3], ['c', 3], ['d', 1], ['hidden', 9], ['priv', 9], ['child', 9],
      ['child18', 9], ['prof', 9]]) {
      await F.attend(P[k], X, local('2026-06-10 18:00'), h * 60);
    }
    await F.attend(P.zero, Y, local('2026-06-10 18:00'), 60);
    await F.attend(P.a, X, local('2026-05-10 18:00'), 60);
    await as(P.zero, 'alumno');
    const june = await rankingOf(X, '2026-06');
    assert.deepEqual(june.rows, [
      { rank: 1, id: P.a, display_name: `${tag}-a`, hours: 4 },
      { rank: 2, id: P.b, display_name: `${tag}-b`, hours: 3 },
      { rank: 2, id: P.c, display_name: `${tag}-c`, hours: 3 },
      { rank: 4, id: P.d, display_name: `${tag}-d`, hours: 1 },
    ]);
    assert.deepEqual([june.discipline, june.month, june.total], [{ id: X, name: `${tag}-X` }, '2026-06', 4]);
    const page = await rankingOf(X, '2026-06', { limit: '2', offset: '1' });
    assert.deepEqual([page.rows.map((r) => r.id), page.total, page.limit, page.offset], [[P.b, P.c], 4, 2, 1]);
    assert.deepEqual((await rankingOf(X, '2026-05')).rows.map((r) => r.id), [P.a]);
    await c.query(`UPDATE profiles SET visible_fields = visible_fields || '{"ranking": false}' WHERE id = $1`, [P.a]);
    assert.deepEqual((await rankingOf(X, '2026-05')).rows, []);
    assert.equal((await rankingOf(X, '2026-05')).discipline.name, `${tag}-X`); // sin filas, sigue el nombre
  }));
  await run('ranking: abierta o inexistente → 404; month y paginación inválidos → 400; sin sesión, 0 filas', () => sp(async () => {
    const reject = (args, status, code) =>
      sp(() => assert.rejects(rankingOf(...args), (e) => e.status === status && e.code === code));
    await as(admin, 'admin');
    await reject([O, '2026-06'], 404, 'ranking_not_found');
    await reject(['999999999', '2026-06'], 404, 'ranking_not_found');
    for (const m of ['2026-13', '2026-6', 'x', ['2026-06']]) await reject([X, m], 400, 'invalid_field');
    await reject([X, undefined, { limit: '101' }], 400, 'invalid_pagination');
    await reject(['abc'], 400, 'invalid_id');
    assert.match((await rankingOf(X)).month, /^\d{4}-\d{2}$/);
    await c.query(`SELECT set_config('app.current_user_id', '', true)`);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM monthly_ranking($1, NULL)`, [X])).rows[0].n, 0);
  }));

  // ---------- Disciplina abierta ----------
  const plan1 = (await c.query(`INSERT INTO plans (name, price_cents, max_disciplines, stripe_price_id)
                                VALUES ($1, 1000, 1, 'price_test_b14') RETURNING id`, [`${tag}-1`])).rows[0].id;
  const covers = async (s, d) => (await c.query(`SELECT covers($1, $2) AS ok`, [s, d])).rows[0].ok;
  await run('abierta: la cubre un plan de 1 disciplina; un adulto no cubre una abierta solo menores', () => sp(async () => {
    const K = await F.discipline('Kids', { open: true, minors: true });
    const adult = await F.person('alumno', { pub: true, flags: { disciplines: true } });
    const child = await F.person('alumno', { birth: '2015-01-01', creds: false });
    await F.subscribe(adult, plan1, [X]);
    await F.subscribe(child, plan1, [X]);
    assert.deepEqual([await covers(adult, O), await covers(adult, Y), await covers(adult, K), await covers(child, K)],
      [true, false, false, true]);
    await as(adult, 'alumno');
    const { rows: [{ d }] } = await c.query(`SELECT public_disciplines($1) AS d`, [adult]);
    assert.deepEqual(d.map((x) => x.id), [Number(X)]); // no sale la abierta
  }));
  await run('abierta: no se elige (validateOrder y change_discipline → discipline_not_eligible)', () => sp(async () => {
    const s = await F.person('alumno');
    await as(s, 'alumno');
    await sp(() => assert.rejects(createCheckout(c, { payerId: s, studentId: s, planId: plan1, disciplineIds: [O] }),
      (e) => e.status === 409 && e.code === 'discipline_not_eligible'));
    const sub = await F.subscribe(s, plan1, [X]);
    await sp(() => assert.rejects(c.query(`SELECT change_discipline($1, $2, $3, $4)`, [sub, X, O, s]),
      /discipline_not_eligible/));
  }));
  await run('abierta: marcarla con elegidas vigentes → 409; desmarcarla cancela reservas futuras sin cobertura', () => sp(async () => {
    const s = await F.person('alumno');
    await F.subscribe(s, plan1, [Y]);
    await as(admin, 'admin');
    await sp(() => assert.rejects(updateDiscipline(c, { id: Y, body: { is_open: true }, actorId: admin }),
      (e) => e.status === 409 && e.code === 'discipline_in_use'));
    const future = await F.session(O, `now() + interval '2 days'`);
    const { rows: [b] } = await c.query(`INSERT INTO bookings (session_id, student_id, booked_by, status)
                                         VALUES ($1, $2, $2, 'confirmed') RETURNING id`, [future, s]);
    const d = await updateDiscipline(c, { id: O, body: { is_open: false }, actorId: admin });
    assert.equal(d.is_open, false);
    const { rows: [after] } = await c.query(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [b.id]);
    assert.deepEqual(after, { status: 'cancelled', cancel_reason: 'no_coverage' });
    await as(s, 'alumno'); // revoke_open_discipline exige admin
    await sp(() => assert.rejects(c.query(`SELECT revoke_open_discipline($1)`, [O]), /not_allowed/));
  }));
} finally {
  await c.query('ROLLBACK');
  c.release();
}

// ======================= HTTP (fixtures confirmados) =======================
const H = fixtures(servicePool);
const who = {};
const role = {};
const created = [];
const person = async (k, r, opts) => { role[k] = r; who[k] = await H.person(r, opts); created.push(who[k]); };
await person('admin', 'admin');
await person('alu', 'alumno', { pub: true, flags: { achievements: true, ranking: true } });
await person('aluNoFlag', 'alumno', { pub: true, flags: { ranking: true } });
await person('other', 'alumno');
await person('prof', 'profesor', { pub: true, flags: { achievements: true } });
await person('tutor', 'tutor');
await person('tutor2', 'tutor');
await person('child', 'alumno', { birth: '2015-01-01', creds: false });
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [who.tutor, who.child]);
const Z = await H.discipline('Z-off', { active: false });
const sessions = [await H.attend(who.alu, Z, local('2026-02-10 18:00'), 90), await H.attend(who.child, Z, local('2026-02-11 18:00'))];
created.push(...(await servicePool.query(`SELECT trainer_id FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]))
  .rows.map((r) => r.trainer_id));

const app = express().use(express.json()).use('/me', meRouter).use('/profiles', profilesRouter)
  .use('/rankings', rankingsRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (path, k) => {
  const res = await fetch(base + path,
    { headers: k ? { authorization: `Bearer ${signToken({ sub: who[k], role: role[k] })}` } : {} });
  return { status: res.status, body: await res.json() };
};
const realError = console.error; // el errorHandler registra cada 4xx esperado
try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('privado: propio, tutor de su hijo y admin sí; otro alumno, profesor y tutor ajeno no', async () => {
    const own = await http('/me/progress?month=2026-02', 'alu');
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.hours, { month: '2026-02', disciplines: [{ id: Number(Z), name: `${tag}-Z-off`, hours: 1.5 }] });
    assert.deepEqual(own.body.badges.map((b) => b.code), ['first_day']);
    assert.equal((await http(`/me/progress?profile_id=${who.child}`, 'tutor')).status, 200);
    assert.equal((await http(`/me/progress?profile_id=${who.alu}`, 'admin')).status, 200);
    for (const [k, target] of [['other', 'alu'], ['prof', 'alu'], ['tutor2', 'child']]) {
      const r = await http(`/me/progress?profile_id=${who[target]}`, k);
      assert.deepEqual([r.status, r.body.code], [403, 'not_guardian'], k);
    }
    assert.equal((await http('/me/progress?profile_id=x', 'alu')).body.code, 'invalid_profile_id');
    assert.equal((await http('/me/progress?month=2026-1', 'alu')).body.code, 'invalid_field');
  });
  await run('ficha pública: achievements solo con su flag; un profesor no tiene', async () => {
    const r = await http(`/profiles/${who.alu}`, 'other');
    assert.equal(r.body.profile.achievements.streak.best, 1); // current depende de las sesiones de la academia
    assert.deepEqual(r.body.profile.achievements.badges.map((b) => b.code), ['first_day']);
    assert.ok(!('achievements' in (await http(`/profiles/${who.aluNoFlag}`, 'other')).body.profile));
    assert.ok(!('achievements' in (await http(`/profiles/${who.prof}`, 'other')).body.profile));
    const me = await http('/me/profile', 'alu');
    assert.deepEqual(Object.keys(me.body.visible_fields).sort(),
      ['achievements', 'bio', 'disciplines', 'member_since', 'ranking', 'social_links']);
  });
  await run('HTTP ranking: una disciplina desactivada se consulta (la RLS la oculta); el hijo no sale', async () => {
    const r = await http(`/rankings/${Z}?month=2026-02`, 'other');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      discipline: { id: Z, name: `${tag}-Z-off` }, month: '2026-02',
      rows: [{ rank: 1, id: who.alu, display_name: (await servicePool.query(
        `SELECT display_name FROM profiles WHERE id = $1`, [who.alu])).rows[0].display_name, hours: 1.5 }],
      total: 1, limit: 25, offset: 0,
    });
    assert.equal((await http(`/rankings/${Z}`)).status, 401);
    assert.equal((await http(`/rankings/x`, 'other')).body.code, 'invalid_id');
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [Z]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [created]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
