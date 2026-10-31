// migrations/021_session_changes.js
// B7.1: cambio de clase y ajuste de sesión sobre las reservas (CONTEXT § Clases y sesiones; ADR 0004).
// `slot` (el inicio que le toca a la sesión según su clase) sustituye a starts_at en el UNIQUE de la generación:
// un ajuste que mueve una sesión no deja un hueco que la extensión diaria vuelva a llenar. `changed_at` es el último
// cambio que afecta a la sesión: las reservas anteriores cancelan sin que cuente como tardía.
// Orden de bloqueos, el de book_session: clase → todas las sesiones afectadas (por id) → alumnos (promote_waitlist).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`; // NULL nunca cuenta como admin en un IF NOT
const TZ = 'Europe/Madrid';

const PUBLIC_FNS = ['change_class(uuid, date, jsonb)', 'adjust_session(uuid, jsonb)'];
const INTERNAL_FNS = ['apply_session_change(class_sessions, class_sessions)'];

// cancel_booking (009). exempt = true: tampoco es tardía la reserva (o su entrada en espera) anterior al último
// cambio que afecta a la sesión. exempt = false recrea la de 009 en el down.
const cancelBookingSql = (exempt) => `
  CREATE OR REPLACE FUNCTION cancel_booking(p_booking uuid) RETURNS bookings
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
      ${exempt ? '' : '-- shortcut: falta la exención por cambio de clase; llega con el cambio de clase con propagación.'}
      UPDATE bookings
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${UID},
             cancel_reason = CASE
               WHEN ${IS_ADMIN} THEN 'admin'
               WHEN was.status = 'confirmed' AND now() > deadline
                    AND NOT COALESCE(was.promoted_at >= deadline, false)
                    ${exempt ? 'AND NOT COALESCE(was.created_at < s.changed_at, false)' : ''} THEN 'late'
               ELSE 'student' END::booking_cancel_reason
       WHERE id = p_booking RETURNING * INTO b;
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), ${UID}, 'booking.cancel', 'booking', b.id::text,
              jsonb_build_object('from', was.status, 'reason', b.cancel_reason));
      IF was.status = 'confirmed' THEN PERFORM promote_waitlist(s.id); END IF;
      RETURN b;
    END
    $$;
`;

// booking_notice (020). extra = true: un 3.er argumento se suma a changes (session_changed guarda fields y
// previous_starts_at). Cambia la firma: se borra y se crea (dos versiones harían ambigua la llamada de 2 argumentos).
const bookingNoticeSql = (extra) => `
  DROP FUNCTION booking_notice(${extra ? 'uuid, text' : 'uuid, text, jsonb'});
  CREATE FUNCTION booking_notice(p_booking uuid, p_action text${extra ? `, p_extra jsonb DEFAULT '{}'` : ''})
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
                                 'recipients', to_jsonb(rcpts), 'expires_at', b.starts_at)${extra ? ' || p_extra' : ''});
      IF first THEN PERFORM enqueue_notice(aid, rcpts, ${UID}); END IF;
    END
    $$;
  ALTER FUNCTION booking_notice(${extra ? 'uuid, text, jsonb' : 'uuid, text'}) OWNER TO service_role;
  REVOKE ALL ON FUNCTION booking_notice(${extra ? 'uuid, text, jsonb' : 'uuid, text'}) FROM PUBLIC;
`;

export const up = (pgm) => {
  pgm.addColumns('class_sessions', {
    slot: { type: 'timestamptz' }, // inicio según su clase; NULL en una sesión suelta. Lo cambian la generación y la hora de la clase
    changed_at: { type: 'timestamptz' }, // último cambio que afecta a la sesión (inicio, duración o profesor)
  });
  // class_sessions tiene RLS FORCE y migrator no tiene política: el backfill entra como service_role (ver 009).
  pgm.sql(`
    SET LOCAL ROLE service_role;
    UPDATE class_sessions SET slot = starts_at WHERE class_id IS NOT NULL;
    RESET ROLE;
  `);
  pgm.dropIndex('class_sessions', ['class_id', 'starts_at'], { name: 'class_sessions_class_start_key' });
  pgm.createIndex('class_sessions', ['class_id', 'slot'], {
    unique: true, where: 'class_id IS NOT NULL', name: 'class_sessions_class_slot_key',
  });
  pgm.addConstraint('class_sessions', 'class_sessions_slot_check', { check: '(class_id IS NULL) = (slot IS NULL)' });

  pgm.sql(bookingNoticeSql(true));
  pgm.sql(cancelBookingSql(true));

  pgm.sql(`
    -- Valores nuevos (n) de una sesión ya bloqueada (s). Si cambia el inicio, la duración o el profesor de una
    -- programada (CONTEXT «Cambio que afecta a la sesión»): changed_at y aviso a sus reservas y esperas anteriores.
    -- Si sube el aforo: promoción. Devuelve { changed, notified, promoted }.
    CREATE FUNCTION apply_session_change(s class_sessions, n class_sessions) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        fields text[] := '{}';
        id_ uuid;
        notified integer := 0;
        promoted integer := 0;
      BEGIN
        n.ends_at := n.starts_at + n.duration_min * interval '1 minute';
        IF (n.trainer_id, n.slot, n.starts_at, n.duration_min, n.capacity, n.location, n.adjusted_fields)
           IS NOT DISTINCT FROM (s.trainer_id, s.slot, s.starts_at, s.duration_min, s.capacity, s.location, s.adjusted_fields) THEN
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
               adjusted_fields = n.adjusted_fields,
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

    -- Cambio de clase (CONTEXT): la fila de la clase y sus sesiones con slot desde p_from (día de Madrid) que no han
    -- empezado, también las canceladas; cada sesión, salvo en sus adjusted_fields. El aforo, todo o nada.
    -- Errores: RAISE con el código como mensaje (como book_session); el de aforo lleva { sessions, fits_from } en DETAIL.
    CREATE FUNCTION change_class(p_class uuid, p_from date, p_patch jsonb) RETURNS jsonb
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
          IF p_patch ? 'trainer_id' AND NOT 'trainer_id' = ANY(s.adjusted_fields) THEN n.trainer_id := c.trainer_id; END IF;
          IF p_patch ? 'start_time' THEN
            n.slot := ((s.slot AT TIME ZONE '${TZ}')::date + c.start_time) AT TIME ZONE '${TZ}';
            IF NOT 'starts_at' = ANY(s.adjusted_fields) THEN n.starts_at := n.slot; END IF;
          END IF;
          IF p_patch ? 'duration_min' AND NOT 'duration_min' = ANY(s.adjusted_fields) THEN
            n.duration_min := c.duration_min;
          END IF;
          IF p_patch ? 'capacity' AND NOT 'capacity' = ANY(s.adjusted_fields) THEN n.capacity := c.capacity; END IF;
          IF p_patch ? 'location' AND NOT 'location' = ANY(s.adjusted_fields) THEN n.location := c.location; END IF;
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

    -- Ajuste de sesión (CONTEXT): una sesión programada que no ha empezado, también suelta. Cada campo que cambia
    -- entra en adjusted_fields y ya no lo pisa un cambio de clase. slot no cambia.
    CREATE FUNCTION adjust_session(p_session uuid, p_patch jsonb) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        s class_sessions;
        n class_sessions;
        r jsonb;
        f text;
        confirmed integer;
        before jsonb := '{}';
        after jsonb := '{}';
      BEGIN
        IF NOT (${IS_ADMIN}) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        SELECT * INTO s FROM class_sessions WHERE id = p_session FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
        IF s.status <> 'scheduled' OR s.starts_at <= now() THEN RAISE EXCEPTION 'session_not_adjustable'; END IF;
        n := s;
        n.trainer_id := COALESCE((p_patch->>'trainer_id')::uuid, s.trainer_id);
        n.starts_at := COALESCE((p_patch->>'starts_at')::timestamptz, s.starts_at);
        n.duration_min := COALESCE((p_patch->>'duration_min')::integer, s.duration_min);
        n.capacity := COALESCE((p_patch->>'capacity')::integer, s.capacity);
        IF p_patch ? 'location' THEN n.location := p_patch->>'location'; END IF;

        confirmed := (SELECT count(*) FROM bookings WHERE session_id = s.id AND status = 'confirmed');
        IF n.capacity < confirmed THEN
          RAISE EXCEPTION 'capacity_below_bookings' USING DETAIL = jsonb_build_object('sessions', jsonb_build_array(
            jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'confirmed', confirmed)))::text;
        END IF;

        FOREACH f IN ARRAY ARRAY['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location'] LOOP
          IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(s) -> f THEN
            before := before || jsonb_build_object(f, to_jsonb(s) -> f);
            after := after || jsonb_build_object(f, to_jsonb(n) -> f);
            IF NOT f = ANY(n.adjusted_fields) THEN n.adjusted_fields := array_append(n.adjusted_fields, f); END IF;
          END IF;
        END LOOP;

        r := apply_session_change(s, n);
        IF (r->>'changed')::boolean THEN
          INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
          VALUES (gen_random_uuid(), ${UID}, 'session.adjust', 'session', s.id::text,
                  jsonb_build_object('before', before, 'after', after));
        END IF;
        RETURN jsonb_build_object('sessions_changed', (r->>'changed')::boolean::integer,
                                  'notified', r->'notified', 'promoted', r->'promoted');
      END
      $$;
  `);
  for (const fn of [...INTERNAL_FNS, ...PUBLIC_FNS]) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
  }
  for (const fn of PUBLIC_FNS) pgm.sql(`GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
};

export const down = (pgm) => {
  for (const fn of [...PUBLIC_FNS, ...INTERNAL_FNS].reverse()) pgm.sql(`DROP FUNCTION ${fn};`);
  pgm.sql(cancelBookingSql(false));
  pgm.sql(bookingNoticeSql(false));
  pgm.dropConstraint('class_sessions', 'class_sessions_slot_check');
  pgm.dropIndex('class_sessions', ['class_id', 'slot'], { name: 'class_sessions_class_slot_key' });
  // Falla si dos sesiones de una clase comparten starts_at tras un ajuste: deshacer el ajuste antes de bajar.
  pgm.createIndex('class_sessions', ['class_id', 'starts_at'], {
    unique: true, where: 'class_id IS NOT NULL', name: 'class_sessions_class_start_key',
  });
  pgm.dropColumns('class_sessions', ['slot', 'changed_at']);
};
