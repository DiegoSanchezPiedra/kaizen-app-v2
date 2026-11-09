// migrations/039_no_temp_tables.js
// B20 (auditoría de RLS, M1): las funciones SECURITY DEFINER fijan search_path = public, pero PostgreSQL busca antes en
// pg_temp, y PUBLIC tenía TEMPORARY en la base: con SQL arbitrario, app_user creaba una tabla temporal que tapaba la
// real dentro de la función (comprobado con is_guardian_of). Sin TEMPORARY no hay pg_temp que tape nada, tampoco en las
// funciones que vengan. Nadie usa tablas temporales; migrator, dueño de la base, conserva el suyo.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
      -- Si migrator no fuera quien lo concedió, el REVOKE solo avisa: mejor fallar que dejarlo abierto.
      IF has_database_privilege('app_user', current_database(), 'TEMPORARY') THEN
        RAISE EXCEPTION 'app_user sigue con TEMPORARY en %', current_database();
      END IF;
    END
    $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END $$;`);
};
