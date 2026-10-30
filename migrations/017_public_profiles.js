// migrations/017_public_profiles.js
// B13: perfiles públicos (CONTEXT § Perfil público y directorio; ADR 0010). profiles pierde la lectura pública:
// lo público se lee solo por public_profiles, que proyecta columnas fijas. El profesor solo lee a sus alumnos.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
// Quién puede ser público: alumno o profesor, adulto y con acceso propio (un hijo nunca, tampoco con 18 sin reclamar).
const ELIGIBLE = `r.role IN ('alumno', 'profesor') AND (${ADULT})
  AND EXISTS (SELECT 1 FROM auth_credentials a WHERE a.profile_id = p.id)`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;

// Fuente única de la regla y de las disciplinas: la vista y getMyProfile las usan. app_user ejecuta las funciones
// (una función en una vista se comprueba con el rol que consulta), así que se guardan solas: solo responden sobre
// uno mismo o sobre lo que la vista ya enseña.
const PUBLIC_FNS = ['can_be_public(uuid)', 'public_disciplines(uuid)'];
const FUNCTIONS = `
  CREATE FUNCTION can_be_public(p_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
                      WHERE ${AUTHED} AND p.id = p_id AND (p.id = ${UID} OR p.is_public) AND ${ELIGIBLE})
    $$;

  -- Alumno: las disciplinas que cubre su suscripción en vigor (covers, 012). Profesor: las de sus clases
  -- no retiradas como profesor habitual (sin sustituciones ni sesiones sueltas). NULL si no las enseña.
  CREATE FUNCTION public_disciplines(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
                        FILTER (WHERE d.id IS NOT NULL), '[]')
        FROM profiles p JOIN user_roles r ON r.user_id = p.id
        LEFT JOIN disciplines d ON CASE r.role
          WHEN 'alumno' THEN covers(p.id, d.id)
          ELSE EXISTS (SELECT 1 FROM classes c
                        WHERE c.trainer_id = p.id AND c.discipline_id = d.id
                          AND (c.ends_on IS NULL OR c.ends_on >= (now() AT TIME ZONE 'Europe/Madrid')::date))
        END
       WHERE p.id = p_id AND p.is_public AND ${SHOWN('disciplines')} AND can_be_public(p.id)
       GROUP BY p.id
    $$;
`;

// Owner service_role (BYPASSRLS): la vista se salta la RLS por diseño, así que solo SELECT para app_user
// (los permisos por defecto le darían también escritura, y trainer_names es actualizable).
const viewGrants = (name) => `
  REVOKE ALL ON ${name} FROM PUBLIC, app_user;
  ALTER VIEW ${name} OWNER TO service_role;
  GRANT SELECT ON ${name} TO app_user;`;

export const up = (pgm) => {
  pgm.sql(FUNCTIONS);
  for (const fn of PUBLIC_FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role;
             REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }
  pgm.sql(`
    CREATE FUNCTION teaches_student(p_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id
                        WHERE b.student_id = p_id AND s.trainer_id = ${UID})
      $$;
    ALTER FUNCTION teaches_student(uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION teaches_student(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION teaches_student(uuid) TO app_user;
  `);

  // El profesor: el suyo (id = UID) y los alumnos con alguna reserva en sus sesiones, como bookings_select (009).
  pgm.sql(`
    DROP POLICY profiles_select ON profiles;
    CREATE POLICY profiles_select ON profiles FOR SELECT TO app_user
      USING (id = ${UID} OR ${IS_ADMIN} OR (${ROLE} = 'profesor' AND teaches_student(id)));

    DROP POLICY user_roles_select ON user_roles;
    CREATE POLICY user_roles_select ON user_roles FOR SELECT TO app_user
      USING (user_id = ${UID} OR ${IS_ADMIN});

    DROP POLICY profiles_update_guardian ON profiles;
    CREATE POLICY profiles_update_guardian ON profiles FOR UPDATE TO app_user
      USING (is_guardian_of(id))
      WITH CHECK (is_guardian_of(id, true) AND birth_date > CURRENT_DATE - interval '18 years' AND is_public = false);
  `);

  pgm.sql(`
    CREATE VIEW public_profiles WITH (security_barrier) AS
      SELECT p.id, p.display_name, r.role,
             CASE WHEN ${SHOWN('bio')} THEN p.bio END AS bio,
             CASE WHEN ${SHOWN('social_links')} THEN p.social_links END AS social_links,
             CASE WHEN ${SHOWN('disciplines')} THEN public_disciplines(p.id) END AS disciplines,
             CASE WHEN ${SHOWN('member_since')} THEN to_char(p.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') END
               AS member_since
        FROM profiles p JOIN user_roles r ON r.user_id = p.id
       WHERE ${AUTHED} AND p.is_public AND can_be_public(p.id);
    ${viewGrants('public_profiles')}

    -- Nombre del profesor de una sesión, público o no (parte del horario, no una ficha).
    CREATE VIEW trainer_names WITH (security_barrier) AS
      SELECT p.id, p.display_name FROM profiles p
       WHERE ${AUTHED} AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.id AND r.role = 'profesor');
    ${viewGrants('trainer_names')}
  `);

  // Por si acaso (no debería haber ninguno): nadie no elegible queda público.
  pgm.sql(`SET LOCAL ROLE service_role;
    UPDATE profiles p SET is_public = false
     WHERE p.is_public AND NOT can_be_public(p.id);
    RESET ROLE;`);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP VIEW trainer_names;
    DROP VIEW public_profiles;

    DROP POLICY profiles_update_guardian ON profiles;
    CREATE POLICY profiles_update_guardian ON profiles FOR UPDATE TO app_user
      USING (is_guardian_of(id))
      WITH CHECK (is_guardian_of(id, true) AND birth_date > CURRENT_DATE - interval '18 years');

    DROP POLICY user_roles_select ON user_roles;
    CREATE POLICY user_roles_select ON user_roles FOR SELECT TO app_user
      USING (user_id = current_setting('app.current_user_id', true)::uuid
             OR current_setting('app.current_role', true) IN ('admin','profesor'));

    DROP POLICY profiles_select ON profiles;
    CREATE POLICY profiles_select ON profiles FOR SELECT TO app_user
      USING (id = current_setting('app.current_user_id', true)::uuid
             OR is_public = true
             OR current_setting('app.current_role', true) IN ('admin','profesor'));

    DROP FUNCTION teaches_student(uuid);
  `);
  for (const fn of [...PUBLIC_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
};
