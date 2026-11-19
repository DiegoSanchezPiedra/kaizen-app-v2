// migrations/074_simultaneous_sessions.js
// ADR 0034: un profesor puede dar dos sesiones a la vez (p. ej. boxeo y muay thai) si tienen la misma franja exacta y el
// mismo lugar (sin mayúsculas ni espacios en los extremos; las dos sin lugar cuentan como el mismo). El resto de solapes
// del mismo profesor sigue prohibido: chocan si la franja o el lugar no coinciden.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  // IMMUTABLE de verdad: el epoch de un timestamptz no depende de la zona (to_char/::text sí, y no valen en un índice).
  pgm.sql(`
    CREATE FUNCTION session_slot_key(p_starts timestamptz, p_ends timestamptz, p_location text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$ SELECT extract(epoch FROM p_starts)::text || '|' || extract(epoch FROM p_ends)::text || '|'
                   || lower(btrim(coalesce(p_location, ''))) $$;

    ALTER TABLE class_sessions DROP CONSTRAINT class_sessions_trainer_no_overlap;
    ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_trainer_no_overlap
      EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, ends_at) WITH &&,
                          session_slot_key(starts_at, ends_at, location) WITH <>)
      WHERE (status = 'scheduled');
  `);
};

// Falla si ya hay sesiones simultáneas programadas: hay que cancelar o mover una antes de bajar.
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE class_sessions DROP CONSTRAINT class_sessions_trainer_no_overlap;
    ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_trainer_no_overlap
      EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
      WHERE (status = 'scheduled');
    DROP FUNCTION session_slot_key(timestamptz, timestamptz, text);
  `);
};
