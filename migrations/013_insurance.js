// migrations/013_insurance.js
// B10.3: seguro y cobertura de riesgo (CONTEXT § Seguro y cobertura de riesgo; ADR 0005, 0006).
// El waiver sale del perfil completo y pasa a la cobertura de riesgo (seguro en vigor o waiver vigente),
// requisito aparte para reservar. El seguro es una 2.ª suscripción anual de Stripe: tabla insurances.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const OWNS_STUDENT = `(student_id = ${UID} OR is_guardian_of(student_id, true))`;
const LIVE = `('active', 'past_due', 'unpaid')`;

const PUBLIC_FNS = ['profile_missing(uuid)', 'has_risk_cover(uuid)'];

// Reservar (009) + cobertura de riesgo. risk = false recrea la versión de 009 en el down.
const bookSessionSql = (risk) => `
  CREATE OR REPLACE FUNCTION book_session(p_session uuid, p_student uuid) RETURNS bookings
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
      ${risk ? `IF NOT has_risk_cover(p_student) THEN RAISE EXCEPTION 'no_risk_cover'; END IF;` : ''}
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
`;

// Promoción (009). risk = true: sin perfil completo o sin cobertura de riesgo se le salta y sigue en la lista;
// «sin cobertura» (sale de la lista) queda solo para la suscripción.
const promoteSql = (risk) => `
  CREATE OR REPLACE FUNCTION promote_waitlist(p_session uuid) RETURNS integer
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
        ELSIF NOT has_overlapping_booking(w.student_id, p_session)
              ${risk ? `AND profile_missing(w.student_id) = '{}' AND has_risk_cover(w.student_id)` : ''} THEN
          UPDATE bookings SET status = 'confirmed', promoted_at = now() WHERE id = w.id;
          PERFORM booking_notice(w.id, 'notice.booking_promoted');
          free := free - 1;
          promoted := promoted + 1;
        END IF; -- si no: se le salta y sigue en espera
      END LOOP;
      RETURN promoted;
    END
    $$;
`;

export const up = (pgm) => {
  // ADR 0005: la tabla genérica heredada se borra; el waiver vive en user_agreements y el seguro en insurances.
  pgm.dropTable('subscription_agreements');

  pgm.createTable('insurances', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    student_id: { type: 'uuid', notNull: true, references: 'profiles' },
    payer_id: { type: 'uuid', notNull: true, references: 'profiles' },
    status: { type: 'sub_status', notNull: true },
    // Tramo del Price en curso; lo fija el aviso de renovación (CONTEXT § Seguro).
    bracket: { type: 'text', notNull: true, check: `bracket IN ('adult', 'minor')` },
    stripe_subscription_id: { type: 'text', notNull: true, unique: true },
    current_period_start: { type: 'timestamptz' },
    current_period_end: { type: 'timestamptz' },
    cancel_at_period_end: { type: 'boolean', notNull: true, default: false },
    cancelled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('insurances', 'payer_id');
  // Seguro vivo: como máximo uno por alumno.
  pgm.createIndex('insurances', 'student_id', { unique: true, where: `status IN ${LIVE}`, name: 'insurances_one_live_idx' });

  pgm.addColumn('invoices', { insurance_id: { type: 'uuid', references: 'insurances' } });
  pgm.createIndex('invoices', 'insurance_id');
  pgm.addConstraint('invoices', 'invoices_owner_check', { check: 'num_nonnulls(subscription_id, insurance_id) = 1' });

  pgm.sql(`
    ALTER TABLE insurances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE insurances FORCE ROW LEVEL SECURITY;
    -- Como los recibos: alumno, tutor (también histórico), pagador, admin. El profesor no.
    CREATE POLICY insurances_select ON insurances FOR SELECT TO app_user
      USING (${OWNS_STUDENT} OR payer_id = ${UID} OR ${IS_ADMIN});
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON insurances FROM app_user;
    GRANT SELECT ON insurances TO app_user;

    -- Firmado en la versión vigente por quien cuenta: el propio adulto o un tutor si es menor (B4.5).
    CREATE FUNCTION signed_current(p_id uuid, p_type text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM user_agreements ua
            JOIN profiles p ON p.id = ua.profile_id
            JOIN agreement_documents d ON d.type = ua.type AND d.version = ua.version
                                      AND d.published_at IS NOT NULL AND d.retired_at IS NULL
           WHERE ua.profile_id = p_id AND ua.type = p_type AND (ua.signed_by = p.id) = (${ADULT})
        )
      $$;

    -- Lo que falta para el perfil completo de un alumno (CONTEXT § Perfil completo). Única fuente:
    -- la usan getProfileStatus (JS) y la promoción. NULL si el perfil no existe.
    CREATE FUNCTION profile_missing(p_id uuid) RETURNS text[]
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT array_remove(ARRAY[
          CASE WHEN COALESCE(trim(p.display_name), '') = '' THEN 'display_name' END,
          CASE WHEN h.profile_id IS NULL THEN 'health_info'
               WHEN COALESCE(h.emergency_contact_name, '') = '' OR COALESCE(h.emergency_contact_phone, '') = ''
               THEN 'emergency_contact' END,
          CASE WHEN NOT signed_current(p.id, 'data_protection') THEN 'data_protection' END,
          CASE WHEN NOT signed_current(p.id, 'rights_of_image') THEN 'rights_of_image' END
        ], NULL)
          FROM profiles p LEFT JOIN student_health_info h ON h.profile_id = p.id
         WHERE p.id = p_id
      $$;

    -- Cobertura de riesgo: seguro en vigor o waiver vigente. Un waiver ya firmado da cobertura sin migrar datos.
    CREATE FUNCTION has_risk_cover(p_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM insurances WHERE student_id = p_id AND status IN ('active', 'past_due'))
            OR signed_current(p_id, 'waiver')
      $$;
  `);
  for (const fn of ['signed_current(uuid, text)', ...PUBLIC_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  // Solo devuelven estado (como is_guardian_of); los servicios comprueban antes quién pregunta.
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(bookSessionSql(true));
  pgm.sql(promoteSql(true));

  // El seguro nace desactivado (CONTEXT § Seguro desactivado). Seed como service_role (ver 009).
  pgm.sql(`
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES ('insurance_enabled', 'false') ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);
};

export const down = (pgm) => {
  pgm.sql(`SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key LIKE 'insurance\\_%';
    RESET ROLE;`);
  pgm.sql(promoteSql(false));
  pgm.sql(bookSessionSql(false));
  for (const fn of [...PUBLIC_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(`DROP FUNCTION signed_current(uuid, text);`);

  // Falla si hay recibos del seguro: borrarlos antes de bajar.
  pgm.dropConstraint('invoices', 'invoices_owner_check');
  pgm.dropColumn('invoices', 'insurance_id');
  pgm.dropTable('insurances');

  pgm.createTable('subscription_agreements', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    insurance_type: { type: 'text' },
    waiver_version: { type: 'text' },
    accepted_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    accepted_ip: { type: 'text' },
  });
  pgm.createIndex('subscription_agreements', 'student_id');
};
