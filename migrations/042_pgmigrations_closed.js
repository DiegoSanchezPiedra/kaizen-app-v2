// migrations/042_pgmigrations_closed.js
// B20 (auditoría de RLS, M4): app_user tenía todos los permisos en pgmigrations (privilegios por defecto): con SQL
// arbitrario se podía marcar como aplicada una migración de seguridad, que ya no se ejecutaría, o borrar el historial.
// Solo la toca migrator, su dueño. Sin RLS: FORCE se la aplicaría también a migrator.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`REVOKE ALL ON pgmigrations, pgmigrations_id_seq FROM app_user;`);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON pgmigrations TO app_user;
    GRANT SELECT, USAGE ON pgmigrations_id_seq TO app_user;
  `);
};
