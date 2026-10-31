// B7.1: cambio de clase y ajuste de sesión sobre las reservas (CONTEXT § Clases y sesiones, § Reservas y § Avisos;
// ADR 0004). Datos confirmados (no hay una transacción que se deshaga): la concurrencia usa dos conexiones reales y los
// avisos pasan por el worker. Se borra todo al final. Las rutas, por HTTP con un express en memoria y un JWT firmado.
// Con `npm run dev` en marcha, su worker se lleva entregas del test: pararlo antes.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { appPool, servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminClassesRouter from '../src/routes/admin/classes.js';
import adminSessionsRouter from '../src/routes/admin/sessions.js';
import { createClass, updateClass } from '../src/services/classes.js';
import { adjustSession, generateSessions } from '../src/services/sessions.js';
import { cancelBooking } from '../src/services/bookings.js';
import { sendPending } from '../src/services/notices.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const tag = `tsc${crypto.randomBytes(3).toString('hex')}`;
const TZ = 'Europe/Madrid';
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: TZ });
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
const local = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const madridDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ });
const when = (d) => new Date(d).toLocaleString('es-ES', { // como services/notices.js
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});
const inMin = (min) => new Date(Date.now() + min * 60e3).toISOString();
const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code);

// --- Fixtures ---
const ids = [];
const roleOf = {};
async function person(role, { name, birth = null } = {}) {
  const id = crypto.randomUUID();
  ids.push(id);
  roleOf[id] = role;
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [id, name ?? `${tag}-${role}`, birth]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
  await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@sc.test`]);
  return id;
}

// Acuerdos vigentes: los existentes o unos de prueba (se borran al final).
const testDocs = [];
for (const type of ['waiver', 'data_protection', 'rights_of_image']) {
  if ((await q(`SELECT 1 FROM agreement_documents WHERE type = $1 AND published_at IS NOT NULL AND retired_at IS NULL`,
    [type])).length) continue;
  testDocs.push((await q(
    `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
     VALUES (gen_random_uuid(), $1, '99.' || floor(random() * 1e6), 'test-session-changes.pdf', 'x', now()) RETURNING id`,
    [type]))[0].id);
}
const [disc] = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id, name`, [`${tag}-BJJ`]);
const [plan] = await q(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`, [`${tag}-all`]);

// Alumno con perfil completo y cobertura de riesgo (la promoción lo re-comprueba); `cover`: suscripción en vigor.
async function student({ name, cover = true, birth = null, tutors = [] } = {}) {
  const id = await person('alumno', { name, birth });
  for (const t of tutors) await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [t, id]);
  const by = birth ? tutors[0] : id;
  for (const type of ['waiver', 'data_protection', 'rights_of_image']) {
    await q(`INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
             SELECT gen_random_uuid(), $1, $2, $3, version FROM agreement_documents
              WHERE type = $3 AND published_at IS NOT NULL AND retired_at IS NULL`, [id, by, type]);
  }
  await q(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
           VALUES ($1, 'x', '600000000')`, [id]);
  if (cover) {
    await q(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
             VALUES ($1, $2, $3, 'active', $4)`, [id, by, plan.id, `sub_${tag}_${id}`]);
  }
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
const cancelAs = (who, bookingId) => withRls({ uid: who, role: roleOf[who] }, (c) => cancelBooking(c, bookingId));

const classes = [];
const loose = [];
const sessionsOf = (classId) => q(`SELECT * FROM class_sessions WHERE class_id = $1 ORDER BY slot`, [classId]);
const sessionRow = async (id) => (await q(`SELECT * FROM class_sessions WHERE id = $1`, [id]))[0];
// Clase semanal desde mañana (la primera sesión nunca ha empezado), `weeks` sesiones; cada una con su profesor.
async function mkClass({ weeks = 3, start_time = '19:00', duration_min = 60, capacity = 5, trainer, starts_on } = {}) {
  const t = trainer ?? await person('profesor');
  const body = { discipline_id: String(disc.id), trainer_id: t, weekday: starts_on ? 7 : dow(day(1)), start_time,
    duration_min, capacity, ...(starts_on ? { starts_on } : { ends_on: day(1 + 7 * (weeks - 1)) }) };
  const cls = await asAdmin((c) => createClass(c, { body, actorId: admin }));
  classes.push(cls.id);
  return { ...cls, trainer: t, s: await sessionsOf(cls.id) };
}
async function looseSession(startsAt, { capacity = 5, trainer, minutes = 60 } = {}) {
  const [s] = await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + $4 * interval '1 minute', $4, $5, 'scheduled') RETURNING *`,
    [disc.id, trainer ?? await person('profesor'), startsAt, minutes, capacity]);
  loose.push(s.id);
  return s;
}
// Sesión de una clase ya empezada (hoy, hace 10 min), con su slot.
const startedSession = async (k) => (await q(
  `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, status)
   VALUES ($1, $2, $3, now() - interval '10 min', now() - interval '10 min', now() + interval '50 min', 60, 5, 'scheduled')
   RETURNING *`, [k.id, disc.id, k.trainer]))[0];
async function bk(sessionId, studentId, status = 'confirmed') {
  const [b] = await q(`INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, $3) RETURNING id`,
    [sessionId, studentId, status]);
  return b.id;
}
const bookingOf = async (id) => (await q(`SELECT status, cancel_reason, promoted_at FROM bookings WHERE id = $1`, [id]))[0];

// Worker con transportes falsos. Las entregas pendientes ajenas al test se aparcan y se restauran al final.
const parked = (await q(
  `UPDATE notice_deliveries SET next_attempt_at = next_attempt_at + interval '100 years' WHERE status = 'pending'
   RETURNING id`)).map((r) => r.id);
const pushed = [];
const mailed = [];
const fakePush = async (m) => { pushed.push(m); return { status: 'sent' }; };
const fakeEmail = async (m) => { mailed.push(m); return { id: `fake-${mailed.length}` }; };
async function drain() {
  pushed.length = 0;
  mailed.length = 0;
  while ((await sendPending(servicePool, fakeEmail, fakePush)) === 20);
}
const pushTo = (endpoint) => pushed.filter((m) => m.subscription.endpoint === endpoint).map((m) => m.payload);
const mailTo = (id) => mailed.filter((m) => m.to === `${id}@sc.test`);
const changedNotices = (sessionIds) => q(
  `SELECT a.* FROM audit_log a JOIN bookings b ON b.id::text = a.resource_id
    WHERE a.action = 'notice.session_changed' AND b.session_id = ANY($1::uuid[]) ORDER BY a.created_at, a.id`, [sessionIds]);
const deliveriesOf = (auditIds) => q(
  `SELECT recipient_id, channel, status, last_error FROM notice_deliveries WHERE audit_id = ANY($1::uuid[])`, [auditIds]);

// Espera a que la conexión `pid` esté esperando un bloqueo (pg_locks lo ve cualquiera).
async function waitLocked(pid, ms = 3000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 25))) {
    if ((await q(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid])).length) return true;
  }
  return false;
}
const settle = (p) => p.then((r) => ({ r }), (e) => ({ e }));
const pidOf = async (c) => (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p;

// --- HTTP ---
const app = express().use(express.json()).use('/admin', adminClassesRouter).use('/admin', adminSessionsRouter).use(errorHandler);
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
  // --- Cambio de clase ---
  await run('cambio de clase desde una fecha: hora, duración, profesor, aforo y lugar; respeta los ajustes; lo anterior no cambia', async () => {
    const k = await mkClass({ weeks: 4 });
    const [s0, s1, s2, s3] = k.s;
    const [p2, p3] = [await person('profesor'), await person('profesor')];
    await q(`UPDATE class_sessions SET status = 'cancelled' WHERE id = $1`, [s2.id]); // también las canceladas
    await adjust(s3.id, { trainer_id: p3 });
    const r = await change(k.id, { from: madridDay(s1.slot), start_time: '20:30', duration_min: 90, trainer_id: p2,
      capacity: 8, location: 'tatami 3' });
    assert.equal(r.sessions_changed, 3);
    assert.deepEqual([r.class.start_time, r.class.duration_min, r.class.trainer_id, r.class.capacity, r.class.location],
      ['20:30', 90, p2, 8, 'tatami 3']);
    const a = await sessionRow(s0.id);
    assert.deepEqual([local(a.starts_at), a.duration_min, a.trainer_id, a.capacity, a.location, a.changed_at],
      ['19:00', 60, k.trainer, 5, null, null], 'antes de from: sin cambios');
    for (const s of [s1, s2, s3]) {
      const n = await sessionRow(s.id);
      assert.equal(local(n.starts_at), '20:30');
      assert.equal(+n.slot, +n.starts_at);
      assert.equal(madridDay(n.slot), madridDay(s.slot));
      assert.equal(n.ends_at - n.starts_at, 90 * 60e3);
      assert.deepEqual([n.duration_min, n.capacity, n.location], [90, 8, 'tatami 3']);
      assert.equal(n.trainer_id, s === s3 ? p3 : p2, 'el sustituto ajustado se queda');
    }
    assert.equal((await sessionRow(s2.id)).changed_at, null, 'cancelada: cambia sin «cambio que afecta»');
    assert.ok((await sessionRow(s1.id)).changed_at);
    const [audit] = await q(`SELECT changes FROM audit_log WHERE action = 'class.change' AND resource_id = $1`, [k.id]);
    assert.deepEqual(audit.changes, { from: madridDay(s1.slot), patch: { start_time: '20:30', duration_min: 90,
      trainer_id: p2, capacity: 8, location: 'tatami 3' }, sessions_changed: 3, notified: 0, promoted: 0 });

    const sx = await startedSession(k);
    const r2 = await change(k.id, { location: 'tatami 4' }); // from = hoy
    assert.equal(r2.sessions_changed, 4);
    assert.equal((await sessionRow(sx.id)).location, null, 'la empezada no cambia');
    assert.equal((await sessionRow(s0.id)).location, 'tatami 4');
  });

  await run('cambio de hora en el paso de horario de verano a invierno: misma hora de Madrid a los dos lados', async () => {
    const lastSundayOct = (y) => {
      const d = new Date(Date.UTC(y, 9, 31));
      d.setUTCDate(31 - d.getUTCDay());
      return d.toISOString().slice(0, 10);
    };
    let winter = lastSundayOct(new Date().getUTCFullYear());
    if (winter <= day(8)) winter = lastSundayOct(new Date().getUTCFullYear() + 1);
    const summer = new Date(Date.parse(winter) - 7 * 864e5).toISOString().slice(0, 10);
    const k = await mkClass({ starts_on: '2999-01-01' }); // sin generar: las sesiones se ponen a mano
    assert.equal(k.s.length, 0);
    const ins = [];
    for (const d of [summer, winter]) {
      ins.push((await q(
        `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, status)
         SELECT $1, $2, $3, t, t, t + interval '60 min', 60, 5, 'scheduled'
           FROM (SELECT ($4::date + time '19:00') AT TIME ZONE '${TZ}' AS t) x RETURNING id`,
        [k.id, disc.id, k.trainer, d]))[0].id);
    }
    assert.equal((await change(k.id, { start_time: '20:30' })).sessions_changed, 2);
    const [a, b] = await Promise.all(ins.map(sessionRow));
    assert.deepEqual([local(a.starts_at), local(b.starts_at)], ['20:30', '20:30']);
    assert.deepEqual([a.starts_at.toISOString().slice(11, 16), b.starts_at.toISOString().slice(11, 16)], ['18:30', '19:30']);
    assert.deepEqual([madridDay(a.slot), madridDay(b.slot)], [summer, winter]);
  });

  await run('cambio de clase: validación (409 disciplina/día, 400 from, profesor sin rol, body vacío)', async () => {
    const k = await mkClass({ weeks: 1 });
    await rejects(change(k.id, { weekday: 3 }), 409, 'not_supported');
    await rejects(change(k.id, { discipline_id: String(disc.id), capacity: 9 }), 409, 'not_supported');
    await rejects(change(k.id, { from: day(-1), capacity: 9 }), 400, 'invalid_field');
    await rejects(change(k.id, { from: day(400), capacity: 9 }), 400, 'invalid_field');
    await rejects(change(k.id, { from: '31/12/2026', capacity: 9 }), 400, 'invalid_field');
    await rejects(change(k.id, { trainer_id: admin }), 400, 'invalid_field');
    await rejects(change(k.id, {}), 400, 'invalid_field');
    await rejects(change(k.id, { from: day(0) }), 400, 'invalid_field');
    await rejects(change(crypto.randomUUID(), { capacity: 9 }), 404, 'class_not_found');
    assert.equal((await sessionRow(k.s[0].id)).capacity, 5);
  });

  await run('solape del profesor → 409 trainer_overlap sin cambiar nada', async () => {
    const k = await mkClass({ weeks: 2 });
    const other = await mkClass({ weeks: 2 }); // otro profesor, misma hora
    await rejects(change(k.id, { trainer_id: other.trainer, capacity: 9 }), 409, 'trainer_overlap');
    const [{ trainer_id: t, capacity }] = await q(`SELECT trainer_id, capacity FROM classes WHERE id = $1`, [k.id]);
    assert.deepEqual([t, capacity], [k.trainer, 5]);
    for (const s of await sessionsOf(k.id)) assert.deepEqual([s.trainer_id, s.capacity], [k.trainer, 5]);
  });

  // --- Ajuste de sesión y slot ---
  await run('ajuste: mover a otro día; generateSessions no recrea el hueco; la hora de la clase luego mueve el slot, no el inicio', async () => {
    const k = await mkClass({ weeks: 3 });
    const last = k.s[2];
    const moved = new Date(+last.starts_at + 2 * 864e5 - 3 * 3600e3).toISOString();
    const r = await adjust(last.id, { starts_at: moved });
    assert.deepEqual([r.sessions_changed, r.session.adjusted_fields, +r.session.slot], [1, ['starts_at'], +last.slot]);
    assert.equal(+r.session.starts_at, Date.parse(moved));
    assert.equal(r.session.ends_at - r.session.starts_at, 60 * 60e3);
    assert.equal(await generateSessions(servicePool, k.id), 0);
    assert.equal((await sessionsOf(k.id)).length, 3);

    await change(k.id, { start_time: '18:00' });
    const after = await sessionRow(last.id);
    assert.equal(+after.starts_at, Date.parse(moved), 'el inicio ajustado no cambia');
    assert.equal(local(after.slot), '18:00');
    assert.equal(madridDay(after.slot), madridDay(last.slot));
    assert.equal(local((await sessionRow(k.s[0].id)).starts_at), '18:00');
    const [{ changes }] = await q(`SELECT changes FROM audit_log WHERE action = 'session.adjust' AND resource_id = $1`, [last.id]);
    assert.deepEqual([Object.keys(changes.before), Date.parse(changes.before.starts_at), Date.parse(changes.after.starts_at)],
      [['starts_at'], +last.starts_at, Date.parse(moved)]);
  });

  await run('cambio de hora desde una fecha futura: la generación no duplica los días anteriores a from', async () => {
    const k = await mkClass({ weeks: 3 });
    await change(k.id, { from: madridDay(k.s[1].slot), start_time: '20:00' });
    await q(`UPDATE classes SET ends_on = ends_on + 7 WHERE id = $1`, [k.id]);
    assert.equal(await generateSessions(servicePool, k.id), 1);
    const s = await sessionsOf(k.id);
    assert.deepEqual(s.map((x) => local(x.starts_at)), ['19:00', '20:00', '20:00', '20:00']);
  });

  await run('ajuste: empezada o cancelada → 409; sesión suelta; validación', async () => {
    const k = await mkClass({ weeks: 2 });
    const sx = await startedSession(k);
    await rejects(adjust(sx.id, { capacity: 9 }), 409, 'session_not_adjustable');
    await q(`UPDATE class_sessions SET status = 'cancelled' WHERE id = $1`, [k.s[1].id]);
    await rejects(adjust(k.s[1].id, { capacity: 9 }), 409, 'session_not_adjustable');
    await rejects(adjust(crypto.randomUUID(), { capacity: 9 }), 404, 'session_not_found');
    const l = await looseSession(inMin(3 * 24 * 60));
    const r = await adjust(l.id, { capacity: 7, location: 'open mat' });
    assert.deepEqual([r.session.capacity, r.session.location, r.session.slot, r.session.adjusted_fields.sort()],
      [7, 'open mat', null, ['capacity', 'location']]);
    await rejects(adjust(l.id, { starts_at: inMin(-5) }), 400, 'invalid_field');
    await rejects(adjust(l.id, { starts_at: '2030-01-01 10:00' }), 400, 'invalid_field'); // sin zona
    await rejects(adjust(l.id, { trainer_id: admin }), 400, 'invalid_field');
    await rejects(adjust(l.id, {}), 400, 'invalid_field');
    await rejects(adjust(l.id, { weekday: 2 }), 400, 'invalid_field');
  });

  // --- Aforo ---
  await run('aforo: bajada por debajo de las confirmadas → 409 con sessions y fits_from, sin cambios', async () => {
    const k = await mkClass({ weeks: 3, capacity: 3 });
    const [s0, s1, s2] = k.s;
    const al = [await student(), await student(), await student()];
    for (const a of al.slice(0, 2)) await bk(s0.id, a);
    for (const a of al) await bk(s1.id, a);
    await bk(s2.id, al[0]);
    const err = await change(k.id, { capacity: 2, location: 'x' }).catch((e) => e);
    assert.equal(err.code, 'capacity_below_bookings');
    assert.deepEqual(err.details.sessions.map((x) => [x.id, Date.parse(x.starts_at), x.confirmed]),
      [[s1.id, +s1.starts_at, 3]]);
    assert.equal(err.details.fits_from, new Date(Date.parse(madridDay(s1.slot)) + 864e5).toISOString().slice(0, 10));
    assert.equal((await q(`SELECT capacity FROM classes WHERE id = $1`, [k.id]))[0].capacity, 3);
    for (const s of await sessionsOf(k.id)) assert.deepEqual([s.capacity, s.location], [3, null]);
    assert.equal((await q(`SELECT 1 FROM audit_log WHERE action = 'class.change' AND resource_id = $1`, [k.id])).length, 0);

    const ok = await change(k.id, { from: err.details.fits_from, capacity: 2 });
    assert.equal(ok.sessions_changed, 1);
    assert.equal((await sessionRow(s2.id)).capacity, 2);
    const e2 = await adjust(s1.id, { capacity: 2 }).catch((e) => e);
    assert.equal(e2.code, 'capacity_below_bookings');
    assert.deepEqual(Object.keys(e2.details), ['sessions']);
    assert.equal(e2.details.sessions[0].confirmed, 3);
  });

  await run('aforo: subida → promoción por orden de llegada, con el salto por solape y no_coverage', async () => {
    const k = await mkClass({ weeks: 1, capacity: 1 });
    const [s] = k.s;
    const [a1, noCov, ovl, a2, a3, a4] = [await student(), await student({ cover: false }), await student(),
      await student(), await student(), await student()];
    const l = await looseSession(s.starts_at); // solapa con s
    await bk(l.id, ovl);
    await bk(s.id, a1);
    const w = {};
    for (const [key, who] of Object.entries({ noCov, ovl, a2, a3, a4 })) w[key] = await bk(s.id, who, 'waitlisted');
    const r = await change(k.id, { capacity: 3 });
    assert.deepEqual([r.sessions_changed, r.promoted, r.notified], [1, 2, 0]);
    assert.deepEqual(await bookingOf(w.noCov).then((b) => [b.status, b.cancel_reason]), ['cancelled', 'no_coverage']);
    assert.equal((await bookingOf(w.ovl)).status, 'waitlisted');
    assert.equal((await bookingOf(w.a2)).status, 'confirmed');
    assert.equal((await bookingOf(w.a3)).status, 'confirmed');
    assert.equal((await bookingOf(w.a4)).status, 'waitlisted');
  });

  // --- Avisos ---
  await run('avisos: solo si cambia inicio, duración o profesor (no con el mismo sustituto, lugar o aforo)', async () => {
    const k = await mkClass({ weeks: 1 });
    const [s] = k.s;
    const alu = await student({ name: `Lucía ${tag}` });
    const ep = await device(alu);
    await bk(s.id, alu);
    for (const body of [{ trainer_id: k.trainer }, { location: 'tatami 9' }, { capacity: 9 }]) {
      assert.equal((await adjust(s.id, body)).notified, 0, JSON.stringify(body));
    }
    assert.equal((await adjust(s.id, { trainer_id: k.trainer })).sessions_changed, 0);
    assert.equal((await change(k.id, { location: 'tatami 1', capacity: 6 })).notified, 0);
    assert.equal((await sessionRow(s.id)).changed_at, null);
    assert.equal((await changedNotices([s.id])).length, 0);

    await drain();
    assert.equal((await adjust(s.id, { duration_min: 90 })).notified, 1);
    await drain();
    assert.deepEqual(pushTo(ep).map((p) => [p.title, p.body]), [['Sesión cambiada',
      `${disc.name}, ${when(s.starts_at)} (Lucía ${tag}): ha cambiado la duración (ahora 1 h 30). `
      + 'Si ya no te viene bien, puedes cancelar sin que cuente como tardía']]);
  });

  await run('avisos: confirmadas y en espera, tutores de un hijo, sin el admin; uno por alumno con N sesiones; texto', async () => {
    const k = await mkClass({ weeks: 3 });
    const carlos = await person('profesor', { name: `Carlos ${tag}` });
    const [t1, t2] = [await person('tutor'), await person('tutor')];
    const alu = await student({ name: `Lucía ${tag}` });
    const child = await student({ name: `Nico ${tag}`, birth: '2016-05-05', tutors: [t1, t2] });
    const ep = await device(alu);
    for (const s of k.s) await bk(s.id, alu);
    await bk(k.s[0].id, child, 'waitlisted');
    const gone = await bk(k.s[1].id, await student());
    await q(`UPDATE bookings SET status = 'cancelled', cancel_reason = 'student', cancelled_at = now() WHERE id = $1`, [gone]);

    await drain();
    const r = await change(k.id, { start_time: '20:00', trainer_id: carlos });
    assert.deepEqual([r.sessions_changed, r.notified], [3, 4]);
    const notices = await changedNotices(k.s.map((s) => s.id));
    assert.equal(notices.length, 4);
    assert.deepEqual(notices[0].changes.fields, ['starts_at', 'trainer_id']);
    assert.equal(Date.parse(notices[0].changes.previous_starts_at) % 1000, 0);
    const dels = await deliveriesOf(notices.map((n) => n.id));
    assert.deepEqual(dels.map((d) => `${d.recipient_id}:${d.channel}`).sort(),
      [`${alu}:push`, `${t1}:email`, `${t2}:email`].sort(), 'una por alumno; los dos tutores; sin admin');

    await drain();
    assert.deepEqual(pushTo(ep), [{ title: 'Sesiones cambiadas', url: `${process.env.APP_URL}/bookings`,
      tag: pushTo(ep)[0]?.tag, body: `Han cambiado 3 sesiones de ${disc.name} de Lucía ${tag} (la hora y el profesor). `
        + 'Si ya no te vienen bien, puedes cancelarlas sin que cuente como tardía' }]);
    const s0 = await sessionRow(k.s[0].id);
    for (const t of [t1, t2]) {
      const [m] = mailTo(t);
      assert.equal(m.subject, `Sesión cambiada de Nico ${tag}`);
      assert.ok(m.text.includes(`${disc.name}, ${when(s0.starts_at)} (Nico ${tag}): ha cambiado la hora `
        + `(antes ${when(k.s[0].starts_at)}) y el profesor (ahora Carlos ${tag}). `
        + 'Si ya no te viene bien, puedes cancelar sin que cuente como tardía.'), m.text);
      assert.doesNotMatch(m.text + m.html, /2016|5 de mayo|\d+ años|nacimiento|undefined|null/);
    }
    assert.equal(mailed.filter((m) => m.to === `${admin}@sc.test`).length, 0);
  });

  await run('avisos: el grupo con la primera sesión ya empezada se envía sin ella; caduca al empezar la última', async () => {
    const k = await mkClass({ weeks: 2 });
    const alu = await student({ name: `Lucía ${tag}` });
    const ep = await device(alu);
    for (const s of k.s) await bk(s.id, alu);
    await change(k.id, { trainer_id: await person('profesor') });
    // Simula que pasa el tiempo: la primera sesión (y lo que guardó su aviso) ya ha empezado.
    const [first] = await changedNotices([k.s[0].id]);
    await q(`UPDATE class_sessions SET starts_at = now() - interval '5 min', ends_at = now() + interval '55 min'
              WHERE id = $1`, [k.s[0].id]);
    await q(`UPDATE audit_log SET changes = jsonb_set(changes, '{expires_at}', to_jsonb(now() - interval '5 min'))
              WHERE id = $1`, [first.id]);
    await drain();
    const [p] = pushTo(ep);
    assert.equal(p.title, 'Sesión cambiada');
    assert.ok(p.body.startsWith(`${disc.name}, ${when(k.s[1].starts_at)} (Lucía ${tag}): ha cambiado el profesor`), p.body);
    assert.ok(pushed.find((m) => m.subscription.endpoint === ep).ttl > 0);

    const k2 = await mkClass({ weeks: 2 });
    for (const s of k2.s) await bk(s.id, alu);
    await change(k2.id, { duration_min: 45 });
    const group = await changedNotices(k2.s.map((s) => s.id));
    await q(`UPDATE audit_log SET changes = jsonb_set(changes, '{expires_at}', to_jsonb(now() - interval '1 min'))
              WHERE id = ANY($1::uuid[])`, [group.map((g) => g.id)]);
    await drain();
    assert.equal(pushTo(ep).length, 0);
    assert.deepEqual((await deliveriesOf(group.map((g) => g.id))).map((d) => [d.status, d.last_error]), [['skipped', 'stale']]);
  });

  // --- Exención de cancelación tardía ---
  await run('exención: anterior al cambio → student; posterior → late; con dos cambios seguidos', async () => {
    const l = await looseSession(inMin(3 * 60));
    const [a0, a1, a2] = [await student(), await student(), await student()];
    const b0 = await bk(l.id, a0);
    await adjust(l.id, { starts_at: inMin(40) }); // dentro del plazo de cancelación (60 min)
    const b1 = await bk(l.id, a1);
    await adjust(l.id, { trainer_id: await person('profesor') });
    const b2 = await bk(l.id, a2);
    assert.equal((await cancelAs(a0, b0)).cancel_reason, 'student');
    assert.equal((await cancelAs(a1, b1)).cancel_reason, 'student');
    assert.equal((await cancelAs(a2, b2)).cancel_reason, 'late');
  });

  await run('exención: promocionado tras el cambio (estaba en espera antes) → student', async () => {
    const l = await looseSession(inMin(3 * 60), { capacity: 1 });
    const [a, b] = [await student(), await student()];
    const ba = await bk(l.id, a);
    const bb = await bk(l.id, b, 'waitlisted');
    await adjust(l.id, { trainer_id: await person('profesor') });
    assert.equal((await cancelAs(a, ba)).cancel_reason, 'student');
    const promoted = await bookingOf(bb);
    assert.equal(promoted.status, 'confirmed');
    // Pasa el tiempo (sin otro cambio): la sesión entra en el plazo; fue promocionado fuera de él.
    await q(`UPDATE class_sessions SET starts_at = now() + interval '30 min', ends_at = now() + interval '90 min'
              WHERE id = $1`, [l.id]);
    assert.equal((await cancelAs(b, bb)).cancel_reason, 'student');
  });

  // --- Solape de reservas ---
  await run('solape: un cambio de hora deja dos reservas solapadas sin error; la promoción sigue saltando por solape', async () => {
    const k = await mkClass({ weeks: 1, capacity: 2 });
    const [s] = k.s;
    const l = await looseSession(new Date(+s.starts_at + 60 * 60e3).toISOString()); // justo después
    const [a1, a2, a3] = [await student(), await student(), await student()];
    await bk(s.id, a2);
    const both = [await bk(s.id, a3), await bk(l.id, a3)];
    await bk(l.id, a1);
    const w = await bk(s.id, a1, 'waitlisted');
    const r = await change(k.id, { start_time: '19:30', capacity: 3 });
    assert.equal(r.promoted, 0);
    assert.equal((await bookingOf(w)).status, 'waitlisted');
    for (const id of both) assert.equal((await bookingOf(id)).status, 'confirmed');
  });

  // --- Concurrencia (dos conexiones reales) ---
  await run('concurrencia: change_class y book_session a la vez, sin interbloqueo (orden clase → sesiones → alumnos)', async () => {
    const k = await mkClass({ weeks: 2, capacity: 1 });
    const [s1, s2] = [...k.s].sort((x, y) => (x.id < y.id ? -1 : 1)); // el orden de los bloqueos
    const [a, x] = [await student(), await student()];
    await bk(s1.id, a);
    const wx = await bk(s1.id, x, 'waitlisted');
    // B tiene s2 y luego reserva en ella a x (lock_student(x)). Si change_class bloqueara sesión a sesión, tendría
    // s1 y a x (al promocionarlo en s1) esperando s2: interbloqueo.
    const b = await servicePool.connect();
    let bErr;
    try {
      await b.query('BEGIN');
      await b.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'alumno', true)`, [x]);
      await b.query(`SELECT 1 FROM class_sessions WHERE id = $1 FOR UPDATE`, [s2.id]);
      let pidA;
      const pA = settle(asAdmin(async (c) => {
        pidA = await pidOf(c);
        return updateClass(c, { id: k.id, body: { capacity: 2 } });
      }));
      while (!pidA) await new Promise((r) => setTimeout(r, 10));
      assert.ok(await waitLocked(pidA), 'change_class espera a s2');
      try {
        await b.query(`SELECT * FROM book_session($1, $2)`, [s2.id, x]);
        await b.query('COMMIT');
      } catch (e) {
        bErr = e;
        await b.query('ROLLBACK');
      }
      const resA = await pA;
      assert.equal(bErr, undefined, `book_session: ${bErr?.message}`);
      assert.equal(resA.e, undefined, `change_class: ${resA.e?.message}`);
      assert.equal(resA.r.promoted, 1);
    } finally {
      b.release();
    }
    assert.equal((await bookingOf(wx)).status, 'confirmed');
    assert.equal((await q(`SELECT status FROM bookings WHERE session_id = $1 AND student_id = $2`, [s2.id, x]))[0].status,
      'confirmed');
  });

  await run('concurrencia: una reserva que entra mientras se baja el aforo cuenta (409, aforo nunca superado)', async () => {
    const k = await mkClass({ weeks: 1, capacity: 2 });
    const [s] = k.s;
    const [a1, a2] = [await student(), await student()];
    await bk(s.id, a1);
    const b = await servicePool.connect();
    try {
      await b.query('BEGIN');
      await b.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'alumno', true)`, [a2]);
      assert.equal((await b.query(`SELECT status FROM book_session($1, $2)`, [s.id, a2])).rows[0].status, 'confirmed');
      let pidA;
      const pA = settle(asAdmin(async (c) => {
        pidA = await pidOf(c);
        return updateClass(c, { id: k.id, body: { capacity: 1 } });
      }));
      while (!pidA) await new Promise((r) => setTimeout(r, 10));
      assert.ok(await waitLocked(pidA));
      await b.query('COMMIT');
      const { e } = await pA;
      assert.equal(e?.code, 'capacity_below_bookings');
      assert.equal(e.details.sessions[0].confirmed, 2);
    } finally {
      b.release();
    }
    assert.equal((await sessionRow(s.id)).capacity, 2);
  });

  await run('concurrencia: generateSessions a la vez que un cambio de clase genera con los valores nuevos (FOR SHARE)', async () => {
    const k = await mkClass({ weeks: 3 });
    await q(`DELETE FROM class_sessions WHERE id = $1`, [k.s[2].id]); // la que generará la extensión
    const a = await appPool.connect();
    const g = await servicePool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'admin', true)`, [admin]);
      await a.query(`SELECT change_class($1, $2, $3)`, [k.id, day(0), { start_time: '21:00' }]);
      const pidG = await pidOf(g);
      const pG = settle(generateSessions(g, k.id));
      assert.ok(await waitLocked(pidG, 1500), 'la generación espera al cambio en curso');
      await a.query('COMMIT');
      const { r, e } = await pG;
      assert.equal(e, undefined);
      assert.equal(r, 1);
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      a.release();
      g.release();
    }
    const s = await sessionsOf(k.id);
    assert.deepEqual(s.map((x) => local(x.starts_at)), ['21:00', '21:00', '21:00']);
    assert.equal(+s[2].slot, +s[2].starts_at);
  });

  // --- Permisos ---
  await run('permisos: alumno, tutor y profesor → 42501 en SQL', async () => {
    const k = await mkClass({ weeks: 1 });
    const who = [await student(), await person('tutor'), k.trainer];
    for (const uid of who) {
      const as = (sql, params) => withRls({ uid, role: roleOf[uid] }, (c) => c.query(sql, params));
      await assert.rejects(as(`SELECT change_class($1, CURRENT_DATE, '{"capacity": 9}')`, [k.id]),
        (e) => e.code === '42501' && e.message === 'not_allowed', roleOf[uid]);
      await assert.rejects(as(`SELECT adjust_session($1, '{"capacity": 9}')`, [k.s[0].id]),
        (e) => e.code === '42501' && e.message === 'not_allowed', roleOf[uid]);
    }
    const { rows } = await servicePool.query(
      `SELECT p.proname FROM pg_proc p WHERE p.proname IN ('change_class', 'adjust_session', 'apply_session_change')
          AND has_function_privilege('app_user', p.oid, 'EXECUTE') ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.proname), ['adjust_session', 'change_class']);
  });

  await run('HTTP: 403 a alumno, tutor y profesor; 401 sin sesión; admin 200, 400 y 409', async () => {
    console.error = () => {};
    try {
    const k = await mkClass({ weeks: 1 });
    const [s] = k.s;
    const alu = await student();
    for (const who of [alu, await person('tutor'), k.trainer]) {
      assert.equal((await http('PATCH', `/admin/classes/${k.id}`, who, { capacity: 9 })).status, 403);
      assert.equal((await http('PATCH', `/admin/sessions/${s.id}`, who, { capacity: 9 })).status, 403);
    }
    assert.equal((await http('PATCH', `/admin/classes/${k.id}`, null, { capacity: 9 })).status, 401);
    assert.equal((await http('PATCH', `/admin/sessions/${s.id}`, null, { capacity: 9 })).status, 401);

    const rs = await http('PATCH', `/admin/sessions/${s.id}`, admin, { capacity: 9 });
    assert.equal(rs.status, 200);
    assert.deepEqual(Object.keys(rs.body).sort(), ['notified', 'promoted', 'session', 'sessions_changed']);
    assert.equal(rs.body.session.capacity, 9);
    const rc = await http('PATCH', `/admin/classes/${k.id}`, admin, { location: 'tatami 5' });
    assert.equal(rc.status, 200);
    assert.deepEqual(Object.keys(rc.body).sort(), ['class', 'notified', 'promoted', 'sessions_changed']);
    assert.equal(rc.body.class.location, 'tatami 5');
    assert.equal((await http('PATCH', `/admin/sessions/${s.id}`, admin, {})).body.code, 'invalid_field');
    assert.equal((await http('PATCH', `/admin/classes/${k.id}`, admin, {})).body.code, 'invalid_field');
    assert.equal((await http('PATCH', `/admin/sessions/nope`, admin, { capacity: 9 })).status, 400);
    const k2 = await mkClass({ weeks: 1 }); // la sesión de k ya tiene el aforo ajustado
    for (let i = 0; i < 2; i++) await bk(k2.s[0].id, await student());
    const rf = await http('PATCH', `/admin/classes/${k2.id}`, admin, { capacity: 1 });
    assert.deepEqual([rf.status, rf.body.code, rf.body.sessions.length, 'fits_from' in rf.body],
      [409, 'capacity_below_bookings', 1, true]);
    assert.equal((await http('PATCH', `/admin/classes/${k.id}`, admin, { weekday: 2 })).body.code, 'not_supported');
    } finally {
      console.error = realError;
    }
  });
} finally {
  console.error = realError;
  server.close();
  const sessions = (await q(`SELECT id FROM class_sessions WHERE class_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])`,
    [classes, loose])).map((r) => r.id);
  await q(`UPDATE notice_deliveries SET next_attempt_at = next_attempt_at - interval '100 years' WHERE id = ANY($1::uuid[])`, [parked]);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]); // CASCADE a notice_deliveries
  await q(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [classes]);
  await q(`DELETE FROM subscriptions WHERE student_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM plans WHERE id = $1`, [plan.id]);
  await q(`DELETE FROM disciplines WHERE id = $1`, [disc.id]);
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
