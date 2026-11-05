// migrations/028_events.js
// B21.0: eventos e inscripciones (CONTEXT § Eventos; ADR 0018; plan § B21). Las tablas de 001 estaban vacías, sin RLS y
// con escritura para app_user por los privilegios por defecto: se borran y se crean de nuevo. Toda escritura de
// inscripciones pasa por funciones SECURITY DEFINER o por el webhook (servicePool); app_user solo lee.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const AUTHED = `${UID} IS NOT NULL`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const TZ = 'Europe/Madrid';
const LIVE_REG = `('pending', 'confirmed')`;

const PUBLIC_FNS = [
  'register_event(uuid, uuid, boolean)', 'attach_event_checkout(uuid, text)',
  'cancel_event_registration(uuid, boolean)', 'cancel_event(uuid, text)', 'mark_event_attendance(uuid, boolean)',
  'professor_event_health(uuid)', 'event_taken(uuid)', 'event_notice(uuid, text, uuid, jsonb)',
];

// teaches_student (017): + los inscritos en sus eventos, para que el profesor vea sus nombres como los de sus sesiones.
const teachesSql = (events) => `
  CREATE OR REPLACE FUNCTION teaches_student(p_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id
                      WHERE b.student_id = p_id AND s.trainer_id = ${UID})${events ? `
          OR EXISTS (SELECT 1 FROM event_registrations r JOIN events e ON e.id = r.event_id
                      WHERE r.profile_id = p_id AND e.trainer_id = ${UID})` : ''}
    $$;
`;

// Tablas como en 001 (vacías, sin RLS); la FK events.id → class_sessions la vuelve a poner el down de 008.
const legacyTables = (pgm) => {
  pgm.createType('event_payment_status', ['free', 'pending', 'paid', 'cash']);
  pgm.createTable('events', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    title: { type: 'text', notNull: true },
    description: { type: 'text' },
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    capacity: { type: 'integer' },
    price_cents: { type: 'integer' },
    location: { type: 'text' },
  });
  pgm.createTable('event_registrations', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    event_id: { type: 'uuid', notNull: true, references: 'events', onDelete: 'CASCADE' },
    student_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    payment_status: { type: 'event_payment_status', notNull: true },
  });
  pgm.createIndex('event_registrations', 'event_id');
  pgm.createIndex('event_registrations', 'student_id');
};

export const up = (pgm) => {
  pgm.dropTable('event_registrations');
  pgm.dropTable('events');
  pgm.dropType('event_payment_status');

  pgm.createTable('events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    title: { type: 'text', notNull: true, check: `char_length(btrim(title)) BETWEEN 1 AND 120` },
    description: { type: 'text', check: `char_length(description) <= 2000` },
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    location: { type: 'text', notNull: true, check: `char_length(btrim(location)) BETWEEN 1 AND 200` },
    discipline_id: { type: 'bigint', references: 'disciplines' },
    trainer_id: { type: 'uuid', references: 'profiles' }, // rol profesor: lo comprueba el servicio
    capacity: { type: 'integer', check: 'capacity > 0' }, // NULL = sin límite
    audience: { type: 'text', notNull: true, default: 'all', check: `audience IN ('all', 'minors', 'adults')` },
    requires_risk_cover: { type: 'boolean', notNull: true, default: true },
    // 0 = gratis; si no, el mínimo de Stripe (0,50 €).
    price_cents: { type: 'integer', notNull: true, default: 0, check: 'price_cents = 0 OR price_cents >= 50' },
    member_price_cents: { type: 'integer' },
    registration_deadline: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'scheduled', check: `status IN ('scheduled', 'cancelled')` },
    cancel_note: { type: 'text', check: 'char_length(cancel_note) <= 500' }, // solo la ve el admin
    created_by: { type: 'uuid', notNull: true, references: 'profiles' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('events', 'events_ends_check', { check: 'ends_at > starts_at' });
  pgm.addConstraint('events', 'events_member_price_check', {
    check: `member_price_cents IS NULL
            OR ((member_price_cents = 0 OR member_price_cents >= 50) AND member_price_cents <= price_cents)`,
  });
  pgm.addConstraint('events', 'events_deadline_check', {
    check: 'registration_deadline IS NULL OR registration_deadline <= starts_at',
  });
  pgm.createIndex('events', 'starts_at');
  pgm.createIndex('events', 'trainer_id');

  pgm.createTable('event_registrations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    event_id: { type: 'uuid', notNull: true, references: 'events' },
    profile_id: { type: 'uuid', notNull: true, references: 'profiles' }, // sujeto
    actor_id: { type: 'uuid', notNull: true, references: 'profiles' },
    payer_id: { type: 'uuid', references: 'profiles' }, // NULL si el importe es 0
    status: { type: 'text', notNull: true, check: `status IN ('pending', 'confirmed', 'cancelled')` },
    amount_cents: { type: 'integer', notNull: true, check: 'amount_cents >= 0' },
    guest: { type: 'boolean', notNull: true, default: false },
    cancel_reason: {
      type: 'text', check: `cancel_reason IN ('student', 'admin', 'event_cancelled', 'checkout_expired')`,
    },
    checkout_session_id: { type: 'text', unique: true },
    payment_intent_id: { type: 'text', unique: true },
    refund_status: { type: 'text', check: `refund_status IN ('requested', 'refunded', 'failed')` },
    refunded_cents: { type: 'integer', notNull: true, default: 0 },
    attended: { type: 'boolean' }, // NULL = sin marcar
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    cancelled_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('event_registrations', 'event_registrations_cancel_check', {
    check: `(status = 'cancelled') = (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)`,
  });
  pgm.addConstraint('event_registrations', 'event_registrations_payer_check', {
    check: `(payer_id IS NULL) = (amount_cents = 0) AND (NOT guest OR amount_cents = 0)
            AND (status <> 'pending' OR amount_cents > 0)`,
  });
  // Una viva por sujeto y evento; tras cancelar se puede volver.
  pgm.createIndex('event_registrations', ['event_id', 'profile_id'], {
    unique: true, where: `status IN ${LIVE_REG}`, name: 'event_registrations_one_live_idx',
  });
  pgm.createIndex('event_registrations', 'event_id');
  pgm.createIndex('event_registrations', 'profile_id');

  pgm.sql(`
    ALTER TABLE events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE events FORCE ROW LEVEL SECURITY;
    -- Qué eventos ve cada uno lo filtra el servicio (programados sin terminar, los suyos, los que imparte).
    CREATE POLICY events_select ON events FOR SELECT TO app_user USING (${AUTHED});
    CREATE POLICY events_insert_admin ON events FOR INSERT TO app_user WITH CHECK (${IS_ADMIN});
    CREATE POLICY events_update_admin ON events FOR UPDATE TO app_user USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});
    REVOKE ALL ON events FROM app_user;
    GRANT SELECT, INSERT, UPDATE ON events TO app_user; -- nunca se borra: se cancela

    ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE event_registrations FORCE ROW LEVEL SECURITY;
    -- El sujeto, sus tutores (también tras cumplir 18, como bookings), el profesor del evento y el admin.
    CREATE POLICY event_registrations_select ON event_registrations FOR SELECT TO app_user
      USING (profile_id = ${UID} OR is_guardian_of(profile_id, true) OR ${IS_ADMIN}
             OR (${ROLE} = 'profesor' AND EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.trainer_id = ${UID})));
    REVOKE ALL ON event_registrations FROM app_user;
    GRANT SELECT ON event_registrations TO app_user;
  `);

  pgm.sql(`
    -- Plazas ocupadas (pendientes y confirmadas): el alumno no lee las inscripciones ajenas, solo la cuenta.
    CREATE FUNCTION event_taken(p_event uuid) RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT count(*)::integer FROM event_registrations WHERE event_id = p_event AND status IN ${LIVE_REG}
      $$;

    -- Aviso de eventos (CONTEXT § Avisos): al alumno o, si es un hijo, a sus tutores; push o email de respaldo
    -- (enqueue_notice) y caduca al empezar el evento. p_reg NULL = todas las inscripciones vivas. Solo el admin.
    CREATE FUNCTION event_notice(p_event uuid, p_action text, p_reg uuid, p_extra jsonb) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        r record;
        rcpts uuid[];
        aid uuid;
        n integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        FOR r IN SELECT x.id, x.profile_id, e.starts_at FROM event_registrations x JOIN events e ON e.id = x.event_id
                  WHERE x.event_id = p_event AND (x.id = p_reg OR (p_reg IS NULL AND x.status IN ${LIVE_REG})) LOOP
          rcpts := COALESCE((SELECT array_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = r.profile_id),
                            ARRAY[r.profile_id]);
          aid := gen_random_uuid();
          INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
          VALUES (aid, ${UID}, p_action, 'event_registration', r.id::text,
                  COALESCE(p_extra, '{}') || jsonb_build_object('event_id', p_event, 'profile_id', r.profile_id,
                                                              'recipients', to_jsonb(rcpts), 'expires_at', r.starts_at));
          PERFORM enqueue_notice(aid, rcpts, ${UID});
          n := n + 1;
        END LOOP;
        RETURN n;
      END
      $$;

    -- Inscribirse (CONTEXT § Eventos). El FOR UPDATE del evento serializa aforo y «una viva». Importe 0 → confirmada;
    -- si no, pendiente (ocupa plaza) hasta que el webhook la resuelve (ADR 0018). Errores: RAISE con el código.
    CREATE FUNCTION register_event(p_event uuid, p_subject uuid, p_guest boolean) RETURNS event_registrations
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        e events;
        r event_registrations;
        adult boolean;
        missing text[];
        amt integer;
      BEGIN
        -- Invitado solo el admin, y el admin solo inscribe como invitado (no paga él).
        IF p_guest IS DISTINCT FROM ${IS_ADMIN} THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        IF NOT booking_can_act(p_subject) THEN RAISE EXCEPTION 'not_guardian' USING ERRCODE = '42501'; END IF;
        SELECT ${ADULT} INTO adult FROM profiles p WHERE p.id = p_subject;
        IF NOT FOUND OR COALESCE((SELECT role::text FROM user_roles WHERE user_id = p_subject), 'alumno') <> 'alumno' THEN
          RAISE EXCEPTION 'not_a_student'; -- un tutor (rol), un profesor o el admin no se inscriben
        END IF;
        SELECT * INTO e FROM events WHERE id = p_event FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
        IF e.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
        IF NOT (${IS_ADMIN}) AND now() >= COALESCE(e.registration_deadline, e.starts_at) THEN
          RAISE EXCEPTION 'registration_closed';
        END IF;
        IF (e.audience = 'minors' AND adult) OR (e.audience = 'adults' AND NOT adult) THEN
          RAISE EXCEPTION 'audience_mismatch';
        END IF;
        missing := profile_missing(p_subject);
        IF missing <> '{}' THEN RAISE EXCEPTION 'profile_incomplete' USING DETAIL = array_to_string(missing, ','); END IF;
        -- El actor que no es el sujeto (tutor por un hijo): como requireCompleteProfile; al tutor le basta lo suyo.
        IF p_subject <> ${UID} AND ${ROLE} IN ('alumno', 'tutor') THEN
          missing := profile_missing(${UID});
          IF ${ROLE} = 'tutor' THEN
            missing := ARRAY(SELECT m FROM unnest(missing) m WHERE m IN ('display_name', 'data_protection'));
          END IF;
          IF missing <> '{}' THEN RAISE EXCEPTION 'profile_incomplete' USING DETAIL = array_to_string(missing, ','); END IF;
        END IF;
        IF e.requires_risk_cover AND NOT has_risk_cover(p_subject) THEN RAISE EXCEPTION 'no_risk_cover'; END IF;
        IF EXISTS (SELECT 1 FROM event_registrations WHERE event_id = p_event AND profile_id = p_subject
                                                      AND status IN ${LIVE_REG}) THEN
          RAISE EXCEPTION 'already_registered';
        END IF;
        IF e.capacity IS NOT NULL AND event_taken(p_event) >= e.capacity THEN RAISE EXCEPTION 'event_full'; END IF;
        -- Socio: el sujeto con suscripción en vigor al inscribirse (CONTEXT § Precio del evento).
        amt := CASE WHEN p_guest THEN 0
                    WHEN e.member_price_cents IS NOT NULL AND EXISTS (
                      SELECT 1 FROM subscriptions s WHERE s.student_id = p_subject AND s.status IN ('active', 'past_due'))
                    THEN e.member_price_cents
                    ELSE e.price_cents END;
        INSERT INTO event_registrations (event_id, profile_id, actor_id, payer_id, status, amount_cents, guest)
        VALUES (p_event, p_subject, ${UID}, CASE WHEN amt > 0 THEN ${UID} END,
                CASE WHEN amt > 0 THEN 'pending' ELSE 'confirmed' END, amt, p_guest)
        RETURNING * INTO r;
        RETURN r;
      END
      $$;

    -- El Checkout de una inscripción pendiente recién creada, en la misma transacción (app_user no escribe la tabla).
    CREATE FUNCTION attach_event_checkout(p_reg uuid, p_session text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        UPDATE event_registrations SET checkout_session_id = p_session
         WHERE id = p_reg AND actor_id = ${UID} AND status = 'pending' AND checkout_session_id IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'registration_not_found'; END IF;
      END
      $$;

    -- Cancelar una inscripción. Alumno o tutor: gratis o pendiente, hasta el inicio. Admin: cualquiera, devolviendo
    -- el importe entero o nada (refund_status = 'requested'; el reembolso lo pide el servicio a Stripe después);
    -- sobre una ya cancelada y pagada, p_refund reintenta un reembolso no pedido o fallido.
    CREATE FUNCTION cancel_event_registration(p_id uuid, p_refund boolean) RETURNS event_registrations
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        e events;
        r event_registrations;
      BEGIN
        SELECT * INTO r FROM event_registrations WHERE id = p_id;
        IF NOT FOUND OR NOT booking_can_act(r.profile_id) THEN RAISE EXCEPTION 'registration_not_found'; END IF;
        SELECT * INTO e FROM events WHERE id = r.event_id FOR UPDATE;
        SELECT * INTO r FROM event_registrations WHERE id = p_id FOR UPDATE; -- releída con el evento bloqueado
        IF ${IS_ADMIN} THEN
          IF r.status = 'cancelled' THEN
            IF p_refund AND r.payment_intent_id IS NOT NULL AND COALESCE(r.refund_status, 'failed') = 'failed' THEN
              UPDATE event_registrations SET refund_status = 'requested' WHERE id = p_id RETURNING * INTO r;
              RETURN r;
            END IF;
            RAISE EXCEPTION 'already_cancelled';
          END IF;
          UPDATE event_registrations
             SET status = 'cancelled', cancel_reason = 'admin', cancelled_at = now(),
                 refund_status = CASE WHEN p_refund AND payment_intent_id IS NOT NULL THEN 'requested' END
           WHERE id = p_id RETURNING * INTO r;
          PERFORM event_notice(e.id, 'notice.event_registration_cancelled', p_id, NULL);
          RETURN r;
        END IF;
        IF r.status = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
        IF now() >= e.starts_at THEN RAISE EXCEPTION 'event_started'; END IF;
        IF r.status = 'confirmed' AND r.amount_cents > 0 THEN RAISE EXCEPTION 'paid_registration'; END IF;
        UPDATE event_registrations SET status = 'cancelled', cancel_reason = 'student', cancelled_at = now()
         WHERE id = p_id RETURNING * INTO r;
        RETURN r;
      END
      $$;

    -- Cancelar el evento (solo admin): todas sus inscripciones, las pagadas a reembolsar (refund_status 'requested') y
    -- aviso a cada inscrito. Devuelve los avisados.
    CREATE FUNCTION cancel_event(p_id uuid, p_note text) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        e events;
        id_ uuid;
        n integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO e FROM events WHERE id = p_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
        IF e.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
        UPDATE events SET status = 'cancelled', cancel_note = p_note, updated_at = now() WHERE id = p_id;
        FOR id_ IN UPDATE event_registrations
                      SET status = 'cancelled', cancel_reason = 'event_cancelled', cancelled_at = now(),
                          refund_status = CASE WHEN payment_intent_id IS NOT NULL THEN 'requested' END
                    WHERE event_id = p_id AND status IN ${LIVE_REG} RETURNING id LOOP
          n := n + event_notice(p_id, 'notice.event_cancelled', id_, NULL);
        END LOOP;
        RETURN n;
      END
      $$;

    -- Lista simple (CONTEXT § Asistencia a un evento): desde el inicio, el profesor del evento y el admin; sin cierre.
    CREATE FUNCTION mark_event_attendance(p_reg uuid, p_present boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        e events;
        r event_registrations;
      BEGIN
        SELECT * INTO r FROM event_registrations WHERE id = p_reg;
        IF FOUND THEN SELECT * INTO e FROM events WHERE id = r.event_id; END IF;
        IF r.id IS NULL OR r.status <> 'confirmed'
           OR NOT (${IS_ADMIN} OR (${ROLE} = 'profesor' AND e.trainer_id = ${UID})) THEN
          RAISE EXCEPTION 'registration_not_found';
        END IF;
        IF e.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
        IF now() < e.starts_at THEN RAISE EXCEPTION 'event_not_started'; END IF;
        UPDATE event_registrations SET attended = p_present WHERE id = p_reg;
      END
      $$;

    -- Fichas de salud de los inscritos confirmados, como professor_session_health (010): solo el profesor del evento,
    -- en los días del evento (Madrid), y queda en audit_log (health.view).
    CREATE FUNCTION professor_event_health(p_event uuid)
      RETURNS TABLE (student_id uuid, display_name text, injuries text, conditions text, allergies text,
                     medication text, emergency_contact_name text, emergency_contact_phone text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      #variable_conflict use_column
      BEGIN
        IF ${ROLE} IS DISTINCT FROM 'profesor' OR NOT EXISTS (
             SELECT 1 FROM events e
              WHERE e.id = p_event AND e.trainer_id = ${UID} AND e.status = 'scheduled'
                AND (now() AT TIME ZONE '${TZ}')::date
                    BETWEEN (e.starts_at AT TIME ZONE '${TZ}')::date AND (e.ends_at AT TIME ZONE '${TZ}')::date) THEN
          RAISE EXCEPTION 'event_not_found'; -- mismo error para «no existe» y «no es tuyo / no es hoy»
        END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        SELECT gen_random_uuid(), ${UID}, 'health.view', 'event', p_event::text,
               jsonb_build_object('student_ids', COALESCE(jsonb_agg(r.profile_id), '[]'::jsonb))
          FROM event_registrations r WHERE r.event_id = p_event AND r.status = 'confirmed';
        RETURN QUERY
          SELECT r.profile_id, p.display_name, h.injuries, h.conditions, h.allergies, h.medication,
                 h.emergency_contact_name, h.emergency_contact_phone
            FROM event_registrations r
            JOIN profiles p ON p.id = r.profile_id
            LEFT JOIN student_health_info h ON h.profile_id = r.profile_id
           WHERE r.event_id = p_event AND r.status = 'confirmed'
           ORDER BY p.display_name, r.profile_id;
      END
      $$;
  `);
  for (const fn of PUBLIC_FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }
  pgm.sql(teachesSql(true));
};

export const down = (pgm) => {
  pgm.sql(teachesSql(false));
  for (const fn of [...PUBLIC_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  // Los avisos y la auditoría de eventos se quedan en audit_log (sin FK): huérfanos e inofensivos.
  pgm.dropTable('event_registrations');
  pgm.dropTable('events');
  legacyTables(pgm);
};
