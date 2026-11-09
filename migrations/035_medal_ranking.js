// migrations/035_medal_ranking.js
// Ranking de medallas de toda la academia y de siempre: los mismos que el mensual (alumnos que hoy pueden ser públicos,
// lo son y enseñan su ranking; un hijo nunca), con ≥ 1 medalla. Por medallas y, empatadas, por horas totales; empates
// con el mismo puesto. Las medallas de cada uno (qué ha conseguido) solo salen con su campo logros (public_profiles).
/* eslint-disable camelcase */

export const shorthands = undefined;

const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION medal_ranking()
      RETURNS TABLE (rank bigint, id uuid, display_name text, medals integer, hours numeric)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT rank() OVER (ORDER BY x.medals DESC, x.hours DESC), x.id, x.display_name, x.medals, x.hours
          FROM (SELECT p.id, p.display_name,
                       jsonb_array_length(student_achievements(p.id)->'badges') AS medals,
                       (SELECT round(COALESCE(sum(extract(epoch FROM s.ends_at - s.starts_at) / 3600), 0), 1)
                          FROM student_present(p.id) s) AS hours
                  FROM profiles p JOIN user_roles r ON r.user_id = p.id AND r.role = 'alumno'
                 WHERE ${AUTHED} AND p.is_public AND ${SHOWN('ranking')} AND can_be_public(p.id)) x
         WHERE x.medals > 0
      $$;
    ALTER FUNCTION medal_ranking() OWNER TO service_role;
    REVOKE ALL ON FUNCTION medal_ranking() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION medal_ranking() TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP FUNCTION medal_ranking();');
};
