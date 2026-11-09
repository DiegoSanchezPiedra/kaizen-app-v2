// migrations/032_drop_academy_stats_now.js
// B24.2: el Inicio del admin ya no enseña cifras de la academia (el dinero se ve en Stripe); muestra los alumnos que
// entrenaron, en vivo desde attendance. academy_stats_now (029) se queda sin lectores y se borra. La foto diaria no cambia.
// shortcut: academy_stats_daily.mrr_cents se sigue escribiendo cada noche y ya no lo lee nadie; borrar la columna (y su
// cálculo en academy_stats_of) si no se va a volver a usar.
/* eslint-disable camelcase */

export const shorthands = undefined;

const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;

export const up = (pgm) => {
  pgm.sql('DROP FUNCTION academy_stats_now();');
};

// Como la dejó 029.
export const down = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION academy_stats_now() RETURNS academy_stats_daily
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        RETURN academy_stats_of((now() AT TIME ZONE 'Europe/Madrid')::date);
      END
      $$;
    ALTER FUNCTION academy_stats_now() OWNER TO service_role;
    REVOKE ALL ON FUNCTION academy_stats_now() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION academy_stats_now() TO app_user;
  `);
};
