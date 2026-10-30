// migrations/016_payer_changes.js
// B11: cambio de pagador pendiente (CONTEXT § Suscripción; ADR 0009). La sucesora sale de un Checkout con
// billing_cycle_anchor = D y su fila en subscriptions nace en el traspaso; hasta entonces el pedido vive aquí.
// Lo escriben el servicio y el webhook con servicePool; app_user solo lee (como insurances).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;

export const up = (pgm) => {
  pgm.createTable('payer_changes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    subscription_id: { type: 'uuid', notNull: true, references: 'subscriptions' },
    student_id: { type: 'uuid', notNull: true, references: 'profiles' },
    old_payer_id: { type: 'uuid', notNull: true, references: 'profiles' },
    new_payer_id: { type: 'uuid', notNull: true, references: 'profiles' },
    // Lo que la antigua tendría en D: la bajada programada o el plan y las disciplinas actuales.
    plan_id: { type: 'bigint', notNull: true, references: 'plans' },
    discipline_ids: { type: 'bigint[]', notNull: true, default: '{}' },
    starts_at: { type: 'timestamptz', notNull: true }, // D: fin de periodo de la antigua y anchor de la sucesora
    deadline: { type: 'timestamptz', notNull: true }, // D − 1 h
    status: {
      type: 'text', notNull: true, default: 'requested',
      check: `status IN ('requested', 'paid', 'completed', 'expired', 'cancelled')`,
    },
    checkout_session_id: { type: 'text' }, // el último abierto (cada «Pagar» abre uno)
    stripe_subscription_id: { type: 'text', unique: true }, // la sucesora, al pagarse
    cancel_reason: { type: 'text', check: `cancel_reason IN ('admin', 'replaced', 'subscription_cancelled')` },
    created_by: { type: 'uuid', notNull: true, references: 'profiles' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Cambio pendiente: como mucho uno por suscripción.
  pgm.createIndex('payer_changes', 'subscription_id', {
    unique: true, where: `status IN ('requested', 'paid')`, name: 'payer_changes_one_pending_idx',
  });
  pgm.createIndex('payer_changes', 'new_payer_id');

  pgm.sql(`
    ALTER TABLE payer_changes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payer_changes FORCE ROW LEVEL SECURITY;
    CREATE POLICY payer_changes_select ON payer_changes FOR SELECT TO app_user
      USING (old_payer_id = ${UID} OR new_payer_id = ${UID} OR ${IS_ADMIN});
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON payer_changes FROM app_user;
    GRANT SELECT ON payer_changes TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.dropTable('payer_changes');
};
