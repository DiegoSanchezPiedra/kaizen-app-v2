// migrations/012_billing.js
// B10 + B10.1: suscripciones y recibos de Stripe (CONTEXT § Suscripción, § Cobros; plan-de-bloques B10).
// Solo el webhook (servicePool) escribe subscriptions, subscription_disciplines, invoices y webhook_events.
// 'grace_period' y 'pending_cash' quedan en el enum sin uso: la gracia es 'past_due' y el efectivo está reservado.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
// Vínculo histórico (D16): el tutor sigue viendo cobros y suscripciones del hijo ya adulto.
const OWNS_STUDENT = `(student_id = ${UID} OR is_guardian_of(student_id, true))`;
const LIVE = `('active', 'past_due', 'unpaid')`;

// Cubrir (009) con «en vigor» = active + past_due. statuses distingue up/down.
const coversSql = (statuses) => `
  CREATE OR REPLACE FUNCTION covers(p_student uuid, p_discipline bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (
        SELECT 1
          FROM subscriptions s
          JOIN plans pl ON pl.id = s.plan_id
          JOIN profiles p ON p.id = s.student_id
          JOIN disciplines d ON d.id = p_discipline AND d.is_active
         WHERE s.student_id = p_student
           AND s.status IN ${statuses}
           AND (NOT (${ADULT}) OR NOT (d.minors_only OR pl.minors_only))
           AND CASE WHEN pl.max_disciplines IS NULL
                    -- «todas»: lista de elegibles vacía = cualquiera
                    THEN NOT EXISTS (SELECT 1 FROM plan_disciplines pd WHERE pd.plan_id = pl.id)
                      OR EXISTS (SELECT 1 FROM plan_disciplines pd
                                  WHERE pd.plan_id = pl.id AND pd.discipline_id = d.id)
                    ELSE EXISTS (SELECT 1 FROM subscription_disciplines sd
                                  WHERE sd.subscription_id = s.id AND sd.discipline_id = d.id)
               END
      )
    $$;
`;

// is_guardian_of (006). up: NULLIF para que una sesión vacía ('') no rompa el cast a uuid,
// ahora que la RLS de plans/disciplines la evalúa también para quien no tiene sesión.
const guardianSql = (uid) => `
  CREATE OR REPLACE FUNCTION is_guardian_of(p_id uuid, any_age boolean DEFAULT false) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (
        SELECT 1 FROM guardianships g JOIN profiles p ON p.id = g.minor_id
         WHERE g.tutor_id = ${uid} AND g.minor_id = p_id
           AND (any_age OR NOT (${ADULT}))
      )
    $$;
`;

export const up = (pgm) => {
  // Un valor nuevo de enum no se puede usar en la transacción que lo crea: ADD VALUE va suelto
  // y el resto en su propia transacción. Si algo falla, 'unpaid' se queda (IF NOT EXISTS permite reintentar).
  pgm.noTransaction();
  // shortcut: ADD VALUE no es reversible; el down deja 'unpaid' en el enum (inofensivo).
  pgm.sql(`ALTER TYPE sub_status ADD VALUE IF NOT EXISTS 'unpaid';`);
  pgm.sql('BEGIN;');

  pgm.sql(guardianSql(UID));

  // Cliente de Stripe del pagador. Un cus_ no es una credencial: no se oculta por columna, pero ningún servicio lo devuelve.
  pgm.addColumn('profiles', { stripe_customer_id: { type: 'text', unique: true } });

  // Tablas vacías al aplicar (B10 es la primera que las escribe): NOT NULL sin backfill.
  pgm.sql(`ALTER TABLE subscriptions ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
  pgm.dropIndex('subscriptions', 'stripe_subscription_id');
  pgm.alterColumn('subscriptions', 'stripe_subscription_id', { notNull: true });
  pgm.addConstraint('subscriptions', 'subscriptions_stripe_subscription_id_key', {
    unique: ['stripe_subscription_id'],
  });
  // Suscripción viva: como máximo una por alumno. El webhook resuelve la carrera de checkouts al chocar aquí.
  pgm.createIndex('subscriptions', 'student_id', {
    unique: true, where: `status IN ${LIVE}`, name: 'subscriptions_one_live_idx',
  });

  pgm.sql(`
    ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
    CREATE POLICY subscriptions_select ON subscriptions FOR SELECT TO app_user
      USING (${OWNS_STUDENT} OR payer_id = ${UID} OR ${IS_ADMIN});
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON subscriptions FROM app_user;
    GRANT SELECT ON subscriptions TO app_user;

    ALTER TABLE subscription_disciplines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE subscription_disciplines FORCE ROW LEVEL SECURITY;
    -- La RLS de subscriptions filtra el EXISTS.
    CREATE POLICY subscription_disciplines_select ON subscription_disciplines FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = subscription_id));
    GRANT SELECT ON subscription_disciplines TO app_user;

    -- Pendiente de B5: el suscriptor sigue viendo su plan y sus disciplinas aunque se retiren.
    CREATE POLICY plans_select_subscribed ON plans FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM subscriptions s WHERE s.plan_id = plans.id AND s.status IN ${LIVE}));
    CREATE POLICY disciplines_select_subscribed ON disciplines FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM subscription_disciplines sd JOIN subscriptions s ON s.id = sd.subscription_id
                      WHERE sd.discipline_id = disciplines.id AND s.status IN ${LIVE}));
  `);

  pgm.sql(coversSql(`('active', 'past_due')`));

  // Pérdida de cobertura (CONTEXT § Reservas): la llama el webhook al pasar a unpaid o cancelled.
  // Cancela reservas y esperas futuras que ya no cubre ninguna suscripción en vigor; no vuelven al pagar.
  pgm.sql(`
    CREATE FUNCTION revoke_coverage(p_student uuid) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        id_ uuid;
        n integer := 0;
      BEGIN
        PERFORM lock_student(p_student);
        FOR id_ IN UPDATE bookings b SET status = 'cancelled', cancel_reason = 'no_coverage',
                                         cancelled_at = now(), cancelled_by = ${UID}
                     FROM class_sessions x
                    WHERE x.id = b.session_id AND b.student_id = p_student AND b.status <> 'cancelled'
                      AND x.status = 'scheduled' AND x.starts_at > now()
                      AND NOT covers(p_student, x.discipline_id)
                RETURNING b.id LOOP
          PERFORM booking_notice(id_, 'notice.no_coverage');
          n := n + 1;
        END LOOP;
        RETURN n;
      END
      $$;
    ALTER FUNCTION revoke_coverage(uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION revoke_coverage(uuid) FROM PUBLIC;
  `);

  // Recibos (B10.1). subscription_id nullable: los del seguro (B10.3) no tienen suscripción.
  pgm.sql(`ALTER TABLE invoices ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
  pgm.alterColumn('invoices', 'stripe_invoice_id', { notNull: true });
  pgm.renameColumn('invoices', 'paid_cents', 'amount_paid_cents');
  pgm.dropColumn('invoices', 'external_pdf_url');
  pgm.addColumns('invoices', {
    payer_id: { type: 'uuid', notNull: true, references: 'profiles' },
    period_start: { type: 'timestamptz' },
    period_end: { type: 'timestamptz' },
    currency: { type: 'text' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    next_payment_attempt: { type: 'timestamptz' },
    last_payment_error: { type: 'text' },
    hosted_invoice_url: { type: 'text' },
    invoice_pdf: { type: 'text' },
  });
  pgm.addConstraint('invoices', 'invoices_status_check', {
    check: `status IN ('draft', 'open', 'paid', 'uncollectible', 'void')`,
  });
  pgm.createIndex('invoices', 'payer_id');
  pgm.createIndex('invoices', 'subscription_id');

  pgm.sql(`
    ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
    -- El profesor no ve recibos.
    CREATE POLICY invoices_select ON invoices FOR SELECT TO app_user
      USING (${OWNS_STUDENT} OR payer_id = ${UID} OR ${IS_ADMIN});
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON invoices FROM app_user;
    GRANT SELECT ON invoices TO app_user;

    REVOKE ALL ON webhook_events FROM app_user;
  `);

  pgm.sql('COMMIT;');
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events, invoices, subscriptions TO app_user;
    DROP POLICY invoices_select ON invoices;
    ALTER TABLE invoices NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropIndex('invoices', 'subscription_id');
  pgm.dropIndex('invoices', 'payer_id');
  pgm.dropConstraint('invoices', 'invoices_status_check');
  pgm.dropColumns('invoices', [
    'payer_id', 'period_start', 'period_end', 'currency', 'attempt_count', 'next_payment_attempt',
    'last_payment_error', 'hosted_invoice_url', 'invoice_pdf',
  ]);
  pgm.addColumn('invoices', { external_pdf_url: { type: 'text' } });
  pgm.renameColumn('invoices', 'amount_paid_cents', 'paid_cents');
  pgm.alterColumn('invoices', 'stripe_invoice_id', { notNull: false });
  pgm.sql(`ALTER TABLE invoices ALTER COLUMN id DROP DEFAULT;`);

  pgm.sql(`DROP FUNCTION revoke_coverage(uuid);`);
  // Vuelve el mapeo provisional de 009; falla si alguna fila usa 'unpaid' (no existía antes).
  pgm.sql(coversSql(`('active', 'pending_cash', 'grace_period')`));

  pgm.sql(`
    DROP POLICY disciplines_select_subscribed ON disciplines;
    DROP POLICY plans_select_subscribed ON plans;
    DROP POLICY subscription_disciplines_select ON subscription_disciplines;
    ALTER TABLE subscription_disciplines NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE subscription_disciplines DISABLE ROW LEVEL SECURITY;
    REVOKE ALL ON subscription_disciplines FROM app_user;
    DROP POLICY subscriptions_select ON subscriptions;
    ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE subscriptions DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropIndex('subscriptions', 'student_id', { name: 'subscriptions_one_live_idx' });
  pgm.dropConstraint('subscriptions', 'subscriptions_stripe_subscription_id_key');
  pgm.alterColumn('subscriptions', 'stripe_subscription_id', { notNull: false });
  pgm.createIndex('subscriptions', 'stripe_subscription_id');
  pgm.sql(`ALTER TABLE subscriptions ALTER COLUMN id DROP DEFAULT;`);

  pgm.dropColumn('profiles', 'stripe_customer_id');
  pgm.sql(guardianSql(`current_setting('app.current_user_id', true)::uuid`));
};
