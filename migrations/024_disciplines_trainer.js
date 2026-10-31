// migrations/024_disciplines_trainer.js
// B17: el profesor ve también las disciplinas de sus sesiones, aunque estén desactivadas. Sin esto, con el client
// RLS, sus sesiones pasadas de una disciplina desactivada se caen por el JOIN de sus informes y de /professor/sessions.
// Permisiva, junto a disciplines_select (007) y disciplines_select_subscribed (012). El nombre no es dato sensible.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE POLICY disciplines_select_trainer ON disciplines FOR SELECT TO app_user
      USING (${ROLE} = 'profesor'
             AND EXISTS (SELECT 1 FROM class_sessions s WHERE s.discipline_id = disciplines.id AND s.trainer_id = ${UID}));
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP POLICY disciplines_select_trainer ON disciplines;`);
};
