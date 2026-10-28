// migrations/011_checkin.js
// B9: tablets y check-in por QR (CONTEXT § Asistencia). La tablet no es usuario: llama sin contexto RLS a
// link_tablet / tablet_feed, que validan su token. El QR no se guarda: es un HMAC del tramo de tiempo (backend).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;

const PUBLIC_FNS = ['link_tablet(text, text)', 'tablet_feed(text)', 'check_in(uuid)', 'checkin_qr_seconds()'];
const INTERNAL_FNS = ['checkin_window_open(timestamptz)'];
const SETTINGS = { checkin_opens_minutes: 30, checkin_closes_minutes: 10, checkin_qr_seconds: 30 };

export const up = (pgm) => {
  pgm.createTable('device_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    token_hash: { type: 'text', unique: true }, // sha256 del device_token; NULL hasta vincular
    link_code_hash: { type: 'text', unique: true }, // sha256 del código de un solo uso; NULL tras usarlo
    link_expires_at: { type: 'timestamptz' },
    created_by: { type: 'uuid', references: 'profiles', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    linked_at: { type: 'timestamptz' },
    last_seen_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });

  pgm.sql(`
    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES
      ${Object.entries(SETTINGS).map(([k, v]) => `('${k}', '${v}')`).join(', ')}
    ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);

  pgm.sql(`
    -- Ventana de check-in alrededor del inicio; ambos límites son parámetros de la academia.
    CREATE FUNCTION checkin_window_open(p_starts_at timestamptz) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT now() BETWEEN p_starts_at - academy_int('checkin_opens_minutes', 30) * interval '1 minute'
                         AND p_starts_at + academy_int('checkin_closes_minutes', 10) * interval '1 minute'
      $$;

    -- Periodo del QR: lo lee también la tablet, que no tiene contexto RLS para leer academy_settings.
    CREATE FUNCTION checkin_qr_seconds() RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT academy_int('checkin_qr_seconds', 30)
      $$;

    -- Vincular: el código vale una vez, caduca y no sirve en una tablet revocada.
    CREATE FUNCTION link_tablet(p_code_hash text, p_token_hash text) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        id_ uuid;
      BEGIN
        UPDATE device_tokens SET token_hash = p_token_hash, linked_at = now(), link_code_hash = NULL,
                                 link_expires_at = NULL
         WHERE link_code_hash = p_code_hash AND link_expires_at > now() AND revoked_at IS NULL
           AND token_hash IS NULL
        RETURNING id INTO id_;
        IF id_ IS NULL THEN RAISE EXCEPTION 'invalid_link_code'; END IF;
        RETURN id_;
      END
      $$;

    -- Lo que muestra la tablet: sesiones con la ventana abierta, sin nombres de alumnos.
    CREATE FUNCTION tablet_feed(p_token_hash text)
      RETURNS TABLE (session_id uuid, discipline text, starts_at timestamptz, ends_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        UPDATE device_tokens SET last_seen_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found'; END IF;
        RETURN QUERY
          SELECT s.id, d.name, s.starts_at, s.ends_at
            FROM class_sessions s JOIN disciplines d ON d.id = s.discipline_id
           WHERE s.status = 'scheduled' AND s.attendance_closed_at IS NULL AND checkin_window_open(s.starts_at)
           ORDER BY s.starts_at, s.id;
      END
      $$;

    -- Check-in de quien escanea (el QR ya lo validó el backend). Reservas candidatas: activas, propias o de
    -- sus hijos, ventana abierta, lista sin cerrar y aún sin presente. Nunca crea reservas.
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
        -- Mismo bloqueo que close_attendance: si la lista se cerró mientras tanto, se rechaza.
        SELECT * INTO s FROM class_sessions WHERE id = b.session_id FOR UPDATE;
        IF s.attendance_closed_at IS NOT NULL THEN RAISE EXCEPTION 'attendance_closed'; END IF;
        INSERT INTO attendance (session_id, student_id, booking_id, status, method, recorded_by)
        VALUES (b.session_id, b.student_id, b.id, 'present', 'qr', ${UID}) ON CONFLICT DO NOTHING;
        RETURN jsonb_build_object('status', 'checked_in', 'booking_id', b.id, 'session_id', b.session_id,
                                  'student_id', b.student_id);
      END
      $$;
  `);
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);

  pgm.sql(`
    ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE device_tokens FORCE ROW LEVEL SECURITY;
    CREATE POLICY device_tokens_select_admin ON device_tokens FOR SELECT TO app_user USING (${IS_ADMIN});
    CREATE POLICY device_tokens_insert_admin ON device_tokens FOR INSERT TO app_user WITH CHECK (${IS_ADMIN});
    CREATE POLICY device_tokens_update_admin ON device_tokens FOR UPDATE TO app_user
      USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});
    -- Los hashes no se leen ni desde el admin: se quitan los permisos por defecto y se dan por columna.
    REVOKE ALL ON device_tokens FROM app_user;
    GRANT SELECT (id, name, link_expires_at, created_by, created_at, linked_at, last_seen_at, revoked_at)
      ON device_tokens TO app_user;
    GRANT INSERT (name, link_code_hash, link_expires_at, created_by) ON device_tokens TO app_user;
    GRANT UPDATE (revoked_at, link_code_hash, link_expires_at) ON device_tokens TO app_user;
  `);
};

export const down = (pgm) => {
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS]) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.dropTable('device_tokens');
  pgm.sql(`SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key IN (${Object.keys(SETTINGS).map((k) => `'${k}'`).join(', ')});
    RESET ROLE;`);
};
