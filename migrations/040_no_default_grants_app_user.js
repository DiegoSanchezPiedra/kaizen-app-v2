// migrations/040_no_default_grants_app_user.js
// B20 (auditoría de RLS, M2): init-roles.sh da a app_user SELECT, INSERT, UPDATE y DELETE en toda tabla (y SELECT, USAGE
// en toda secuencia) que cree migrator. Así se colaron events (028), cash_payments y pgmigrations. Las 001–039 dependen
// de ese privilegio por defecto en una base nueva, así que se quita aquí, después de ellas, y no en init-roles.sh.
// Desde esta migración, cada tabla nueva da a app_user sus permisos explícitamente (GRANT … TO app_user).
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public REVOKE SELECT, USAGE ON SEQUENCES FROM app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO app_user;
  `);
};
