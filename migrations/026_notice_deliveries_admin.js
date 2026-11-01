// migrations/026_notice_deliveries_admin.js
// B19.0: el panel lee las entregas fallidas. notice_deliveries pasa a tener RLS con lectura solo para el admin;
// escribir sigue siendo solo del servidor (servicePool, BYPASSRLS).
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE notice_deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notice_deliveries FORCE ROW LEVEL SECURITY;
    CREATE POLICY notice_deliveries_select_admin ON notice_deliveries FOR SELECT TO app_user
      USING (current_setting('app.current_role', true) = 'admin');
    GRANT SELECT ON notice_deliveries TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON notice_deliveries FROM app_user;
    DROP POLICY notice_deliveries_select_admin ON notice_deliveries;
    ALTER TABLE notice_deliveries NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE notice_deliveries DISABLE ROW LEVEL SECURITY;
  `);
};
