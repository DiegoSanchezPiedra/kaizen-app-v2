// migrations/041_cash_payments_closed.js
// B20 (auditoría de RLS, M3): cash_payments (001, reservada para el pago en efectivo, sin uso) no tenía RLS y app_user
// la leía y escribía entera por los privilegios por defecto. Hasta que el efectivo tenga su bloque, solo el servicePool:
// RLS en ENABLE y FORCE sin políticas y nada para app_user. No borra nada.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE cash_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cash_payments FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON cash_payments FROM app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON cash_payments TO app_user;
    ALTER TABLE cash_payments NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE cash_payments DISABLE ROW LEVEL SECURITY;
  `);
};
