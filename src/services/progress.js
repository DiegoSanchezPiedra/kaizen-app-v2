// src/services/progress.js — racha, horas, badges y ranking mensual (B14; CONTEXT § Racha y logros).
// Las reglas viven en SQL (019: student_progress, monthly_ranking); aquí solo se valida, pagina y da forma.
// Siempre con el client RLS: las funciones se guardan solas.
import { httpError } from '../lib/errors.js';
import { invalid, parseId } from './catalog.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// 'YYYY-MM' → primer día del mes; sin month, NULL (el mes en curso en Madrid, lo decide SQL).
function parseMonth(month) {
  if (month === undefined) return null;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw invalid('month', 'month debe ser YYYY-MM');
  return `${month}-01`;
}

/** Progreso privado: el propio alumno, un tutor vinculado o el admin; si no, 403 not_guardian. */
export async function getProgress(client, { studentId, month }) {
  const { rows: [{ p }] } = await client.query(`SELECT student_progress($1, $2::date) AS p`,
    [studentId, parseMonth(month)]);
  if (!p) throw httpError(403, 'not_guardian', 'No eres tutor de este perfil');
  return p;
}

/** Ranking mensual: `{ discipline, month, rows, total, limit, offset }`. 404 si no existe o es abierta. */
export async function getRanking(client, { disciplineId, month, limit = 25, offset = 0 }) {
  const id = parseId(disciplineId);
  limit = Number(limit);
  offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw httpError(400, 'invalid_pagination', 'limit debe estar entre 1 y 100 y offset ser >= 0');
  }
  const m = parseMonth(month);
  let r;
  try {
    ({ rows: [r] } = await client.query(
      `WITH r AS (SELECT * FROM monthly_ranking($1, $2::date))
       SELECT (SELECT discipline_name FROM r LIMIT 1) AS name,
              to_char(COALESCE($2::date, now() AT TIME ZONE 'Europe/Madrid'), 'YYYY-MM') AS month,
              (SELECT count(id)::int FROM r) AS total,
              COALESCE((SELECT jsonb_agg(x ORDER BY x.rank, x.display_name, x.id) FROM (SELECT rank, id, display_name, hours FROM r WHERE id IS NOT NULL
                                                   ORDER BY rank, display_name, id LIMIT $3 OFFSET $4) x), '[]') AS rows`,
      [id, m, limit, offset]));
  } catch (err) {
    if (err.message === 'ranking_not_found') throw httpError(404, 'ranking_not_found', 'Ranking no encontrado');
    throw err;
  }
  return { discipline: { id, name: r.name }, month: r.month, rows: r.rows, total: r.total, limit, offset };
}
