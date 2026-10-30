// migrations/018_calendar_coverage.js
// B6 (calendario del alumno): si la suscripción del sujeto cubre una sesión. covers (012) solo la ejecuta
// service_role; esta la expone a app_user y se guarda sola: solo responde sobre uno mismo, un hijo vinculado
// (is_guardian_of) o, al admin, sobre cualquiera. Si no, NULL.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION session_coverage(p_student uuid, p_discipline bigint) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT CASE WHEN p_student = ${UID} OR is_guardian_of(p_student) OR ${IS_ADMIN}
                    THEN covers(p_student, p_discipline) END
      $$;
    ALTER FUNCTION session_coverage(uuid, bigint) OWNER TO service_role;
    REVOKE ALL ON FUNCTION session_coverage(uuid, bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION session_coverage(uuid, bigint) TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP FUNCTION session_coverage(uuid, bigint);`);
};
