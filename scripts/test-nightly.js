// B16: foto diaria de las suscripciones y tareas nocturnas (CONTEXT § Informes; ADR 0012). Las reglas de la foto se
// prueban en una transacción de servicePool que se deshace (dentro se borran las fotos de ayer y hoy, y se comparan
// los recuentos con los de antes de los fixtures). El job (scripts/nightly.js como proceso aparte), la concurrencia y
// los permisos usan una foto confirmada de un día libre (hoy o ayer), que se borra al acabar. El job extiende de verdad
// el horizonte de las clases de la base, como `npm run extend-horizon`.
// Falla si se ejecuta en torno a las 00:00 de Madrid (las fechas de ayer y hoy cambian a mitad).
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const tag = `tnight${crypto.randomBytes(3).toString('hex')}`;
const TZ = 'Europe/Madrid';
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: TZ });
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
const local = (ts) => `'${ts}'::timestamp AT TIME ZONE '${TZ}'`;
const [yesterday, today] = [day(-1), day(0)];
const COLS = ['active', 'past_due', 'unpaid', 'new_subscriptions', 'cancelled_subscriptions', 'mrr_cents'];
const diff = (a, b) => Object.fromEntries(COLS.map((k) => [k, b[k] - a[k]]));
const zero = Object.fromEntries(COLS.map((k) => [k, 0]));

// ======================= Reglas de la foto (transacción deshecha) =======================
const c = await servicePool.connect();
let spN = 0;
const sp = async (fn) => {
  const name = `t${spN++}`;
  await c.query(`SAVEPOINT ${name}`);
  try { await fn(); } finally { await c.query(`ROLLBACK TO ${name}`); }
};
const statsOf = async (d) => (await c.query(`SELECT * FROM academy_stats_of($1)`, [d])).rows[0];
const snapshot = async (d) => (await c.query(`SELECT snapshot_academy_stats($1) AS created`, [d])).rows[0].created;
const photo = async (d) => (await c.query(`SELECT * FROM academy_stats_daily WHERE date = $1`, [d])).rows[0];
const person = async () => {
  const id = crypto.randomUUID();
  await c.query(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [id, `${tag}-${id.slice(0, 6)}`]);
  return id;
};
const plan = async (price) =>
  (await c.query(`INSERT INTO plans (name, price_cents) VALUES ($1, $2) RETURNING id`, [`${tag}-${crypto.randomUUID()}`, price])).rows[0].id;
// Suscripción de un alumno nuevo (que es su propio pagador); created / cancelled: expresiones SQL.
const sub = async (planId, status, { created = 'now()', cancelled = status === 'cancelled' ? 'now()' : 'NULL' } = {}) => {
  const student = await person();
  return (await c.query(
    `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id, created_at, cancelled_at)
     VALUES ($1, $1, $2, $3, $4, ${created}, ${cancelled}) RETURNING *`,
    [student, planId, status, `sub_${tag}_${crypto.randomUUID()}`])).rows[0];
};

try {
  await c.query('BEGIN');
  await c.query(`DELETE FROM academy_stats_daily WHERE date IN ($1, $2)`, [yesterday, today]);

  await run('foto: un alumno de cada estado; MRR solo de las activas y en gracia, con el precio del plan; el seguro no suma', () => sp(async () => {
    const base = await statsOf(today);
    const [a, b] = [await plan(1000), await plan(2500)];
    await sub(a, 'active');
    await sub(b, 'past_due');
    await sub(b, 'unpaid');
    await sub(a, 'cancelled');
    const s = await person();
    await c.query(`INSERT INTO insurances (student_id, payer_id, status, bracket, stripe_subscription_id)
                   VALUES ($1, $1, 'active', 'adult', $2)`, [s, `sub_${tag}_ins`]);
    assert.equal(await snapshot(today), true);
    assert.deepEqual(diff(base, await photo(today)),
      { active: 1, past_due: 1, unpaid: 1, new_subscriptions: 4, cancelled_subscriptions: 1, mrr_cents: 1000 + 2500 });
  }));

  // Altas a las 23:30 de la víspera y a las 00:30 del día; bajas a las 23:30 del día y a las 00:30 del siguiente: cuenta
  // una de cada (con días UTC contarían 0 altas y 2 bajas). También en los cambios de hora (29-03 dura 23 h; 25-10, 25 h).
  await run('altas y bajas en su día de Madrid, también en los cambios de hora', async () => {
    for (const [prev, d, next] of [[day(-2), yesterday, today], [yesterday, today, day(1)],
      ['2026-03-28', '2026-03-29', '2026-03-30'], ['2026-10-24', '2026-10-25', '2026-10-26']]) {
      await sp(async () => {
        const base = await statsOf(d);
        const p = await plan(1000);
        const old = local(`${prev} 12:00`) + ` - interval '40 days'`;
        for (const t of [`${prev} 23:30`, `${d} 00:30`]) await sub(p, 'cancelled', { created: local(t), cancelled: old });
        for (const t of [`${d} 23:30`, `${next} 00:30`]) await sub(p, 'cancelled', { created: old, cancelled: local(t) });
        assert.deepEqual(diff(base, await statsOf(d)), { ...zero, new_subscriptions: 1, cancelled_subscriptions: 1 }, d);
      });
    }
  });

  await run('un traspaso (payer_changes completed) no es ni alta ni baja; una baja normal sí', () => sp(async () => {
    const base = await statsOf(today);
    const p = await plan(1000);
    const old = await sub(p, 'cancelled', { created: `now() - interval '40 days'` });
    const succ = await sub(p, 'active');
    const payer = await person();
    await c.query(`UPDATE subscriptions SET student_id = $1 WHERE id = $2`, [old.student_id, succ.id]);
    await c.query(
      `INSERT INTO payer_changes (subscription_id, student_id, old_payer_id, new_payer_id, plan_id, starts_at, deadline,
                                  status, stripe_subscription_id, created_by)
       VALUES ($1, $2, $2, $3, $4, now(), now() - interval '1 hour', 'completed', $5, $2)`,
      [old.id, old.student_id, payer, p, succ.stripe_subscription_id]);
    await sub(p, 'cancelled', { created: `now() - interval '40 days'` });
    assert.deepEqual(diff(base, await statsOf(today)), { ...zero, active: 1, cancelled_subscriptions: 1, mrr_cents: 1000 });
  }));

  await run('idempotente: la segunda llamada devuelve false y no cambia la fila aunque cambie el estado', () => sp(async () => {
    assert.equal(await snapshot(yesterday), true);
    const first = await photo(yesterday);
    await sub(await plan(1000), 'active');
    assert.equal(await snapshot(yesterday), false);
    assert.deepEqual(await photo(yesterday), first);
  }));

  await run('p_date distinta de ayer u hoy → invalid_date', async () => {
    for (const d of [day(-2), day(1), null]) {
      await sp(() => assert.rejects(snapshot(d), /invalid_date/, String(d)));
    }
  });
} finally {
  await c.query('ROLLBACK');
  c.release();
}

// ======================= Job, permisos y concurrencia (foto confirmada) =======================
const exec = promisify(execFile);
const nightly = (date) => exec(process.execPath, ['scripts/nightly.js', `--date=${date}`]).then(
  (r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const free = (await q(`SELECT d::text FROM unnest($1::date[]) d
                        WHERE NOT EXISTS (SELECT 1 FROM academy_stats_daily WHERE date = d)`,
  [[today, yesterday]])).map((r) => r.d);
const D = free.includes(today) ? today : free[0];
const trainer = crypto.randomUUID();
let disc;
try {
  assert.ok(D, 'ya hay foto de ayer y de hoy: el test necesita un día libre');

  await run('job: con extend-horizon fallando (una clase rota) la foto se hace igual y sale con 1; relanzado, «ya existía»', async () => {
    // La clase choca con una sesión suelta de su profesor a la misma hora: generateSessions falla en ella.
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [trainer, `${tag}-profesor`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'profesor')`, [trainer]);
    [disc] = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-BJJ`]);
    const at = local(`${day(1)} 19:00`);
    await q(`INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
             VALUES ($1, $2, ${at}, ${at} + interval '1 hour', 60, 5, 'scheduled')`, [disc.id, trainer]);
    const [k] = await q(
      `INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, starts_on, ends_on)
       VALUES ($1, $2, $3, '19:00', 60, 5, $4, $4) RETURNING id`, [disc.id, trainer, dow(day(1)), day(1)]);

    const r1 = await nightly(D);
    assert.equal(r1.code, 1, r1.stderr);
    assert.match(r1.stdout, new RegExp(`foto ${D}: creada`));
    assert.match(r1.stderr, new RegExp(k.id));
    assert.equal((await q(`SELECT 1 FROM academy_stats_daily WHERE date = $1`, [D])).length, 1);
    const r2 = await nightly(D);
    assert.match(r2.stdout, new RegExp(`foto ${D}: ya existía`));
    const r3 = await nightly(day(-2));
    assert.equal(r3.code, 1);
    assert.match(r3.stderr, /invalid_date/);
  });

  await run('permisos: solo el admin lee; sin INSERT/UPDATE/DELETE ni EXECUTE para app_user; student_stats_daily borrada', async () => {
    const as = (role, sql, params) => withRls({ uid: crypto.randomUUID(), role }, (cl) => cl.query(sql, params));
    assert.equal((await as('admin', `SELECT * FROM academy_stats_daily WHERE date = $1`, [D])).rows.length, 1);
    for (const role of ['profesor', 'alumno', 'tutor']) {
      assert.equal((await as(role, `SELECT * FROM academy_stats_daily`)).rows.length, 0, role);
    }
    for (const sql of [
      `INSERT INTO academy_stats_daily VALUES ('2000-01-01', 0, 0, 0, 0, 0, 0)`,
      `UPDATE academy_stats_daily SET active = 0`,
      `DELETE FROM academy_stats_daily`,
      `SELECT snapshot_academy_stats(CURRENT_DATE)`,
      `SELECT academy_stats_of(CURRENT_DATE)`,
    ]) {
      await assert.rejects(as('admin', sql), /permission denied/, sql);
    }
    assert.equal((await q(`SELECT to_regclass('student_stats_daily') AS t`))[0].t, null);
    for (const fn of ['snapshot_academy_stats', 'academy_stats_of']) {
      const [{ def }] = await q(`SELECT pg_get_functiondef($1::regproc) AS def`, [fn]);
      assert.doesNotMatch(def, /student_health_info|birth_date/, fn);
    }
  });

  await run('concurrencia: dos llamadas a la vez (dos conexiones) dejan una sola fila sin error', async () => {
    await q(`DELETE FROM academy_stats_daily WHERE date = $1`, [D]);
    const [a, b] = [await servicePool.connect(), await servicePool.connect()];
    try {
      await a.query('BEGIN');
      assert.equal((await a.query(`SELECT snapshot_academy_stats($1) AS r`, [D])).rows[0].r, true);
      const pidB = (await b.query(`SELECT pg_backend_pid() AS p`)).rows[0].p;
      const pB = b.query(`SELECT snapshot_academy_stats($1) AS r`, [D]).then((r) => ({ r }), (e) => ({ e }));
      let waited = false;
      for (const t0 = Date.now(); !waited && Date.now() - t0 < 3000; await new Promise((r) => setTimeout(r, 25))) {
        waited = (await q(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pidB])).length > 0;
      }
      assert.ok(waited, 'la segunda espera a la primera');
      await a.query('COMMIT');
      const resB = await pB;
      assert.equal(resB.e, undefined, resB.e?.message);
      assert.equal(resB.r.rows[0].r, false);
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      a.release();
      b.release();
    }
    assert.equal((await q(`SELECT 1 FROM academy_stats_daily WHERE date = $1`, [D])).length, 1);
  });
} finally {
  if (D) await q(`DELETE FROM academy_stats_daily WHERE date = $1`, [D]); // estaba libre al empezar
  if (disc) {
    await q(`DELETE FROM class_sessions WHERE discipline_id = $1`, [disc.id]);
    await q(`DELETE FROM classes WHERE discipline_id = $1`, [disc.id]);
    await q(`DELETE FROM disciplines WHERE id = $1`, [disc.id]);
  }
  await q(`DELETE FROM user_roles WHERE user_id = $1`, [trainer]);
  await q(`DELETE FROM profiles WHERE id = $1`, [trainer]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
