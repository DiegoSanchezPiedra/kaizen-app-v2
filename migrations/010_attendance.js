// migrations/010_attendance.js
// B8: asistencia y auditoría (CONTEXT § Asistencia). Como en 009, toda escritura pasa por funciones
// SECURITY DEFINER; app_user solo lee `attendance`. La vista de salud del profesor (004) se sustituye
// por una función: una vista no puede auditar la consulta ni acotarla a una sesión.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`; // NULL nunca cuenta como admin en un IF NOT
const TZ = 'Europe/Madrid';

const PUBLIC_FNS = [
  'mark_attendance(uuid, uuid, boolean)', 'close_attendance(uuid)',
  'correct_attendance(uuid, uuid, attendance_status, text)', 'professor_session_health(uuid)',
];
const INTERNAL_FNS = ['attendance_session(uuid)'];

// 009 + `extra`: 010 añade que cancelar una sesión anula su lista y sus asistencias (cancelación retroactiva).
const cancelSessionBookings = (extra = '') => `
  CREATE OR REPLACE FUNCTION cancel_session_bookings(p_session uuid) RETURNS integer
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
      END LOOP;${extra}
      RETURN n;
    END
    $$;`;

export const up = (pgm) => {
  // Tabla vacía al aplicar (B8 es la primera que la usa): NOT NULL sin backfill.
  pgm.sql(`ALTER TABLE attendance ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
  pgm.addColumns('attendance', {
    booking_id: { type: 'uuid', notNull: true, unique: true, references: 'bookings', onDelete: 'CASCADE' },
    corrected_by: { type: 'uuid', references: 'profiles', onDelete: 'SET NULL' },
  });
  pgm.addConstraint('attendance', 'attendance_correction_check', {
    check: `corrected_at IS NULL OR (correction_reason IS NOT NULL AND btrim(correction_reason) <> '')`,
  });
  pgm.addColumns('class_sessions', {
    attendance_closed_at: { type: 'timestamptz' }, // NULL = sin registrar
    attendance_closed_by: { type: 'uuid', references: 'profiles', onDelete: 'SET NULL' },
  });

  pgm.sql(`
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES ('attendance_correction_hours', '48')
    ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);

  pgm.sql(`
    REVOKE SELECT ON student_health_professor_view FROM app_user;
    DROP VIEW student_health_professor_view;

    -- Sesión sobre la que se pasa lista, bloqueada. Solo su profesor (sustituto incluido) o el admin;
    -- para cualquier otro no existe.
    CREATE FUNCTION attendance_session(p_session uuid) RETURNS class_sessions
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
      BEGIN
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF NOT FOUND OR NOT COALESCE(${IS_ADMIN} OR (${ROLE} = 'profesor' AND s.trainer_id = ${UID}), false) THEN
          RAISE EXCEPTION 'session_not_found';
        END IF;
        IF s.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;
        IF s.starts_at > now() THEN RAISE EXCEPTION 'session_not_started'; END IF;
        RETURN s;
      END
      $$;

    -- Pasar lista: marcar o desmarcar a un alumno con reserva. Antes del cierre no deja rastro (CONTEXT).
    CREATE FUNCTION mark_attendance(p_session uuid, p_student uuid, p_present boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        bid uuid;
      BEGIN
        s := attendance_session(p_session);
        IF s.attendance_closed_at IS NOT NULL THEN RAISE EXCEPTION 'attendance_closed'; END IF;
        SELECT id INTO bid FROM bookings
         WHERE session_id = p_session AND student_id = p_student AND status = 'confirmed';
        IF NOT FOUND THEN RAISE EXCEPTION 'no_active_booking'; END IF;
        IF p_present THEN
          INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
          VALUES (p_session, p_student, bid, 'present', 'manual', ${UID}) ON CONFLICT DO NOTHING;
        ELSE
          DELETE FROM attendance WHERE booking_id = bid;
        END IF;
      END
      $$;

    -- Cerrar la lista: toda reserva sin presente pasa a falta. Sin límite posterior.
    CREATE FUNCTION close_attendance(p_session uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        absent integer;
        result jsonb;
      BEGIN
        s := attendance_session(p_session);
        IF s.attendance_closed_at IS NOT NULL THEN RAISE EXCEPTION 'attendance_closed'; END IF;
        INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
        SELECT b.session_id, b.student_id, b.id, 'absent', 'manual', ${UID}
          FROM bookings b
         WHERE b.session_id = p_session AND b.status = 'confirmed'
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.booking_id = b.id);
        GET DIAGNOSTICS absent = ROW_COUNT;
        UPDATE class_sessions SET attendance_closed_at = now(), attendance_closed_by = ${UID} WHERE id = p_session;
        result := jsonb_build_object('present',
          (SELECT count(*) FROM attendance WHERE session_id = p_session AND status = 'present'), 'absent', absent);
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'attendance.close', 'session', p_session::text, result);
        RETURN result;
      END
      $$;

    -- Corrección tras el cierre: con motivo; el profesor dentro del plazo, el admin siempre.
    CREATE FUNCTION correct_attendance(p_session uuid, p_student uuid, p_status attendance_status, p_reason text)
      RETURNS attendance
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        was attendance;
        a attendance;
      BEGIN
        s := attendance_session(p_session);
        IF s.attendance_closed_at IS NULL THEN RAISE EXCEPTION 'attendance_not_closed'; END IF;
        IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
        IF NOT (${IS_ADMIN}) AND now() > s.attendance_closed_at
             + academy_int('attendance_correction_hours', 48) * interval '1 hour' THEN
          RAISE EXCEPTION 'correction_window_expired';
        END IF;
        SELECT * INTO was FROM attendance WHERE session_id = p_session AND student_id = p_student FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'no_active_booking'; END IF; -- lista cerrada: toda reserva tiene fila
        IF was.status = p_status THEN RAISE EXCEPTION 'no_change'; END IF;
        UPDATE attendance SET status = p_status, corrected_at = now(), corrected_by = ${UID},
                              correction_reason = btrim(p_reason)
         WHERE id = was.id RETURNING * INTO a;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'attendance.correct', 'session', p_session::text,
                jsonb_build_object('student_id', p_student, 'from', was.status, 'to', p_status, 'reason', a.correction_reason));
        RETURN a;
      END
      $$;

    -- Ficha de salud vista por el profesor (CONTEXT): solo su sesión, solo hoy (Madrid), solo alumnos con
    -- reserva activa, nunca experiencia ni disciplina previa. Cada consulta queda en audit_log.
    -- Es la única vía del profesor a student_health_info (su RLS no le deja leer la tabla).
    CREATE FUNCTION professor_session_health(p_session uuid)
      RETURNS TABLE (student_id uuid, display_name text, injuries text, conditions text, allergies text,
                     medication text, emergency_contact_name text, emergency_contact_phone text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      #variable_conflict use_column
      BEGIN
        IF ${ROLE} IS DISTINCT FROM 'profesor' OR NOT EXISTS (
             SELECT 1 FROM class_sessions s
              WHERE s.id = p_session AND s.trainer_id = ${UID} AND s.status = 'scheduled'
                AND (s.starts_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date) THEN
          RAISE EXCEPTION 'session_not_found'; -- mismo error para «no existe» y «no es tuya / no es hoy»
        END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        SELECT gen_random_uuid(), ${UID}, 'health.view', 'session', p_session::text,
               jsonb_build_object('student_ids', COALESCE(jsonb_agg(b.student_id), '[]'::jsonb))
          FROM bookings b WHERE b.session_id = p_session AND b.status = 'confirmed';
        RETURN QUERY
          SELECT b.student_id, p.display_name, h.injuries, h.conditions, h.allergies, h.medication,
                 h.emergency_contact_name, h.emergency_contact_phone
            FROM bookings b
            JOIN profiles p ON p.id = b.student_id
            LEFT JOIN student_health_info h ON h.profile_id = b.student_id
           WHERE b.session_id = p_session AND b.status = 'confirmed'
           ORDER BY p.display_name, b.student_id;
      END
      $$;

    ${cancelSessionBookings(`
      -- Sesión cancelada: no tiene lista.
      DELETE FROM attendance WHERE session_id = p_session;
      UPDATE class_sessions SET attendance_closed_at = NULL, attendance_closed_by = NULL WHERE id = p_session;`)}
  `);
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(`
    ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
    ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
    -- Como bookings_select: propia, de los hijos, todas para el admin, las de sus sesiones para el profesor.
    CREATE POLICY attendance_select ON attendance FOR SELECT TO app_user
      USING (student_id = ${UID} OR is_guardian_of(student_id, true) OR ${IS_ADMIN}
             OR (${ROLE} = 'profesor' AND EXISTS (SELECT 1 FROM class_sessions s WHERE s.id = session_id AND s.trainer_id = ${UID})));
    -- Sin políticas de escritura y sin permisos: solo las funciones escriben.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON attendance FROM app_user;
    GRANT SELECT ON attendance TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT INSERT, UPDATE, DELETE ON attendance TO app_user;
    DROP POLICY attendance_select ON attendance;
    ALTER TABLE attendance NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
  `);
  pgm.sql(cancelSessionBookings());
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS]) pgm.sql(`DROP FUNCTION ${fn};`);

  // Vista de 004 tal cual, para que el down sea reversible.
  pgm.sql(`
    CREATE VIEW student_health_professor_view
    WITH (security_barrier = true, security_invoker = false)
    AS
    SELECT profile_id, injuries, conditions
    FROM student_health_info
    WHERE current_setting('app.current_role', true) = 'profesor';
    ALTER VIEW student_health_professor_view OWNER TO service_role;
    GRANT SELECT ON student_health_professor_view TO app_user;
  `);

  pgm.sql(`SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key = 'attendance_correction_hours';
    RESET ROLE;`);
  pgm.dropColumns('class_sessions', ['attendance_closed_at', 'attendance_closed_by']);
  pgm.dropConstraint('attendance', 'attendance_correction_check');
  pgm.dropColumns('attendance', ['booking_id', 'corrected_by']);
  pgm.sql(`ALTER TABLE attendance ALTER COLUMN id DROP DEFAULT;`);
};
