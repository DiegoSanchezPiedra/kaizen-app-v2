// migrations/007_catalog.js
// Catálogo (ADR 0003): el plan fija cuántas disciplinas; plan_disciplines = disciplinas elegibles.
/* eslint-disable camelcase */

export const shorthands = undefined;

const IS_ADMIN = `current_setting('app.current_role', true) = 'admin'`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;

export const up = (pgm) => {
  // Filas heredadas con NULL: se rellenan antes de exigir NOT NULL.
  pgm.sql(`
    UPDATE disciplines SET is_active = true WHERE is_active IS NULL;
    UPDATE plans SET is_active = true WHERE is_active IS NULL;
    UPDATE plans SET billing_period = 'monthly' WHERE billing_period IS NULL;
    UPDATE plans SET price_cents = 0 WHERE price_cents IS NULL;
  `);

  // ids generados por la BD; ALWAYS rechaza ids a mano (seeds: OVERRIDING SYSTEM VALUE + setval).
  for (const t of ['disciplines', 'plans']) {
    pgm.sql(`
      ALTER TABLE ${t} ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
      SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${t};
    `);
  }

  pgm.alterColumn('disciplines', 'is_active', { notNull: true, default: true });
  pgm.addColumn('disciplines', { minors_only: { type: 'boolean', notNull: true, default: false } });

  pgm.alterColumn('plans', 'is_active', { notNull: true, default: true });
  pgm.alterColumn('plans', 'price_cents', { notNull: true });
  pgm.alterColumn('plans', 'billing_period', { notNull: true, default: 'monthly' });
  pgm.addColumns('plans', {
    max_disciplines: { type: 'integer' }, // NULL = todas
    minors_only: { type: 'boolean', notNull: true, default: false },
    stripe_price_id: { type: 'text', unique: true }, // lo rellena B10
  });
  pgm.addConstraint('plans', 'plans_price_cents_check', { check: 'price_cents >= 0' });
  pgm.addConstraint('plans', 'plans_max_disciplines_check', {
    check: 'max_disciplines IS NULL OR max_disciplines >= 1',
  });
  // CHECK y no ENUM: ADD VALUE no es reversible.
  pgm.addConstraint('plans', 'plans_billing_period_check', { check: "billing_period IN ('monthly')" });
  pgm.addConstraint('plans', 'plans_name_key', { unique: ['name'] });

  pgm.addConstraint('plan_disciplines', 'plan_disciplines_plan_id_fkey', {
    foreignKeys: [{ columns: 'plan_id', references: 'plans(id)', onDelete: 'RESTRICT' }],
  });
  pgm.addConstraint('plan_disciplines', 'plan_disciplines_discipline_id_fkey', {
    foreignKeys: [{ columns: 'discipline_id', references: 'disciplines(id)', onDelete: 'RESTRICT' }],
  });
  pgm.createIndex('plan_disciplines', 'discipline_id');

  for (const t of ['disciplines', 'plans']) {
    pgm.sql(`
      ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_select ON ${t} FOR SELECT TO app_user
        USING (${AUTHED} AND (is_active OR ${IS_ADMIN}));
      CREATE POLICY ${t}_insert_admin ON ${t} FOR INSERT TO app_user WITH CHECK (${IS_ADMIN});
      CREATE POLICY ${t}_update_admin ON ${t} FOR UPDATE TO app_user
        USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});
      REVOKE DELETE ON ${t} FROM app_user;
    `);
  }
  // shortcut: el alumno con suscripción en un plan/disciplina retirado aún no lo ve; se añade en B10 con RLS de subscriptions.

  pgm.sql(`
    ALTER TABLE plan_disciplines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_disciplines FORCE ROW LEVEL SECURITY;
    CREATE POLICY plan_disciplines_select ON plan_disciplines FOR SELECT TO app_user
      USING (${AUTHED});
    CREATE POLICY plan_disciplines_insert_admin ON plan_disciplines FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN});
    CREATE POLICY plan_disciplines_delete_admin ON plan_disciplines FOR DELETE TO app_user
      USING (${IS_ADMIN});
    GRANT SELECT, INSERT, DELETE ON plan_disciplines TO app_user;
    GRANT SELECT, INSERT, UPDATE ON disciplines, plans TO app_user;
  `);
};

export const down = (pgm) => {
  for (const t of ['plan_disciplines', 'disciplines', 'plans']) {
    pgm.sql(`
      DROP POLICY IF EXISTS ${t}_select ON ${t};
      DROP POLICY IF EXISTS ${t}_insert_admin ON ${t};
      DROP POLICY IF EXISTS ${t}_update_admin ON ${t};
      DROP POLICY IF EXISTS ${t}_delete_admin ON ${t};
      ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;
    `);
  }
  pgm.dropIndex('plan_disciplines', 'discipline_id');
  pgm.dropConstraint('plan_disciplines', 'plan_disciplines_discipline_id_fkey');
  pgm.dropConstraint('plan_disciplines', 'plan_disciplines_plan_id_fkey');
  pgm.dropConstraint('plans', 'plans_name_key');
  pgm.dropConstraint('plans', 'plans_billing_period_check');
  pgm.dropConstraint('plans', 'plans_max_disciplines_check');
  pgm.dropConstraint('plans', 'plans_price_cents_check');
  pgm.dropColumns('plans', ['max_disciplines', 'minors_only', 'stripe_price_id']);
  pgm.alterColumn('plans', 'billing_period', { notNull: false, default: null });
  pgm.alterColumn('plans', 'price_cents', { notNull: false });
  pgm.alterColumn('plans', 'is_active', { notNull: false, default: null });
  pgm.dropColumn('disciplines', 'minors_only');
  pgm.alterColumn('disciplines', 'is_active', { notNull: false, default: null });
  pgm.sql(`
    ALTER TABLE disciplines ALTER COLUMN id DROP IDENTITY;
    ALTER TABLE plans ALTER COLUMN id DROP IDENTITY;
  `);
};
