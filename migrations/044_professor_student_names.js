// migrations/044_professor_student_names.js
// B20 (auditoría de RLS, M6): profiles_select dejaba al profesor leer la fila entera de los alumnos de sus sesiones y
// eventos (birth_date, también de menores, stripe_customer_id, bio…). CONTEXT.md le da el nombre y la foto. Ahora en
// profiles solo ve la suya, y de sus alumnos lee student_names (id, display_name, avatar), como trainer_names (017).
// La lee también el admin: la lista de una sesión (getAttendance) es de los dos.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE VIEW student_names WITH (security_barrier) AS
      SELECT p.id, p.display_name, p.avatar FROM profiles p
       WHERE ${UID} IS NOT NULL AND (${IS_ADMIN} OR (${ROLE} = 'profesor' AND teaches_student(p.id)));
    REVOKE ALL ON student_names FROM PUBLIC, app_user;
    ALTER VIEW student_names OWNER TO service_role;
    GRANT SELECT ON student_names TO app_user;

    ALTER POLICY profiles_select ON profiles USING (id = ${UID} OR ${IS_ADMIN});
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER POLICY profiles_select ON profiles
      USING (id = ${UID} OR ${IS_ADMIN} OR (${ROLE} = 'profesor' AND teaches_student(id)));
    DROP VIEW student_names;
  `);
};
