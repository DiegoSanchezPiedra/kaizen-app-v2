// B6.1: sesiones sueltas, cancelar y recuperar una sesión, cancelación retroactiva, deshacer un ajuste, retirar una
// clase y desactivar una disciplina (CONTEXT § Clases y sesiones). Como test:session-changes: datos confirmados, la
// concurrencia con dos conexiones reales y pg_locks, los avisos por el worker y las rutas con un express en memoria.
// Con `npm run dev` en marcha, su worker se lleva entregas del test: pararlo antes.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { appPool, servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminSessionsRouter from '../src/routes/admin/sessions.js';
import { createClass, updateClass, retireClass } from '../src/services/classes.js';
import {
  adjustSession, generateSessions, createSession, cancelSession, restoreSession, resetSession,
} from '../src/services/sessions.js';
import { updateDiscipline } from '../src/services/catalog.js';
import { cancelBooking } from '../src/services/bookings.js';
import { sendPending } from '../src/services/notices.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const tag = `tsx${crypto.randomBytes(3).toString('hex')}`;
const TZ = 'Europe/Madrid';
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: TZ });
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
const madridDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ });
const when = (d) => new Date(d).toLocaleString('es-ES', { // como services/notices.js
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});
const inMin = (min) => new Date(Date.now() + min * 60e3).toISOString();
const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);

// --- Fixtures ---
const ids = [];
const roleOf = {};
async function person(role, { name, birth = null, pub = false } = {}) {
  const id = crypto.randomUUID();
  ids.push(id);
  roleOf[id] = role;
  await q(`INSERT INTO profiles (id, display_name, birth_date, is_public, visible_fields) VALUES ($1, $2, $3, $4, $5)`,
    [id, name ?? `${tag}-${role}`, birth, pub, pub ? { ranking: true } : {}]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
  await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@sx.test`]);
  return id;
}

// Acuerdos vigentes: los existentes o unos de prueba (se borran al final).
const testDocs = [];
for (const type of ['waiver', 'data_protection', 'rights_of_image']) {
  if ((await q(`SELECT 1 FROM agreement_documents WHERE type = $1 AND published_at IS NOT NULL AND retired_at IS NULL`,
    [type])).length) continue;
  testDocs.push((await q(
    `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
     VALUES (gen_random_uuid(), $1, '99.' || floor(random() * 1e6), 'test-session-cancel.pdf', 'x', now()) RETURNING id`,
    [type]))[0].id);
}
const discs = [];
async function discipline(name, active = true) {
  const [d] = await q(`INSERT INTO disciplines (name, is_active) VALUES ($1, $2) RETURNING id, name`, [`${tag}-${name}`, active]);
  discs.push(d.id);
  return d;
}
const disc = await discipline('BJJ');
const [plan] = await q(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`, [`${tag}-all`]);

// Alumno con perfil completo, cobertura de riesgo y suscripción en vigor (book_session y la promoción lo comprueban).
async function student({ name, birth = null, tutors = [], pub = false } = {}) {
  const id = await person('alumno', { name, birth, pub });
  for (const t of tutors) await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [t, id]);
  const by = birth ? tutors[0] : id;
  for (const type of ['waiver', 'data_protection', 'rights_of_image']) {
    await q(`INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
             SELECT gen_random_uuid(), $1, $2, $3, version FROM agreement_documents
              WHERE type = $3 AND published_at IS NOT NULL AND retired_at IS NULL`, [id, by, type]);
  }
  await q(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
           VALUES ($1, 'x', '600000000')`, [id]);
  await q(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
           VALUES ($1, $2, $3, 'active', $4)`, [id, by, plan.id, `sub_${tag}_${id}`]);
  return id;
}
async function device(profileId) {
  const endpoint = `https://fcm.googleapis.com/${tag}/${crypto.randomUUID()}`;
  await q(`INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES ($1, $2, 'k', 'a')`, [profileId, endpoint]);
  return endpoint;
}

const admin = await person('admin');
const asAdmin = (fn) => withRls({ uid: admin, role: 'admin' }, fn);
const change = (id, body) => asAdmin((c) => updateClass(c, { id, body }));
const adjust = (id, body) => asAdmin((c) => adjustSession(c, { id, body }));
const cancel = (id, body = {}) => asAdmin((c) => cancelSession(c, { id, body }));
const restore = (id) => asAdmin((c) => restoreSession(c, { id }));
const reset = (id, fields) => asAdmin((c) => resetSession(c, { id, body: { fields } }));
const loose = (body) => asAdmin((c) => createSession(c, { body, actorId: admin }));
const cancelAs = (who, bookingId) => withRls({ uid: who, role: roleOf[who] }, (c) => cancelBooking(c, bookingId));

const sessionsOf = (classId) => q(`SELECT * FROM class_sessions WHERE class_id = $1 ORDER BY slot`, [classId]);
const sessionRow = async (id) => (await q(`SELECT * FROM class_sessions WHERE id = $1`, [id]))[0];
// Clase semanal desde mañana, `weeks` sesiones; o desde `starts_on` (aún sin empezar).
async function mkClass({ weeks = 3, capacity = 5, trainer, starts_on, d = disc } = {}) {
  const t = trainer ?? await person('profesor');
  const body = { discipline_id: String(d.id), trainer_id: t, weekday: dow(starts_on ?? day(1)), start_time: '19:00',
    duration_min: 60, capacity, ...(starts_on ? { starts_on, ends_on: starts_on } : { ends_on: day(1 + 7 * (weeks - 1)) }) };
  const cls = await asAdmin((c) => createClass(c, { body, actorId: admin }));
  return { ...cls, trainer: t, s: await sessionsOf(cls.id) };
}
// Sesión de una clase insertada a mano: `at` y `slot` en minutos desde ahora; `adjusted` los campos ajustados.
const classSession = async (k, { at, slot = at, adjusted = [], capacity = 5 }) => (await q(
  `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, status,
                               adjusted_fields, class_trainer_id, class_duration_min, class_capacity)
   VALUES ($1, $2, $3, now() + $4 * interval '1 minute', now() + $5 * interval '1 minute',
           now() + ($4 + 60) * interval '1 minute', 60, $6, 'scheduled', $7, $3, 60, 5) RETURNING *`,
  [k.id, k.discipline_id, k.trainer, at, slot, capacity, adjusted]))[0];
// Sesión suelta insertada a mano (también en el pasado), cada una con su profesor.
const rawLoose = async ({ at, minutes = 60, d = disc }) => (await q(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
   VALUES ($1, $2, $3::timestamptz, $3::timestamptz + $4 * interval '1 minute', $4, 10, 'scheduled') RETURNING *`,
  [d.id, await person('profesor'), at, minutes]))[0];
async function bk(sessionId, studentId, status = 'confirmed') {
  const [b] = await q(`INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, $3) RETURNING id`,
    [sessionId, studentId, status]);
  return b.id;
}
const bookingOf = async (id) => (await q(`SELECT status, cancel_reason FROM bookings WHERE id = $1`, [id]))[0];
const present = (sessionId, studentId, bookingId, status = 'present') => q(
  `INSERT INTO attendance (session_id, student_id, booking_id, status, method) VALUES ($1, $2, $3, $4, 'manual')`,
  [sessionId, studentId, bookingId, status]);
const lastAudit = async (action, resourceId) => (await q(
  `SELECT changes, actor_id FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at DESC LIMIT 1`,
  [action, String(resourceId)]))[0];
const notices = (action, sessionIds) => q(
  `SELECT a.* FROM audit_log a JOIN bookings b ON b.id::text = a.resource_id
    WHERE a.action = $1 AND b.session_id = ANY($2::uuid[]) ORDER BY a.created_at, a.id`, [action, sessionIds]);
const deliveriesOf = (auditIds) => q(
  `SELECT recipient_id, channel, status FROM notice_deliveries WHERE audit_id = ANY($1::uuid[])`, [auditIds]);

// Worker con transportes falsos. Las entregas pendientes ajenas al test se aparcan y se restauran al final.
const parked = (await q(
  `UPDATE notice_deliveries SET next_attempt_at = next_attempt_at + interval '100 years' WHERE status = 'pending'
   RETURNING id`)).map((r) => r.id);
const pushed = [];
const fakePush = async (m) => { pushed.push(m); return { status: 'sent' }; };
const fakeEmail = async () => ({ id: 'fake' });
async function drain() {
  pushed.length = 0;
  while ((await sendPending(servicePool, fakeEmail, fakePush)) === 20);
}
const pushTo = (endpoint) => pushed.filter((m) => m.subscription.endpoint === endpoint).map((m) => m.payload);

// Espera a que la conexión `pid` esté esperando un bloqueo (pg_locks lo ve cualquiera).
async function waitLocked(pid, ms = 3000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 25))) {
    if ((await q(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid])).length) return true;
  }
  return false;
}
const settle = (p) => p.then((r) => ({ r }), (e) => ({ e }));
const pidOf = async (c) => (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p;
// Dos transacciones a la vez: `first` se ejecuta y se queda abierta; `second` debe esperarla; después se confirma `first`.
async function race(first, second) {
  const [a, b] = [await appPool.connect(), await appPool.connect()];
  const ctx = (c, uid) => c.query(
    `SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true)`, [uid, roleOf[uid]]);
  try {
    await a.query('BEGIN');
    await ctx(a, first.uid);
    await a.query(first.sql, first.params);
    await b.query('BEGIN');
    await ctx(b, second.uid);
    const pidB = await pidOf(b);
    const pB = settle(b.query(second.sql, second.params));
    const waited = await waitLocked(pidB);
    await a.query('COMMIT');
    const res = await pB;
    await b.query(res.e ? 'ROLLBACK' : 'COMMIT');
    return { waited, ...res };
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    a.release();
    b.release();
  }
}

// --- HTTP ---
const app = express().use(express.json()).use('/admin', adminSessionsRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, who, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json',
      ...(who && { authorization: `Bearer ${signToken({ sub: who, role: roleOf[who] })}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const realError = console.error; // el errorHandler registra cada 4xx esperado

try {
  // --- Sesión suelta ---
  await run('suelta: se crea sin clase ni slot; validación; solape → 409; se ajusta, se cancela y se recupera; sin deshacer', async () => {
    const t = await person('profesor');
    const body = { discipline_id: String(disc.id), trainer_id: t, starts_at: inMin(2 * 24 * 60), duration_min: 90,
      capacity: 12, location: ' open mat ' };
    const s = await loose(body);
    assert.deepEqual([s.class_id, s.slot, s.adjusted_fields, s.status, s.location, s.cancelled_at],
      [null, null, [], 'scheduled', 'open mat', null]);
    assert.equal(new Date(s.ends_at) - new Date(s.starts_at), 90 * 60e3);
    const row = await sessionRow(s.id);
    assert.deepEqual([row.class_trainer_id, row.class_duration_min, row.class_capacity, row.class_location],
      [null, null, null, null]);
    assert.equal((await lastAudit('session.create', s.id)).changes.trainer_id, t);

    const off = await discipline('off', false);
    await rejects(loose({ ...body, discipline_id: String(off.id) }), 400, 'invalid_field');
    await rejects(loose({ ...body, trainer_id: await student() }), 400, 'invalid_field');
    await rejects(loose({ ...body, starts_at: inMin(-5) }), 400, 'invalid_field');
    await rejects(loose({ ...body, starts_at: `${day(400)}T10:00:00Z` }), 400, 'invalid_field');
    await rejects(loose({ ...body, starts_at: '2030-01-01T10:00:00' }), 400, 'invalid_field'); // sin zona
    await rejects(loose({ ...body, capacity: undefined }), 400, 'invalid_field');
    await rejects(loose({ ...body, starts_at: inMin(2 * 24 * 60 + 30) }), 409, 'trainer_overlap');

    assert.equal((await adjust(s.id, { capacity: 15 })).session.capacity, 15);
    await rejects(reset(s.id, ['capacity']), 409, 'loose_session');
    const k = await mkClass({ weeks: 1, trainer: t });
    const before = await sessionRow(s.id);
    assert.equal(await asAdmin((c) => generateSessions(c, k.id)), 0);
    assert.deepEqual(await sessionRow(s.id), before, 'la generación no toca la suelta');
    const cc = await cancel(s.id);
    assert.deepEqual([cc.retroactive, cc.session.status], [false, 'cancelled']);
    assert.equal((await restore(s.id)).session.status, 'scheduled');
  });

  // --- Cancelar ---
  await run('cancelar: reservas y esperas con session_cancelled; un aviso por alumno, tutores del hijo, sin el admin; sin el motivo', async () => {
    const k = await mkClass({ weeks: 2 });
    const [s, s2] = k.s;
    const a1 = await student({ name: `${tag}-Lucía` });
    const [t1, t2] = [await person('tutor'), await person('tutor')];
    const kid = await student({ name: `${tag}-Hijo`, birth: '2016-05-05', tutors: [t1, t2] });
    const w = await student();
    const [e1, et1, et2] = [await device(a1), await device(t1), await device(t2)];
    await device(admin);
    const b = [await bk(s.id, a1), await bk(s.id, kid), await bk(s.id, w, 'waitlisted')];
    const r = await cancel(s.id, { note: '  lesión de rodilla del profesor ' });
    assert.deepEqual([r.retroactive, r.cancelled_bookings, r.notified], [false, 3, 3]);
    assert.deepEqual([r.session.status, r.session.cancelled_by, r.session.cancel_note],
      ['cancelled', admin, 'lesión de rodilla del profesor']);
    assert.ok(r.session.cancelled_at);
    for (const id of b) assert.deepEqual(await bookingOf(id), { status: 'cancelled', cancel_reason: 'session_cancelled' });
    const audit = await lastAudit('session.cancel', s.id);
    assert.deepEqual(audit.changes, { note: 'lesión de rodilla del profesor', retroactive: false, cancelled_bookings: 3,
      notified: 3, attendance: { closed_at: null, present: [], absent: [] } });
    assert.equal(audit.actor_id, admin);

    const rows = await notices('notice.session_cancelled', [s.id]);
    assert.equal(rows.length, 3);
    const dels = await deliveriesOf(rows.map((x) => x.id));
    assert.deepEqual(dels.map((d) => d.recipient_id).sort(), [a1, t1, t2, w].sort(), 'sin el admin');
    await drain();
    const [p] = pushTo(e1);
    assert.deepEqual([pushTo(e1).length, pushTo(et1).length, pushTo(et2).length], [1, 1, 1]);
    assert.equal(p.title, 'Sesión cancelada');
    assert.equal(p.body, `${disc.name}, ${when(s.starts_at)} (${tag}-Lucía): la academia ha cancelado la sesión`);
    assert.ok(pushed.every((m) => !JSON.stringify(m.payload).includes('rodilla')), 'el motivo nunca va en el aviso');
    assert.ok(pushTo(et1)[0].body.includes(`(${tag}-Hijo)`));

    await rejects(cancel(s.id), 409, 'session_cancelled');
    await assert.rejects(withRls({ uid: a1, role: 'alumno' }, (c) => c.query(`SELECT book_session($1, $2)`, [s.id, a1])),
      (e) => e.message === 'session_not_bookable');
    // Libera el EXCLUDE del profesor: otra sesión suya a la misma hora entra.
    const other = await loose({ discipline_id: String(disc.id), trainer_id: k.trainer, starts_at: new Date(s.starts_at).toISOString(),
      duration_min: 60, capacity: 5 });
    assert.equal(other.status, 'scheduled');
    const r2 = await cancel(s2.id, { note: '   ' });
    assert.deepEqual([r2.cancelled_bookings, r2.notified, r2.session.cancel_note], [0, 0, null], 'motivo opcional');
  });

  // --- Cancelación retroactiva ---
  await run('retroactiva: en curso y pasada con la lista cerrada; motivo obligatorio; sin avisos; instantánea; no se recupera', async () => {
    const a = await student();
    const live = await rawLoose({ at: inMin(-10) });
    const bLive = await bk(live.id, a);
    await present(live.id, a, bLive);
    await rejects(cancel(live.id), 400, 'invalid_field');
    await rejects(cancel(live.id, { note: 'x'.repeat(501) }), 400, 'invalid_field');
    const r = await cancel(live.id, { note: 'no vino el profesor' });
    assert.deepEqual([r.retroactive, r.cancelled_bookings, r.notified], [true, 1, 0]);
    assert.equal((await q(`SELECT 1 FROM attendance WHERE session_id = $1`, [live.id])).length, 0);
    assert.deepEqual((await lastAudit('session.cancel', live.id)).changes.attendance,
      { closed_at: null, present: [a], absent: [] });
    assert.equal((await notices('notice.session_cancelled', [live.id])).length, 0, 'sin avisos ni entregas');
    await rejects(restore(live.id), 409, 'session_started');
  });

  await run('retroactiva: student_progress pierde horas, racha y badge; la semana pasa a saltarse; monthly_ranking baja', async () => {
    // Enero de 2001: ninguna otra sesión de la academia, así que cada semana depende solo de estas.
    const s = await student({ pub: true });
    const s2 = await student();
    const wk = (k, min = 60) => rawLoose({ at: `2001-01-${String(1 + 7 * k).padStart(2, '0')}T18:00:00Z`, minutes: min });
    const W = [await wk(0), await wk(1, 600), await wk(2)];
    for (const x of W) await present(x.id, s, await bk(x.id, s));
    await present(W[1].id, s2, await bk(W[1].id, s2), 'absent');
    await q(`UPDATE class_sessions SET attendance_closed_at = '2001-01-08T20:00:00Z', attendance_closed_by = $2 WHERE id = $1`,
      [W[1].id, admin]);
    const progress = () => asAdmin(async (c) => (await c.query(`SELECT student_progress($1, '2001-01-01') AS p`, [s])).rows[0].p);
    const ranking = () => asAdmin(async (c) => (await c.query(
      `SELECT hours FROM monthly_ranking($1, '2001-01-01') WHERE id = $2`, [disc.id, s])).rows[0]?.hours);
    const p0 = await progress();
    assert.equal(p0.streak.best, 3);
    assert.ok(p0.badges.some((x) => x.code === 'hours_10'));
    assert.equal(+p0.hours.disciplines[0].hours, 12);
    assert.equal(+await ranking(), 12);

    await rejects(cancel(W[1].id), 400, 'invalid_field');
    const r = await cancel(W[1].id, { note: 'se suspendió por la nieve' });
    assert.deepEqual([r.retroactive, r.cancelled_bookings, r.notified, r.session.cancel_note],
      [true, 2, 0, 'se suspendió por la nieve']);
    const row = await sessionRow(W[1].id);
    assert.deepEqual([row.attendance_closed_at, row.attendance_closed_by], [null, null]);
    assert.equal((await q(`SELECT 1 FROM attendance WHERE session_id = $1`, [W[1].id])).length, 0);
    const snap = (await lastAudit('session.cancel', W[1].id)).changes.attendance;
    assert.deepEqual([new Date(snap.closed_at).toISOString(), snap.present, snap.absent],
      ['2001-01-08T20:00:00.000Z', [s], [s2]]);
    assert.equal((await notices('notice.session_cancelled', [W[1].id])).length, 0);

    const p1 = await progress();
    assert.equal(p1.streak.best, 2, 'la semana sin sesión celebrada se salta (si rompiera, sería 1)');
    assert.ok(!p1.badges.some((x) => x.code === 'hours_10'));
    assert.equal(+p1.hours.disciplines[0].hours, 2);
    assert.equal(+await ranking(), 2);
    await rejects(restore(W[1].id), 409, 'session_started');
  });

  // --- Recuperar ---
  await run('recuperar: sin reservas; aviso solo a las de esa cancelación; con los valores de un cambio de clase', async () => {
    const k = await mkClass({ weeks: 1 });
    const [s] = k.s;
    const d = await student();
    await bk(s.id, d);
    await cancel(s.id); // una cancelación anterior de la misma sesión
    await restore(s.id);
    const a = await student({ name: `${tag}-Ana` });
    const ea = await device(a);
    const w = await student();
    const self = await student();
    await bk(s.id, a);
    await bk(s.id, w, 'waitlisted');
    await cancelAs(self, await bk(s.id, self)); // canceló por su cuenta antes
    await cancel(s.id, { note: 'avería' });
    await change(k.id, { location: 'tatami 9', capacity: 8 }); // mientras está cancelada
    await drain();

    const r = await restore(s.id);
    assert.equal(r.notified, 2);
    assert.deepEqual([r.session.status, r.session.cancelled_at, r.session.cancelled_by, r.session.cancel_note,
      r.session.location, r.session.capacity], ['scheduled', null, null, null, 'tatami 9', 8]);
    assert.equal((await q(`SELECT 1 FROM bookings WHERE session_id = $1 AND status <> 'cancelled'`, [s.id])).length, 0);
    const rows = await notices('notice.session_restored', [s.id]);
    const students = rows.slice(-2).map((x) => x.changes.student_id).sort();
    assert.deepEqual(students, [a, w].sort(), 'ni quien canceló antes ni las de la cancelación anterior');
    assert.equal(rows.length, 3); // + la de d en su recuperación
    assert.deepEqual((await lastAudit('session.restore', s.id)).changes, { notified: 2 });
    await drain();
    assert.deepEqual(pushTo(ea), [{ title: 'Sesión recuperada', url: pushTo(ea)[0].url, tag: pushTo(ea)[0].tag,
      body: `${disc.name}, ${when(s.starts_at)} (${tag}-Ana): la academia ha recuperado la sesión. Si quieres ir, vuelve a reservar` }]);
    assert.ok(pushTo(ea)[0].url.endsWith('/bookings'));
    await rejects(restore(s.id), 409, 'session_not_cancelled');
  });

  await run('recuperar: clase retirada, disciplina inactiva y solape del profesor → 409', async () => {
    const k = await mkClass({ weeks: 2 });
    await cancel(k.s[1].id);
    await asAdmin((c) => retireClass(c, { id: k.id, date: madridDay(k.s[1].slot) }));
    await rejects(restore(k.s[1].id), 409, 'class_retired');

    const off = await discipline('pausa');
    const s = await loose({ discipline_id: String(off.id), trainer_id: await person('profesor'), starts_at: inMin(3000),
      duration_min: 60, capacity: 5 });
    await cancel(s.id);
    await q(`UPDATE disciplines SET is_active = false WHERE id = $1`, [off.id]);
    await rejects(restore(s.id), 409, 'discipline_inactive');

    const k2 = await mkClass({ weeks: 1 });
    await cancel(k2.s[0].id);
    await loose({ discipline_id: String(disc.id), trainer_id: k2.trainer, starts_at: new Date(k2.s[0].starts_at).toISOString(),
      duration_min: 30, capacity: 5 });
    await rejects(restore(k2.s[0].id), 409, 'trainer_overlap');
    assert.equal((await sessionRow(k2.s[0].id)).status, 'cancelled');
  });

  // --- Valores de clase ---
  await run('valores de clase: la generación los rellena; el cambio de clase los escribe en ajustadas y canceladas, no en empezadas', async () => {
    const k = await mkClass({ weeks: 3 });
    const [s0, s1, s2] = k.s;
    assert.deepEqual([s0.class_trainer_id, s0.class_duration_min, s0.class_capacity, s0.class_location],
      [k.trainer, 60, 5, null]);
    const started = await classSession(k, { at: -10 });
    await adjust(s1.id, { capacity: 9, location: 'tatami 1' });
    await cancel(s2.id);
    const p2 = await person('profesor');
    await change(k.id, { capacity: 7, duration_min: 45, trainer_id: p2, location: 'tatami 4' });
    const [n0, n1, n2, ns] = await Promise.all([s0, s1, s2, started].map((x) => sessionRow(x.id)));
    for (const n of [n0, n1, n2]) {
      assert.deepEqual([n.class_trainer_id, n.class_duration_min, n.class_capacity, n.class_location], [p2, 45, 7, 'tatami 4']);
    }
    assert.deepEqual([n1.capacity, n1.location], [9, 'tatami 1'], 'los valores ajustados no cambian');
    assert.deepEqual([ns.class_trainer_id, ns.class_duration_min, ns.class_capacity], [k.trainer, 60, 5], 'empezada: sin cambios');
    await assert.rejects(q(
      `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, status)
       VALUES ($1, $2, $3, now() + interval '9 days', now() + interval '9 days', now() + interval '9 days 1 hour', 60, 5, 'scheduled')`,
      [k.id, disc.id, k.trainer]), (e) => e.constraint === 'class_sessions_class_values_check');
  });

  // --- Deshacer un ajuste ---
  await run('deshacer: cada campo vuelve a la clase y sale de adjusted_fields; starts_at a slot; aviso', async () => {
    const k = await mkClass({ weeks: 1 });
    const [s] = k.s;
    const a = await student();
    await bk(s.id, a);
    const p2 = await person('profesor');
    await adjust(s.id, { trainer_id: p2, starts_at: new Date(Date.parse(s.starts_at) + 3600e3).toISOString(), duration_min: 90,
      capacity: 9, location: 'L' });
    const r = await reset(s.id, ['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location']);
    assert.deepEqual([r.sessions_changed, r.notified, r.promoted], [1, 1, 0]);
    assert.deepEqual([r.session.trainer_id, +new Date(r.session.starts_at), r.session.duration_min, r.session.capacity,
      r.session.location, r.session.adjusted_fields], [k.trainer, +s.slot, 60, 5, null, []]);
    assert.equal(new Date(r.session.ends_at) - new Date(r.session.starts_at), 60 * 60e3);
    const audit = await lastAudit('session.reset', s.id);
    assert.deepEqual(audit.changes.fields, ['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location']);
    assert.deepEqual([audit.changes.before.capacity, audit.changes.after.capacity], [9, 5]);
    const [n] = (await notices('notice.session_changed', [s.id])).slice(-1);
    assert.deepEqual(n.changes.fields, ['starts_at', 'duration_min', 'trainer_id']);
    assert.equal((await reset(s.id, ['capacity'])).sessions_changed, 0, 'un campo no ajustado no hace nada');
  });

  await run('deshacer: tras un cambio de aforo de fecha futura vuelve al de sus vecinas; un cambio posterior ya lo pisa', async () => {
    const k = await mkClass({ weeks: 3 });
    const [s0, s1, s2] = k.s;
    await adjust(s0.id, { capacity: 9 });
    await change(k.id, { from: madridDay(s2.slot), capacity: 7 });
    assert.equal((await reset(s0.id, ['capacity'])).session.capacity, 5);
    assert.deepEqual([(await sessionRow(s1.id)).capacity, (await sessionRow(s2.id)).capacity], [5, 7]);
    await change(k.id, { capacity: 6 });
    assert.equal((await sessionRow(s0.id)).capacity, 6);
  });

  await run('deshacer: hora con exención de tardía; slot pasado → 409; aforo todo o nada y promoción; validación y estados', async () => {
    const k = await mkClass({ weeks: 2 });
    // slot dentro del plazo de cancelación (30 min); el inicio ajustado, 20 min antes.
    const s = await classSession(k, { at: 20, slot: 30, adjusted: ['starts_at'] });
    const [a, late] = [await student(), await student()];
    const ba = await bk(s.id, a);
    const r = await reset(s.id, ['starts_at']);
    assert.deepEqual([r.sessions_changed, r.notified, +new Date(r.session.starts_at)], [1, 1, +s.slot]);
    assert.ok(r.session.changed_at);
    const bl = await bk(s.id, late);
    assert.equal((await cancelAs(a, ba)).cancel_reason, 'student', 'reserva anterior al cambio: exenta');
    assert.equal((await cancelAs(late, bl)).cancel_reason, 'late');

    const gone = await classSession(k, { at: 3000, slot: -60, adjusted: ['starts_at'] });
    await rejects(reset(gone.id, ['starts_at']), 409, 'slot_passed');

    const full = await classSession(k, { at: 4000, adjusted: ['capacity'], capacity: 9 });
    for (let i = 0; i < 6; i++) await bk(full.id, await student());
    await rejects(reset(full.id, ['capacity']), 409, 'capacity_below_bookings');
    assert.deepEqual([(await sessionRow(full.id)).capacity, (await sessionRow(full.id)).adjusted_fields], [9, ['capacity']]);

    const small = await classSession(k, { at: 5000, adjusted: ['capacity'], capacity: 1 });
    await bk(small.id, await student());
    const wb = await bk(small.id, await student(), 'waitlisted');
    assert.equal((await reset(small.id, ['capacity'])).promoted, 1);
    assert.equal((await bookingOf(wb)).status, 'confirmed');

    for (const f of [[], ['nope'], ['capacity', 'capacity'], 'capacity']) await rejects(reset(small.id, f), 400, 'invalid_field');
    await assert.rejects(asAdmin((c) => c.query(`SELECT reset_session($1, '{nope}')`, [small.id])), (e) => e.message === 'invalid_field');
    await cancel(k.s[1].id);
    await rejects(reset(k.s[1].id, ['capacity']), 409, 'session_not_adjustable');
    const started = await classSession(k, { at: -100, adjusted: ['capacity'] }); // sin solapar con s
    await rejects(reset(started.id, ['capacity']), 409, 'session_not_adjustable');
  });

  // --- Retirar una clase ---
  await run('retirar: fecha pasada → 400; hoy conserva la sesión empezada con su asistencia; el resto, cancelado con aviso', async () => {
    const k = await mkClass({ weeks: 2 });
    const started = await classSession(k, { at: -10 });
    const a = await student();
    const ba = await bk(started.id, a);
    await present(started.id, a, ba);
    const bf = await bk(k.s[0].id, a);
    await rejects(asAdmin((c) => retireClass(c, { id: k.id, date: day(-1) })), 400, 'invalid_field');
    await rejects(asAdmin((c) => retireClass(c, { id: k.id, date: day(5000) })), 400, 'invalid_field');
    const r = await asAdmin((c) => retireClass(c, { id: k.id }));
    assert.equal(r.cancelled_sessions, 2);
    const st = await sessionRow(started.id);
    assert.deepEqual([st.status, (await q(`SELECT 1 FROM attendance WHERE session_id = $1`, [started.id])).length], ['scheduled', 1]);
    assert.deepEqual(await bookingOf(bf), { status: 'cancelled', cancel_reason: 'session_cancelled' });
    assert.equal((await notices('notice.session_cancelled', [k.s[0].id])).length, 1);
    const audit = await lastAudit('class.retire', k.id);
    assert.deepEqual([audit.changes.from, audit.changes.sessions.sort()], [day(0), k.s.map((x) => x.id).sort()]);
    for (const x of k.s) assert.ok((await sessionRow(x.id)).cancelled_at);
  });

  // --- Desactivar una disciplina ---
  await run('desactivar una disciplina: retira sus clases, cancela sus sueltas futuras, conserva la empezada; un aviso por alumno', async () => {
    const d = await discipline('Muay');
    const k1 = await mkClass({ weeks: 2, d });
    const k2 = await mkClass({ d, starts_on: day(10) }); // aún no ha empezado
    const started = await classSession(k1, { at: -10 });
    const fut = await loose({ discipline_id: String(d.id), trainer_id: await person('profesor'), starts_at: inMin(4000),
      duration_min: 60, capacity: 5 });
    const now = await rawLoose({ at: inMin(-5), d });
    const a = await student({ name: `${tag}-Eva` });
    const ea = await device(a);
    await bk(k1.s[0].id, a);
    await bk(fut.id, a);
    await bk(k2.s[0].id, await student());
    await drain();

    const r = await asAdmin((c) => updateDiscipline(c, { id: String(d.id), body: { is_active: false }, actorId: admin }));
    assert.deepEqual([r.is_active, r.retired_classes, r.cancelled_sessions], [false, 2, 4]);
    const [c1, c2] = await Promise.all([k1, k2].map(async (k) => (await q(`SELECT ends_on FROM classes WHERE id = $1`, [k.id]))[0]));
    assert.equal(madridDay(c1.ends_on), day(-1));
    assert.equal(madridDay(c2.ends_on), day(9), 'retirada antes de empezar');
    for (const x of [...k1.s, ...k2.s, fut]) assert.equal((await sessionRow(x.id)).status, 'cancelled');
    for (const x of [started, now]) assert.equal((await sessionRow(x.id)).status, 'scheduled');
    assert.equal((await q(`SELECT 1 FROM audit_log WHERE action = 'class.retire' AND resource_id = ANY($1)`, [[k1.id, k2.id]])).length, 2);
    assert.equal((await lastAudit('session.cancel', fut.id)).changes.note, null);
    await drain();
    assert.deepEqual(pushTo(ea).map((p) => p.body),
      [`Se han cancelado 2 reservas de ${tag}-Eva: la academia ha cancelado las sesiones`]);

    const back = await asAdmin((c) => updateDiscipline(c, { id: String(d.id), body: { is_active: true }, actorId: admin }));
    assert.equal('retired_classes' in back, false);
    assert.equal((await sessionRow(fut.id)).status, 'cancelled', 'volver a activarla no recupera nada');
  });

  // --- Concurrencia ---
  const sql = (uid, text, params) => ({ uid, sql: text, params });
  await run('concurrencia: cancel_session y book_session a la vez, en los dos órdenes; nunca una reserva confirmada en una cancelada', async () => {
    const k = await mkClass({ weeks: 2 });
    const [a, b] = [await student(), await student()];
    const r1 = await race(sql(admin, `SELECT cancel_session($1, NULL)`, [k.s[0].id]),
      sql(a, `SELECT book_session($1, $2)`, [k.s[0].id, a]));
    assert.ok(r1.waited, 'la reserva espera a la cancelación');
    assert.equal(r1.e?.message, 'session_not_bookable');
    const r2 = await race(sql(b, `SELECT book_session($1, $2)`, [k.s[1].id, b]),
      sql(admin, `SELECT cancel_session($1, NULL)`, [k.s[1].id]));
    assert.ok(r2.waited);
    assert.equal(r2.e, undefined);
    assert.deepEqual((await q(`SELECT status, cancel_reason FROM bookings WHERE session_id = $1`, [k.s[1].id])),
      [{ status: 'cancelled', cancel_reason: 'session_cancelled' }]);
    assert.equal((await q(`SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id
                            WHERE s.class_id = $1 AND s.status = 'cancelled' AND b.status <> 'cancelled'`, [k.id])).length, 0);
    // Dos cancelaciones a la vez: la segunda espera y ve la sesión ya cancelada (una sola cancelación auditada).
    const k2 = await mkClass({ weeks: 1 });
    const cs = sql(admin, `SELECT cancel_session($1, NULL)`, [k2.s[0].id]);
    const r3 = await race(cs, cs);
    assert.ok(r3.waited);
    assert.equal(r3.e?.message, 'session_cancelled');
    assert.equal((await q(`SELECT 1 FROM audit_log WHERE action = 'session.cancel' AND resource_id = $1`, [k2.s[0].id])).length, 1);
  });

  await run('concurrencia: restore_session y retire_class de su clase a la vez; nunca una programada después de ends_on', async () => {
    for (const restoreFirst of [false, true]) {
      const k = await mkClass({ weeks: 2 });
      const s = k.s[1];
      await cancel(s.id);
      const rs = sql(admin, `SELECT restore_session($1)`, [s.id]);
      const rt = sql(admin, `SELECT retire_class($1, $2)`, [k.id, madridDay(s.slot)]);
      const r = restoreFirst ? await race(rs, rt) : await race(rt, rs);
      assert.ok(r.waited, `espera (${restoreFirst})`);
      if (restoreFirst) assert.equal(r.e, undefined);
      else assert.equal(r.e?.message, 'class_retired');
      assert.equal((await sessionRow(s.id)).status, 'cancelled');
    }
  });

  await run('concurrencia: reset_session y change_class a la vez, sin interbloqueo y con el valor correcto en los dos órdenes', async () => {
    for (const resetFirst of [true, false]) {
      const k = await mkClass({ weeks: 1 });
      const [s] = k.s;
      await adjust(s.id, { capacity: 9 });
      const rs = sql(admin, `SELECT reset_session($1, '{capacity}')`, [s.id]);
      const cc = sql(admin, `SELECT change_class($1, CURRENT_DATE, '{"capacity": 7}')`, [k.id]);
      const r = resetFirst ? await race(rs, cc) : await race(cc, rs);
      assert.ok(r.waited, `espera (${resetFirst})`);
      assert.equal(r.e, undefined);
      const n = await sessionRow(s.id);
      assert.deepEqual([n.capacity, n.class_capacity, n.adjusted_fields], [7, 7, []]);
    }
    // A mitad del cambio de clase (B ya tiene la clase): el deshacer no la pide, así que nunca espera a B mientras
    // tiene la sesión. Si bloqueara sesión → clase, B esperaría su sesión y A la clase: interbloqueo.
    const k = await mkClass({ weeks: 1 });
    const [s] = k.s;
    await adjust(s.id, { capacity: 9 });
    const b = await appPool.connect();
    let bErr;
    try {
      await b.query('BEGIN');
      await b.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'admin', true)`, [admin]);
      await b.query(`SELECT 1 FROM classes WHERE id = $1 FOR UPDATE`, [k.id]); // el primer bloqueo de change_class
      let pidA;
      const pA = settle(asAdmin(async (c) => {
        pidA = await pidOf(c);
        return resetSession(c, { id: s.id, body: { fields: ['capacity'] } });
      }));
      while (!pidA) await new Promise((r) => setTimeout(r, 10));
      await waitLocked(pidA, 500);
      try {
        await b.query(`SELECT change_class($1, CURRENT_DATE, '{"capacity": 7}')`, [k.id]);
        await b.query('COMMIT');
      } catch (e) {
        bErr = e;
        await b.query('ROLLBACK');
      }
      const resA = await pA;
      assert.equal(bErr, undefined, `change_class: ${bErr?.message}`);
      assert.equal(resA.e, undefined, `reset_session: ${resA.e?.message}`);
    } finally {
      b.release();
    }
    assert.deepEqual([(await sessionRow(s.id)).capacity, (await sessionRow(s.id)).adjusted_fields], [7, []]);
  });

  // --- Permisos ---
  await run('permisos: alumno, tutor y profesor → 42501; cancel_session_row interna; cancel_session_bookings retirada; sin UPDATE', async () => {
    const k = await mkClass({ weeks: 1 });
    const who = [await student(), await person('tutor'), k.trainer];
    for (const uid of who) {
      const as = (text, params) => withRls({ uid, role: roleOf[uid] }, (c) => c.query(text, params));
      for (const [text, params] of [[`SELECT cancel_session($1, NULL)`, [k.s[0].id]], [`SELECT restore_session($1)`, [k.s[0].id]],
        [`SELECT reset_session($1, '{capacity}')`, [k.s[0].id]], [`SELECT retire_class($1, NULL)`, [k.id]]]) {
        await assert.rejects(as(text, params), (e) => e.code === '42501' && e.message === 'not_allowed', `${roleOf[uid]} ${text}`);
      }
    }
    const rows = await q(
      `SELECT p.proname FROM pg_proc p
        WHERE p.proname IN ('cancel_session', 'restore_session', 'reset_session', 'retire_class', 'cancel_session_row')
          AND has_function_privilege('app_user', p.oid, 'EXECUTE') ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.proname), ['cancel_session', 'reset_session', 'restore_session', 'retire_class']);
    assert.equal((await q(`SELECT 1 FROM pg_proc WHERE proname = 'cancel_session_bookings'`)).length, 0);
    await assert.rejects(asAdmin((c) => c.query(`UPDATE class_sessions SET capacity = 9 WHERE id = $1`, [k.s[0].id])),
      /permission denied/);
  });

  await run('HTTP: 403 a alumno, tutor y profesor; 401 sin sesión; admin 201/200 con su forma; 400 y 409', async () => {
    console.error = () => {};
    try {
      const k = await mkClass({ weeks: 2 });
      const [s, s2] = k.s;
      const body = { discipline_id: String(disc.id), trainer_id: k.trainer, starts_at: inMin(6000), duration_min: 60, capacity: 5 };
      const routes = [['POST', '/admin/sessions', body], ['POST', `/admin/sessions/${s.id}/cancel`, {}],
        ['POST', `/admin/sessions/${s.id}/restore`], ['POST', `/admin/sessions/${s.id}/reset`, { fields: ['capacity'] }]];
      for (const who of [await student(), await person('tutor'), k.trainer]) {
        for (const [m, url, b] of routes) assert.equal((await http(m, url, who, b)).status, 403, `${roleOf[who]} ${url}`);
      }
      for (const [m, url, b] of routes) assert.equal((await http(m, url, null, b)).status, 401);

      const rc = await http('POST', '/admin/sessions', admin, { ...body, extra: 'se ignora' });
      assert.deepEqual([rc.status, Object.keys(rc.body)], [201, ['session']]);
      assert.equal((await http('POST', '/admin/sessions', admin, {})).body.code, 'invalid_field');
      await http('PATCH', `/admin/sessions/${s.id}`, admin, { capacity: 9 });
      const rr = await http('POST', `/admin/sessions/${s.id}/reset`, admin, { fields: ['capacity'] });
      assert.deepEqual([rr.status, Object.keys(rr.body).sort()], [200, ['notified', 'promoted', 'session', 'sessions_changed']]);
      assert.equal((await http('POST', `/admin/sessions/${s.id}/reset`, admin, {})).body.code, 'invalid_field');
      const rx = await http('POST', `/admin/sessions/${s.id}/cancel`, admin);
      assert.deepEqual([rx.status, Object.keys(rx.body).sort()], [200, ['cancelled_bookings', 'notified', 'retroactive', 'session']]);
      assert.deepEqual([(await http('POST', `/admin/sessions/${s.id}/cancel`, admin, {})).status], [409]);
      const ro = await http('POST', `/admin/sessions/${s.id}/restore`, admin);
      assert.deepEqual([ro.status, Object.keys(ro.body).sort()], [200, ['notified', 'session']]);
      assert.equal((await http('POST', `/admin/sessions/${s2.id}/restore`, admin)).body.code, 'session_not_cancelled');
      assert.equal((await http('POST', `/admin/sessions/${s2.id}/cancel`, admin, { note: 5 })).body.code, 'invalid_field');
      assert.equal((await http('POST', `/admin/sessions/nope/cancel`, admin)).status, 400);
      assert.equal((await http('POST', `/admin/sessions/${crypto.randomUUID()}/cancel`, admin)).status, 404);
    } finally {
      console.error = realError;
    }
  });
} finally {
  console.error = realError;
  server.close();
  const sessions = (await q(`SELECT id FROM class_sessions WHERE discipline_id = ANY($1::bigint[])`, [discs])).map((r) => r.id);
  await q(`UPDATE notice_deliveries SET next_attempt_at = next_attempt_at - interval '100 years' WHERE id = ANY($1::uuid[])`, [parked]);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]); // CASCADE a notice_deliveries
  await q(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM classes WHERE discipline_id = ANY($1::bigint[])`, [discs]);
  await q(`DELETE FROM subscriptions WHERE student_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM plans WHERE id = $1`, [plan.id]);
  await q(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [discs]);
  await q(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM student_health_info WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM guardianships WHERE tutor_id = ANY($1::uuid[]) OR minor_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM auth_credentials WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]); // CASCADE a push_subscriptions
  await q(`DELETE FROM agreement_documents WHERE id = ANY($1::uuid[])`, [testDocs]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
