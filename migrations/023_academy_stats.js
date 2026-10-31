// migrations/023_academy_stats.js
// B16: foto diaria de las suscripciones (CONTEXT § Informes; ADR 0012). student_stats_daily se borra (la asistencia se
// calcula al leer) y academy_stats_daily se rehace solo con lo irrecuperable: el estado de las suscripciones de cada
// día de Madrid. La escribe scripts/nightly.js con servicePool; app_user solo lee, y solo el admin (lleva dinero).
/* eslint-disable camelcase */

export const shorthands = undefined;

const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const TZ = 'Europe/Madrid';
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;
const FNS = ['academy_stats_of(date)', 'snapshot_academy_stats(date)'];
const COUNT = { type: 'integer', notNull: true };

export const up = (pgm) => {
  pgm.dropTable('student_stats_daily');
  pgm.dropTable('academy_stats_daily'); // vacía: nadie escribía en ella
  pgm.createTable('academy_stats_daily', {
    date: { type: 'date', primaryKey: true }, // día de Madrid
    active: COUNT,
    past_due: COUNT,
    unpaid: COUNT,
    new_subscriptions: COUNT, // altas
    cancelled_subscriptions: COUNT, // bajas
    mrr_cents: COUNT,
  });
  pgm.sql(`
    ALTER TABLE academy_stats_daily ENABLE ROW LEVEL SECURITY;
    ALTER TABLE academy_stats_daily FORCE ROW LEVEL SECURITY;
    CREATE POLICY academy_stats_daily_select ON academy_stats_daily FOR SELECT TO app_user USING (${IS_ADMIN});
    REVOKE ALL ON academy_stats_daily FROM app_user;
    GRANT SELECT ON academy_stats_daily TO app_user;

    -- La fila de p_date con el estado de ahora. Interna: sin el límite de fecha de la foto (lo prueba test:nightly en
    -- los cambios de hora). Un traspaso (payer_changes completed) no es ni alta ni baja: la cobertura sigue.
    -- shortcut: el MRR usa el precio actual del plan, aunque tras un cambio de precio la suscripción pague el viejo
    -- hasta renovar (error de un mes como mucho); guardar el precio en la suscripción si hace falta el MRR exacto.
    CREATE FUNCTION academy_stats_of(p_date date) RETURNS academy_stats_daily
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT p_date,
             count(*) FILTER (WHERE s.status = 'active')::integer,
             count(*) FILTER (WHERE s.status = 'past_due')::integer,
             count(*) FILTER (WHERE s.status = 'unpaid')::integer,
             count(*) FILTER (WHERE s.created_at >= d.t0 AND s.created_at < d.t1
                               AND NOT EXISTS (SELECT 1 FROM payer_changes pc WHERE pc.status = 'completed'
                                                  AND pc.stripe_subscription_id = s.stripe_subscription_id))::integer,
             count(*) FILTER (WHERE s.cancelled_at >= d.t0 AND s.cancelled_at < d.t1
                               AND NOT EXISTS (SELECT 1 FROM payer_changes pc WHERE pc.status = 'completed'
                                                  AND pc.subscription_id = s.id))::integer,
             COALESCE(sum(p.price_cents) FILTER (WHERE s.status IN ('active', 'past_due')), 0)::integer
        FROM (SELECT p_date::timestamp AT TIME ZONE '${TZ}' AS t0,
                     (p_date + 1)::timestamp AT TIME ZONE '${TZ}' AS t1) d
       CROSS JOIN subscriptions s
        JOIN plans p ON p.id = s.plan_id
      $$;

    -- Foto de p_date (ayer u hoy de Madrid). Gana la primera y no cambia nunca: true si la ha creado ahora.
    CREATE FUNCTION snapshot_academy_stats(p_date date) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF p_date IS NULL OR p_date NOT IN (${TODAY}, ${TODAY} - 1) THEN RAISE EXCEPTION 'invalid_date'; END IF;
        INSERT INTO academy_stats_daily SELECT * FROM academy_stats_of(p_date) ON CONFLICT (date) DO NOTHING;
        RETURN FOUND;
      END
      $$;
  `);
  // Sin EXECUTE para app_user: solo la llama el job con servicePool.
  for (const fn of FNS) pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
};

export const down = (pgm) => {
  for (const fn of [...FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.dropTable('academy_stats_daily');
  // Como en 001.
  pgm.createTable('academy_stats_daily', {
    date: { type: 'date', primaryKey: true, notNull: true },
    active_students: { type: 'integer' },
    new_students: { type: 'integer' },
    cancelled_students: { type: 'integer' },
    mrr_cents: { type: 'integer' },
    occupancy_rate: { type: 'numeric' },
  });
  pgm.createTable('student_stats_daily', {
    student_id: { type: 'uuid', notNull: true },
    date: { type: 'date', notNull: true },
    classes_attended: { type: 'integer' },
    streak_weeks: { type: 'integer' },
  });
  pgm.addConstraint('student_stats_daily', 'student_stats_daily_pkey', { primaryKey: ['student_id', 'date'] });
  pgm.addConstraint('student_stats_daily', 'student_stats_daily_student_id_fkey', {
    foreignKeys: [{ columns: 'student_id', references: 'profiles(id)', onDelete: 'CASCADE' }],
  });
};
