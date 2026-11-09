// migrations/034_medal_codes.js
// Medallas (033): el visto pasa de una fecha a los códigos ya celebrados. earned_at es el inicio de la sesión que
// cruzó el umbral, así que una lista pasada tarde da una fecha anterior al último visto y la medalla no se celebraba.
// Ahora es nueva toda medalla cuyo código quien mira aún no celebró, tenga la fecha que tenga.
/* eslint-disable camelcase */

export const shorthands = undefined;

const TZ = 'Europe/Madrid';
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const THIS_MONTH = `date_trunc('month', now() AT TIME ZONE '${TZ}')::date`;
const CAN_SEE = `${AUTHED} AND (p_id = ${UID} OR is_guardian_of(p_id, true) OR ${IS_ADMIN})`;

// 033 con medals_seen_at (fecha) o medals_seen (códigos; NULL si nunca cerró una medalla nueva).
const progressSql = (codes) => `
  CREATE OR REPLACE FUNCTION student_progress(p_id uuid, p_month date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT student_achievements(p_id) || jsonb_build_object('hours', jsonb_build_object(
               'month', to_char(m, 'YYYY-MM'),
               'disciplines', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'hours', h.hours) ORDER BY d.name, d.id)
                   FROM month_hours(p_id, m) h JOIN disciplines d ON d.id = h.discipline_id), '[]')))
             || jsonb_build_object(
               'total_hours', (SELECT round(COALESCE(sum(extract(epoch FROM x.ends_at - x.starts_at) / 3600), 0), 1)
                                 FROM student_present(p_id) x),
               ${codes
    ? `'medals_seen', (SELECT to_jsonb(v.codes) FROM medal_views v WHERE v.viewer_id = ${UID} AND v.profile_id = p_id))`
    : `'medals_seen_at', (SELECT v.seen_at FROM medal_views v WHERE v.viewer_id = ${UID} AND v.profile_id = p_id))`}
        FROM (SELECT COALESCE(p_month, ${THIS_MONTH}) AS m) x
       WHERE ${CAN_SEE}
    $$;
`;

const markSql = (codes) => codes ? `
  -- Quien puede ver el progreso añade los códigos que ya celebró; si no, NULL (403 en la API).
  CREATE FUNCTION mark_medals_seen(p_id uuid, p_codes text[]) RETURNS text[]
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      INSERT INTO medal_views (viewer_id, profile_id, codes) SELECT ${UID}, p_id, p_codes WHERE ${CAN_SEE}
      ON CONFLICT (viewer_id, profile_id) DO UPDATE
        SET seen_at = now(), codes = ARRAY(SELECT DISTINCT unnest(medal_views.codes || EXCLUDED.codes) ORDER BY 1)
      RETURNING codes
    $$;
  ALTER FUNCTION mark_medals_seen(uuid, text[]) OWNER TO service_role;
  REVOKE ALL ON FUNCTION mark_medals_seen(uuid, text[]) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION mark_medals_seen(uuid, text[]) TO app_user;
` : `
  CREATE FUNCTION mark_medals_seen(p_id uuid) RETURNS timestamptz
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      INSERT INTO medal_views (viewer_id, profile_id) SELECT ${UID}, p_id WHERE ${CAN_SEE}
      ON CONFLICT (viewer_id, profile_id) DO UPDATE SET seen_at = now()
      RETURNING seen_at
    $$;
  ALTER FUNCTION mark_medals_seen(uuid) OWNER TO service_role;
  REVOKE ALL ON FUNCTION mark_medals_seen(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION mark_medals_seen(uuid) TO app_user;
`;

export const up = (pgm) => {
  // Las filas de 033 (una hora en staging) no dicen qué códigos vio: vuelven a la ventana de 14 días.
  pgm.sql('DELETE FROM medal_views;');
  pgm.addColumn('medal_views', { codes: { type: 'text[]', notNull: true, default: '{}' } });
  pgm.sql('DROP FUNCTION mark_medals_seen(uuid);');
  pgm.sql(markSql(true));
  pgm.sql(progressSql(true));
};

export const down = (pgm) => {
  pgm.sql('DROP FUNCTION mark_medals_seen(uuid, text[]);');
  pgm.sql(markSql(false));
  pgm.sql(progressSql(false));
  pgm.dropColumn('medal_views', 'codes');
};
