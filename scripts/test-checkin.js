// B9: tablets, QR rotativo y check-in (CONTEXT § Asistencia).
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { getAttendance } from '../src/services/attendance.js';
import {
  qrStep, qrCode, verifyQr, createTablet, revokeTablet, updateCheckinSettings, checkIn,
} from '../src/services/checkin.js';

const sp = async (c, fn) => { // savepoint: un error SQL no aborta el resto de la transacción
  await c.query('SAVEPOINT t');
  try { await fn(); } finally { await c.query('ROLLBACK TO t'); }
};
const rejects = (c, fn, status, code) =>
  sp(c, () => assert.rejects(fn(), (e) => e.status === status && e.code === code));
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const people = { admin: 'admin', prof: 'profesor', alu1: 'alumno', alu2: 'alumno', alu3: 'alumno', tutor: 'tutor', child: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-chk`, k === 'child' ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.child]);
const disc = (await servicePool.query(`INSERT INTO disciplines (name) VALUES ('T-Chk') RETURNING id`)).rows[0].id;

// Sesión que empieza a `offset` de ahora. Ventana por defecto: −30 / +10 min. Dura 1 min: el profesor no
// puede tener sesiones solapadas.
async function session(offset, closed = false) {
  const { rows: [s] } = await servicePool.query(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status,
                                 attendance_closed_at)
     VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '1 min', 1, 10, 'scheduled', $4) RETURNING id`,
    [disc, U.prof, offset, closed ? new Date() : null]);
  return s.id;
}
const S = {
  in29: await session('29 min'), in31: await session('31 min'), ago5: await session('-5 min'),
  ago11: await session('-11 min'), closed: await session('-2 min', true), now: await session('3 min'),
};
const B = {};
async function booking(s, k) {
  const { rows: [b] } = await servicePool.query(
    `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
    [S[s], U[k], U.admin]);
  B[`${s}:${k}`] = b.id;
}
for (const s of ['in29', 'in31', 'ago11']) await booking(s, 'alu1');
for (const s of ['ago5', 'in29']) await booking(s, 'child');
await booking('in29', 'tutor'); // el tutor también entrena
await booking('ago5', 'alu2'); // reserva de alguien que no es hijo del tutor
await booking('closed', 'alu3');
await booking('now', 'alu3');
await booking('now', 'alu2'); // para la carrera con la anulación
// alu2 tenía check-in en ago11 con una reserva que luego anuló y rehízo: el presente cuelga de la anulada.
const { rows: [old] } = await servicePool.query(
  `INSERT INTO bookings (session_id, student_id, booked_by, status, cancel_reason, cancelled_at)
   VALUES ($1, $2, $2, 'cancelled', 'student', now()) RETURNING id`, [S.ago11, U.alu2]);
await servicePool.query(`INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
  VALUES ($1, $2, $3, 'present', 'qr', $2)`, [S.ago11, U.alu2, old.id]);
await booking('ago11', 'alu2');

const code = () => qrCode(qrStep(30)); // checkin_qr_seconds por defecto
const attendanceOf = async (c, bookingId) => {
  await as(c, U.admin, 'admin');
  return (await c.query(`SELECT status, method, recorded_by FROM attendance WHERE booking_id = $1`, [bookingId])).rows[0];
};

try {
  await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
    await run('QR: vale el actual y el anterior, no el de hace dos periodos ni basura', async () => {
      const now = Date.now();
      const step = qrStep(30, now);
      assert.ok(verifyQr(qrCode(step), 30, now));
      assert.ok(verifyQr(qrCode(step - 1), 30, now));
      assert.ok(!verifyQr(qrCode(step - 2), 30, now));
      assert.ok(!verifyQr(qrCode(step + 1), 30, now));
      for (const bad of [undefined, '', 'x', 'a'.repeat(16)]) assert.ok(!verifyQr(bad, 30, now));
    });

    await run('tablet: código de un solo uso, feed sin nombres, revocación corta el acceso', async () => {
      await as(c, U.admin, 'admin');
      const t = await createTablet(c, { name: 'Recepción', actorId: U.admin });
      assert.match(t.link_code, /^[A-HJ-NP-Z2-9]{8}$/);
      const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
      await c.query(`SELECT link_tablet($1, $2)`, [h(t.link_code), h('tok')]);
      await sp(c, () => assert.rejects(c.query(`SELECT link_tablet($1, $2)`, [h(t.link_code), h('tok2')]), /invalid_link_code/));
      const { rows } = await c.query(`SELECT * FROM tablet_feed($1)`, [h('tok')]);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['discipline', 'ends_at', 'session_id', 'starts_at']);
      const shown = rows.map((r) => r.session_id);
      for (const s of ['in29', 'ago5']) assert.ok(shown.includes(S[s]), s);
      for (const s of ['in31', 'ago11', 'closed']) assert.ok(!shown.includes(S[s]), s);
      await sp(c, () => assert.rejects(c.query(`SELECT 1 FROM device_tokens WHERE token_hash IS NOT NULL`), /permission denied/));
      await revokeTablet(c, t.id, U.admin);
      await sp(c, () => assert.rejects(c.query(`SELECT * FROM tablet_feed($1)`, [h('tok')]), /device_not_found/));
      const { rows: au } = await c.query(
        `SELECT action, actor_id FROM audit_log WHERE resource_type = 'tablet' AND resource_id = $1 ORDER BY action`, [t.id]);
      assert.deepEqual(au.map((a) => a.action), ['tablet.link', 'tablet.revoke']);
      assert.ok(au.every((a) => a.actor_id === U.admin));
    });

    await run('tablet: sin admin creador (borrado) vincula igual, sin auditoría', async () => {
      await as(c, U.admin, 'admin');
      const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
      const t = await createTablet(c, { name: 'Huérfana', actorId: null }); // como si se hubiera borrado al admin (SET NULL)
      await c.query(`SELECT link_tablet($1, $2)`, [h(t.link_code), h('tok-huerfana')]);
      const { rows } = await c.query(`SELECT 1 FROM audit_log WHERE resource_type = 'tablet' AND resource_id = $1`, [t.id]);
      assert.equal(rows.length, 0);
    });

    await run('tablet: código caducado o de tablet revocada no vincula; solo el admin crea tablets', async () => {
      await as(c, U.admin, 'admin');
      const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
      const t1 = await createTablet(c, { name: 'A', actorId: U.admin });
      await c.query(`UPDATE device_tokens SET link_expires_at = now() - interval '1 s' WHERE id = $1`, [t1.id]);
      await sp(c, () => assert.rejects(c.query(`SELECT link_tablet($1, 'x')`, [h(t1.link_code)]), /invalid_link_code/));
      const t2 = await createTablet(c, { name: 'B', actorId: U.admin });
      await revokeTablet(c, t2.id, U.admin);
      await sp(c, () => assert.rejects(c.query(`SELECT link_tablet($1, 'x')`, [h(t2.link_code)]), /invalid_link_code/));
      await as(c, U.alu1, 'alumno');
      await sp(c, () => assert.rejects(createTablet(c, { name: 'C', actorId: U.alu1 }), /row-level security/));
    });

    await run('check-in: QR inválido → 400; sin candidatas o reserva ajena → 404', async () => {
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => checkIn(c, { code: 'x'.repeat(16) }), 400, 'invalid_qr');
      await as(c, U.prof, 'alumno'); // sin reservas
      await rejects(c, () => checkIn(c, { code: code() }), 404, 'no_candidates');
      await as(c, U.alu2, 'alumno');
      await rejects(c, () => checkIn(c, { code: code(), bookingIds: [B['in29:alu1']] }), 404, 'no_candidates');
      await as(c, U.alu3, 'alumno'); // esa sesión tiene la lista cerrada
      await rejects(c, () => checkIn(c, { code: code(), bookingIds: [B['closed:alu3']] }), 404, 'no_candidates');
    });

    await run('check-in: una candidata se marca (solo la de la ventana); reintento → ya registrado con su hora', async () => {
      await as(c, U.alu1, 'alumno');
      const r = await checkIn(c, { code: code() });
      assert.equal(r.status, 'done');
      assert.deepEqual(r.results.map((x) => [x.booking_id, x.already]), [[B['in29:alu1'], false]]);
      assert.ok(r.results[0].checked_in_at);
      assert.deepEqual(await attendanceOf(c, B['in29:alu1']), { status: 'present', method: 'qr', recorded_by: U.alu1 });
      for (const s of ['in31', 'ago11']) assert.equal(await attendanceOf(c, B[`${s}:alu1`]), undefined);
      await as(c, U.alu1, 'alumno');
      const again = await checkIn(c, { code: code() });
      assert.equal(again.status, 'done');
      assert.deepEqual(again.results.map((x) => [x.booking_id, x.already, x.checked_in_at]),
        [[B['in29:alu1'], true, r.results[0].checked_in_at]]);
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [B['in29:alu1']]);
      assert.equal(rows[0].n, 1);
    });

    await run('tutor: varias candidatas (él y su hijo) → elegir; marca a ambos de una vez, recorded_by = tutor', async () => {
      await as(c, U.tutor, 'tutor');
      const r = await checkIn(c, { code: code() });
      assert.equal(r.status, 'choose');
      assert.deepEqual(r.candidates.map((x) => x.booking_id).sort(),
        [B['ago5:child'], B['in29:child'], B['in29:tutor']].sort());
      assert.ok(r.candidates.every((x) => x.checked_in_at === null));
      const ok = await checkIn(c, { code: code(), bookingIds: [B['ago5:child'], B['in29:tutor']] });
      assert.equal(ok.status, 'done');
      assert.deepEqual(ok.results.map((x) => [x.booking_id, x.already]).sort(),
        [[B['ago5:child'], false], [B['in29:tutor'], false]].sort());
      assert.deepEqual(await attendanceOf(c, B['ago5:child']), { status: 'present', method: 'qr', recorded_by: U.tutor });
      assert.deepEqual(await attendanceOf(c, B['in29:tutor']), { status: 'present', method: 'qr', recorded_by: U.tutor });
    });

    await run('tutor: al re-escanear no se marca solo a nadie; repetir la elección → ya registrado', async () => {
      await as(c, U.tutor, 'tutor');
      const r = await checkIn(c, { code: code() }); // queda in29:child pendiente: se pregunta, no se marca
      assert.equal(r.status, 'choose');
      assert.equal(await attendanceOf(c, B['in29:child']), undefined);
      await as(c, U.tutor, 'tutor');
      const done = Object.fromEntries(r.candidates.map((x) => [x.booking_id, !!x.checked_in_at]));
      assert.deepEqual(done, { [B['ago5:child']]: true, [B['in29:tutor']]: true, [B['in29:child']]: false });
      const again = await checkIn(c, { code: code(), bookingIds: [B['ago5:child'], B['ago5:child']] });
      assert.deepEqual(again.results.map((x) => [x.booking_id, x.already]), [[B['ago5:child'], true]]);
    });

    await run('tutor: reserva de alguien que no es su hijo → 404 y no se marca nada', async () => {
      await as(c, U.tutor, 'tutor');
      await rejects(c, () => checkIn(c, { code: code(), bookingIds: [B['ago5:alu2']] }), 404, 'no_candidates');
      await rejects(c, () => checkIn(c, { code: code(), bookingIds: [B['in29:child'], B['ago5:alu2']] }), 404, 'no_candidates');
      assert.equal(await attendanceOf(c, B['in29:child']), undefined);
      assert.equal(await attendanceOf(c, B['ago5:alu2']), undefined);
    });

    await run('reserva anulada y rehecha: el presente previo cuenta (ya registrado, no pendiente)', async () => {
      await as(c, U.admin, 'admin');
      await updateCheckinSettings(c, { closes_minutes: 12 }); // ago11 entra en la ventana
      await as(c, U.alu2, 'alumno');
      const r = await checkIn(c, { code: code() }); // ago5 pendiente + ago11 ya registrado → elegir
      assert.equal(r.status, 'choose');
      assert.ok(r.candidates.find((x) => x.booking_id === B['ago11:alu2']).checked_in_at);
      await as(c, U.alu2, 'alumno');
      const again = await checkIn(c, { code: code(), bookingIds: [B['ago11:alu2']] });
      assert.deepEqual(again.results.map((x) => x.already), [true]);
      await as(c, U.admin, 'admin');
      await updateCheckinSettings(c, { closes_minutes: 10 });
    });

    await run('profesor ve el método en su lista', async () => {
      await as(c, U.prof, 'profesor');
      const { students } = await getAttendance(c, S.ago5);
      assert.equal(students.find((s) => s.student_id === U.child).method, 'qr');
    });

    await run('ventana ajustable por el admin; valores inválidos → 400', async () => {
      await as(c, U.admin, 'admin');
      const r = await updateCheckinSettings(c, { opens_minutes: 32 });
      assert.equal(r.opens_minutes, 32);
      await rejects(c, () => updateCheckinSettings(c, { closes_minutes: 0 }), 400, 'invalid_field');
      await as(c, U.alu1, 'alumno'); // in31 entra en la ventana
      const r2 = await checkIn(c, { code: code() }); // in29 ya registrado + in31 nuevo → elegir
      assert.equal(r2.status, 'choose');
      const ok = await checkIn(c, { code: code(), bookingIds: [B['in31:alu1']] });
      assert.deepEqual(ok.results.map((x) => [x.booking_id, x.already]), [[B['in31:alu1'], false]]);
    });
  }, { commit: false });

  await run('doble envío concurrente: una sola fila; uno marca y el otro responde ya registrado', async () => {
    const twice = await Promise.all([1, 2].map(() =>
      withRls({ uid: U.alu3, role: 'alumno' }, (c) => checkIn(c, { code: code(), bookingIds: [B['now:alu3']] }))));
    assert.deepEqual(twice.map((r) => r.results[0].already).sort(), [false, true]);
    assert.equal(twice[0].results[0].checked_in_at, twice[1].results[0].checked_in_at);
    const { rows } = await servicePool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [B['now:alu3']]);
    assert.equal(rows[0].n, 1);
  });

  await run('anulación concurrente: espera al bloqueo de la sesión y, tras ella, no marca la reserva anulada', async () => {
    const other = await servicePool.connect();
    try {
      await other.query('BEGIN'); // como cancel_booking: sesión bloqueada y luego la reserva anulada
      await other.query(`SELECT 1 FROM class_sessions WHERE id = $1 FOR UPDATE`, [S.now]);
      await other.query(`UPDATE bookings SET status = 'cancelled', cancel_reason = 'student', cancelled_at = now() WHERE id = $1`,
        [B['now:alu2']]);
      const pending = withRls({ uid: U.alu2, role: 'alumno' }, (c) => checkIn(c, { code: code(), bookingIds: [B['now:alu2']] }))
        .then(() => 'ok', (e) => e.code);
      await new Promise((r) => setTimeout(r, 300)); // que el check-in llegue a esperar el bloqueo
      await other.query('COMMIT');
      assert.equal(await pending, 'no_candidates');
      const { rows } = await servicePool.query(`SELECT 1 FROM attendance WHERE booking_id = $1`, [B['now:alu2']]);
      assert.equal(rows.length, 0);
    } finally {
      other.release();
    }
  });

  await run('POST /checkin: booking_id (API anterior) → 400, booking_ids mal formado → 400', async () => {
    const { startApp } = await import('./lib/app-server.js');
    const { signToken } = await import('../src/services/jwt.js');
    const app = await startApp();
    try {
      const token = signToken({ sub: U.alu1, role: 'alumno' });
      for (const body of [{ code: code(), booking_id: B['in29:alu1'] }, { code: code(), booking_ids: [] },
        { code: code(), booking_ids: ['x'] }, { code: code(), booking_ids: B['in29:alu1'] }]) {
        const r = await app.http('POST', '/checkin', { token, body });
        assert.deepEqual([r.status, r.body?.error?.code ?? r.body?.code], [400, 'invalid_field'], JSON.stringify(body));
      }
    } finally {
      await app.close();
    }
  });
} finally {
  const sessions = Object.values(S);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
