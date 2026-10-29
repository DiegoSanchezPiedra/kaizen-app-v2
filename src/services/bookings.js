// src/services/bookings.js — reservas y lista de espera (CONTEXT § Reservas). Las reglas viven en las
// funciones SQL de la migración 009; aquí solo se traducen sus errores y se lee con RLS.
import { httpError } from '../lib/errors.js';
import { dateParam, MAX_RANGE_DAYS } from './sessions.js';

const TZ = 'Europe/Madrid';

const SQL_ERRORS = {
  not_allowed: [403, 'No puedes reservar ni cancelar por este perfil'],
  session_not_found: [404, 'Sesión no encontrada'],
  session_not_bookable: [409, 'La sesión está cancelada o ya ha empezado'],
  outside_booking_window: [409, 'La sesión aún no está dentro de la ventana de reserva'],
  not_covered: [403, 'La suscripción no cubre esta sesión'],
  no_risk_cover: [403, 'Sin cobertura de riesgo: firma el waiver o contrata el seguro'],
  already_booked: [409, 'Ya tiene reserva o está en espera en esta sesión'],
  booking_overlap: [409, 'Tiene otra reserva que se solapa con esta sesión'],
  booking_not_found: [404, 'Reserva no encontrada'],
  booking_not_active: [409, 'La reserva ya está cancelada'],
  session_started: [409, 'La sesión ya ha empezado'],
};

async function callFn(client, sql, params) {
  try {
    const { rows: [row] } = await client.query(sql, params);
    return row;
  } catch (err) {
    const known = (err.code === 'P0001' || err.code === '42501') && SQL_ERRORS[err.message];
    if (known) throw httpError(known[0], err.message, known[1]);
    // Promociones cruzadas entre sesiones pueden bloquearse mutuamente; Postgres aborta una: que reintente.
    if (err.code === '40P01') throw httpError(409, 'booking_conflict_retry', 'Operación concurrente, vuelve a intentarlo');
    throw err;
  }
}

// Llena → queda en espera (status 'waitlisted').
export function bookSession(client, { sessionId, studentId }) {
  return callFn(client, `SELECT * FROM book_session($1, $2)`, [sessionId, studentId]);
}

// Cancela una reserva o retira una espera; si liberaba plaza, promociona en la misma transacción.
export function cancelBooking(client, id) {
  return callFn(client, `SELECT * FROM cancel_booking($1)`, [id]);
}

// Reservas visibles (propias y de los hijos; la RLS decide). `from`/`to`: días de Madrid, ambos inclusive.
export async function listBookings(client, { profile_id, from, to } = {}) {
  const f = from ? dateParam(from, 'from') : null;
  const t = to ? dateParam(to, 'to') : null;
  const { rows } = await client.query(
    `WITH r AS (SELECT COALESCE($2::date, (now() AT TIME ZONE '${TZ}')::date) AS f)
     SELECT b.id, b.session_id, b.student_id, b.booked_by, b.status, b.cancel_reason,
            b.created_at, b.promoted_at, b.cancelled_at,
            s.discipline_id, d.name AS discipline_name, s.starts_at, s.ends_at, s.location,
            s.status AS session_status
       FROM bookings b
       JOIN class_sessions s ON s.id = b.session_id
       LEFT JOIN disciplines d ON d.id = s.discipline_id, r
      WHERE ($1::uuid IS NULL OR b.student_id = $1)
        AND s.starts_at >= r.f::timestamp AT TIME ZONE '${TZ}'
        AND s.starts_at <  (COALESCE($3::date, r.f + 30) + 1)::timestamp AT TIME ZONE '${TZ}'
        AND COALESCE($3::date, r.f + 30) - r.f < ${MAX_RANGE_DAYS}
      ORDER BY s.starts_at, b.created_at`,
    [profile_id ?? null, f, t]
  );
  return rows;
}
