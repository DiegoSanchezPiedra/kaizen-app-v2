// migrations/060_pauses.js
// B30: pausa con cuota de mantenimiento (CONTEXT § Pausa; ADR 0024). La pausa es una fase del Subscription Schedule;
// aquí, su fila (la escribe el servicio y el webhook confirma el estado) y lo que cambia mientras dura:
// - pauses: suscripción, inicio (la siguiente fecha de cobro), fin, meses, importe pedido, eximida, estado y quién la pidió.
//   app_user solo lee, con la RLS de la suscripción (quien ve la suscripción ve su pausa). Como mucho una viva.
// - in_pause(alumno, instante): si ese instante cae en una pausa no anulada. book_session rechaza (paused) una sesión
//   en pausa, también la espera; la racha (achievements_in) salta las semanas enteras en pausa y en una semana a medias
//   solo rompen las sesiones fuera de ella.
// - cancel_paused_bookings: al pedirla, reservas y esperas de sesiones de esos días, con motivo pause y aviso. Lo mismo
//   cuando un cambio de clase o un ajuste (apply_session_change) mueve la sesión a un día de pausa del alumno.
// - Ajustes por defecto: 3 meses por pausa y 1 pausa por año natural de Madrid. El precio lo pone el admin.
/* eslint-disable camelcase */

export const shorthands = undefined;

const TZ = 'Europe/Madrid';
const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IN_PAUSE = 'in_pause(uuid, timestamptz)';
const CANCEL = 'cancel_paused_bookings(uuid, timestamptz, timestamptz)';
const FULL_WEEK = `EXISTS (SELECT 1 FROM pauses pa JOIN subscriptions su ON su.id = pa.subscription_id
                              WHERE su.student_id = p_id AND pa.status <> 'cancelled'
                                AND pa.starts_at <= g AT TIME ZONE '${TZ}'
                                AND pa.ends_at >= (g + interval '1 week') AT TIME ZONE '${TZ}')`;

// Parches sobre la definición actual (como 058): [función, texto de antes, texto de después]. Si no encuentra, falla.
const PATCHES = [
  ['book_session(uuid, uuid)', `IF NOT covers(p_student, s.discipline_id) THEN`,
    `IF in_pause(p_student, s.starts_at) THEN RAISE EXCEPTION 'paused'; END IF;
      IF NOT covers(p_student, s.discipline_id) THEN`],
  ['achievements_in(uuid, bigint)', `WHEN g IN (SELECT w FROM pweeks) THEN 'sum'`,
    `WHEN ${FULL_WEEK} THEN 'skip'
                 WHEN g IN (SELECT w FROM pweeks) THEN 'sum'`],
  ['achievements_in(uuid, bigint)', `AND s.ends_at <= now()`, `AND s.ends_at <= now() AND NOT in_pause(p_id, s.starts_at)`],
  ['apply_session_change(class_sessions, class_sessions)', `IF fields <> '{}' THEN`,
    `IF 'starts_at' = ANY(fields) THEN
        FOR id_ IN UPDATE bookings b SET status = 'cancelled', cancel_reason = 'pause', cancelled_at = now(),
                                         cancelled_by = ${UID}
                    WHERE b.session_id = s.id AND b.status <> 'cancelled' AND in_pause(b.student_id, n.starts_at)
                RETURNING b.id LOOP
          PERFORM booking_notice(id_, 'notice.pause');
        END LOOP;
      END IF;
      IF fields <> '{}' THEN`],
];
const patch = ([fn, from, to]) => `
  DO $do$
  DECLARE
    def text := pg_get_functiondef('${fn}'::regprocedure);
  BEGIN
    IF position($q$${from}$q$ IN def) = 0 THEN RAISE EXCEPTION '${fn}: no encuentro %', $q$${from}$q$; END IF;
    EXECUTE replace(def, $q$${from}$q$, $q$${to}$q$);
  END
  $do$;
`;

export const up = (pgm) => {
  // Un valor nuevo de enum no se puede usar en la transacción que lo crea (como 012 y 058).
  pgm.noTransaction();
  // shortcut: ADD VALUE no es reversible; el down deja 'pause' en el enum (inofensivo).
  pgm.sql(`ALTER TYPE booking_cancel_reason ADD VALUE IF NOT EXISTS 'pause';`);
  pgm.sql('BEGIN;');
  pgm.sql(`
    CREATE TABLE pauses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id uuid NOT NULL REFERENCES subscriptions(id),
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
      months smallint NOT NULL CHECK (months >= 1),
      price_cents integer NOT NULL CHECK (price_cents > 0), -- la cuota de mantenimiento al pedirla
      exempt boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
      requested_by uuid NOT NULL REFERENCES profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- Como mucho una pausa viva (programada o en curso) por suscripción.
    CREATE UNIQUE INDEX pauses_one_live_idx ON pauses (subscription_id) WHERE status IN ('scheduled', 'active');

    ALTER TABLE pauses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pauses FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON pauses FROM app_user;
    GRANT SELECT ON pauses TO app_user;
    CREATE POLICY pauses_select ON pauses FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = pauses.subscription_id));

    CREATE FUNCTION ${IN_PAUSE.replace('uuid, timestamptz', 'p_student uuid, p_at timestamptz')} RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM pauses pa JOIN subscriptions s ON s.id = pa.subscription_id
                        WHERE s.student_id = p_student AND pa.status <> 'cancelled'
                          AND p_at >= pa.starts_at AND p_at < pa.ends_at)
      $$;
    ALTER FUNCTION ${IN_PAUSE} OWNER TO service_role;
    REVOKE ALL ON FUNCTION ${IN_PAUSE} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${IN_PAUSE} TO app_user;

    -- Como revoke_coverage (012): reservas y esperas de sesiones en [p_from, p_to), con aviso.
    -- shortcut: no promociona la espera de las plazas liberadas (como revoke_coverage y change_discipline).
    CREATE FUNCTION ${CANCEL.replace('uuid, timestamptz, timestamptz', 'p_student uuid, p_from timestamptz, p_to timestamptz')}
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        id_ uuid;
        n integer := 0;
      BEGIN
        PERFORM lock_student(p_student);
        FOR id_ IN UPDATE bookings b SET status = 'cancelled', cancel_reason = 'pause', cancelled_at = now(),
                                         cancelled_by = ${UID}
                     FROM class_sessions x
                    WHERE x.id = b.session_id AND b.student_id = p_student AND b.status <> 'cancelled'
                      AND x.status = 'scheduled' AND x.starts_at > now()
                      AND x.starts_at >= p_from AND x.starts_at < p_to
                RETURNING b.id LOOP
          PERFORM booking_notice(id_, 'notice.pause');
          n := n + 1;
        END LOOP;
        RETURN n;
      END
      $$;
    ALTER FUNCTION ${CANCEL} OWNER TO service_role;
    REVOKE ALL ON FUNCTION ${CANCEL} FROM PUBLIC;

    SET LOCAL ROLE service_role;
    INSERT INTO academy_settings (key, value) VALUES ('pause_max_months', '3'), ('pause_per_year', '1')
      ON CONFLICT (key) DO NOTHING;
    RESET ROLE;
  `);
  PATCHES.forEach((p) => pgm.sql(patch(p)));
  pgm.sql('COMMIT;');
};

// Las reservas canceladas con 'pause' se quedan (el valor sigue en el enum).
export const down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('BEGIN;');
  [...PATCHES].reverse().forEach(([fn, from, to]) => pgm.sql(patch([fn, to, from])));
  pgm.sql(`
    DROP FUNCTION ${CANCEL};
    DROP FUNCTION ${IN_PAUSE};
    DROP TABLE pauses;
    SET LOCAL ROLE service_role;
    DELETE FROM academy_settings WHERE key LIKE 'pause\\_%';
    RESET ROLE;
  `);
  pgm.sql('COMMIT;');
};
