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
  ago11: await session('-11 min'), closed: await session('-2 min', true),
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
await booking('closed', 'alu3');

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
      await revokeTablet(c, t.id);
      await sp(c, () => assert.rejects(c.query(`SELECT * FROM tablet_feed($1)`, [h('tok')]), /device_not_found/));
    });

    await run('tablet: código caducado o de tablet revocada no vincula; solo el admin crea tablets', async () => {
      await as(c, U.admin, 'admin');
      const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
      const t1 = await createTablet(c, { name: 'A', actorId: U.admin });
      await c.query(`UPDATE device_tokens SET link_expires_at = now() - interval '1 s' WHERE id = $1`, [t1.id]);
      await sp(c, () => assert.rejects(c.query(`SELECT link_tablet($1, 'x')`, [h(t1.link_code)]), /invalid_link_code/));
      const t2 = await createTablet(c, { name: 'B', actorId: U.admin });
      await revokeTablet(c, t2.id);
      await sp(c, () => assert.rejects(c.query(`SELECT link_tablet($1, 'x')`, [h(t2.link_code)]), /invalid_link_code/));
      await as(c, U.alu1, 'alumno');
      await sp(c, () => assert.rejects(createTablet(c, { name: 'C', actorId: U.alu1 }), /row-level security/));
    });

    await run('check-in: QR inválido → 400; sin candidatas o reserva ajena → 404', async () => {
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => checkIn(c, { code: 'x'.repeat(16) }), 400, 'invalid_qr');
      await as(c, U.alu2, 'alumno');
      await rejects(c, () => checkIn(c, { code: code() }), 404, 'no_candidates');
      await rejects(c, () => checkIn(c, { code: code(), bookingId: B['in29:alu1'] }), 404, 'no_candidates');
      await as(c, U.alu3, 'alumno'); // su sesión tiene la lista cerrada
      await rejects(c, () => checkIn(c, { code: code() }), 404, 'no_candidates');
    });

    await run('check-in: una candidata se marca (solo la de la ventana) y no se repite', async () => {
      await as(c, U.alu1, 'alumno');
      const r = await checkIn(c, { code: code() });
      assert.deepEqual([r.status, r.booking_id], ['checked_in', B['in29:alu1']]);
      assert.deepEqual(await attendanceOf(c, B['in29:alu1']), { status: 'present', method: 'qr', recorded_by: U.alu1 });
      for (const s of ['in31', 'ago11']) assert.equal(await attendanceOf(c, B[`${s}:alu1`]), undefined);
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => checkIn(c, { code: code() }), 404, 'no_candidates');
    });

    await run('check-in del tutor: varias candidatas del hijo → elegir; queda recorded_by = tutor', async () => {
      await as(c, U.tutor, 'tutor');
      const r = await checkIn(c, { code: code() });
      assert.equal(r.status, 'choose');
      assert.deepEqual(r.candidates.map((x) => x.booking_id).sort(), [B['ago5:child'], B['in29:child']].sort());
      const ok = await checkIn(c, { code: code(), bookingId: B['ago5:child'] });
      assert.equal(ok.status, 'checked_in');
      assert.deepEqual(await attendanceOf(c, B['ago5:child']), { status: 'present', method: 'qr', recorded_by: U.tutor });
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
      assert.equal((await checkIn(c, { code: code() })).booking_id, B['in31:alu1']);
    });
  }, { commit: false });
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
