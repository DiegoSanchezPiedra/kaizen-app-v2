// migrations/031_session_taken.js
// B24.1: plazas ocupadas de una sesión (reservas confirmadas) para que el alumno vea «10/13» al reservar. Como
// event_taken (028): la RLS no le deja leer reservas ajenas, así que solo recibe la cuenta.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION session_taken(p_session uuid) RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT count(*)::integer FROM bookings WHERE session_id = p_session AND status = 'confirmed'
      $$;
    ALTER FUNCTION session_taken(uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION session_taken(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION session_taken(uuid) TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP FUNCTION session_taken(uuid);');
};
