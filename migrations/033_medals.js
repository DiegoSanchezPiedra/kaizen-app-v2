// migrations/033_medals.js
// Medallas (los badges de 019 con nombre e icono): student_progress añade las horas totales (hacia la próxima
// medalla) y cuándo vio quien mira por última vez las medallas de ese perfil, para celebrar solo las nuevas.
// El visto vive en el servidor y por quien mira, no en el dispositivo (ADR 0015: móvil compartido).
/* eslint-disable camelcase */

export const shorthands = undefined;

const TZ = 'Europe/Madrid';
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const THIS_MONTH = `date_trunc('month', now() AT TIME ZONE '${TZ}')::date`;
const CAN_SEE = `${AUTHED} AND (p_id = ${UID} OR is_guardian_of(p_id, true) OR ${IS_ADMIN})`;

// 019 + total_hours y medals_seen_at.
const progressSql = (medals) => `
  CREATE OR REPLACE FUNCTION student_progress(p_id uuid, p_month date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT student_achievements(p_id) || jsonb_build_object('hours', jsonb_build_object(
               'month', to_char(m, 'YYYY-MM'),
               'disciplines', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'hours', h.hours) ORDER BY d.name, d.id)
                   FROM month_hours(p_id, m) h JOIN disciplines d ON d.id = h.discipline_id), '[]')))${medals ? `
             || jsonb_build_object(
               'total_hours', (SELECT round(COALESCE(sum(extract(epoch FROM x.ends_at - x.starts_at) / 3600), 0), 1)
                                 FROM student_present(p_id) x),
               'medals_seen_at', (SELECT v.seen_at FROM medal_views v WHERE v.viewer_id = ${UID} AND v.profile_id = p_id))` : ''}
        FROM (SELECT COALESCE(p_month, ${THIS_MONTH}) AS m) x
       WHERE ${CAN_SEE}
    $$;
`;

export const up = (pgm) => {
  pgm.createTable('medal_views', {
    viewer_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    profile_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('medal_views', 'medal_views_pkey', { primaryKey: ['viewer_id', 'profile_id'] });
  // Solo por las funciones (SECURITY DEFINER), como notice_deliveries.
  pgm.sql(`REVOKE ALL ON medal_views FROM app_user;`);
  pgm.sql(progressSql(true));
  pgm.sql(`
    -- Quien puede ver el progreso marca sus medallas como vistas; si no, NULL (403 en la API).
    CREATE FUNCTION mark_medals_seen(p_id uuid) RETURNS timestamptz
      LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO medal_views (viewer_id, profile_id) SELECT ${UID}, p_id WHERE ${CAN_SEE}
        ON CONFLICT (viewer_id, profile_id) DO UPDATE SET seen_at = now()
        RETURNING seen_at
      $$;
    ALTER FUNCTION mark_medals_seen(uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION mark_medals_seen(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION mark_medals_seen(uuid) TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP FUNCTION mark_medals_seen(uuid);');
  pgm.sql(progressSql(false));
  pgm.dropTable('medal_views');
};
