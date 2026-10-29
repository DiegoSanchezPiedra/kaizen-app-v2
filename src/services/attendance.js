// src/services/attendance.js — asistencia y ficha de salud del profesor (CONTEXT § Asistencia). Las reglas
// viven en las funciones SQL de la migración 010; aquí solo se traducen sus errores y se lee con RLS.
import { httpError } from '../lib/errors.js';

const SQL_ERRORS = {
  session_not_found: [404, 'Sesión no encontrada'],
  session_cancelled: [409, 'La sesión está cancelada: no tiene lista'],
  session_not_started: [409, 'La sesión aún no ha empezado'],
  attendance_closed: [409, 'La lista ya está cerrada'],
  attendance_not_closed: [409, 'La lista aún no está cerrada'],
  no_active_booking: [404, 'El alumno no tiene reserva activa en esta sesión'],
  reason_required: [400, 'La corrección exige motivo'],
  no_change: [409, 'La asistencia ya tiene ese estado'],
  correction_window_expired: [403, 'El plazo de corrección ha terminado; pídelo a la academia'],
};

async function callFn(client, sql, params) {
  try {
    return (await client.query(sql, params)).rows;
  } catch (err) {
    const known = err.code === 'P0001' && SQL_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1]);
    throw err;
  }
}

// Lista de la sesión: reservas activas con su asistencia (null = sin marcar / sin registrar).
export async function getAttendance(client, sessionId) {
  const { rows: [s] } = await client.query(
    `SELECT attendance_closed_at FROM class_sessions WHERE id = $1`, [sessionId]); // la RLS oculta las ajenas al profesor
  if (!s) throw httpError(404, 'session_not_found', SQL_ERRORS.session_not_found[1]);
  const { rows: students } = await client.query(
    `SELECT b.id AS booking_id, b.student_id, p.display_name, a.status, a.method, a.corrected_at, a.correction_reason,
            has_risk_cover(b.student_id) AS risk_cover -- solo el sí/no (CONTEXT § Quién ve el seguro)
       FROM bookings b
       JOIN profiles p ON p.id = b.student_id
       LEFT JOIN attendance a ON a.booking_id = b.id
      WHERE b.session_id = $1 AND b.status = 'confirmed'
      ORDER BY p.display_name, b.student_id`,
    [sessionId]
  );
  return { closed_at: s.attendance_closed_at, students };
}

export async function markAttendance(client, { sessionId, studentId, present }) {
  await callFn(client, `SELECT mark_attendance($1, $2, $3)`, [sessionId, studentId, present]);
  return { student_id: studentId, present };
}

// Devuelve { present, absent }: las faltas se generan aquí.
export async function closeAttendance(client, sessionId) {
  const [r] = await callFn(client, `SELECT close_attendance($1) AS r`, [sessionId]);
  return r.r;
}

export async function correctAttendance(client, { sessionId, studentId, status, reason }) {
  const [a] = await callFn(client, `SELECT * FROM correct_attendance($1, $2, $3, $4)`,
    [sessionId, studentId, status, reason]);
  return a;
}

// Cada llamada queda auditada en la BD (health.view).
export function getSessionHealth(client, sessionId) {
  return callFn(client, `SELECT * FROM professor_session_health($1)`, [sessionId]);
}
