// migrations/050_classes_professor_scope.js
// B20 (auditoría de RLS, B10): classes_select (008) dejaba a cualquier autenticado ver todo el horario, también al
// profesor, que en el calendario solo ve sus sesiones (CONTEXT § Clases y sesiones). Ahora el profesor ve sus clases y las
// de las sesiones que imparte como sustituto: su informe por clase (reports.js) lee la clase, el día y el profesor
// habitual. El resto de roles, igual.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER POLICY classes_select ON classes USING (${AUTHED} AND (current_setting('app.current_role', true) <> 'profesor'
      OR trainer_id = ${UID}
      OR EXISTS (SELECT 1 FROM class_sessions s WHERE s.class_id = classes.id AND s.trainer_id = ${UID})));
  `);
};

export const down = (pgm) => {
  pgm.sql(`ALTER POLICY classes_select ON classes USING (${AUTHED});`);
};
