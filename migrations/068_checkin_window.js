// migrations/068_checkin_window.js
// La ventana de check-in, legible por el alumno y el tutor. La app la usa para saber cuándo ofrecer el check-in; quien
// decide si una reserva puede marcar sigue siendo check_in (con checkin_window_open). academy_int no es ejecutable por
// app_user y academy_settings es solo de admin: una función definer propia, como checkin_qr_seconds, con los mismos
// valores y los mismos por defecto que checkin_window_open.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION checkin_window() RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT jsonb_build_object('opens_minutes', academy_int('checkin_opens_minutes', 30),
                                  'closes_minutes', academy_int('checkin_closes_minutes', 10))
      $$;
    ALTER FUNCTION checkin_window() OWNER TO service_role; REVOKE ALL ON FUNCTION checkin_window() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION checkin_window() TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP FUNCTION checkin_window();`);
};
