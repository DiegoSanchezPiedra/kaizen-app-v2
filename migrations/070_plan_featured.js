// migrations/070_plan_featured.js
// Plan destacado («Recomendado» al contratar): lo elige el admin en Membresías. Como mucho uno a la vez;
// marcar otro desmarca el anterior en la misma transacción (catalog.js).
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE plans ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX plans_one_featured ON plans ((true)) WHERE is_featured;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX plans_one_featured; ALTER TABLE plans DROP COLUMN is_featured;`);
};
