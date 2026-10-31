import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { createClass, updateClass, retireClass, listClasses } from '../src/services/classes.js';
import { generateSessions, listTrainerSessions, getTrainerSession } from '../src/services/sessions.js';

const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);
const sp = async (c, fn) => { // savepoint: un error SQL no aborta el resto de la transacción
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO t'); }
};
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const [admin, prof1, prof2, alumno] = [1, 2, 3, 4].map(() => crypto.randomUUID());
const ids = [admin, prof1, prof2, alumno];
await servicePool.query(
  `INSERT INTO profiles (id, display_name) VALUES ($1,'admin-t'),($2,'prof1-t'),($3,'prof2-t'),($4,'alumno-t')`, ids);
await servicePool.query(
  `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin'),($2,'profesor'),($3,'profesor'),($4,'alumno')`, ids);
const { rows: [disc] } = await servicePool.query(`INSERT INTO disciplines (name) VALUES ('T-Classes') RETURNING id`);

const base = { discipline_id: String(disc.id), trainer_id: prof1, weekday: 1, start_time: '19:00', duration_min: 60, capacity: 20 };

try {
  await withRls({ uid: admin, role: 'admin' }, async (c) => {
    let cls;
    await run('crea clase y genera ~1 año de sesiones a las 19:00 locales todo el año (DST)', async () => {
      cls = await createClass(c, { body: base, actorId: admin });
      assert.ok(cls.sessions_created >= 52 && cls.sessions_created <= 53, `sesiones: ${cls.sessions_created}`);
      const { rows: [r] } = await c.query(
        `SELECT count(*)::int n, count(DISTINCT (starts_at AT TIME ZONE 'Europe/Madrid')::time)::int hours,
                count(DISTINCT extract(isodow FROM starts_at AT TIME ZONE 'Europe/Madrid'))::int days,
                count(DISTINCT extract(timezone_hour FROM starts_at AT TIME ZONE 'UTC' AT TIME ZONE 'UTC'))::int
           FROM class_sessions WHERE class_id = $1`, [cls.id]);
      assert.equal(r.hours, 1);
      assert.equal(r.days, 1);
    });
    await run('regenerar es idempotente', async () => {
      assert.equal(await generateSessions(c, cls.id), 0);
    });
    await run('validación y reglas de negocio', async () => {
      await rejects(createClass(c, { body: { ...base, weekday: 8 }, actorId: admin }), 400, 'invalid_field');
      await rejects(createClass(c, { body: { ...base, start_time: '25:00' }, actorId: admin }), 400, 'invalid_field');
      await rejects(createClass(c, { body: { ...base, capacity: 0 }, actorId: admin }), 400, 'invalid_field');
      await rejects(createClass(c, { body: { ...base, trainer_id: alumno }, actorId: admin }), 400, 'invalid_field');
      await rejects(createClass(c, { body: { ...base, discipline_id: '999999999' }, actorId: admin }), 400, 'invalid_field');
      await rejects(createClass(c, { body: { ...base, starts_on: '2030-01-10', ends_on: '2030-01-01' }, actorId: admin }), 400, 'invalid_field');
    });
    await run('solape del mismo profesor → 409 y no deja clase a medias', async () => {
      await sp(c, () => rejects(createClass(c, { body: { ...base, start_time: '19:30' }, actorId: admin }), 409, 'trainer_overlap'));
      assert.equal((await listClasses(c, { discipline_id: String(disc.id) })).length, 1);
    });
    await run('otro profesor a la misma hora sí; ends_on recorta', async () => {
      const short = await createClass(c, {
        body: { ...base, trainer_id: prof2, starts_on: '2999-01-01', ends_on: '2999-01-31' }, actorId: admin });
      assert.equal(short.sessions_created, 0); // fuera del horizonte
      const near = await createClass(c, { body: { ...base, trainer_id: prof2, weekday: 2 }, actorId: admin });
      assert.ok(near.sessions_created >= 52);
    });
    await run('PATCH: cambio de clase (location llega a las sesiones generadas); disciplina y día → 409', async () => {
      const r = await updateClass(c, { id: cls.id, body: { location: 'tatami 2' } });
      assert.equal(r.class.location, 'tatami 2');
      const { rows: [n] } = await c.query(
        `SELECT count(*) FILTER (WHERE location = 'tatami 2')::int moved, count(*) FILTER (WHERE starts_at > now())::int future
           FROM class_sessions WHERE class_id = $1`, [cls.id]);
      assert.deepEqual([r.sessions_changed, n.moved], [n.future, n.future]);
      await rejects(updateClass(c, { id: cls.id, body: { weekday: 2 } }), 409, 'not_supported');
      await rejects(updateClass(c, { id: cls.id, body: { discipline_id: String(disc.id) } }), 409, 'not_supported');
    });
    await run('retirar: cancela desde la fecha y conserva lo anterior', async () => {
      const { rows: [{ d }] } = await c.query(`SELECT to_char(CURRENT_DATE + 14, 'YYYY-MM-DD') d`);
      const before = (await c.query(
        `SELECT count(*)::int n FROM class_sessions WHERE class_id=$1 AND starts_at < $2::date::timestamp AT TIME ZONE 'Europe/Madrid'`,
        [cls.id, d])).rows[0].n;
      const r = await retireClass(c, { id: cls.id, date: d });
      assert.equal(r.cancelled_sessions + before, cls.sessions_created);
      const { rows: [{ n }] } = await c.query(`SELECT count(*)::int n FROM class_sessions WHERE class_id=$1 AND status='scheduled'`, [cls.id]);
      assert.equal(n, before);
      await sp(c, () => rejects(retireClass(c, { id: cls.id, date: d }), 409, 'already_retired')); // el error es de SQL
      assert.equal(await generateSessions(c, cls.id), 0); // no regenera tras retirar
    });

    await as(c, prof1, 'profesor');
    await run('profesor ve solo sus sesiones; ajena → 404; sin escribir', async () => {
      const mine = await listTrainerSessions(c, prof1);
      assert.ok(mine.length > 0 && mine.every((s) => s.status));
      const { rows } = await c.query(`SELECT DISTINCT trainer_id FROM class_sessions`);
      assert.deepEqual(rows.map((r) => r.trainer_id), [prof1]); // RLS, sin filtro explícito
      await rejects(getTrainerSession(c, prof1, crypto.randomUUID()), 404, 'session_not_found');
      await sp(c, () => assert.rejects(c.query(`UPDATE class_sessions SET capacity = 1`), /permission denied/));
      await sp(c, () => assert.rejects(c.query(`DELETE FROM class_sessions`), /permission denied/));
    });
    await run('rango > 92 días se ignora (devuelve vacío)', async () => {
      assert.deepEqual(await listTrainerSessions(c, prof1, { from: '2026-01-01', to: '2026-12-31' }), []);
      await rejects(listTrainerSessions(c, prof1, { from: 'mañana' }), 400, 'invalid_field');
    });

    await as(c, alumno, 'alumno');
    await run('alumno ve el calendario completo pero no escribe', async () => {
      assert.ok((await c.query(`SELECT count(DISTINCT trainer_id)::int n FROM class_sessions`)).rows[0].n >= 2);
      assert.ok((await c.query(`SELECT 1 FROM classes`)).rowCount >= 2);
      await sp(c, () => assert.rejects(c.query(`INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity)
        VALUES ($1,$2,1,'10:00',60,5)`, [disc.id, prof1]), /row-level security/));
      await sp(c, () => assert.rejects(c.query(`UPDATE class_sessions SET capacity = 1`), /permission denied/));
    });
    await run('sin sesión (uid NULL) no ve nada', async () => {
      await c.query(`SELECT set_config('app.current_user_id', NULL, true)`);
      assert.equal((await c.query(`SELECT 1 FROM class_sessions`)).rowCount, 0);
    });
    await as(c, admin, 'admin');
    await run('enum sin completed', async () => {
      const { rows } = await c.query(`SELECT unnest(enum_range(NULL::session_status))::text v`);
      assert.deepEqual(rows.map((r) => r.v), ['scheduled', 'cancelled']);
    });
  }, { commit: false });
} finally {
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc.id]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
