import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { bookSession, cancelBooking, listBookings } from '../src/services/bookings.js';
import { createClass, retireClass } from '../src/services/classes.js';
import { requireCompleteProfile } from '../src/middleware/requireCompleteProfile.js';

const sp = async (c, fn) => { // savepoint: un error SQL no aborta el resto de la transacción
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO t'); }
};
// Un RAISE de las funciones aborta la transacción: cada rechazo esperado va en su savepoint.
const rejects = (c, fn, status, code) =>
  sp(c, () => assert.rejects(fn(), (e) => e.status === status && e.code === code));
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const people = {
  admin: 'admin', prof1: 'profesor', prof2: 'profesor', prof3: 'profesor',
  alu1: 'alumno', alu2: 'alumno', alu3: 'alumno', alu4: 'alumno',
  tutor1: 'tutor', tutor2: 'tutor', tutorX: 'tutor', child: 'alumno',
  kid5: 'alumno', kid13: 'alumno', // B29: cumplen 5 y 13 dentro de 3 días (de Madrid)
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-bk`, k === 'child' ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1,$3),($2,$3),($1,$4),($1,$5)`,
  [U.tutor1, U.tutor2, U.child, U.kid5, U.kid13]);
const TZ = 'Europe/Madrid';
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE', { timeZone: TZ });
for (const [k, years] of [['kid5', 5], ['kid13', 13]]) {
  await servicePool.query(`UPDATE profiles SET birth_date = ($2::date - $3 * interval '1 year')::date WHERE id = $1`,
    [U[k], day(3), years]);
}

// Acuerdos vigentes: los existentes o unos de prueba (se borran al final).
const testDocs = [];
for (const type of ['data_protection', 'rights_of_image']) {
  const { rowCount } = await servicePool.query(
    `SELECT 1 FROM agreement_documents WHERE type = $1 AND published_at IS NOT NULL AND retired_at IS NULL`, [type]);
  if (rowCount) continue;
  testDocs.push((await servicePool.query(
    `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
     VALUES (gen_random_uuid(), $1, '99.' || floor(random() * 1e6), 'test-bookings.pdf', 'x', now()) RETURNING id`,
    [type])).rows[0].id);
}
const sign = (student, type, by = student) => servicePool.query(
  `INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
   SELECT gen_random_uuid(), $1, $2, $3, version FROM agreement_documents
    WHERE type = $3 AND published_at IS NOT NULL AND retired_at IS NULL`, [U[student], U[by], type]);
// Perfil completo solo para alu1–3 y kid5 (los de la promoción).
for (const k of ['alu1', 'alu2', 'alu3', 'kid5']) { // kid5: firma su tutor (lo promociona la espera de R)
  for (const type of ['data_protection', 'rights_of_image']) await sign(k, type, k === 'kid5' ? 'tutor1' : k);
  await servicePool.query(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
                           VALUES ($1, 'x', '600000000')`, [U[k]]);
}

const disc = {};
// K: la que era solo menores (máxima 17); R: kids 5–12 (B29).
for (const [k, min, max] of [['A', null, null], ['B', null, null], ['K', null, 17], ['R', 5, 12]]) {
  disc[k] = (await servicePool.query(`INSERT INTO disciplines (name, min_age, max_age) VALUES ($1, $2, $3) RETURNING id`,
    [`T-Book-${k}`, min, max])).rows[0].id;
}
const planAll = (await servicePool.query(
  `INSERT INTO plans (name, price_cents) VALUES ('T-Book-all', 1000) RETURNING id`)).rows[0].id;
const planOne = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ('T-Book-one', 500, 1) RETURNING id`)).rows[0].id;
const sub = {};
for (const k of ['alu1', 'alu2', 'alu3', 'child', 'alu4', 'kid5', 'kid13']) {
  sub[k] = crypto.randomUUID();
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`,
    [sub[k], U[k], ['child', 'kid5', 'kid13'].includes(k) ? U.tutor1 : U[k], k === 'alu4' ? planOne : planAll, `sub_test_${sub[k]}`]);
}
await servicePool.query(`INSERT INTO subscription_disciplines VALUES ($1, $2)`, [sub.alu4, disc.B]);

// Sesión a `offset` de ahora (intervalo SQL), 60 min.
async function session(key, trainer, offset, { capacity = 5, d = disc.A, status = 'scheduled' } = {}) {
  const { rows: [s] } = await servicePool.query(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status, cancelled_at)
     VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '60 min', 60, $4, $5::session_status,
             CASE WHEN $5::session_status = 'cancelled' THEN now() END) RETURNING id`,
    [d, U[trainer], offset, capacity, status]);
  return s.id;
}
const S = {
  full: await session('full', 'prof1', '2 days', { capacity: 1 }),
  overlap: await session('overlap', 'prof2', '2 days 30 min'),
  far: await session('far', 'prof1', '20 days'),
  soon: await session('soon', 'prof2', '30 min', { capacity: 1 }),
  started: await session('started', 'prof1', '-10 min'),
  cancelled: await session('cancelled', 'prof1', '3 days', { status: 'cancelled' }),
  discB: await session('discB', 'prof1', '4 days', { d: disc.B }),
  kids: await session('kids', 'prof2', '4 days', { d: disc.K }),
  race: await session('race', 'prof1', '6 days', { capacity: 1 }),
  raceA: await session('raceA', 'prof1', '7 days'),
  raceB: await session('raceB', 'prof2', '7 days 15 min'),
};

// Sesiones de R a una hora de Madrid: la víspera del cumpleaños a las 23:30 y el día a las 00:30 y a las 10:00.
const at = (key, ts, capacity = 5) => servicePool.query(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
   VALUES ($1, $2, $3::timestamp AT TIME ZONE '${TZ}', $3::timestamp AT TIME ZONE '${TZ}' + interval '60 min', 60, $4,
           'scheduled') RETURNING id`, [disc.R, U.prof3, ts, capacity]).then((r) => { S[key] = r.rows[0].id; });
await at('rEve', `${day(2)} 23:30`);
await at('rDay', `${day(3)} 00:30`);
await at('rWait', `${day(3)} 10:00`, 1);
// kid13 entró en espera antes de que la sesión quedara fuera de su rango (p. ej., el admin bajó la máxima).
await servicePool.query(`INSERT INTO bookings (session_id, student_id, booked_by, status, created_at)
                         VALUES ($1, $2, $3, 'waitlisted', now() - interval '1 hour')`, [S.rWait, U.kid13, U.tutor1]);

const book = (c, session, student) => bookSession(c, { sessionId: S[session], studentId: U[student] });
// Lee con contexto admin (la RLS oculta al alumno las reservas ajenas) y restaura el contexto anterior.
const statusOf = async (c, id) => {
  const { rows: [r] } = await c.query(
    `SELECT current_setting('app.current_user_id') uid, current_setting('app.current_role') role`);
  await as(c, U.admin, 'admin');
  const { rows: [b] } = await c.query(`SELECT status, cancel_reason, promoted_at FROM bookings WHERE id=$1`, [id]);
  await as(c, r.uid, r.role);
  return b;
};

try {
  await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
    let b1, w2, w3, o2;
    await run('reserva con plaza → confirmed; llena → waitlisted por orden de llegada', async () => {
      await as(c, U.alu1, 'alumno');
      b1 = await book(c, 'full', 'alu1');
      assert.equal(b1.status, 'confirmed');
      assert.equal(b1.booked_by, U.alu1);
      await rejects(c, () => book(c, 'full', 'alu1'), 409, 'already_booked');
      await as(c, U.alu2, 'alumno');
      w2 = await book(c, 'full', 'alu2');
      await as(c, U.alu3, 'alumno');
      w3 = await book(c, 'full', 'alu3');
      assert.deepEqual([w2.status, w3.status], ['waitlisted', 'waitlisted']);
    });
    await run('solape: no se reservan dos sesiones solapadas; en espera sí', async () => {
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => book(c, 'overlap', 'alu1'), 409, 'booking_overlap');
      await as(c, U.alu2, 'alumno');
      o2 = await book(c, 'overlap', 'alu2'); // alu2 está en espera de `full`, que se solapa
      assert.equal(o2.status, 'confirmed');
    });
    await run('cancelar promociona: salta al que tiene solape, sube el siguiente y avisa', async () => {
      await as(c, U.alu1, 'alumno');
      const cb = await cancelBooking(c, b1.id);
      assert.deepEqual([cb.status, cb.cancel_reason], ['cancelled', 'student']);
      assert.equal((await statusOf(c, w2.id)).status, 'waitlisted');
      const p3 = await statusOf(c, w3.id);
      assert.equal(p3.status, 'confirmed');
      assert.ok(p3.promoted_at);
      await as(c, U.admin, 'admin');
      const { rows: [n] } = await c.query(
        `SELECT changes FROM audit_log WHERE action = 'notice.booking_promoted' AND resource_id = $1`, [w3.id]);
      assert.deepEqual(n.changes.recipients, [U.alu3]);
    });
    await run('promoción sin cobertura: sale de la lista con no_coverage', async () => {
      // Solo el webhook escribe suscripciones (012).
      await servicePool.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [sub.alu2]);
      await as(c, U.alu2, 'alumno');
      await cancelBooking(c, o2.id); // quita el solape para que no se le salte
      await as(c, U.alu3, 'alumno');
      await cancelBooking(c, w3.id);
      assert.deepEqual(await statusOf(c, w2.id).then((r) => [r.status, r.cancel_reason]), ['cancelled', 'no_coverage']);
      await servicePool.query(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [sub.alu2]);
    });
    await run('promoción salta (sigue en la lista) a quien no tiene el perfil completo; recuperado, por orden de llegada', async () => {
      // `full` (aforo 1) vacía: alu1 reserva, alu2 y alu3 (sin contacto de emergencia) esperan; alu1 cancela.
      const phone = (v) => servicePool.query(
        `UPDATE student_health_info SET emergency_contact_phone = $2 WHERE profile_id = ANY($1::uuid[])`, [[U.alu2, U.alu3], v]);
      await as(c, U.alu1, 'alumno');
      const r1 = await book(c, 'full', 'alu1');
      await as(c, U.alu2, 'alumno');
      const q2 = await book(c, 'full', 'alu2');
      await as(c, U.alu3, 'alumno');
      const q3 = await book(c, 'full', 'alu3');
      await phone(null);
      await as(c, U.alu1, 'alumno');
      await cancelBooking(c, r1.id);
      for (const q of [q2, q3]) assert.deepEqual(await statusOf(c, q.id).then((r) => [r.status, r.cancel_reason]), ['waitlisted', null]);
      // Recuperados, la siguiente plaza que se libere los promociona por orden de llegada.
      await phone('600000000');
      const r2 = await book(c, 'full', 'alu1');
      await cancelBooking(c, r2.id);
      // En una transacción created_at es el mismo (now()): el orden de llegada lo desempata el id, como en promote_waitlist.
      const [first, second] = [q2, q3].sort((x, y) => (x.id < y.id ? -1 : 1));
      assert.deepEqual([(await statusOf(c, first.id)).status, (await statusOf(c, second.id)).status], ['confirmed', 'waitlisted']);
      for (const [k, q] of [['alu3', q3], ['alu2', q2]]) {
        await as(c, U[k], 'alumno');
        await cancelBooking(c, q.id);
      }
    });
    await run('se puede volver a reservar tras cancelar', async () => {
      await as(c, U.alu1, 'alumno');
      assert.equal((await book(c, 'full', 'alu1')).status, 'confirmed');
      // Mis reservas: una fila por sesión y alumno (la activa), no también la cancelada de antes.
      const mine = (await listBookings(c, {})).filter((x) => x.session_id === S.full);
      assert.deepEqual(mine.map((x) => x.status), ['confirmed']);
    });
    await run('ventana: el alumno no reserva a 20 días; el admin sí', async () => {
      await rejects(c, () => book(c, 'far', 'alu1'), 409, 'outside_booking_window');
      await as(c, U.admin, 'admin');
      const b = await book(c, 'far', 'alu1');
      assert.equal(b.booked_by, U.admin);
      assert.equal((await cancelBooking(c, b.id)).cancel_reason, 'admin');
    });
    await run('sesión empezada, cancelada o inexistente', async () => {
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => book(c, 'started', 'alu1'), 409, 'session_not_bookable');
      await rejects(c, () => book(c, 'cancelled', 'alu1'), 409, 'session_not_bookable');
      await rejects(c, () => bookSession(c, { sessionId: crypto.randomUUID(), studentId: U.alu1 }), 404, 'session_not_found');
    });
    await run('fuera de plazo → late; el promocionado dentro del plazo cancela sin ser tardía', async () => {
      await as(c, U.alu1, 'alumno');
      const b = await book(c, 'soon', 'alu1');
      await as(c, U.alu3, 'alumno');
      const w = await book(c, 'soon', 'alu3');
      assert.equal(w.status, 'waitlisted');
      await as(c, U.alu1, 'alumno');
      assert.equal((await cancelBooking(c, b.id)).cancel_reason, 'late');
      await rejects(c, () => cancelBooking(c, b.id), 409, 'booking_not_active');
      await as(c, U.alu3, 'alumno');
      assert.equal((await statusOf(c, w.id)).status, 'confirmed');
      assert.equal((await cancelBooking(c, w.id)).cancel_reason, 'student');
    });
    await run('cobertura: plan de 1 disciplina y disciplinas solo menores', async () => {
      await as(c, U.alu4, 'alumno');
      await rejects(c, () => book(c, 'overlap', 'alu4'), 403, 'not_covered'); // disciplina A no elegida
      assert.equal((await book(c, 'discB', 'alu4')).status, 'confirmed');
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => book(c, 'kids', 'alu1'), 403, 'age_out_of_range'); // adulto, la que era solo menores
    });
    await run('tutor reserva por su hijo; otro tutor cancela; ajenos y profesor no', async () => {
      await as(c, U.tutor1, 'tutor');
      const b = await book(c, 'kids', 'child');
      assert.equal(b.booked_by, U.tutor1);
      assert.equal((await listBookings(c, {})).filter((x) => x.student_id === U.child).length, 1);
      await as(c, U.tutorX, 'tutor');
      await rejects(c, () => book(c, 'overlap', 'child'), 403, 'not_allowed');
      await rejects(c, () => cancelBooking(c, b.id), 404, 'booking_not_found');
      await as(c, U.prof2, 'profesor');
      await rejects(c, () => book(c, 'overlap', 'prof2'), 403, 'not_allowed');
      await rejects(c, () => cancelBooking(c, b.id), 404, 'booking_not_found');
      assert.equal((await c.query(`SELECT 1 FROM bookings WHERE id = $1`, [b.id])).rowCount, 1); // ve las de su sesión
      await as(c, U.tutor2, 'tutor');
      assert.equal((await cancelBooking(c, b.id)).cancel_reason, 'student');
    });
    await run('RLS: el alumno solo ve lo suyo y nadie escribe en bookings', async () => {
      await as(c, U.alu1, 'alumno');
      const { rows } = await c.query(`SELECT DISTINCT student_id FROM bookings`);
      assert.deepEqual(rows.map((r) => r.student_id), [U.alu1]);
      assert.ok((await listBookings(c, {})).every((x) => x.student_id === U.alu1));
      await sp(c, () => assert.rejects(c.query(
        `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1,$2,$2,'confirmed')`,
        [S.overlap, U.alu1]), /permission denied/));
      await sp(c, () => assert.rejects(c.query(`UPDATE bookings SET status = 'confirmed'`), /permission denied/));
      await sp(c, () => assert.rejects(c.query(`SELECT covers($1, $2)`, [U.alu1, disc.A]), /permission denied/));
    });
    await run('requireCompleteProfile: alumno incompleto (alu4) → 403; el admin por un hijo comprueba al hijo', async () => {
      await rejects(c, () => requireCompleteProfile({ body: {}, user: { id: U.alu4, role: 'alumno' } }, c), 403, 'profile_incomplete');
      await as(c, U.admin, 'admin');
      await rejects(c, () => requireCompleteProfile({ body: { profile_id: U.child }, user: { id: U.admin, role: 'admin' } }, c),
        403, 'profile_incomplete');
    });
    await run('B28: perfil completo y suscripción bastan para reservar, sin firmar nada más', async () => {
      const req = { body: {}, user: { id: U.alu1, role: 'alumno' } };
      await requireCompleteProfile(req, c);
      await as(c, U.alu1, 'alumno');
      const b = await book(c, 'discB', 'alu1');
      assert.equal(b.status, 'confirmed');
      await cancelBooking(c, b.id);
    });
    await run('B28: un hijo con perfil completo firmado por su tutor reserva sin firmar nada más', async () => {
      for (const type of ['data_protection', 'rights_of_image']) await sign('child', type, 'tutor1');
      await sign('tutor1', 'data_protection');
      await servicePool.query(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
                               VALUES ($1, 'x', '600000000')`, [U.child]);
      await as(c, U.tutor1, 'tutor');
      await requireCompleteProfile({ body: { profile_id: U.child }, user: { id: U.tutor1, role: 'tutor' } }, c);
      const b = await book(c, 'kids', 'child');
      assert.equal(b.status, 'confirmed');
      await cancelBooking(c, b.id);
    });
    await run('retirar una clase anula sus reservas con session_cancelled y avisa a los tutores', async () => {
      await as(c, U.admin, 'admin');
      const { rows: [{ dow }] } = await c.query(
        `SELECT extract(isodow FROM now() AT TIME ZONE 'Europe/Madrid' + interval '2 days')::int dow`);
      const cls = await createClass(c, { body: {
        discipline_id: String(disc.K), trainer_id: U.prof3, weekday: dow, start_time: '12:00', duration_min: 60, capacity: 5,
      }, actorId: U.admin });
      const { rows: [s] } = await c.query(
        `SELECT id FROM class_sessions WHERE class_id = $1 AND starts_at > now() ORDER BY starts_at LIMIT 1`, [cls.id]);
      await as(c, U.tutor1, 'tutor');
      const b = await bookSession(c, { sessionId: s.id, studentId: U.child });
      await as(c, U.admin, 'admin');
      await retireClass(c, { id: cls.id, actorId: U.admin });
      assert.equal((await statusOf(c, b.id)).cancel_reason, 'session_cancelled');
      const { rows: [n] } = await c.query(
        `SELECT changes FROM audit_log WHERE action = 'notice.session_cancelled' AND resource_id = $1`, [b.id]);
      assert.deepEqual(n.changes.recipients.sort(), [U.tutor1, U.tutor2].sort());
    });
    await run('rango de edad en hora de Madrid: 5–12 desde el día que cumple 5 hasta la víspera de cumplir 13', async () => {
      const out = (session, student) => sp(c, () => assert.rejects(book(c, session, student),
        (e) => e.status === 403 && e.code === 'age_out_of_range' && e.details.min_age === 5 && e.details.max_age === 12));
      await as(c, U.tutor1, 'tutor');
      await out('rEve', 'kid5'); // aún tiene 4: contrató, pero no reserva antes de su 5.º cumpleaños
      assert.equal((await book(c, 'rDay', 'kid5')).status, 'confirmed');
      assert.equal((await book(c, 'rEve', 'kid13')).status, 'confirmed');
      await out('rDay', 'kid13'); // el día que cumple 13
      await as(c, U.alu1, 'alumno');
      await out('rDay', 'alu1'); // adulto (sin fecha de nacimiento)
    });
    await run('espera: la promoción salta a quien estará fuera de rango el día de la sesión', async () => {
      await as(c, U.tutor1, 'tutor');
      const b = await book(c, 'rWait', 'child');
      assert.equal(b.status, 'confirmed');
      const w = await book(c, 'rWait', 'kid5'); // llena: en espera detrás de kid13
      assert.equal(w.status, 'waitlisted');
      await cancelBooking(c, b.id);
      assert.equal((await statusOf(c, w.id)).status, 'confirmed');
      const { rows: [k13] } = await servicePool.query(
        `SELECT status FROM bookings WHERE session_id = $1 AND student_id = $2`, [S.rWait, U.kid13]);
      assert.equal(k13.status, 'waitlisted'); // sigue en la lista
    });
    await run('in_age_range: años cumplidos el día de Madrid (cumpleaños, medianoche, cambios de hora, 29-F, sin fecha)', async () => {
      const fits = async (birth, min, max, ts) => (await c.query(
        `SELECT in_age_range($1::date, $2::smallint, $3::smallint, $4::timestamptz) AS r`, [birth, min, max, ts])).rows[0].r;
      // Cumple 13 el 29-03-2026 (adelanto de hora): a las 23:30 de la víspera tiene 12; a las 00:30 (aún 28 en UTC), 13.
      assert.equal(await fits('2013-03-29', 5, 12, '2026-03-28 23:30+01'), true);
      assert.equal(await fits('2013-03-29', 5, 12, '2026-03-28 23:30Z'), false);
      assert.equal(await fits('2013-03-29', 5, 12, '2026-03-29 01:30Z'), false);
      // Cumple 5 el 25-10-2026 (retraso de hora): a las 00:30 de Madrid (22:30 UTC del 24) ya tiene 5.
      assert.equal(await fits('2021-10-25', 5, 12, '2026-10-24 21:30Z'), false);
      assert.equal(await fits('2021-10-25', 5, 12, '2026-10-24 22:30Z'), true);
      // 29-F: cumple el 1-3 en año no bisiesto.
      assert.equal(await fits('2012-02-29', null, 12, '2025-02-28 12:00Z'), true);
      assert.equal(await fits('2012-02-29', null, 12, '2025-03-01 12:00Z'), false);
      // Sin fecha de nacimiento: adulto.
      assert.equal(await fits(null, 5, 12, '2026-01-01Z'), false);
      assert.equal(await fits(null, null, 17, '2026-01-01Z'), false);
      assert.equal(await fits(null, 16, null, '2026-01-01Z'), true);
      assert.equal(await fits(null, null, null, '2026-01-01Z'), true);
    });
  }, { commit: false });

  // Concurrencia real: conexiones distintas, transacciones que confirman.
  await run('concurrencia: dos alumnos por la última plaza → 1 confirmed, 1 waitlisted', async () => {
    const r = await Promise.all(['alu1', 'alu3'].map((k) =>
      withRls({ uid: U[k], role: 'alumno' }, (c) => book(c, 'race', k))));
    assert.deepEqual(r.map((b) => b.status).sort(), ['confirmed', 'waitlisted']);
  });
  await run('concurrencia: dos tutores reservan a la vez sesiones solapadas del hijo → solo una', async () => {
    const r = await Promise.allSettled([['tutor1', 'raceA'], ['tutor2', 'raceB']].map(([t, s]) =>
      withRls({ uid: U[t], role: 'tutor' }, (c) => book(c, s, 'child'))));
    assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(r.find((x) => x.status === 'rejected').reason.code, 'booking_overlap');
  });
  await run('deadlock (40P01) → 409 booking_conflict_retry, no 500', async () => {
    const deadlocked = { query: () => Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' })) };
    await assert.rejects(cancelBooking(deadlocked, crypto.randomUUID()),
      (e) => e.status === 409 && e.code === 'booking_conflict_retry');
    await assert.rejects(bookSession(deadlocked, { sessionId: S.race, studentId: U.alu1 }),
      (e) => e.status === 409 && e.code === 'booking_conflict_retry');
  });
} finally {
  const sessions = Object.values(S);
  await servicePool.query(
    `DELETE FROM audit_log WHERE resource_id IN (SELECT id::text FROM bookings WHERE session_id = ANY($1::uuid[]))`, [sessions]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[planAll, planOne]]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [Object.values(disc)]);
  await servicePool.query(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM student_health_info WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM agreement_documents WHERE id = ANY($1::uuid[])`, [testDocs]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
