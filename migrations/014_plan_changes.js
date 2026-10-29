// migrations/014_plan_changes.js
// B10.5: subir/bajar de plan y cambio de disciplina (CONTEXT § Suscripción; ADR 0007).
// La bajada programada (Subscription Schedule) la reflejan las columnas scheduled_*, que solo escribe el webhook.
// El cambio de disciplina no pasa por el cobro: lo escribe change_discipline, en una transacción.
/* eslint-disable camelcase */

export const shorthands = undefined;

const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const HELPER_FNS = ['discipline_change_limit()', 'discipline_changes_used(uuid)'];

export const up = (pgm) => {
  pgm.addColumns('subscriptions', {
    stripe_schedule_id: { type: 'text' },
    scheduled_plan_id: { type: 'bigint', references: 'plans' },
    scheduled_discipline_ids: { type: 'bigint[]' },
    scheduled_at: { type: 'timestamptz' }, // cuándo se aplica: el inicio de la fase 2
  });

  // Seed como service_role (ver 009). Admite 0: academy_int no, por eso change_discipline lo lee aparte.
  pgm.sql(`
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES ('discipline_changes_per_period', '1') ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);

  // Límite por periodo y cambios gastados en el periodo en curso (los gratis no cuentan). Solo devuelven
  // estado (como has_risk_cover): app_user las usa para discipline_changes_left.
  pgm.sql(`
    CREATE FUNCTION discipline_change_limit() RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT COALESCE((SELECT (value #>> '{}')::integer FROM academy_settings
                          WHERE key = 'discipline_changes_per_period' AND value #>> '{}' ~ '^[0-9]{1,9}$'), 1)
      $$;
    CREATE FUNCTION discipline_changes_used(p_subscription uuid) RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT count(*)::integer FROM audit_log a JOIN subscriptions s ON s.id = p_subscription
         WHERE a.action = 'subscription.discipline_change' AND a.resource_id = s.id::text
           AND a.changes->>'free' = 'false' AND a.created_at >= s.current_period_start
      $$;
  `);
  for (const fn of HELPER_FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }

  // Cambio de disciplina (CONTEXT § Suscripción). Interna: la llama services/billing.js con servicePool tras
  // comprobar quién actúa. Las reglas que dependen del estado van aquí, bajo lock_student (límite sin carreras).
  // Errores: RAISE con el código como mensaje; el límite lleva { limit, used, resets_at } en DETAIL.
  pgm.sql(`
    CREATE FUNCTION change_discipline(p_subscription uuid, p_from bigint, p_to bigint, p_actor uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s subscriptions;
        pl plans;
        adult boolean;
        free boolean;
        lim integer;
        used integer;
        id_ uuid;
        cancelled uuid[] := '{}';
      BEGIN
        SELECT * INTO s FROM subscriptions WHERE id = p_subscription FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
        PERFORM lock_student(s.student_id);
        IF s.status NOT IN ('active', 'past_due') THEN RAISE EXCEPTION 'subscription_not_in_force'; END IF;
        SELECT * INTO pl FROM plans WHERE id = s.plan_id;
        IF pl.max_disciplines IS NULL THEN RAISE EXCEPTION 'plan_all_disciplines'; END IF;
        IF NOT EXISTS (SELECT 1 FROM subscription_disciplines WHERE subscription_id = s.id AND discipline_id = p_from) THEN
          RAISE EXCEPTION 'discipline_not_chosen';
        END IF;
        SELECT ${ADULT} INTO adult FROM profiles p WHERE p.id = s.student_id;
        -- Destino: activa, elegible en el plan, permitida por la edad y no elegida ya (como el checkout).
        IF NOT EXISTS (
             SELECT 1 FROM disciplines d
              WHERE d.id = p_to AND d.is_active AND NOT (adult AND d.minors_only)
                AND (NOT EXISTS (SELECT 1 FROM plan_disciplines WHERE plan_id = pl.id)
                     OR EXISTS (SELECT 1 FROM plan_disciplines WHERE plan_id = pl.id AND discipline_id = p_to)))
           OR EXISTS (SELECT 1 FROM subscription_disciplines WHERE subscription_id = s.id AND discipline_id = p_to) THEN
          RAISE EXCEPTION 'discipline_not_eligible';
        END IF;

        -- Gratis si la abandonada ya no se cubre: desactivada, o solo menores para un adulto.
        SELECT NOT d.is_active OR (adult AND d.minors_only) INTO free FROM disciplines d WHERE d.id = p_from;
        IF NOT free THEN
          lim := discipline_change_limit();
          used := discipline_changes_used(s.id);
          IF used >= lim THEN
            RAISE EXCEPTION 'discipline_change_limit' USING DETAIL =
              jsonb_build_object('limit', lim, 'used', used, 'resets_at', s.current_period_end)::text;
          END IF;
        END IF;

        DELETE FROM subscription_disciplines WHERE subscription_id = s.id AND discipline_id = p_from;
        INSERT INTO subscription_disciplines (subscription_id, discipline_id) VALUES (s.id, p_to);

        -- Reservas y esperas futuras de la abandonada, con aviso (CONTEXT § Motivo de cancelación).
        -- shortcut: no promociona la espera de las plazas liberadas (como revoke_coverage); lo hará la
        -- siguiente cancelación o subida de aforo de cada sesión. Llamar a promote_waitlist aquí invertiría
        -- el orden de bloqueos (alumno → sesión) frente a book_session.
        FOR id_ IN UPDATE bookings b SET status = 'cancelled', cancel_reason = 'discipline_change',
                                         cancelled_at = now(), cancelled_by = p_actor
                     FROM class_sessions x
                    WHERE x.id = b.session_id AND b.student_id = s.student_id AND b.status <> 'cancelled'
                      AND x.discipline_id = p_from AND x.status = 'scheduled' AND x.starts_at > now()
                RETURNING b.id LOOP
          PERFORM booking_notice(id_, 'notice.discipline_change');
          cancelled := cancelled || id_;
        END LOOP;

        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), p_actor, 'subscription.discipline_change', 'subscription', s.id::text,
                jsonb_build_object('from', p_from, 'to', p_to, 'free', free, 'cancelled', to_jsonb(cancelled)));
        RETURN jsonb_build_object('free', free, 'cancelled', to_jsonb(cancelled));
      END
      $$;
    ALTER FUNCTION change_discipline(uuid, bigint, bigint, uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION change_discipline(uuid, bigint, bigint, uuid) FROM PUBLIC;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP FUNCTION change_discipline(uuid, bigint, bigint, uuid);`);
  for (const fn of [...HELPER_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(`SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key = 'discipline_changes_per_period';
    RESET ROLE;`);
  pgm.dropColumns('subscriptions', ['stripe_schedule_id', 'scheduled_plan_id', 'scheduled_discipline_ids', 'scheduled_at']);
};
