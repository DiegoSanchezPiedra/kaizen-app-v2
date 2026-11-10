// migrations/057_drop_insurance_and_waiver.js
// B28: sin seguro ni waiver, solo membresías (ADR 0023, que sustituye a 0005 y 0006). Se borra todo sin copia: solo
// había datos de staging y del sandbox (los seguros de Stripe los cancela antes scripts/drop-insurance-stripe.js).
// Reservar, la promoción y la inscripción a eventos dejan de pedir cobertura de riesgo. down() recrea el esquema vacío.
/* eslint-disable camelcase */
import fs from 'node:fs/promises';
import path from 'node:path';
import { bookSessionSql } from './013_insurance.js';

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const LIVE = `('active', 'past_due', 'unpaid')`;
const LIVE_REG = `('pending', 'confirmed')`;
const SEES = `(p_id = ${UID} OR is_guardian_of(p_id) OR ${IS_ADMIN})`;
const TYPES = (waiver) => `type IN (${waiver ? "'waiver', " : ''}'data_protection', 'rights_of_image')`;
const RISK_FNS = ['has_risk_cover(uuid)', 'visible_risk_cover(uuid)'];

// Promoción (013): se salta (sigue en la lista) a quien no tiene el perfil completo; risk = true, también sin cobertura.
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
              AND profile_missing(w.student_id) = '{}' ${risk ? 'AND has_risk_cover(w.student_id)' : ''} THEN
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

// Inscribirse a un evento (028); risk = true con la regla requires_risk_cover.
const registerSql = (risk) => `
    CREATE OR REPLACE FUNCTION register_event(p_event uuid, p_subject uuid, p_guest boolean) RETURNS event_registrations
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
        ${risk ? `IF e.requires_risk_cover AND NOT has_risk_cover(p_subject) THEN RAISE EXCEPTION 'no_risk_cover'; END IF;` : ''}
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
`;

// Aviso de re-firma (020); risk = true, sin el waiver de quien tiene el seguro en vigor.
const agreementNoticeSql = (risk) => `
    CREATE OR REPLACE FUNCTION agreement_notice(p_document uuid) RETURNS void
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
             ${risk ? `AND NOT (d.type = 'waiver' AND EXISTS (
                   SELECT 1 FROM insurances i WHERE i.student_id = p.id AND i.status IN ('active', 'past_due')))` : ''}
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
`;

export const up = async (pgm) => {
  // PDFs de los waiver: se leen ya (service_role salta la RLS forzada) y se borran al final.
  await pgm.db.query('SET ROLE service_role');
  const { rows: pdfs } = await pgm.db.query(`SELECT storage_path FROM agreement_documents WHERE type = 'waiver'`);
  await pgm.db.query('RESET ROLE');

  pgm.sql(bookSessionSql(false));
  pgm.sql(promoteSql(false));
  pgm.sql(registerSql(false));
  pgm.sql(agreementNoticeSql(false));
  pgm.sql(`DROP FUNCTION visible_risk_cover(uuid); DROP FUNCTION has_risk_cover(uuid);`);
  pgm.dropColumn('events', 'requires_risk_cover');

  pgm.sql(`
    SET LOCAL ROLE service_role;
    DELETE FROM invoices WHERE insurance_id IS NOT NULL;
    DELETE FROM notice_deliveries WHERE audit_id IN (SELECT id FROM audit_log WHERE action LIKE 'notice.insurance\\_%');
    DELETE FROM audit_log WHERE action LIKE 'notice.insurance\\_%';
    DELETE FROM academy_settings WHERE key LIKE 'insurance\\_%';
    DELETE FROM user_agreements WHERE type = 'waiver';
    DELETE FROM agreement_documents WHERE type = 'waiver';
    RESET ROLE;
  `);
  pgm.dropConstraint('invoices', 'invoices_owner_check');
  pgm.dropColumn('invoices', 'insurance_id');
  pgm.dropTable('insurances');
  for (const t of ['user_agreements', 'agreement_documents']) {
    pgm.dropConstraint(t, `${t}_type_check`);
    pgm.addConstraint(t, `${t}_type_check`, { check: TYPES(false) });
  }

  const dir = path.resolve(process.env.AGREEMENTS_STORAGE_PATH || './storage/agreements');
  for (const { storage_path: p } of pdfs) await fs.rm(path.join(dir, path.basename(p)), { force: true });
};

export const down = (pgm) => {
  for (const t of ['user_agreements', 'agreement_documents']) {
    pgm.dropConstraint(t, `${t}_type_check`);
    pgm.addConstraint(t, `${t}_type_check`, { check: TYPES(true) });
  }
  pgm.createTable('insurances', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    student_id: { type: 'uuid', notNull: true, references: 'profiles' },
    payer_id: { type: 'uuid', notNull: true, references: 'profiles' },
    status: { type: 'sub_status', notNull: true },
    bracket: { type: 'text', notNull: true, check: `bracket IN ('adult', 'minor')` },
    stripe_subscription_id: { type: 'text', notNull: true, unique: true },
    current_period_start: { type: 'timestamptz' },
    current_period_end: { type: 'timestamptz' },
    cancel_at_period_end: { type: 'boolean', notNull: true, default: false },
    cancelled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('insurances', 'payer_id');
  pgm.createIndex('insurances', 'student_id', { unique: true, where: `status IN ${LIVE}`, name: 'insurances_one_live_idx' });
  pgm.addColumn('invoices', { insurance_id: { type: 'uuid', references: 'insurances' } });
  pgm.createIndex('invoices', 'insurance_id');
  pgm.addConstraint('invoices', 'invoices_owner_check', { check: 'num_nonnulls(subscription_id, insurance_id) = 1' });
  pgm.addColumn('events', { requires_risk_cover: { type: 'boolean', notNull: true, default: true } });
  pgm.sql(`
    ALTER TABLE insurances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE insurances FORCE ROW LEVEL SECURITY;
    CREATE POLICY insurances_select ON insurances FOR SELECT TO app_user
      USING ((student_id = ${UID} OR is_guardian_of(student_id, true)) OR payer_id = ${UID} OR ${IS_ADMIN});
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON insurances FROM app_user;
    GRANT SELECT ON insurances TO app_user;

    CREATE FUNCTION has_risk_cover(p_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM insurances WHERE student_id = p_id AND status IN ('active', 'past_due'))
            OR signed_current(p_id, 'waiver')
      $$;
    CREATE FUNCTION visible_risk_cover(p_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT has_risk_cover(p_id)
         WHERE ${SEES} OR (current_setting('app.current_role', true) = 'profesor' AND teaches_student(p_id))
      $$;
    ${RISK_FNS.map((f) => `ALTER FUNCTION ${f} OWNER TO service_role; REVOKE ALL ON FUNCTION ${f} FROM PUBLIC;`).join('\n    ')}
    GRANT EXECUTE ON FUNCTION visible_risk_cover(uuid) TO app_user;
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES ('insurance_enabled', 'false') ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);
  pgm.sql(agreementNoticeSql(true));
  pgm.sql(registerSql(true));
  pgm.sql(promoteSql(true));
  pgm.sql(bookSessionSql(true));
};
