// migrations/037_medals_by_discipline.js
// Medallas por disciplina (ADR 0022): cada disciplina con asistencia, también la abierta, tiene su escalera de 11
// (primer día, horas 10…1000, racha 4…52) contando solo su asistencia. Su racha se salta las semanas en que esa
// disciplina no dio clase. La racha general (StreakPanel) sigue igual que en 019, sobre toda la academia.
// student_achievements: { streak, disciplines: [{ id, name, theme, hours, streak, badges }] }.
// El visto (034) guarda claves '<discipline_id>:<code>'; el ranking de medallas pasa a ser por disciplina.
/* eslint-disable camelcase */
import { progressSql as progress034 } from './034_medal_codes.js';

export const shorthands = undefined;

const TZ = 'Europe/Madrid';
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const THIS_MONTH = `date_trunc('month', now() AT TIME ZONE '${TZ}')::date`;
const CAN_SEE = `${AUTHED} AND (p_id = ${UID} OR is_guardian_of(p_id, true) OR ${IS_ADMIN})`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;
const HOURS = (a) => `extract(epoch FROM ${a}.ends_at - ${a}.starts_at) / 3600`;
const HOUR_BADGES = [10, 50, 100, 250, 500, 1000];
const STREAK_BADGES = [4, 12, 26, 52];

// El cuerpo de 019 (student_achievements). disc: filtra la asistencia y las semanas que rompen por p_discipline
// (NULL = todas, con el salto de toda la academia de 019) y añade las horas. Sin disc es la 019 tal cual (down).
const achievementsSql = (disc) => `
  CREATE OR REPLACE FUNCTION ${disc ? 'achievements_in(p_id uuid, p_discipline bigint)' : 'student_achievements(p_id uuid)'}
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      WITH pr AS (SELECT * FROM student_present(p_id) x${disc ? ' WHERE p_discipline IS NULL OR x.discipline_id = p_discipline' : ''}),
      pweeks AS (SELECT DISTINCT date_trunc('week', starts_at AT TIME ZONE '${TZ}') AS w FROM pr),
      now_week AS (SELECT date_trunc('week', now() AT TIME ZONE '${TZ}') AS w),
      weeks AS (
        SELECT g AS w, CASE
                 WHEN g IN (SELECT w FROM pweeks) THEN 'sum'
                 WHEN g = (SELECT w FROM now_week) THEN 'skip'
                 WHEN EXISTS (SELECT 1 FROM class_sessions s
                               WHERE s.status <> 'cancelled' AND s.ends_at <= now()${disc ? `
                                 AND (p_discipline IS NULL OR s.discipline_id = p_discipline)` : ''}
                                 AND s.starts_at >= g AT TIME ZONE '${TZ}'
                                 AND s.starts_at < (g + interval '1 week') AT TIME ZONE '${TZ}') THEN 'break'
                 ELSE 'skip' END AS kind
          FROM generate_series((SELECT min(w) FROM pweeks), (SELECT w FROM now_week), interval '1 week') g
      ),
      tramos AS (SELECT w, kind, count(*) FILTER (WHERE kind = 'break') OVER (ORDER BY w) AS grp
                   FROM weeks WHERE kind <> 'skip'),
      runs AS (SELECT w, count(*) FILTER (WHERE kind = 'sum') OVER (PARTITION BY grp ORDER BY w) AS n FROM tramos),
      cum AS (SELECT starts_at, sum(${HOURS('pr')}) OVER (ORDER BY starts_at, ends_at ROWS UNBOUNDED PRECEDING) AS h
                FROM pr)
      SELECT jsonb_build_object(
        'streak', jsonb_build_object(
          'current', COALESCE((SELECT n FROM runs ORDER BY w DESC LIMIT 1), 0),
          'best', COALESCE((SELECT max(n) FROM runs), 0)),${disc ? `
        'hours', (SELECT round(COALESCE(sum(${HOURS('pr')}), 0), 1) FROM pr),` : ''}
        'badges', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('code', code, 'earned_at', at) ORDER BY at, ord)
            FROM (VALUES (0, 'first_day', (SELECT min(starts_at) FROM pr))
                  ${HOUR_BADGES.map((h, i) => `, (${1 + i}, 'hours_${h}', (SELECT min(starts_at) FROM cum WHERE h >= ${h}))`).join('')}
                  ${STREAK_BADGES.map((n, i) => `, (${10 + i}, 'streak_${n}',
                     (SELECT min(w) AT TIME ZONE '${TZ}' FROM runs WHERE n >= ${n}))`).join('')}
                 ) b (ord, code, at)
           WHERE at IS NOT NULL), '[]'))
    $$;
`;

const progressSql = `
  CREATE OR REPLACE FUNCTION student_progress(p_id uuid, p_month date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT student_achievements(p_id) || jsonb_build_object('hours', jsonb_build_object(
               'month', to_char(m, 'YYYY-MM'),
               'disciplines', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'hours', h.hours) ORDER BY d.name, d.id)
                   FROM month_hours(p_id, m) h JOIN disciplines d ON d.id = h.discipline_id), '[]')))
             || jsonb_build_object(
               'medals_seen', (SELECT to_jsonb(v.codes) FROM medal_views v WHERE v.viewer_id = ${UID} AND v.profile_id = p_id))
        FROM (SELECT COALESCE(p_month, ${THIS_MONTH}) AS m) x
       WHERE ${CAN_SEE}
    $$;
`;

// Ficha pública (019): los logros sin las horas exactas de cada disciplina (eso es del ranking, no de los logros).
const publicSql = (disc) => `
  CREATE OR REPLACE FUNCTION public_achievements(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT ${disc ? `a || jsonb_build_object('disciplines', (SELECT COALESCE(jsonb_agg(d - 'hours'), '[]')
                                                         FROM jsonb_array_elements(a->'disciplines') d))`
    : 'a'}
        FROM profiles p JOIN user_roles r ON r.user_id = p.id
        CROSS JOIN LATERAL student_achievements(p.id) a
       WHERE ${AUTHED} AND p.id = p_id AND p.is_public AND r.role = 'alumno'
         AND ${SHOWN('achievements')} AND can_be_public(p.id)
    $$;
`;

const fns = (list, grant) => list.map((fn) => `ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;${
  grant ? ` GRANT EXECUTE ON FUNCTION ${fn} TO app_user;` : ''}`).join('\n');

export const up = (pgm) => {
  // Los vistos guardados son códigos globales: sin disciplina no se traducen. Vuelven a la ventana de 14 días.
  pgm.sql('DELETE FROM medal_views;');
  pgm.sql(achievementsSql(true));
  // shortcut: achievements_in recorre student_present una vez por disciplina (y otra para la racha general); con
  // cientos de alumnos y páginas de 25–50 va bien. Si Progreso o los rankings se notan lentos, calcular la asistencia
  // una sola vez (o guardar las medallas en una tabla).
  pgm.sql(`
    CREATE OR REPLACE FUNCTION student_achievements(p_id uuid) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT jsonb_build_object(
          'streak', achievements_in(p_id, NULL)->'streak',
          'disciplines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', d.id::text, 'name', d.name, 'theme', d.medal_theme)
                             || achievements_in(p_id, d.id) ORDER BY d.name, d.id)
              FROM disciplines d WHERE d.id IN (SELECT discipline_id FROM student_present(p_id))), '[]'))
      $$;
  `);
  pgm.sql(progressSql);
  pgm.sql(publicSql(true));
  pgm.sql(`
    DROP FUNCTION medal_ranking();
    -- Ranking de medallas de una disciplina, de siempre: los mismos que el mensual (019) con ≥ 1 medalla en ella;
    -- por medallas y, empatadas, por sus horas en ella. Como el mensual: el nombre en cada fila y, sin nadie,
    -- una fila solo con él. Una abierta también tiene el suyo (tiene escalera propia).
    CREATE FUNCTION medal_ranking(p_discipline bigint)
      RETURNS TABLE (discipline_name text, rank bigint, id uuid, display_name text, medals integer, hours numeric)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
      #variable_conflict use_column
      DECLARE dname text;
      BEGIN
        IF NOT (${AUTHED}) THEN RETURN; END IF;
        SELECT d.name INTO dname FROM disciplines d WHERE d.id = p_discipline;
        IF NOT FOUND THEN RAISE EXCEPTION 'ranking_not_found'; END IF;
        RETURN QUERY
          SELECT dname, x.rank, x.id, x.display_name, x.medals, x.hours
            FROM (SELECT 1) one LEFT JOIN (
              SELECT rank() OVER (ORDER BY y.medals DESC, y.hours DESC) AS rank, y.*
                FROM (SELECT q.id, q.display_name, jsonb_array_length(a->'badges') AS medals, (a->>'hours')::numeric AS hours
                        -- Primero quién compite y ha estado en ella (OFFSET 0: no se aplana), luego su escalera.
                        FROM (SELECT p.id, p.display_name FROM profiles p
                                JOIN user_roles r ON r.user_id = p.id AND r.role = 'alumno'
                               WHERE p.is_public AND ${SHOWN('ranking')} AND can_be_public(p.id)
                                 AND EXISTS (SELECT 1 FROM student_present(p.id) x WHERE x.discipline_id = p_discipline)
                              OFFSET 0) q
                        CROSS JOIN LATERAL achievements_in(q.id, p_discipline) a) y
               WHERE y.medals > 0) x ON true;
      END
      $$;
  `);
  pgm.sql(fns(['achievements_in(uuid, bigint)'], false));
  pgm.sql(fns(['medal_ranking(bigint)'], true));
};

export const down = (pgm) => {
  pgm.sql('DELETE FROM medal_views;');
  pgm.sql(achievementsSql(false));
  pgm.sql(publicSql(false));
  pgm.sql(progress034(true));
  pgm.sql(`
    DROP FUNCTION medal_ranking(bigint);
    DROP FUNCTION achievements_in(uuid, bigint);
    CREATE FUNCTION medal_ranking()
      RETURNS TABLE (rank bigint, id uuid, display_name text, medals integer, hours numeric)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT rank() OVER (ORDER BY x.medals DESC, x.hours DESC), x.id, x.display_name, x.medals, x.hours
          FROM (SELECT p.id, p.display_name,
                       jsonb_array_length(student_achievements(p.id)->'badges') AS medals,
                       (SELECT round(COALESCE(sum(${HOURS('s')}), 0), 1) FROM student_present(p.id) s) AS hours
                  FROM profiles p JOIN user_roles r ON r.user_id = p.id AND r.role = 'alumno'
                 WHERE ${AUTHED} AND p.is_public AND ${SHOWN('ranking')} AND can_be_public(p.id)) x
         WHERE x.medals > 0
      $$;
  `);
  pgm.sql(fns(['medal_ranking()'], true));
};
