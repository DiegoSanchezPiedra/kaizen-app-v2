// src/services/reports.js — informes (B17; CONTEXT § Informes; ADR 0012). Todo por el client RLS: la misma consulta
// sirve al admin y al profesor, y la RLS deja al profesor solo sus sesiones (trainer_id). La foto solo la lee el admin.
// Nunca salud, edad, fecha de nacimiento ni desglose por menor/adulto.
import { httpError } from '../lib/errors.js';
import { dateParam, MAX_RANGE_DAYS, today, addDays } from './sessions.js';

const TZ = 'Europe/Madrid';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^\d{1,18}$/;

const bad = (field, msg) => httpError(400, 'invalid_field', msg, { field });
const range = (msg) => httpError(400, 'invalid_range', msg);
const monthParam = (v, field) => {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw bad(field, `${field} debe ser YYYY-MM`);
  return v;
};
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const addMonths = (m, n) => { const i = monthIndex(m) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
// Rango de meses de Madrid, ambos incluidos, `max` meses como mucho.
const monthRange = (from, to, max, [defFrom, defTo]) => {
  const f = from !== undefined ? monthParam(from, 'from') : defFrom;
  const t = to !== undefined ? monthParam(to, 'to') : defTo;
  const n = monthIndex(t) - monthIndex(f);
  if (n < 0 || n >= max) throw range(`to debe ser >= from y el rango de ${max} meses como mucho`);
  return [f, t];
};
const disciplineParam = (v) => {
  if (v === undefined) return null;
  if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('discipline_id', 'discipline_id inválido');
  return v;
};
// Como services/profiles.js.
export const pagination = ({ limit = 25, offset = 0 }) => {
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  return { limit, offset };
};

/** Foto diaria por día o por mes. Un día o un mes sin foto, con los valores a null («sin dato»). */
export async function getSubscriptionStats(client, { group, from, to }) {
  if (group === 'day') {
    const t = to !== undefined ? dateParam(to, 'to') : addDays(today(), -1);
    const f = from !== undefined ? dateParam(from, 'from') : addDays(t, -29);
    const days = (Date.parse(t) - Date.parse(f)) / 864e5;
    if (days < 0 || days >= MAX_RANGE_DAYS) {
      throw range(`to debe ser >= from y el rango de ${MAX_RANGE_DAYS} días como mucho`);
    }
    const { rows } = await client.query(
      `SELECT to_char(g.d, 'YYYY-MM-DD') AS date, a.active, a.past_due, a.unpaid,
              a.new_subscriptions, a.cancelled_subscriptions, a.mrr_cents
         FROM generate_series($1::date, $2::date, interval '1 day') g(d)
         LEFT JOIN academy_stats_daily a ON a.date = g.d::date
        ORDER BY g.d`, [f, t]);
    return { group, from: f, to: t, rows };
  }
  if (group !== 'month') throw bad('group', 'group debe ser day o month');
  const cur = today().slice(0, 7);
  const [f, t] = monthRange(from, to, 24, [addMonths(cur, -11), cur]);
  // Estados y MRR, de la última foto del mes; altas y bajas, la suma. days_in_month: los días con foto posible
  // (el mes entero en el pasado, hasta ayer en el en curso, 0 en el futuro).
  const { rows } = await client.query(
    `WITH m AS (SELECT g.m::date AS m, (g.m + interval '1 month')::date AS e
                  FROM generate_series(($1::text || '-01')::date, ($2::text || '-01')::date, interval '1 month') g(m)),
          t AS (SELECT (now() AT TIME ZONE '${TZ}')::date AS d)
     SELECT to_char(m.m, 'YYYY-MM') AS month, l.active, l.past_due, l.unpaid,
            s.new_subscriptions, s.cancelled_subscriptions, l.mrr_cents,
            s.days_with_data, least(m.e - m.m, greatest(t.d - m.m, 0)) AS days_in_month
       FROM m CROSS JOIN t
       LEFT JOIN LATERAL (SELECT active, past_due, unpaid, mrr_cents FROM academy_stats_daily
                           WHERE date >= m.m AND date < m.e ORDER BY date DESC LIMIT 1) l ON true
       CROSS JOIN LATERAL (SELECT sum(new_subscriptions)::int AS new_subscriptions,
                                  sum(cancelled_subscriptions)::int AS cancelled_subscriptions,
                                  count(*)::int AS days_with_data
                             FROM academy_stats_daily WHERE date >= m.m AND date < m.e) s
      ORDER BY m.m`, [f, t]);
  return { group, from: f, to: t, rows };
}

// Sesiones que cuentan (celebradas: programadas y ya terminadas), en los meses de Madrid [$1, $2] por su inicio.
const COUNTED = `
  s.status = 'scheduled' AND s.ends_at <= now()
  AND s.starts_at >= ($1::text || '-01')::timestamp AT TIME ZONE '${TZ}'
  AND s.starts_at < (($2::text || '-01')::date + interval '1 month')::timestamp AT TIME ZONE '${TZ}'
  AND ($3::bigint IS NULL OR s.discipline_id = $3)`;

// Cifras de un conjunto de filas por sesión (x); occupancy, razón de sumas y null sin sesiones.
const FIGURES = `jsonb_build_object(
  'sessions', count(x.id), 'capacity', COALESCE(sum(x.capacity), 0), 'booked', COALESCE(sum(x.booked), 0),
  'occupancy', round(sum(x.booked)::numeric / NULLIF(sum(x.capacity), 0), 3),
  'present', COALESCE(sum(x.present), 0), 'absent', COALESCE(sum(x.absent), 0),
  'unrecorded', COALESCE(sum(x.unrecorded), 0), 'late', COALESCE(sum(x.late), 0))`;

/**
 * Ocupación y asistencia por disciplina o por clase y mes. Admin y profesor: la RLS acota a sus sesiones.
 * Las sueltas van en una fila class_id null por disciplina. by=class, paginado.
 */
export async function getSessionStats(client, { by, from, to, discipline_id: disciplineId, limit, offset }) {
  if (by !== 'discipline' && by !== 'class') throw bad('by', 'by debe ser discipline o class');
  const cur = today().slice(0, 7);
  const [f, t] = monthRange(from, to, 12, [cur, cur]);
  const disc = disciplineParam(disciplineId);
  const page = by === 'class' ? pagination({ limit, offset }) : null;
  const classKey = by === 'class' ? 's.class_id' : 'NULL::uuid';
  const { rows } = await client.query(
    `WITH x AS (
       SELECT s.id, s.discipline_id, ${classKey} AS class_id, s.capacity,
              date_trunc('month', s.starts_at AT TIME ZONE '${TZ}')::date AS month, b.*
         FROM class_sessions s
        CROSS JOIN LATERAL (
          SELECT count(*) FILTER (WHERE bk.status = 'confirmed') AS booked,
                 count(*) FILTER (WHERE bk.status = 'confirmed' AND a.status = 'present') AS present,
                 count(*) FILTER (WHERE bk.status = 'confirmed' AND a.status IS DISTINCT FROM 'present'
                                    AND s.attendance_closed_at IS NOT NULL) AS absent,
                 count(*) FILTER (WHERE bk.status = 'confirmed' AND a.status IS DISTINCT FROM 'present'
                                    AND s.attendance_closed_at IS NULL) AS unrecorded,
                 count(*) FILTER (WHERE bk.cancel_reason = 'late') AS late
            FROM bookings bk LEFT JOIN attendance a ON a.booking_id = bk.id
           WHERE bk.session_id = s.id) b
        WHERE ${COUNTED}),
     g AS (SELECT DISTINCT discipline_id, class_id FROM x),
     months AS (SELECT g.m::date AS month
                  FROM generate_series(($1::text || '-01')::date, ($2::text || '-01')::date, interval '1 month') g(m))
     SELECT g.class_id, d.id AS discipline_id, d.name AS discipline_name,
            c.weekday, to_char(c.start_time, 'HH24:MI') AS start_time, c.trainer_id, tp.display_name AS trainer_name,
            (SELECT jsonb_agg(jsonb_build_object('month', to_char(mm.month, 'YYYY-MM')) || mm.f ORDER BY mm.month)
               FROM (SELECT months.month, ${FIGURES} AS f
                       FROM months LEFT JOIN x ON x.month = months.month AND x.discipline_id = g.discipline_id
                                              AND x.class_id IS NOT DISTINCT FROM g.class_id
                      GROUP BY months.month) mm) AS months,
            (SELECT ${FIGURES} FROM x WHERE x.discipline_id = g.discipline_id
                                        AND x.class_id IS NOT DISTINCT FROM g.class_id) AS total,
            count(*) OVER () AS n
       FROM g
       JOIN disciplines d ON d.id = g.discipline_id
       LEFT JOIN classes c ON c.id = g.class_id
       LEFT JOIN profiles tp ON tp.id = c.trainer_id
      ORDER BY d.name, d.id, g.class_id IS NULL, c.weekday, c.start_time, c.id
      ${page ? 'LIMIT $4 OFFSET $5' : ''}`,
    page ? [f, t, disc, page.limit, page.offset] : [f, t, disc]);
  const out = rows.map((r) => {
    const discipline = { id: r.discipline_id, name: r.discipline_name };
    if (by === 'discipline') return { discipline, months: r.months, total: r.total };
    const cls = r.class_id === null ? {} : {
      weekday: r.weekday, start_time: r.start_time,
      // El profesor no ve el nombre de otro profesor (RLS de profiles): name null si el habitual es otro.
      trainer: { id: r.trainer_id, name: r.trainer_name ?? null },
    };
    return { class_id: r.class_id, discipline, ...cls, months: r.months, total: r.total };
  });
  if (!page) return { by, from: f, to: t, rows: out };
  // Con un offset más allá del final no vuelve ninguna fila: el total se cuenta aparte.
  const total = rows.length ? Number(rows[0].n) : (await client.query(
    `SELECT count(*)::int AS n FROM (SELECT DISTINCT s.discipline_id, s.class_id FROM class_sessions s
       JOIN disciplines d ON d.id = s.discipline_id WHERE ${COUNTED}) q`, [f, t, disc])).rows[0].n;
  return { by, from: f, to: t, rows: out, total, ...page };
}

/** Asistencia por alumno (solo admin): totales del rango, por nombre. Sin horas ni racha (B14). */
export async function getStudentStats(client, { from, to, discipline_id: disciplineId, limit, offset }) {
  const cur = today().slice(0, 7);
  const [f, t] = monthRange(from, to, 12, [cur, cur]);
  const disc = disciplineParam(disciplineId);
  const page = pagination({ limit, offset });
  const { rows } = await client.query(
    `WITH x AS (
       SELECT bk.student_id, bk.status, bk.cancel_reason, a.status AS att, s.attendance_closed_at AS closed
         FROM bookings bk
         JOIN class_sessions s ON s.id = bk.session_id
         LEFT JOIN attendance a ON a.booking_id = bk.id
        WHERE ${COUNTED} AND (bk.status = 'confirmed' OR bk.cancel_reason = 'late'))
     SELECT p.id, p.display_name AS name,
            count(*) FILTER (WHERE x.status = 'confirmed')::int AS bookings,
            count(*) FILTER (WHERE x.status = 'confirmed' AND x.att = 'present')::int AS present,
            count(*) FILTER (WHERE x.status = 'confirmed' AND x.att IS DISTINCT FROM 'present'
                               AND x.closed IS NOT NULL)::int AS absent,
            count(*) FILTER (WHERE x.status = 'confirmed' AND x.att IS DISTINCT FROM 'present'
                               AND x.closed IS NULL)::int AS unrecorded,
            count(*) FILTER (WHERE x.cancel_reason = 'late')::int AS late,
            count(*) OVER ()::int AS n
       FROM x JOIN profiles p ON p.id = x.student_id
      GROUP BY p.id
      ORDER BY p.display_name, p.id
      LIMIT $4 OFFSET $5`, [f, t, disc, page.limit, page.offset]);
  const total = rows.length ? rows[0].n : (await client.query(
    `SELECT count(DISTINCT bk.student_id)::int AS n FROM bookings bk JOIN class_sessions s ON s.id = bk.session_id
      WHERE ${COUNTED} AND (bk.status = 'confirmed' OR bk.cancel_reason = 'late')`, [f, t, disc])).rows[0].n;
  for (const r of rows) delete r.n;
  return { from: f, to: t, rows, total, ...page };
}
