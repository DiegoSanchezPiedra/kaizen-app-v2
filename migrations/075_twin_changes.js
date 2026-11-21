// migrations/075_twin_changes.js
// ADR 0034: la restricción de solape pasa a DEFERRABLE (INITIALLY IMMEDIATE, así que todo sigue igual) para que cambiar la
// hora, la duración o el lugar de una pareja de clases o sesiones simultáneas se compruebe una vez, con las dos ya movidas.
/* eslint-disable camelcase */

export const shorthands = undefined;

const recreate = (deferrable) => `
  ALTER TABLE class_sessions DROP CONSTRAINT class_sessions_trainer_no_overlap;
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_trainer_no_overlap
    EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, ends_at) WITH &&,
                        session_slot_key(starts_at, ends_at, location) WITH <>)
    WHERE (status = 'scheduled')${deferrable ? ' DEFERRABLE INITIALLY IMMEDIATE' : ''};`;

export const up = (pgm) => pgm.sql(recreate(true));
export const down = (pgm) => pgm.sql(recreate(false));
