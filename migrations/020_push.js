// migrations/020_push.js
// B15: push de los avisos de reservas y de re-firma, con email de respaldo (CONTEXT § Avisos, ADR 0011).
// El canal se decide al crear el aviso (enqueue_notice): push si el destinatario tiene algún dispositivo de push,
// si no email. El worker (services/notices.js) reparte cada entrega push entre todos sus dispositivos.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const LIVE = `('active', 'past_due', 'unpaid')`;

const INTERNAL_FNS = ['enqueue_notice(uuid, uuid[], uuid)'];
const PUBLIC_FNS = ['save_push_subscription(text, text, text)', 'agreement_notice(uuid)'];

// booking_notice (009). up: guarda expires_at y crea las entregas, una vez por acción y alumno en la transacción.
const bookingNoticeSql = (push) => (push ? `
  CREATE OR REPLACE FUNCTION booking_notice(p_booking uuid, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      b record;
      rcpts uuid[];
      first boolean;
      aid uuid := gen_random_uuid();
    BEGIN
      SELECT bk.id, bk.session_id, bk.student_id, x.starts_at INTO b
        FROM bookings bk JOIN class_sessions x ON x.id = bk.session_id WHERE bk.id = p_booking;
      IF NOT FOUND THEN RETURN; END IF;
      rcpts := COALESCE((SELECT array_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = b.student_id),
                        ARRAY[b.student_id]);
      -- Agrupar: now() es constante en la transacción; el worker compone uno con todas las del grupo.
      first := NOT EXISTS (SELECT 1 FROM audit_log a
                            WHERE a.created_at = now() AND a.resource_type = 'booking' AND a.action = p_action
                              AND a.changes->>'student_id' = b.student_id::text);
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (aid, COALESCE(${UID}, b.student_id), p_action, 'booking', b.id::text,
              jsonb_build_object('session_id', b.session_id, 'student_id', b.student_id,
                                 'recipients', to_jsonb(rcpts), 'expires_at', b.starts_at));
      IF first THEN PERFORM enqueue_notice(aid, rcpts, ${UID}); END IF;
    END
    $$;
` : `
  CREATE OR REPLACE FUNCTION booking_notice(p_booking uuid, p_action text) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      SELECT gen_random_uuid(), COALESCE(${UID}, b.student_id), p_action, 'booking', b.id::text,
             jsonb_build_object('session_id', b.session_id, 'student_id', b.student_id, 'recipients',
               COALESCE((SELECT jsonb_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = b.student_id),
                        jsonb_build_array(b.student_id)))
        FROM bookings b WHERE b.id = p_booking
    $$;
`);

// push_subscriptions como en 001 (vacía, sin RLS ni FK).
const legacyTable = (pgm) => {
  pgm.createTable('push_subscriptions', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    user_id: { type: 'uuid', notNull: true },
    endpoint: { type: 'text', notNull: true },
    keys: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('push_subscriptions', 'user_id');
};

export const up = (pgm) => {
  pgm.dropTable('push_subscriptions');
  pgm.createTable('push_subscriptions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    profile_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    endpoint: { type: 'text', notNull: true, unique: true },
    p256dh: { type: 'text', notNull: true },
    auth: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('push_subscriptions', 'profile_id');
  pgm.sql(`
    ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
    -- Cada uno ve y da de baja los suyos; el alta (y el traspaso) solo por save_push_subscription.
    CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT TO app_user USING (profile_id = ${UID});
    CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE TO app_user USING (profile_id = ${UID});
    REVOKE ALL ON push_subscriptions FROM app_user;
    GRANT SELECT, DELETE ON push_subscriptions TO app_user;
  `);

  pgm.dropConstraint('notice_deliveries', 'notice_deliveries_channel_check');
  pgm.addConstraint('notice_deliveries', 'notice_deliveries_channel_check', { check: `channel IN ('email', 'push')` });
  // La búsqueda del grupo en booking_notice (created_at = now()).
  pgm.createIndex('audit_log', 'created_at', { where: `resource_type = 'booking'`, name: 'audit_log_booking_created_idx' });

  pgm.sql(`
    -- Alta o traspaso de un dispositivo de push: el endpoint pasa al usuario actual (móvil compartido, ADR 0011).
    CREATE FUNCTION save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF ${UID} IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES (${UID}, p_endpoint, p_p256dh, p_auth)
        ON CONFLICT (endpoint) DO UPDATE
          SET profile_id = EXCLUDED.profile_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now();
      END
      $$;

    -- Entregas de un aviso (CONTEXT § Avisos): sin admins, profesores ni el actor; push si tiene algún
    -- dispositivo de push, si no email (respaldo). No se vuelve a decidir al enviar.
    CREATE FUNCTION enqueue_notice(p_audit uuid, p_recipients uuid[], p_actor uuid) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO notice_deliveries (audit_id, recipient_id, channel)
        SELECT p_audit, r, CASE WHEN EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.profile_id = r)
                                THEN 'push' ELSE 'email' END
          FROM unnest(p_recipients) r
         WHERE r IS DISTINCT FROM p_actor
           AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = r AND role IN ('admin', 'profesor'))
        ON CONFLICT DO NOTHING
      $$;

    -- Re-firma (CONTEXT § Aviso de re-firma), en la transacción que publica el documento. Destinatarios: quien
    -- firmó la versión retirada (la firma que contaba: el adulto o, por un menor, sus tutores) y sigue con una
    -- suscripción viva; el tutor por su data_protection, si algún hijo la tiene. Sin el waiver de quien tiene
    -- el seguro en vigor. El hijo con 18 sin reclamar queda fuera solo: su firma era de un tutor.
    CREATE FUNCTION agreement_notice(p_document uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        d agreement_documents;
        prev text;
        rcpts uuid[];
        aid uuid := gen_random_uuid();
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO d FROM agreement_documents
         WHERE id = p_document AND published_at IS NOT NULL AND retired_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'document_not_current' USING ERRCODE = '22023'; END IF;
        SELECT version INTO prev FROM agreement_documents
         WHERE type = d.type AND id <> d.id AND retired_at IS NOT NULL ORDER BY retired_at DESC LIMIT 1;
        IF prev IS NULL THEN RETURN; END IF;

        WITH s AS (
          SELECT DISTINCT p.id, ua.signed_by = p.id AS self
            FROM user_agreements ua JOIN profiles p ON p.id = ua.profile_id
           WHERE ua.type = d.type AND ua.version = prev AND (ua.signed_by = p.id) = (${ADULT})
             AND NOT (d.type = 'waiver' AND EXISTS (
                   SELECT 1 FROM insurances i WHERE i.student_id = p.id AND i.status IN ('active', 'past_due')))
             AND (EXISTS (SELECT 1 FROM subscriptions x WHERE x.student_id = p.id AND x.status IN ${LIVE})
                  OR (d.type = 'data_protection' AND EXISTS (
                        SELECT 1 FROM guardianships g JOIN subscriptions x ON x.student_id = g.minor_id
                         WHERE g.tutor_id = p.id AND x.status IN ${LIVE})))
        )
        SELECT COALESCE(array_agg(DISTINCT r), '{}') INTO rcpts FROM (
          SELECT s.id AS r FROM s WHERE s.self
          UNION SELECT g.tutor_id FROM s JOIN guardianships g ON g.minor_id = s.id WHERE NOT s.self
        ) x;

        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (aid, ${UID}, 'notice.agreement_published', 'agreement_document', d.id::text,
                jsonb_build_object('type', d.type, 'version', d.version, 'previous_version', prev,
                                   'recipients', to_jsonb(rcpts)));
        PERFORM enqueue_notice(aid, rcpts, ${UID});
      END
      $$;
  `);
  for (const fn of [...INTERNAL_FNS, ...PUBLIC_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(bookingNoticeSql(true));
};

export const down = (pgm) => {
  pgm.sql(bookingNoticeSql(false));
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.dropIndex('audit_log', 'created_at', { name: 'audit_log_booking_created_idx' });
  // Falla si hay entregas push: borrarlas antes de bajar.
  pgm.dropConstraint('notice_deliveries', 'notice_deliveries_channel_check');
  pgm.addConstraint('notice_deliveries', 'notice_deliveries_channel_check', { check: `channel IN ('email')` });
  pgm.dropTable('push_subscriptions');
  legacyTable(pgm);
};
