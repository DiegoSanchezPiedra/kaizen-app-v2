// B8: asistencia, correcciones, ficha de salud del profesor y su auditoría (CONTEXT § Asistencia).
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import {
  getAttendance, markAttendance, closeAttendance, correctAttendance, getSessionHealth,
} from '../src/services/attendance.js';

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

const people = {
  admin: 'admin', prof1: 'profesor', prof2: 'profesor',
  alu1: 'alumno', alu2: 'alumno', alu3: 'alumno', alu4: 'alumno', tutor: 'tutor', child: 'alumno',
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, role] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `${k}-att`, k === 'child' ? '2016-05-05' : null]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.child]);
await servicePool.query(
  `INSERT INTO student_health_info (profile_id, injuries, allergies, previous_experience, emergency_contact_phone)
   VALUES ($1, 'rodilla', 'polen', '5 años de judo', '600000000')`, [U.alu1]);
const disc = (await servicePool.query(
  `INSERT INTO disciplines (name) VALUES ('T-Att') RETURNING id`)).rows[0].id;

// Sesión a `offset` de ahora, 60 min. «today» empieza hace 5 min: falla si se ejecuta entre 00:00 y 00:05 de Madrid.
async function session(trainer, offset, status = 'scheduled') {
  const { rows: [s] } = await servicePool.query(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status, cancelled_at)
     VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '60 min', 60, 10, $4::session_status,
             CASE WHEN $4::session_status = 'cancelled' THEN now() END) RETURNING id`,
    [disc, U[trainer], offset, status]);
  return s.id;
}
const S = {
  today: await session('prof1', '-5 min'),
  yesterday: await session('prof1', '-1 day'),
  tomorrow: await session('prof1', '1 day'),
  cancelled: await session('prof1', '-10 min', 'cancelled'),
  retro: await session('prof2', '-3 hours'),
  closed: await session('prof1', '-50 hours'),
};
// Reservas directas: book_session no reserva sesiones empezadas.
async function booking(s, k, status = 'confirmed') {
  await servicePool.query(
    `INSERT INTO bookings (session_id, student_id, booked_by, status, cancel_reason, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [S[s], U[k], U.admin, status, status === 'cancelled' ? 'student' : null, status === 'cancelled' ? new Date() : null]);
}
for (const k of ['alu1', 'alu2', 'child']) await booking('today', k);
await booking('today', 'alu3', 'waitlisted');
await booking('today', 'alu4', 'cancelled');
for (const s of ['yesterday', 'tomorrow', 'cancelled', 'retro']) await booking(s, 'alu1');
// Lista cerrada hace 49 h, fuera del plazo de corrección del profesor (app_user ya no hace UPDATE de class_sessions).
await booking('closed', 'child');
await servicePool.query(
  `INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
   SELECT session_id, student_id, id, 'absent', 'manual', $2 FROM bookings WHERE session_id = $1`, [S.closed, U.prof1]);
await servicePool.query(
  `UPDATE class_sessions SET attendance_closed_at = now() - interval '49 hours', attendance_closed_by = $2 WHERE id = $1`,
  [S.closed, U.prof1]);

const audits = async (c, action, sessionId) => {
  await as(c, U.admin, 'admin');
  return (await c.query(`SELECT actor_id, changes FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at`,
    [action, sessionId])).rows;
};
const statusOf = async (c, s) => {
  await as(c, U.admin, 'admin');
  const { rows } = await c.query(`SELECT student_id, status FROM attendance WHERE session_id = $1`, [S[s]]);
  return Object.fromEntries(rows.map((r) => [r.student_id, r.status]));
};
const mark = (c, s, k, present) => markAttendance(c, { sessionId: S[s], studentId: U[k], present });
const correct = (c, s, k, status, reason) => correctAttendance(c, { sessionId: S[s], studentId: U[k], status, reason });

try {
  await withRls({ uid: U.admin, role: 'admin' }, async (c) => {
    await run('salud: el profesor ve solo reservas activas de su sesión de hoy, sin experiencia previa, y se audita', async () => {
      await as(c, U.prof1, 'profesor');
      const rows = await getSessionHealth(c, S.today);
      assert.deepEqual(rows.map((r) => r.student_id).sort(), [U.alu1, U.alu2, U.child].sort());
      assert.deepEqual(Object.keys(rows[0]).sort(), ['allergies', 'conditions', 'display_name', 'emergency_contact_name',
        'emergency_contact_phone', 'injuries', 'medication', 'student_id']);
      const a1 = rows.find((r) => r.student_id === U.alu1);
      assert.deepEqual([a1.injuries, a1.allergies, a1.emergency_contact_phone], ['rodilla', 'polen', '600000000']);
      const log = await audits(c, 'health.view', S.today);
      assert.equal(log.length, 1);
      assert.equal(log[0].actor_id, U.prof1);
      assert.deepEqual(log[0].changes.student_ids.sort(), [U.alu1, U.alu2, U.child].sort());
    });
    await run('salud: otro profesor, otro día, sesión cancelada, alumno, tutor y admin → 404', async () => {
      await as(c, U.prof2, 'profesor');
      await rejects(c, () => getSessionHealth(c, S.today), 404, 'session_not_found');
      await as(c, U.prof1, 'profesor');
      for (const s of ['yesterday', 'tomorrow', 'cancelled']) await rejects(c, () => getSessionHealth(c, S[s]), 404, 'session_not_found');
      await rejects(c, () => getSessionHealth(c, crypto.randomUUID()), 404, 'session_not_found');
      for (const [k, role] of [['alu1', 'alumno'], ['tutor', 'tutor'], ['admin', 'admin']]) {
        await as(c, U[k], role);
        await rejects(c, () => getSessionHealth(c, S.today), 404, 'session_not_found');
      }
    });
    await run('salud: el profesor no lee la tabla base ni las funciones internas', async () => {
      await as(c, U.prof1, 'profesor');
      assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id = $1`, [U.alu1])).rowCount, 0);
      await sp(c, () => assert.rejects(c.query(`SELECT attendance_session($1)`, [S.today]), /permission denied/));
    });
    await run('pasar lista: antes del inicio, sin reserva, otro profesor o sesión cancelada → rechazado', async () => {
      await as(c, U.prof1, 'profesor');
      await rejects(c, () => mark(c, 'tomorrow', 'alu1', true), 409, 'session_not_started');
      await rejects(c, () => mark(c, 'today', 'alu3', true), 404, 'no_active_booking'); // en espera
      await rejects(c, () => mark(c, 'today', 'alu4', true), 404, 'no_active_booking'); // cancelada
      await rejects(c, () => mark(c, 'cancelled', 'alu1', true), 409, 'session_cancelled');
      await as(c, U.prof2, 'profesor');
      await rejects(c, () => mark(c, 'today', 'alu1', true), 404, 'session_not_found');
      await as(c, U.alu1, 'alumno');
      await rejects(c, () => mark(c, 'today', 'alu1', true), 404, 'session_not_found');
    });
    await run('pasar lista: marcar y desmarcar es libre y no deja rastro', async () => {
      await as(c, U.prof1, 'profesor');
      await mark(c, 'today', 'alu1', true);
      await mark(c, 'today', 'alu1', true); // idempotente
      await mark(c, 'today', 'alu2', true);
      await mark(c, 'today', 'alu2', false);
      assert.deepEqual(await statusOf(c, 'today'), { [U.alu1]: 'present' });
      assert.equal((await c.query(`SELECT 1 FROM audit_log WHERE resource_id = $1 AND action LIKE 'attendance.%'`,
        [S.today])).rowCount, 0);
    });
    await run('corregir antes del cierre → attendance_not_closed', async () => {
      await as(c, U.prof1, 'profesor');
      await rejects(c, () => correct(c, 'today', 'alu1', 'absent', 'x'), 409, 'attendance_not_closed');
    });
    await run('cerrar: los no marcados pasan a falta; tras el cierre no se marca ni se recierra; se audita', async () => {
      await as(c, U.prof1, 'profesor');
      assert.deepEqual(await closeAttendance(c, S.today), { present: 1, absent: 2 });
      assert.deepEqual(await statusOf(c, 'today'), { [U.alu1]: 'present', [U.alu2]: 'absent', [U.child]: 'absent' });
      await as(c, U.prof1, 'profesor');
      await rejects(c, () => closeAttendance(c, S.today), 409, 'attendance_closed');
      await rejects(c, () => mark(c, 'today', 'alu2', true), 409, 'attendance_closed');
      const log = await audits(c, 'attendance.close', S.today);
      assert.deepEqual(log.map((l) => [l.actor_id, l.changes]), [[U.prof1, { present: 1, absent: 2 }]]);
    });
    await run('lista: el profesor ve la suya; otro profesor no', async () => {
      await as(c, U.prof1, 'profesor');
      const l = await getAttendance(c, S.today);
      assert.ok(l.closed_at);
      assert.equal(l.students.length, 3);
      await as(c, U.prof2, 'profesor');
      await rejects(c, () => getAttendance(c, S.today), 404, 'session_not_found');
    });
    await run('corrección: exige motivo y cambio; queda fechada, firmada y auditada', async () => {
      await as(c, U.prof1, 'profesor');
      await rejects(c, () => correct(c, 'today', 'alu2', 'present', '  '), 400, 'reason_required');
      await rejects(c, () => correct(c, 'today', 'alu2', 'absent', 'x'), 409, 'no_change');
      await rejects(c, () => correct(c, 'today', 'alu3', 'present', 'x'), 404, 'no_active_booking');
      const a = await correct(c, 'today', 'alu2', 'present', ' llegó tarde ');
      assert.deepEqual([a.status, a.corrected_by, a.correction_reason], ['present', U.prof1, 'llegó tarde']);
      assert.ok(a.corrected_at);
      const log = await audits(c, 'attendance.correct', S.today);
      assert.deepEqual(log[0].changes, { student_id: U.alu2, from: 'absent', to: 'present', reason: 'llegó tarde' });
    });
    await run('plazo de corrección: el profesor fuera de plazo no corrige; el admin siempre', async () => {
      await as(c, U.prof1, 'profesor');
      await rejects(c, () => correct(c, 'closed', 'child', 'present', 'x'), 403, 'correction_window_expired');
      await as(c, U.admin, 'admin');
      assert.equal((await correct(c, 'closed', 'child', 'present', 'aviso del tutor')).corrected_by, U.admin);
      await as(c, U.admin, 'admin');
      await c.query(`UPDATE academy_settings SET value = '72' WHERE key = 'attendance_correction_hours'`);
      await as(c, U.prof1, 'profesor');
      assert.equal((await correct(c, 'closed', 'child', 'absent', 'error del tutor')).status, 'absent');
    });
    await run('RLS: alumno ve solo lo suyo, tutor lo del hijo; nadie escribe directo', async () => {
      await as(c, U.alu1, 'alumno');
      assert.deepEqual((await c.query(`SELECT DISTINCT student_id FROM attendance`)).rows.map((r) => r.student_id), [U.alu1]);
      await as(c, U.tutor, 'tutor');
      assert.deepEqual((await c.query(`SELECT DISTINCT student_id FROM attendance`)).rows.map((r) => r.student_id), [U.child]);
      await as(c, U.prof2, 'profesor');
      assert.equal((await c.query(`SELECT 1 FROM attendance WHERE session_id = $1`, [S.today])).rowCount, 0);
      await as(c, U.prof1, 'profesor');
      await sp(c, () => assert.rejects(c.query(`UPDATE attendance SET status = 'present'`), /permission denied/));
      await sp(c, () => assert.rejects(c.query(`DELETE FROM attendance`), /permission denied/));
    });
    await run('cancelación retroactiva: anula la lista y las asistencias', async () => {
      await as(c, U.prof2, 'profesor');
      await mark(c, 'retro', 'alu1', true);
      await closeAttendance(c, S.retro);
      await as(c, U.admin, 'admin');
      await c.query(`SELECT cancel_session($1, 'no se dio')`, [S.retro]);
      assert.deepEqual(await statusOf(c, 'retro'), {});
      const { rows: [s] } = await c.query(`SELECT attendance_closed_at FROM class_sessions WHERE id = $1`, [S.retro]);
      assert.equal(s.attendance_closed_at, null);
    });
  }, { commit: false });
} finally {
  const sessions = Object.values(S);
  await servicePool.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
