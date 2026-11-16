// migrations/069_booking_rules.js
// El plazo de cancelación, legible por el alumno y el tutor. La app lo usa para avisar en el diálogo de cancelar de si la
// cancelación va a contar como tardía; quien decide sigue siendo cancel_booking (que además tiene exenciones: promoción dentro
// del plazo y cambio de clase). Misma clave y mismo valor por defecto (60) que cancel_booking. Función definer, como
// checkin_window (068): academy_int no es ejecutable por app_user y academy_settings es solo de admin.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION booking_rules() RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT jsonb_build_object('cancellation_notice_minutes', academy_int('cancellation_notice_minutes', 60))
      $$;
    ALTER FUNCTION booking_rules() OWNER TO service_role; REVOKE ALL ON FUNCTION booking_rules() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION booking_rules() TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP FUNCTION booking_rules();`);
};
