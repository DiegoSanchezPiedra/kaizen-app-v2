// migrations/019_progress_open_disciplines.js
// B14: racha, horas, badges y ranking mensual opt-in (CONTEXT § Racha y logros), y disciplina abierta
// (CONTEXT § Disciplina abierta). Todo se calcula al leer sobre attendance + class_sessions, en hora de Madrid.
// Las reglas viven en student_present y sus derivadas (month_hours, student_achievements): una sola fuente.
/* eslint-disable camelcase */

export const shorthands = undefined;

const TZ = 'Europe/Madrid';
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;
const THIS_MONTH = `date_trunc('month', now() AT TIME ZONE '${TZ}')::date`;
const HOURS = (a) => `extract(epoch FROM ${a}.ends_at - ${a}.starts_at) / 3600`;

const INTERNAL_FNS = ['student_present(uuid)', 'month_hours(uuid, date)', 'student_achievements(uuid)'];
const PUBLIC_FNS = [
  'student_progress(uuid, date)', 'public_achievements(uuid)', 'monthly_ranking(bigint, date)',
  'revoke_open_discipline(bigint)',
];
// Lista cerrada (CONTEXT § Badge). Horas: totales, la abierta una sola vez. Racha: sobre la mejor.
const HOUR_BADGES = [10, 50, 100, 250, 500, 1000];
const STREAK_BADGES = [4, 12, 26, 52];

// Cubrir (012) + la disciplina abierta: la cubre cualquier suscripción en vigor, respetando «solo menores».
const coversSql = (open) => `
  CREATE OR REPLACE FUNCTION covers(p_student uuid, p_discipline bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (
        SELECT 1
          FROM subscriptions s
          JOIN plans pl ON pl.id = s.plan_id
          JOIN profiles p ON p.id = s.student_id
          JOIN disciplines d ON d.id = p_discipline AND d.is_active
         WHERE s.student_id = p_student
           AND s.status IN ('active', 'past_due')
           AND (NOT (${ADULT}) OR NOT (d.minors_only OR pl.minors_only))
           AND (${open ? 'd.is_open OR ' : ''}CASE WHEN pl.max_disciplines IS NULL
                    -- «todas»: lista de elegibles vacía = cualquiera
                    THEN NOT EXISTS (SELECT 1 FROM plan_disciplines pd WHERE pd.plan_id = pl.id)
                      OR EXISTS (SELECT 1 FROM plan_disciplines pd
                                  WHERE pd.plan_id = pl.id AND pd.discipline_id = d.id)
                    ELSE EXISTS (SELECT 1 FROM subscription_disciplines sd
                                  WHERE sd.subscription_id = s.id AND sd.discipline_id = d.id)
               END)
      )
    $$;
`;

// public_disciplines (017); up: sin las abiertas (las cubre todo suscriptor, no dicen nada de él).
const publicDisciplinesSql = (open) => `
  CREATE OR REPLACE FUNCTION public_disciplines(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
                        FILTER (WHERE d.id IS NOT NULL), '[]')
        FROM profiles p JOIN user_roles r ON r.user_id = p.id
        LEFT JOIN disciplines d ON ${open ? 'NOT d.is_open AND ' : ''}CASE r.role
          WHEN 'alumno' THEN covers(p.id, d.id)
          ELSE EXISTS (SELECT 1 FROM classes c
                        WHERE c.trainer_id = p.id AND c.discipline_id = d.id
                          AND (c.ends_on IS NULL OR c.ends_on >= (now() AT TIME ZONE 'Europe/Madrid')::date))
        END
       WHERE p.id = p_id AND p.is_public AND ${SHOWN('disciplines')} AND can_be_public(p.id)
       GROUP BY p.id
    $$;
`;

// public_profiles (017) con o sin achievements. Columnas fijas: el test de profiles las comprueba una a una.
const publicProfilesSql = (achievements) => `
  DROP VIEW public_profiles;
  CREATE VIEW public_profiles WITH (security_barrier) AS
    SELECT p.id, p.display_name, r.role,
           CASE WHEN ${SHOWN('bio')} THEN p.bio END AS bio,
           CASE WHEN ${SHOWN('social_links')} THEN p.social_links END AS social_links,
           CASE WHEN ${SHOWN('disciplines')} THEN public_disciplines(p.id) END AS disciplines,
           CASE WHEN ${SHOWN('member_since')} THEN to_char(p.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') END
             AS member_since${achievements ? `,
           public_achievements(p.id) AS achievements` : ''}
      FROM profiles p JOIN user_roles r ON r.user_id = p.id
     WHERE ${AUTHED} AND p.is_public AND can_be_public(p.id);
  REVOKE ALL ON public_profiles FROM PUBLIC, app_user;
  ALTER VIEW public_profiles OWNER TO service_role;
  GRANT SELECT ON public_profiles TO app_user;
`;

// change_discipline (014) cambia en una condición: el destino no puede ser una abierta (no se elige).
// Se reescribe sobre su definición actual para no copiar la función entera; si no encuentra el texto, falla.
const CHOSEN = 'd.id = p_to AND d.is_active AND NOT (adult';
const CHOSEN_OPEN = 'd.id = p_to AND d.is_active AND NOT d.is_open AND NOT (adult';
const swapChangeDiscipline = (from, to) => `
  DO $do$
  DECLARE
    def text := pg_get_functiondef('change_discipline(uuid, bigint, bigint, uuid)'::regprocedure);
  BEGIN
    IF position('${from}' IN def) = 0 THEN RAISE EXCEPTION 'change_discipline: no encuentro %', '${from}'; END IF;
    EXECUTE replace(def, '${from}', '${to}');
  END
  $do$;
`;

export const up = (pgm) => {
  // Sin bloque, sin RLS y sin uso: no hay feed (B14).
  pgm.dropTable('activity_feed');

  pgm.addColumn('disciplines', { is_open: { type: 'boolean', notNull: true, default: false } });
  pgm.sql(coversSql(true));
  pgm.sql(publicDisciplinesSql(true));
  pgm.sql(swapChangeDiscipline(CHOSEN, CHOSEN_OPEN));

  pgm.sql(`
    -- Los presentes que cuentan: status present de una sesión no cancelada, con o sin lista cerrada.
    CREATE FUNCTION student_present(p_id uuid)
      RETURNS TABLE (starts_at timestamptz, ends_at timestamptz, discipline_id bigint, is_open boolean)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT s.starts_at, s.ends_at, s.discipline_id, d.is_open
          FROM attendance a
          JOIN class_sessions s ON s.id = a.session_id
          JOIN disciplines d ON d.id = s.discipline_id
         WHERE ${AUTHED} AND a.student_id = p_id AND a.status = 'present' AND s.status <> 'cancelled'
      $$;

    -- Horas del mes por disciplina no abierta (mes de Madrid en que empieza la sesión). Las de una abierta
    -- suman, enteras, en cada disciplina con algún presente ese mes; si solo hizo abiertas, en ninguna.
    CREATE FUNCTION month_hours(p_id uuid, p_month date) RETURNS TABLE (discipline_id bigint, hours numeric)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        WITH x AS (SELECT * FROM student_present(p_id) x
                    WHERE date_trunc('month', x.starts_at AT TIME ZONE '${TZ}')::date = p_month)
        SELECT x.discipline_id,
               round(sum(${HOURS('x')}) + (SELECT COALESCE(sum(${HOURS('o')}), 0) FROM x o WHERE o.is_open), 1)
          FROM x WHERE NOT x.is_open GROUP BY x.discipline_id
      $$;

    -- Racha (semanas lunes–domingo de Madrid) y badges: { streak: { current, best }, badges: [{ code, earned_at }] }.
    -- Una semana suma con ≥ 1 presente; se salta si la academia no celebró ninguna sesión (no cancelada y ya
    -- terminada) o si es la semana en curso sin presente; cualquier otra la rompe.
    -- shortcut: el salto mira toda la academia, no las disciplinas del alumno (si en agosto solo hay Kids,
    -- un adulto rompe la racha); revisar si la academia lo pide.
    CREATE FUNCTION student_achievements(p_id uuid) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        WITH pr AS (SELECT * FROM student_present(p_id)),
        pweeks AS (SELECT DISTINCT date_trunc('week', starts_at AT TIME ZONE '${TZ}') AS w FROM pr),
        now_week AS (SELECT date_trunc('week', now() AT TIME ZONE '${TZ}') AS w),
        weeks AS (
          SELECT g AS w, CASE
                   WHEN g IN (SELECT w FROM pweeks) THEN 'sum'
                   WHEN g = (SELECT w FROM now_week) THEN 'skip'
                   WHEN EXISTS (SELECT 1 FROM class_sessions s
                                 WHERE s.status <> 'cancelled' AND s.ends_at <= now()
                                   AND s.starts_at >= g AT TIME ZONE '${TZ}'
                                   AND s.starts_at < (g + interval '1 week') AT TIME ZONE '${TZ}') THEN 'break'
                   ELSE 'skip' END AS kind
            FROM generate_series((SELECT min(w) FROM pweeks), (SELECT w FROM now_week), interval '1 week') g
        ),
        -- Cada ruptura abre un tramo; n = semanas que suman hasta esa, dentro de su tramo.
        tramos AS (SELECT w, kind, count(*) FILTER (WHERE kind = 'break') OVER (ORDER BY w) AS grp
                     FROM weeks WHERE kind <> 'skip'),
        runs AS (SELECT w, count(*) FILTER (WHERE kind = 'sum') OVER (PARTITION BY grp ORDER BY w) AS n FROM tramos),
        cum AS (SELECT starts_at, sum(${HOURS('pr')}) OVER (ORDER BY starts_at, ends_at ROWS UNBOUNDED PRECEDING) AS h
                  FROM pr)
        SELECT jsonb_build_object(
          'streak', jsonb_build_object(
            'current', COALESCE((SELECT n FROM runs ORDER BY w DESC LIMIT 1), 0),
            'best', COALESCE((SELECT max(n) FROM runs), 0)),
          'badges', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('code', code, 'earned_at', at) ORDER BY at, ord)
              FROM (VALUES (0, 'first_day', (SELECT min(starts_at) FROM pr))
                    ${HOUR_BADGES.map((h, i) => `, (${1 + i}, 'hours_${h}', (SELECT min(starts_at) FROM cum WHERE h >= ${h}))`).join('')}
                    ${STREAK_BADGES.map((n, i) => `, (${10 + i}, 'streak_${n}',
                       (SELECT min(w) AT TIME ZONE '${TZ}' FROM runs WHERE n >= ${n}))`).join('')}
                   ) b (ord, code, at)
             WHERE at IS NOT NULL), '[]'))
      $$;

    -- Privado: el propio alumno, cualquier tutor vinculado (también con 18 sin reclamar) y el admin. Si no, NULL.
    CREATE FUNCTION student_progress(p_id uuid, p_month date) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT student_achievements(p_id) || jsonb_build_object('hours', jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'disciplines', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'hours', h.hours) ORDER BY d.name, d.id)
                     FROM month_hours(p_id, m) h JOIN disciplines d ON d.id = h.discipline_id), '[]')))
          FROM (SELECT COALESCE(p_month, ${THIS_MONTH}) AS m) x
         WHERE ${AUTHED} AND (p_id = ${UID} OR is_guardian_of(p_id, true) OR ${IS_ADMIN})
      $$;

    -- Ficha pública: NULL salvo alumno público, que puede serlo y enseña sus logros.
    CREATE FUNCTION public_achievements(p_id uuid) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT student_achievements(p.id)
          FROM profiles p JOIN user_roles r ON r.user_id = p.id
         WHERE ${AUTHED} AND p.id = p_id AND p.is_public AND r.role = 'alumno'
           AND ${SHOWN('achievements')} AND can_be_public(p.id)
      $$;

    -- Ranking mensual de una disciplina no abierta (también desactivada): alumnos que hoy pueden ser públicos,
    -- lo son y enseñan su ranking, con > 0 h ese mes. Empates con el mismo puesto (rank). Devuelve el nombre
    -- de la disciplina en cada fila y, sin participantes, una fila solo con él (la RLS oculta las desactivadas).
    CREATE FUNCTION monthly_ranking(p_discipline bigint, p_month date)
      RETURNS TABLE (discipline_name text, rank bigint, id uuid, display_name text, hours numeric)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
      #variable_conflict use_column
      DECLARE
        dname text;
        m date := COALESCE(p_month, ${THIS_MONTH});
      BEGIN
        IF NOT (${AUTHED}) THEN RETURN; END IF;
        SELECT d.name INTO dname FROM disciplines d WHERE d.id = p_discipline AND NOT d.is_open;
        IF NOT FOUND THEN RAISE EXCEPTION 'ranking_not_found'; END IF;
        RETURN QUERY
          SELECT dname, x.rank, x.id, x.display_name, x.hours
            FROM (SELECT 1) one LEFT JOIN (
              SELECT rank() OVER (ORDER BY h.hours DESC) AS rank, p.id, p.display_name, h.hours
                FROM profiles p
                JOIN user_roles r ON r.user_id = p.id AND r.role = 'alumno'
                CROSS JOIN LATERAL month_hours(p.id, m) h
               WHERE p.is_public AND ${SHOWN('ranking')} AND can_be_public(p.id)
                 AND h.discipline_id = p_discipline AND h.hours > 0) x ON true;
      END
      $$;

    -- Desmarcar una abierta: quien tenía reservas o esperas futuras en ella y ya no la cubre las pierde
    -- (revoke_coverage, 012, con aviso). app_user no ejecuta revoke_coverage: esta exige admin.
    CREATE FUNCTION revoke_open_discipline(p_discipline bigint) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        st uuid;
        n integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        FOR st IN SELECT DISTINCT b.student_id FROM bookings b JOIN class_sessions x ON x.id = b.session_id
                   WHERE x.discipline_id = p_discipline AND x.status = 'scheduled' AND x.starts_at > now()
                     AND b.status <> 'cancelled' LOOP
          n := n + revoke_coverage(st);
        END LOOP;
        RETURN n;
      END
      $$;
  `);
  for (const fn of [...INTERNAL_FNS, ...PUBLIC_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(publicProfilesSql(true));
};

export const down = (pgm) => {
  pgm.sql(publicProfilesSql(false));
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(swapChangeDiscipline(CHOSEN_OPEN, CHOSEN));
  pgm.sql(publicDisciplinesSql(false));
  pgm.sql(coversSql(false));
  pgm.dropColumn('disciplines', 'is_open');

  // Como en 001.
  pgm.createTable('activity_feed', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    activity_type: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true },
    shared_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('activity_feed', ['student_id', 'shared_at'], { sort: 'DESC' });
};
