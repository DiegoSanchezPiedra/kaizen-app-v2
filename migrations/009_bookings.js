// migrations/009_bookings.js
// B7: reservas y lista de espera (CONTEXT § Reservas). Toda escritura pasa por funciones SECURITY DEFINER:
// la promoción escribe reservas de otro alumno, que la RLS no permitiría.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`; // NULL nunca cuenta como admin en un IF NOT
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;

// Funciones con owner service_role (BYPASSRLS), como is_guardian_of/create_child (006). Las demás son internas.
const PUBLIC_FNS = ['book_session(uuid, uuid)', 'cancel_booking(uuid)', 'cancel_session_bookings(uuid)'];
const INTERNAL_FNS = [
  'academy_int(text, integer)', 'covers(uuid, bigint)', 'booking_can_act(uuid)',
  'has_overlapping_booking(uuid, uuid)', 'lock_student(uuid)', 'booking_notice(uuid, text)',
  'promote_waitlist(uuid)',
];

export const up = (pgm) => {
  // ADR 0003: las disciplinas elegidas de cada suscripción. Los flujos de elección llegan en B10.5.
  pgm.createTable('subscription_disciplines', {
    subscription_id: { type: 'uuid', notNull: true, references: 'subscriptions', onDelete: 'RESTRICT' },
    discipline_id: { type: 'bigint', notNull: true, references: 'disciplines', onDelete: 'RESTRICT' },
  });
  pgm.addConstraint('subscription_disciplines', 'subscription_disciplines_pkey',
    { primaryKey: ['subscription_id', 'discipline_id'] });
  pgm.createIndex('subscription_disciplines', 'discipline_id');
  // shortcut: sin acceso para app_user (solo la leen las funciones definer); RLS con la de subscriptions en B10.
  pgm.sql(`REVOKE ALL ON subscription_disciplines FROM app_user;`);

  pgm.createType('booking_cancel_reason',
    ['student', 'late', 'admin', 'session_cancelled', 'no_coverage', 'discipline_change']);

  // Tabla vacía al aplicar (B7 es la primera que la usa): NOT NULL sin backfill.
  pgm.sql(`ALTER TABLE bookings ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
  pgm.addColumns('bookings', {
    booked_by: { type: 'uuid', notNull: true, references: 'profiles' }, // actor; student_id es el sujeto
    cancel_reason: { type: 'booking_cancel_reason' },
    cancelled_at: { type: 'timestamptz' },
    cancelled_by: { type: 'uuid' },
    promoted_at: { type: 'timestamptz' }, // promocionado dentro del plazo de cancelación → nunca es tardía
  });
  pgm.addConstraint('bookings', 'bookings_cancel_check', {
    check: `(status = 'cancelled') = (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)`,
  });
  // 001 pedía un UNIQUE parcial pero se creó total: impedía volver a reservar tras cancelar.
  pgm.dropConstraint('bookings', 'bookings_unique_active_booking');
  pgm.createIndex('bookings', ['session_id', 'student_id'], {
    unique: true, where: `status <> 'cancelled'`, name: 'bookings_unique_active_booking',
  });
  pgm.createIndex('bookings', ['session_id', 'created_at'], {
    where: `status = 'waitlisted'`, name: 'bookings_waitlist_idx',
  });

  // Las políticas son TO app_user y migrator no tiene BYPASSRLS: el seed entra como service_role (GRANT de B4.6).
  pgm.sql(`
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES
      ('booking_window_days', '14'), ('cancellation_notice_minutes', '60')
    ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);

  pgm.sql(`
    -- Parámetro entero de la academia; si falta o no es un entero positivo, el valor por defecto.
    CREATE FUNCTION academy_int(p_key text, p_default integer) RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT COALESCE((SELECT (value #>> '{}')::integer FROM academy_settings
                          WHERE key = p_key AND value #>> '{}' ~ '^[1-9][0-9]{0,8}$'), p_default)
      $$;

    -- Cubrir (CONTEXT § Planes y disciplinas). Suscripción en vigor: el mapeo definitivo se fija en B10.
    CREATE FUNCTION covers(p_student uuid, p_discipline bigint) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1
            FROM subscriptions s
            JOIN plans pl ON pl.id = s.plan_id
            JOIN profiles p ON p.id = s.student_id
            JOIN disciplines d ON d.id = p_discipline AND d.is_active
           WHERE s.student_id = p_student
             AND s.status IN ('active', 'pending_cash', 'grace_period')
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

    -- Quién reserva y cancela: el propio alumno, cualquier tutor de un hijo menor, el admin. Nunca el profesor.
    CREATE FUNCTION booking_can_act(p_student uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT ${UID} IS NOT NULL AND ${ROLE} <> 'profesor'
           AND (${IS_ADMIN} OR p_student = ${UID} OR is_guardian_of(p_student))
      $$;

    CREATE FUNCTION has_overlapping_booking(p_student uuid, p_session uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM bookings b
            JOIN class_sessions x ON x.id = b.session_id
            JOIN class_sessions s ON s.id = p_session
           WHERE b.student_id = p_student AND b.status = 'confirmed' AND x.status = 'scheduled'
             AND x.id <> s.id AND tstzrange(x.starts_at, x.ends_at) && tstzrange(s.starts_at, s.ends_at)
        )
      $$;

    -- Serializa a un alumno (p. ej. dos tutores a la vez) para que el solape no tenga carreras.
    -- Siempre después del FOR UPDATE de la sesión.
    CREATE FUNCTION lock_student(p_student uuid) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT pg_advisory_xact_lock(7, hashtext(p_student::text))
      $$;

    -- Aviso pendiente de envío (B15 los envía): al alumno o, si es un hijo, a todos sus tutores.
    CREATE FUNCTION booking_notice(p_booking uuid, p_action text) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        SELECT gen_random_uuid(), COALESCE(${UID}, b.student_id), p_action, 'booking', b.id::text,
               jsonb_build_object('session_id', b.session_id, 'student_id', b.student_id, 'recipients',
                 COALESCE((SELECT jsonb_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = b.student_id),
                          jsonb_build_array(b.student_id)))
          FROM bookings b WHERE b.id = p_booking
      $$;

    -- Promoción (CONTEXT): por orden de llegada mientras haya plaza y la sesión no haya empezado.
    -- Quien llama ya tiene la sesión bloqueada (FOR UPDATE).
    -- shortcut: solo re-comprueba cobertura y solape, no el perfil completo (vive en JS); revisar si se pide.
    CREATE FUNCTION promote_waitlist(p_session uuid) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        w bookings;
        free integer;
        promoted integer := 0;
      BEGIN
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF s.status <> 'scheduled' OR s.starts_at <= now() THEN RETURN 0; END IF;
        free := s.capacity - (SELECT count(*) FROM bookings WHERE session_id = p_session AND status = 'confirmed');
        FOR w IN SELECT * FROM bookings WHERE session_id = p_session AND status = 'waitlisted'
                  ORDER BY created_at, id LOOP
          EXIT WHEN free <= 0;
          PERFORM lock_student(w.student_id);
          IF NOT covers(w.student_id, s.discipline_id) THEN
            UPDATE bookings SET status = 'cancelled', cancel_reason = 'no_coverage',
                                cancelled_at = now(), cancelled_by = ${UID}
             WHERE id = w.id;
            PERFORM booking_notice(w.id, 'notice.no_coverage');
          ELSIF NOT has_overlapping_booking(w.student_id, p_session) THEN
            UPDATE bookings SET status = 'confirmed', promoted_at = now() WHERE id = w.id;
            PERFORM booking_notice(w.id, 'notice.booking_promoted');
            free := free - 1;
            promoted := promoted + 1;
          END IF; -- con solape: se le salta y sigue en espera
        END LOOP;
        RETURN promoted;
      END
      $$;

    -- Reservar. Llena → en espera. El FOR UPDATE de la sesión serializa aforo y lista de espera.
    -- Errores: RAISE con el código de error como mensaje; services/bookings.js los traduce a HTTP.
    CREATE FUNCTION book_session(p_session uuid, p_student uuid) RETURNS bookings
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        b bookings;
      BEGIN
        IF NOT booking_can_act(p_student) THEN
          RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
        IF s.status <> 'scheduled' OR s.starts_at <= now() THEN RAISE EXCEPTION 'session_not_bookable'; END IF;
        IF NOT (${IS_ADMIN})
           AND s.starts_at > now() + academy_int('booking_window_days', 14) * interval '1 day' THEN
          RAISE EXCEPTION 'outside_booking_window';
        END IF;
        IF NOT covers(p_student, s.discipline_id) THEN RAISE EXCEPTION 'not_covered'; END IF;
        PERFORM lock_student(p_student);
        IF EXISTS (SELECT 1 FROM bookings WHERE session_id = p_session AND student_id = p_student
                                             AND status <> 'cancelled') THEN
          RAISE EXCEPTION 'already_booked';
        END IF;
        IF (SELECT count(*) FROM bookings WHERE session_id = p_session AND status = 'confirmed') < s.capacity THEN
          IF has_overlapping_booking(p_student, p_session) THEN RAISE EXCEPTION 'booking_overlap'; END IF;
          INSERT INTO bookings (session_id, student_id, booked_by, status)
          VALUES (p_session, p_student, ${UID}, 'confirmed') RETURNING * INTO b;
        ELSE
          -- En espera puede solaparse con otra reserva (CONTEXT).
          INSERT INTO bookings (session_id, student_id, booked_by, status)
          VALUES (p_session, p_student, ${UID}, 'waitlisted') RETURNING * INTO b;
        END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'booking.create', 'booking', b.id::text,
                jsonb_build_object('session_id', p_session, 'student_id', p_student, 'status', b.status));
        RETURN b;
      END
      $$;

    -- Cancelar una reserva o salir de la espera; libera plaza y promociona.
    CREATE FUNCTION cancel_booking(p_booking uuid) RETURNS bookings
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        b bookings;
        was bookings;
        deadline timestamptz;
      BEGIN
        SELECT * INTO b FROM bookings WHERE id = p_booking;
        IF NOT FOUND OR NOT booking_can_act(b.student_id) THEN RAISE EXCEPTION 'booking_not_found'; END IF;
        SELECT * INTO s FROM class_sessions WHERE id = b.session_id FOR UPDATE;
        SELECT * INTO was FROM bookings WHERE id = p_booking; -- releída con la sesión bloqueada
        IF was.status = 'cancelled' THEN RAISE EXCEPTION 'booking_not_active'; END IF;
        IF s.starts_at <= now() THEN RAISE EXCEPTION 'session_started'; END IF;
        deadline := s.starts_at - academy_int('cancellation_notice_minutes', 60) * interval '1 minute';
        -- shortcut: falta la exención por cambio de clase; llega con el cambio de clase con propagación.
        UPDATE bookings
           SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${UID},
               cancel_reason = CASE
                 WHEN ${IS_ADMIN} THEN 'admin'
                 WHEN was.status = 'confirmed' AND now() > deadline
                      AND NOT COALESCE(was.promoted_at >= deadline, false) THEN 'late'
                 ELSE 'student' END::booking_cancel_reason
         WHERE id = p_booking RETURNING * INTO b;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'booking.cancel', 'booking', b.id::text,
                jsonb_build_object('from', was.status, 'reason', b.cancel_reason));
        IF was.status = 'confirmed' THEN PERFORM promote_waitlist(s.id); END IF;
        RETURN b;
      END
      $$;

    -- Cancelar una sesión (CONTEXT): anula reservas y esperas con aviso. Solo admin.
    CREATE FUNCTION cancel_session_bookings(p_session uuid) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        id_ uuid;
        n integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        FOR id_ IN UPDATE bookings SET status = 'cancelled', cancel_reason = 'session_cancelled',
                                       cancelled_at = now(), cancelled_by = ${UID}
                    WHERE session_id = p_session AND status <> 'cancelled' RETURNING id LOOP
          PERFORM booking_notice(id_, 'notice.session_cancelled');
          n := n + 1;
        END LOOP;
        RETURN n;
      END
      $$;
  `);
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(`
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
    -- Propias, de los hijos (también tras cumplir 18, D16), todas para el admin, las de sus sesiones para el profesor (B8).
    CREATE POLICY bookings_select ON bookings FOR SELECT TO app_user
      USING (student_id = ${UID} OR is_guardian_of(student_id, true) OR ${IS_ADMIN}
             OR (${ROLE} = 'profesor' AND EXISTS (SELECT 1 FROM class_sessions s WHERE s.id = session_id AND s.trainer_id = ${UID})));
    -- Sin políticas de escritura y sin permisos: solo las funciones escriben.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON bookings FROM app_user;
    GRANT SELECT ON bookings TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT INSERT, UPDATE, DELETE ON bookings TO app_user;
    DROP POLICY bookings_select ON bookings;
    ALTER TABLE bookings NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;
  `);
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(`SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key IN ('booking_window_days', 'cancellation_notice_minutes');
    RESET ROLE;`);
  pgm.dropIndex('bookings', [], { name: 'bookings_waitlist_idx' });
  pgm.dropIndex('bookings', [], { name: 'bookings_unique_active_booking' });
  // Falla si quedan reservas repetidas (re-reservas tras cancelar): vaciar bookings antes de bajar.
  pgm.addConstraint('bookings', 'bookings_unique_active_booking', { unique: ['session_id', 'student_id'] });
  pgm.dropConstraint('bookings', 'bookings_cancel_check');
  pgm.dropColumns('bookings', ['booked_by', 'cancel_reason', 'cancelled_at', 'cancelled_by', 'promoted_at']);
  pgm.sql(`ALTER TABLE bookings ALTER COLUMN id DROP DEFAULT;`);
  pgm.dropType('booking_cancel_reason');
  pgm.dropTable('subscription_disciplines');
};
