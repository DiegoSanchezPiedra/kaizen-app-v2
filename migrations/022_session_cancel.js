// migrations/022_session_cancel.js
// B6.1: sesiones sueltas, cancelar y recuperar una sesión, cancelación retroactiva, deshacer un ajuste, retirar una
// clase sin tocar el pasado (CONTEXT § Clases y sesiones). cancel_session_bookings (009/010) se sustituye por
// cancel_session_row (interna) y dos públicas encima, cancel_session y retire_class. Toda escritura sobre una sesión
// existente pasa por funciones: se revoca el UPDATE de class_sessions para app_user.
// `class_*`: lo que dice su clase para la sesión, como `slot` para el inicio; deshacer un ajuste vuelve a ellos.
// Orden de bloqueos: disciplina → clase → sesiones (por id) → alumnos (promote_waitlist).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`; // NULL nunca cuenta como admin en un IF NOT
const TZ = 'Europe/Madrid';
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;

const PUBLIC_FNS = [
  'cancel_session(uuid, text)', 'restore_session(uuid)', 'reset_session(uuid, text[])', 'retire_class(uuid, date)',
];
const INTERNAL_FNS = ['cancel_session_row(class_sessions, text)'];
const CLASS_COLS = ['class_trainer_id', 'class_duration_min', 'class_capacity', 'class_location'];

// apply_session_change (021). cls = true: también escribe los class_* y cuentan como cambio (los escribe change_class).
const applySessionChangeSql = (cls) => `
  CREATE OR REPLACE FUNCTION apply_session_change(s class_sessions, n class_sessions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      fields text[] := '{}';
      id_ uuid;
      notified integer := 0;
      promoted integer := 0;
    BEGIN
      n.ends_at := n.starts_at + n.duration_min * interval '1 minute';
      IF (n.trainer_id, n.slot, n.starts_at, n.duration_min, n.capacity, n.location, n.adjusted_fields${cls ? `,
          n.class_trainer_id, n.class_duration_min, n.class_capacity, n.class_location` : ''})
         IS NOT DISTINCT FROM (s.trainer_id, s.slot, s.starts_at, s.duration_min, s.capacity, s.location, s.adjusted_fields${cls ? `,
          s.class_trainer_id, s.class_duration_min, s.class_capacity, s.class_location` : ''}) THEN
        RETURN jsonb_build_object('changed', false, 'notified', 0, 'promoted', 0);
      END IF;
      IF s.status = 'scheduled' THEN
        IF n.starts_at <> s.starts_at THEN fields := array_append(fields, 'starts_at'); END IF;
        IF n.duration_min <> s.duration_min THEN fields := array_append(fields, 'duration_min'); END IF;
        IF n.trainer_id <> s.trainer_id THEN fields := array_append(fields, 'trainer_id'); END IF;
      END IF;
      UPDATE class_sessions
         SET trainer_id = n.trainer_id, slot = n.slot, starts_at = n.starts_at, ends_at = n.ends_at,
             duration_min = n.duration_min, capacity = n.capacity, location = n.location,
             adjusted_fields = n.adjusted_fields,${cls ? `
             class_trainer_id = n.class_trainer_id, class_duration_min = n.class_duration_min,
             class_capacity = n.class_capacity, class_location = n.class_location,` : ''}
             changed_at = CASE WHEN fields <> '{}' THEN now() ELSE changed_at END
       WHERE id = s.id;
      IF fields <> '{}' THEN
        FOR id_ IN SELECT id FROM bookings
                    WHERE session_id = s.id AND status <> 'cancelled' AND created_at < now()
                    ORDER BY created_at, id LOOP
          PERFORM booking_notice(id_, 'notice.session_changed',
                                 jsonb_build_object('fields', to_jsonb(fields), 'previous_starts_at', s.starts_at));
          notified := notified + 1;
        END LOOP;
      END IF;
      IF n.capacity > s.capacity THEN promoted := promote_waitlist(s.id); END IF; -- 0 si no está programada
      RETURN jsonb_build_object('changed', true, 'notified', notified, 'promoted', promoted);
    END
    $$;
`;

// change_class (021). cls = true: escribe los class_* de cada sesión afectada cuando el patch trae el campo, también
// en los campos ajustados (que en los valores de la sesión no toca).
const changeClassSql = (cls) => {
  const set = (f, v) => (cls ? `n.class_${f} := ${v}; ` : '');
  return `
  CREATE OR REPLACE FUNCTION change_class(p_class uuid, p_from date, p_patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      c classes;
      s class_sessions;
      n class_sessions;
      ids uuid[];
      sid uuid;
      r jsonb;
      over jsonb;
      last_slot timestamptz;
      fits date;
      changed integer := 0;
      notified integer := 0;
      promoted integer := 0;
    BEGIN
      IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
      SELECT * INTO c FROM classes WHERE id = p_class FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'class_not_found'; END IF;
      UPDATE classes
         SET trainer_id = COALESCE((p_patch->>'trainer_id')::uuid, trainer_id),
             start_time = COALESCE((p_patch->>'start_time')::time, start_time),
             duration_min = COALESCE((p_patch->>'duration_min')::integer, duration_min),
             capacity = COALESCE((p_patch->>'capacity')::integer, capacity),
             location = CASE WHEN p_patch ? 'location' THEN p_patch->>'location' ELSE location END
       WHERE id = p_class RETURNING * INTO c;

      -- Todas las afectadas, bloqueadas por id antes de tocar ninguna: dos cambios a la vez bloquean en el mismo
      -- orden, y nunca se espera una sesión con un alumno ya bloqueado.
      SELECT array_agg(id ORDER BY id) INTO ids FROM (
        SELECT id FROM class_sessions
         WHERE class_id = p_class AND slot >= p_from::timestamp AT TIME ZONE '${TZ}' AND starts_at > now()
         ORDER BY id FOR UPDATE) x;
      ids := COALESCE(ids, '{}');

      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'starts_at', x.starts_at, 'confirmed', x.confirmed)
                       ORDER BY x.slot), max(x.slot)
        INTO over, last_slot
        FROM (SELECT cs.id, cs.starts_at, cs.slot,
                     (SELECT count(*) FROM bookings b WHERE b.session_id = cs.id AND b.status = 'confirmed') AS confirmed
                FROM class_sessions cs
               WHERE cs.id = ANY(ids) AND p_patch ? 'capacity' AND NOT 'capacity' = ANY(cs.adjusted_fields)) x
       WHERE x.confirmed > c.capacity;
      IF over IS NOT NULL THEN
        fits := (last_slot AT TIME ZONE '${TZ}')::date + 1;
        RAISE EXCEPTION 'capacity_below_bookings' USING DETAIL = jsonb_build_object('sessions', over,
          'fits_from', CASE WHEN fits <= (now() AT TIME ZONE '${TZ}')::date + academy_int('horizon_days', 365)
                            THEN fits END)::text;
      END IF;

      FOREACH sid IN ARRAY ids LOOP
        SELECT * INTO s FROM class_sessions WHERE id = sid;
        n := s;
        IF p_patch ? 'trainer_id' THEN
          ${set('trainer_id', 'c.trainer_id')}IF NOT 'trainer_id' = ANY(s.adjusted_fields) THEN n.trainer_id := c.trainer_id; END IF;
        END IF;
        IF p_patch ? 'start_time' THEN
          n.slot := ((s.slot AT TIME ZONE '${TZ}')::date + c.start_time) AT TIME ZONE '${TZ}';
          IF NOT 'starts_at' = ANY(s.adjusted_fields) THEN n.starts_at := n.slot; END IF;
        END IF;
        IF p_patch ? 'duration_min' THEN
          ${set('duration_min', 'c.duration_min')}IF NOT 'duration_min' = ANY(s.adjusted_fields) THEN n.duration_min := c.duration_min; END IF;
        END IF;
        IF p_patch ? 'capacity' THEN
          ${set('capacity', 'c.capacity')}IF NOT 'capacity' = ANY(s.adjusted_fields) THEN n.capacity := c.capacity; END IF;
        END IF;
        IF p_patch ? 'location' THEN
          ${set('location', 'c.location')}IF NOT 'location' = ANY(s.adjusted_fields) THEN n.location := c.location; END IF;
        END IF;
        r := apply_session_change(s, n);
        changed := changed + (r->>'changed')::boolean::integer;
        notified := notified + (r->>'notified')::integer;
        promoted := promoted + (r->>'promoted')::integer;
      END LOOP;

      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), ${UID}, 'class.change', 'class', p_class::text,
              jsonb_build_object('from', p_from, 'patch', p_patch,
                                 'sessions_changed', changed, 'notified', notified, 'promoted', promoted));
      RETURN jsonb_build_object('sessions_changed', changed, 'notified', notified, 'promoted', promoted);
    END
    $$;
`;
};

// cancel_session_bookings de 010, para el down.
const cancelSessionBookingsSql = `
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
      -- Sesión cancelada: no tiene lista.
      DELETE FROM attendance WHERE session_id = p_session;
      UPDATE class_sessions SET attendance_closed_at = NULL, attendance_closed_by = NULL WHERE id = p_session;
      RETURN n;
    END
    $$;
  ALTER FUNCTION cancel_session_bookings(uuid) OWNER TO service_role;
  REVOKE ALL ON FUNCTION cancel_session_bookings(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION cancel_session_bookings(uuid) TO app_user;
`;

export const up = (pgm) => {
  pgm.addColumns('class_sessions', {
    cancelled_at: { type: 'timestamptz' },
    cancelled_by: { type: 'uuid', references: 'profiles', onDelete: 'SET NULL' },
    cancel_note: { type: 'text' }, // motivo del admin: solo lo ve él, nunca va en un aviso (podría llevar salud)
    // Lo que dice su clase para esta sesión (NULL en una suelta). Lo escriben la generación y change_class.
    class_trainer_id: { type: 'uuid', references: 'profiles', onDelete: 'RESTRICT' },
    class_duration_min: { type: 'integer' },
    class_capacity: { type: 'integer' },
    class_location: { type: 'text' },
  });
  // class_sessions tiene RLS FORCE y migrator no tiene política: el backfill entra como service_role (ver 021).
  // Un campo ajustado toma el valor actual de la clase (impreciso solo tras un cambio de clase de fecha futura).
  pgm.sql(`
    SET LOCAL ROLE service_role;
    UPDATE class_sessions SET cancelled_at = now() WHERE status = 'cancelled';
    UPDATE class_sessions s
       SET class_trainer_id = CASE WHEN 'trainer_id' = ANY(s.adjusted_fields) THEN c.trainer_id ELSE s.trainer_id END,
           class_duration_min = CASE WHEN 'duration_min' = ANY(s.adjusted_fields) THEN c.duration_min ELSE s.duration_min END,
           class_capacity = CASE WHEN 'capacity' = ANY(s.adjusted_fields) THEN c.capacity ELSE s.capacity END,
           class_location = CASE WHEN 'location' = ANY(s.adjusted_fields) THEN c.location ELSE s.location END
      FROM classes c WHERE c.id = s.class_id;
    RESET ROLE;
  `);
  pgm.addConstraint('class_sessions', 'class_sessions_cancel_check', {
    check: `(status = 'cancelled') = (cancelled_at IS NOT NULL) AND char_length(cancel_note) <= 500`,
  });
  pgm.addConstraint('class_sessions', 'class_sessions_class_values_check', {
    check: `CASE WHEN class_id IS NULL
                 THEN class_trainer_id IS NULL AND class_duration_min IS NULL AND class_capacity IS NULL
                      AND class_location IS NULL
                 ELSE class_trainer_id IS NOT NULL AND class_duration_min IS NOT NULL AND class_capacity IS NOT NULL END`,
  });

  pgm.sql(applySessionChangeSql(true));
  pgm.sql(changeClassSql(true));

  pgm.sql(`
    -- Cancelar una sesión ya bloqueada (s), con su motivo (CONTEXT «Cancelar una sesión»): anula reservas y esperas
    -- con session_cancelled (con aviso solo si no ha empezado) y su lista, tras guardar una instantánea.
    -- Devuelve { cancelled_bookings, notified, attendance }.
    CREATE FUNCTION cancel_session_row(s class_sessions, p_note text) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        id_ uuid;
        n integer := 0;
        notified integer := 0;
        att jsonb;
      BEGIN
        SELECT jsonb_build_object('closed_at', s.attendance_closed_at,
                 'present', COALESCE(jsonb_agg(student_id ORDER BY student_id) FILTER (WHERE status = 'present'), '[]'),
                 'absent', COALESCE(jsonb_agg(student_id ORDER BY student_id) FILTER (WHERE status = 'absent'), '[]'))
          INTO att FROM attendance WHERE session_id = s.id;
        DELETE FROM attendance WHERE session_id = s.id; -- sesión cancelada: no tiene lista
        UPDATE class_sessions
           SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${UID}, cancel_note = p_note,
               attendance_closed_at = NULL, attendance_closed_by = NULL
         WHERE id = s.id;
        FOR id_ IN UPDATE bookings SET status = 'cancelled', cancel_reason = 'session_cancelled',
                                       cancelled_at = now(), cancelled_by = ${UID}
                    WHERE session_id = s.id AND status <> 'cancelled' RETURNING id LOOP
          n := n + 1;
          IF s.starts_at > now() THEN -- la retroactiva no avisa: el aviso nacería caducado
            PERFORM booking_notice(id_, 'notice.session_cancelled');
            notified := notified + 1;
          END IF;
        END LOOP;
        RETURN jsonb_build_object('cancelled_bookings', n, 'notified', notified, 'attendance', att);
      END
      $$;

    -- Cancelar una sesión con la frontera en el inicio: antes, con aviso y motivo opcional; desde el inicio
    -- (también en curso), cancelación retroactiva, con motivo y sin aviso. Una cancelada → session_cancelled.
    CREATE FUNCTION cancel_session(p_session uuid, p_note text) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        note text := NULLIF(btrim(p_note), '');
        retro boolean;
        r jsonb;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
        IF s.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled'; END IF;
        retro := s.starts_at <= now();
        IF retro AND note IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
        r := cancel_session_row(s, note);
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'session.cancel', 'session', s.id::text,
                jsonb_build_object('note', note, 'retroactive', retro) || r);
        RETURN jsonb_build_object('retroactive', retro, 'cancelled_bookings', r->'cancelled_bookings',
                                  'notified', r->'notified');
      END
      $$;

    -- Recuperar una sesión cancelada que no ha empezado (CONTEXT): vuelve con los valores que tiene y sin reservas;
    -- avisa a las reservas y esperas que anuló esa cancelación (mismo cancelled_at). La disciplina y la clase se
    -- bloquean antes que la sesión (orden de bloqueos); class_id y discipline_id nunca cambian.
    CREATE FUNCTION restore_session(p_session uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        active boolean;
        ends date;
        id_ uuid;
        notified integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
        SELECT is_active INTO active FROM disciplines WHERE id = s.discipline_id FOR SHARE;
        IF s.class_id IS NOT NULL THEN SELECT ends_on INTO ends FROM classes WHERE id = s.class_id FOR SHARE; END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF s.status <> 'cancelled' THEN RAISE EXCEPTION 'session_not_cancelled'; END IF;
        IF s.starts_at <= now() THEN RAISE EXCEPTION 'session_started'; END IF;
        IF (s.slot AT TIME ZONE '${TZ}')::date > ends THEN RAISE EXCEPTION 'class_retired'; END IF;
        IF NOT active THEN RAISE EXCEPTION 'discipline_inactive'; END IF;
        UPDATE class_sessions SET status = 'scheduled', cancelled_at = NULL, cancelled_by = NULL, cancel_note = NULL
         WHERE id = s.id;
        FOR id_ IN SELECT id FROM bookings
                    WHERE session_id = s.id AND cancel_reason = 'session_cancelled' AND cancelled_at = s.cancelled_at
                    ORDER BY created_at, id LOOP
          PERFORM booking_notice(id_, 'notice.session_restored');
          notified := notified + 1;
        END LOOP;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'session.restore', 'session', s.id::text,
                jsonb_build_object('notified', notified));
        RETURN jsonb_build_object('notified', notified);
      END
      $$;

    -- Deshacer un ajuste (CONTEXT): cada campo sale de adjusted_fields y vuelve a lo que dice su clase para la
    -- sesión (class_*; starts_at, a slot). Un campo no ajustado no hace nada. El resto, como un ajuste
    -- (apply_session_change): aviso y exención si cambia inicio, duración o profesor; promoción si sube el aforo.
    CREATE FUNCTION reset_session(p_session uuid, p_fields text[]) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        n class_sessions;
        r jsonb;
        f text;
        cleared text[] := '{}';
        confirmed integer;
        before jsonb := '{}';
        after jsonb := '{}';
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        IF COALESCE(p_fields, '{}') = '{}' OR NOT p_fields <@ ARRAY['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location'] THEN
          RAISE EXCEPTION 'invalid_field';
        END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
        IF s.class_id IS NULL THEN RAISE EXCEPTION 'loose_session'; END IF;
        IF s.status <> 'scheduled' OR s.starts_at <= now() THEN RAISE EXCEPTION 'session_not_adjustable'; END IF;
        n := s;
        FOREACH f IN ARRAY p_fields LOOP
          CONTINUE WHEN NOT f = ANY(n.adjusted_fields);
          n.adjusted_fields := array_remove(n.adjusted_fields, f);
          cleared := array_append(cleared, f);
          CASE f
            WHEN 'trainer_id' THEN n.trainer_id := s.class_trainer_id;
            WHEN 'starts_at' THEN
              IF s.slot <= now() THEN RAISE EXCEPTION 'slot_passed'; END IF;
              n.starts_at := s.slot;
            WHEN 'duration_min' THEN n.duration_min := s.class_duration_min;
            WHEN 'capacity' THEN n.capacity := s.class_capacity;
            WHEN 'location' THEN n.location := s.class_location;
          END CASE;
        END LOOP;

        confirmed := (SELECT count(*) FROM bookings WHERE session_id = s.id AND status = 'confirmed');
        IF n.capacity < confirmed THEN
          RAISE EXCEPTION 'capacity_below_bookings' USING DETAIL = jsonb_build_object('sessions', jsonb_build_array(
            jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'confirmed', confirmed)))::text;
        END IF;

        FOREACH f IN ARRAY cleared LOOP
          IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(s) -> f THEN
            before := before || jsonb_build_object(f, to_jsonb(s) -> f);
            after := after || jsonb_build_object(f, to_jsonb(n) -> f);
          END IF;
        END LOOP;

        r := apply_session_change(s, n);
        IF (r->>'changed')::boolean THEN
          INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
          VALUES (gen_random_uuid(), ${UID}, 'session.reset', 'session', s.id::text,
                  jsonb_build_object('fields', to_jsonb(cleared), 'before', before, 'after', after));
        END IF;
        RETURN jsonb_build_object('sessions_changed', (r->>'changed')::boolean::integer,
                                  'notified', r->'notified', 'promoted', r->'promoted');
      END
      $$;

    -- Retirar una clase (CONTEXT): acaba el día anterior a p_date (por defecto hoy, nunca pasado) y se cancelan,
    -- con aviso, sus sesiones programadas con slot desde p_date que no han empezado. El pasado se conserva.
    -- El tope del horizonte lo pone services/classes.js: desactivar una disciplina retira desde su inicio.
    CREATE FUNCTION retire_class(p_class uuid, p_date date) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        c classes;
        d date := COALESCE(p_date, ${TODAY});
        ids uuid[];
        sid uuid;
        s class_sessions;
        r jsonb;
        notified integer := 0;
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO c FROM classes WHERE id = p_class FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'class_not_found'; END IF;
        IF d < ${TODAY} THEN RAISE EXCEPTION 'invalid_date'; END IF;
        IF c.ends_on <= d - 1 THEN RAISE EXCEPTION 'already_retired'; END IF;
        IF d < c.starts_on THEN RAISE EXCEPTION 'before_start'; END IF;
        UPDATE classes SET ends_on = d - 1 WHERE id = p_class;
        SELECT array_agg(id ORDER BY id) INTO ids FROM (
          SELECT id FROM class_sessions
           WHERE class_id = p_class AND status = 'scheduled' AND starts_at > now()
             AND slot >= d::timestamp AT TIME ZONE '${TZ}'
           ORDER BY id FOR UPDATE) x;
        ids := COALESCE(ids, '{}');
        FOREACH sid IN ARRAY ids LOOP
          SELECT * INTO s FROM class_sessions WHERE id = sid;
          r := cancel_session_row(s, NULL);
          notified := notified + (r->>'notified')::integer;
        END LOOP;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'class.retire', 'class', p_class::text,
                jsonb_build_object('from', d, 'sessions', to_jsonb(ids)));
        RETURN jsonb_build_object('cancelled_sessions', cardinality(ids), 'notified', notified);
      END
      $$;

    DROP FUNCTION cancel_session_bookings(uuid);
    REVOKE UPDATE ON class_sessions FROM app_user;
    DROP POLICY class_sessions_update_admin ON class_sessions;
  `);
  for (const fn of [...INTERNAL_FNS, ...PUBLIC_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
};

export const down = (pgm) => {
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(`
    CREATE POLICY class_sessions_update_admin ON class_sessions FOR UPDATE TO app_user
      USING (${ROLE} = 'admin') WITH CHECK (${ROLE} = 'admin');
    GRANT UPDATE ON class_sessions TO app_user;
  `);
  pgm.sql(cancelSessionBookingsSql);
  pgm.sql(changeClassSql(false));
  pgm.sql(applySessionChangeSql(false));
  pgm.dropConstraint('class_sessions', 'class_sessions_class_values_check');
  pgm.dropConstraint('class_sessions', 'class_sessions_cancel_check');
  pgm.dropColumns('class_sessions', ['cancelled_at', 'cancelled_by', 'cancel_note', ...CLASS_COLS]);
};
