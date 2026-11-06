// migrations/029_academy_stats_now.js
// B23: las cifras de la academia en vivo para el Inicio del admin. academy_stats_of es SECURITY DEFINER y no mira el rol
// (solo la llama el job): darle EXECUTE a app_user dejaría a cualquier alumno leer los totales. Esta la envuelve y
// solo deja pasar al admin.
/* eslint-disable camelcase */

export const shorthands = undefined;

const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;

export const up = (pgm) => {
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

export const down = (pgm) => {
  pgm.sql('DROP FUNCTION academy_stats_now();');
};
