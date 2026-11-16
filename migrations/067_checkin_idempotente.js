// migrations/067_checkin_idempotente.js
// Check-in idempotente (CONTEXT § Asistencia). La BD ya impide duplicados (UNIQUE booking_id y session_id+student_id);
// lo que fallaba era la respuesta: el perdedor de un doble envío decía «hecho», el reintento daba 404 y el tutor, al
// re-escanear, se marcaba solo a la única candidata que le quedaba. Ahora: se marca sin preguntar solo si hay una
// candidata; se pueden elegir varias a la vez; y cada resultado dice si ya estaba registrado y desde cuándo.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;

const grants = (fn) => `ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`;

export const up = (pgm) => {
  pgm.sql(`
    DROP FUNCTION check_in(uuid);

    -- Candidatas: reservas activas propias o de sus hijos con la ventana abierta y la lista sin cerrar, también las
    -- ya registradas (checked_in_at). Antes del cierre toda fila de attendance es un presente (desmarcar la borra).
    CREATE FUNCTION check_in(p_bookings uuid[] DEFAULT NULL) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        cands jsonb;
        picked uuid[];
        c jsonb;
        at timestamptz;
        already boolean;
        closed boolean;
        results jsonb := '[]'::jsonb;
      BEGIN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('booking_id', b.id, 'student_id', b.student_id,
                 'display_name', p.display_name, 'discipline', d.name, 'starts_at', s.starts_at,
                 'checked_in_at', a.recorded_at) ORDER BY s.starts_at, p.display_name, b.id), '[]'::jsonb)
          INTO cands
          FROM bookings b
          JOIN class_sessions s ON s.id = b.session_id
          JOIN disciplines d ON d.id = s.discipline_id
          JOIN profiles p ON p.id = b.student_id
          -- Por persona y sesión (como la UNIQUE): una reserva anulada y rehecha conserva su presente.
          LEFT JOIN attendance a ON a.session_id = b.session_id AND a.student_id = b.student_id
         WHERE b.status = 'confirmed' AND (b.student_id = ${UID} OR is_guardian_of(b.student_id))
           AND s.status = 'scheduled' AND s.attendance_closed_at IS NULL AND checkin_window_open(s.starts_at);
        IF jsonb_array_length(cands) = 0 THEN RAISE EXCEPTION 'no_candidates'; END IF;

        IF p_bookings IS NULL THEN
          -- Sin elección solo se marca si no hay nada que elegir: una candidata, o todas ya registradas.
          IF jsonb_array_length(cands) > 1
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(cands) x WHERE x->'checked_in_at' = 'null') THEN
            RETURN jsonb_build_object('status', 'choose', 'candidates', cands);
          END IF;
          SELECT array_agg((x->>'booking_id')::uuid) INTO picked FROM jsonb_array_elements(cands) x;
        ELSE
          -- Todas las elegidas deben ser candidatas (propias o de un hijo); si no, no se marca ninguna.
          picked := ARRAY(SELECT DISTINCT unnest(p_bookings));
          IF cardinality(picked) = 0 OR EXISTS (SELECT 1 FROM unnest(picked) id
               WHERE NOT cands @> jsonb_build_array(jsonb_build_object('booking_id', id))) THEN
            RAISE EXCEPTION 'no_candidates';
          END IF;
        END IF;

        -- Mismo bloqueo que close_attendance (en orden fijo): si la lista se cerró mientras tanto, se rechaza.
        SELECT bool_or(attendance_closed_at IS NOT NULL) INTO closed
          FROM (SELECT attendance_closed_at FROM class_sessions
                 WHERE id IN (SELECT session_id FROM bookings WHERE id = ANY(picked)) ORDER BY id FOR UPDATE) s;
        IF closed THEN RAISE EXCEPTION 'attendance_closed'; END IF;
        -- Releídas y bloqueadas tras la sesión (mismo orden que cancel_booking): una anulada mientras tanto no entra.
        IF (SELECT count(*) FROM (SELECT 1 FROM bookings WHERE id = ANY(picked) AND status = 'confirmed'
                                    ORDER BY id FOR UPDATE) x) <> cardinality(picked) THEN
          RAISE EXCEPTION 'no_candidates';
        END IF;

        -- Una sentencia por reserva: tras esperar a un INSERT concurrente, el SELECT siguiente ya ve su fila.
        FOR c IN SELECT x FROM jsonb_array_elements(cands) x WHERE (x->>'booking_id')::uuid = ANY(picked) LOOP
          INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
            SELECT session_id, student_id, id, 'present', 'qr', ${UID} FROM bookings WHERE id = (c->>'booking_id')::uuid
          ON CONFLICT DO NOTHING
          RETURNING recorded_at INTO at;
          already := NOT FOUND;
          IF already THEN
            SELECT a.recorded_at INTO at FROM attendance a JOIN bookings b
                ON b.session_id = a.session_id AND b.student_id = a.student_id
             WHERE b.id = (c->>'booking_id')::uuid;
            IF at IS NULL THEN -- el profesor la desmarcó justo entre medias: se marca de nuevo
              INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
                SELECT session_id, student_id, id, 'present', 'qr', ${UID} FROM bookings WHERE id = (c->>'booking_id')::uuid
              RETURNING recorded_at INTO at;
              already := false;
            END IF;
          END IF;
          results := results || jsonb_build_array(c || jsonb_build_object('checked_in_at', at, 'already', already));
        END LOOP;
        RETURN jsonb_build_object('status', 'done', 'results', results);
      END
      $$;
    ${grants('check_in(uuid[])')}
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION check_in(uuid[]);
    CREATE FUNCTION check_in(p_booking uuid DEFAULT NULL) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        cands jsonb;
        b bookings;
        s class_sessions;
      BEGIN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('booking_id', b2.id, 'student_id', b2.student_id,
                 'display_name', p.display_name, 'discipline', d.name, 'starts_at', s2.starts_at)
                 ORDER BY s2.starts_at, p.display_name), '[]'::jsonb)
          INTO cands
          FROM bookings b2
          JOIN class_sessions s2 ON s2.id = b2.session_id
          JOIN disciplines d ON d.id = s2.discipline_id
          JOIN profiles p ON p.id = b2.student_id
         WHERE b2.status = 'confirmed' AND (b2.student_id = ${UID} OR is_guardian_of(b2.student_id))
           AND s2.status = 'scheduled' AND s2.attendance_closed_at IS NULL AND checkin_window_open(s2.starts_at)
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.booking_id = b2.id)
           AND (p_booking IS NULL OR b2.id = p_booking);
        IF jsonb_array_length(cands) = 0 THEN RAISE EXCEPTION 'no_candidates'; END IF;
        IF jsonb_array_length(cands) > 1 THEN
          RETURN jsonb_build_object('status', 'choose', 'candidates', cands);
        END IF;
        SELECT * INTO b FROM bookings WHERE id = (cands->0->>'booking_id')::uuid;
        SELECT * INTO s FROM class_sessions WHERE id = b.session_id FOR UPDATE;
        IF s.attendance_closed_at IS NOT NULL THEN RAISE EXCEPTION 'attendance_closed'; END IF;
        INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
        VALUES (b.session_id, b.student_id, b.id, 'present', 'qr', ${UID}) ON CONFLICT DO NOTHING;
        RETURN jsonb_build_object('status', 'checked_in', 'booking_id', b.id, 'session_id', b.session_id,
                                  'student_id', b.student_id);
      END
      $$;
    ${grants('check_in(uuid)')}
  `);
};
