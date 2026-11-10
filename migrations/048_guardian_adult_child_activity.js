// migrations/048_guardian_adult_child_activity.js
// B20 (auditoría de RLS, B7): con is_guardian_of(…, true), el tutor de un hijo que cumplió 18 sin reclamar su perfil
// seguía viendo sus reservas, asistencia, inscripciones, acuerdos y progreso. CONTEXT § Identidad: «su tutor solo lo ve
// en la lista y paga lo que ya pagaba». Esas cuatro políticas y las dos funciones del progreso pasan a is_guardian_of(x)
// (solo un menor). Siguen con any_age la lista (profiles_select_guardian) y lo que se paga: recibos, suscripción y
// seguro. Lo que firmó él mismo lo sigue viendo como firmante (signed_by).
/* eslint-disable camelcase */
import { markSql } from './034_medal_codes.js';
import { progressSql } from './037_medals_by_discipline.js';

export const shorthands = undefined;

// Las expresiones tal como están (013, 010, 028, 004): solo cambia el argumento de is_guardian_of.
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const TRAINS = (table, fk, parent, a) =>
  `(${ROLE} = 'profesor' AND EXISTS (SELECT 1 FROM ${parent} ${a} WHERE ${a}.id = ${table}.${fk} AND ${a}.trainer_id = ${UID}))`;
const UID_004 = `(current_setting('app.current_user_id', true))::uuid`;

// anyAge: ', true' es lo de antes (down); '' solo un menor (up).
const policies = (anyAge) => `
  ALTER POLICY bookings_select ON bookings USING (student_id = ${UID} OR is_guardian_of(student_id${anyAge}) OR ${IS_ADMIN}
    OR ${TRAINS('bookings', 'session_id', 'class_sessions', 's')});
  ALTER POLICY attendance_select ON attendance USING (student_id = ${UID} OR is_guardian_of(student_id${anyAge}) OR ${IS_ADMIN}
    OR ${TRAINS('attendance', 'session_id', 'class_sessions', 's')});
  ALTER POLICY event_registrations_select ON event_registrations USING (profile_id = ${UID}
    OR is_guardian_of(profile_id${anyAge}) OR ${IS_ADMIN} OR ${TRAINS('event_registrations', 'event_id', 'events', 'e')});
  ALTER POLICY user_agreements_select ON user_agreements USING (profile_id = ${UID_004} OR signed_by = ${UID_004}
    OR ${ROLE} = 'admin' OR is_guardian_of(profile_id${anyAge}));`;

// student_progress (037) y mark_medals_seen (034) tal cual, con el tutor solo de un menor.
const minorsOnly = (sql) => {
  const out = sql.replaceAll('is_guardian_of(p_id, true)', 'is_guardian_of(p_id)');
  if (out === sql) throw new Error('048: no se encontró is_guardian_of(p_id, true)');
  return out;
};
const replaceMark = (sql) => sql.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');

export const up = (pgm) => {
  pgm.sql(policies(''));
  pgm.sql(minorsOnly(progressSql));
  pgm.sql(replaceMark(minorsOnly(markSql(true))));
};

export const down = (pgm) => {
  pgm.sql(policies(', true'));
  pgm.sql(progressSql);
  pgm.sql(replaceMark(markSql(true)));
};
