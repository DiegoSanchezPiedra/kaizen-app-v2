// migrations/059_clock.js
// B31: registro de jornada de los profesores empleados (CONTEXT § Registro de jornada; ADR 0025).
// - teacher_employment: tipo de relación del profesor (sin fila, autónomo). Lo escribe solo el admin.
// - clock_events: fichajes (entra, sale, empieza y acaba una pausa). app_user solo inserta profile_id, kind y origin: la
//   hora es la del servidor (default now()). Solo el profesor empleado y para sí mismo.
// - clock_corrections: corrección = registro nuevo que apunta a un fichaje (event_id) o a uno añadido por una corrección
//   aplicada (correction_id), con nueva hora o anulándolo (at NULL), o añade uno que falta (kind + at). La pide el
//   profesor empleado (pendiente) o la hace el admin.
// - clock_correction_resolutions: el admin aplica o rechaza (con motivo) una corrección; una fila aparte, nunca un UPDATE.
// Las tres, solo añadir: sin UPDATE ni DELETE para app_user y un trigger que los rechaza a todos salvo el DELETE de
// service_role de filas de más de 4 años (la purga de la tarea nocturna). RLS: el profesor lo suyo, el admin todo.
// clock_effective: los fichajes como cuentan (cada uno con su última corrección aplicada, por orden de resolución), con la
// RLS de quien consulta.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `COALESCE(${ROLE} = 'admin', false)`;
const TABLES = ['clock_events', 'clock_corrections', 'clock_correction_resolutions'];

export const up = (pgm) => {
  pgm.sql(`
    CREATE TYPE clock_kind AS ENUM ('in', 'out', 'pause_start', 'pause_end');

    CREATE TABLE teacher_employment (
      profile_id uuid PRIMARY KEY REFERENCES profiles(id),
      employment text NOT NULL CHECK (employment IN ('employee', 'self_employed')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES profiles(id)
    );

    CREATE TABLE clock_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profiles(id),
      kind clock_kind NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      origin text NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'tablet'))
    );
    CREATE INDEX clock_events_profile_at ON clock_events (profile_id, at);

    CREATE TABLE clock_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profiles(id),
      event_id uuid REFERENCES clock_events(id),
      correction_id uuid REFERENCES clock_corrections(id),
      kind clock_kind,
      at timestamptz,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
      requested_by uuid NOT NULL REFERENCES profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      -- Con event_id o correction_id (uno): nueva hora (o anularlo, at NULL). Sin ninguno: añade el fichaje que falta.
      CHECK (CASE WHEN event_id IS NOT NULL OR correction_id IS NOT NULL THEN kind IS NULL AND num_nulls(event_id, correction_id) = 1
                  ELSE kind IS NOT NULL AND at IS NOT NULL END),
      CHECK (at IS NULL OR at <= created_at)
    );
    CREATE INDEX clock_corrections_profile ON clock_corrections (profile_id, created_at);
    CREATE INDEX clock_corrections_event ON clock_corrections (event_id);
    CREATE INDEX clock_corrections_correction ON clock_corrections (correction_id);

    CREATE TABLE clock_correction_resolutions (
      correction_id uuid PRIMARY KEY REFERENCES clock_corrections(id),
      status text NOT NULL CHECK (status IN ('applied', 'rejected')),
      reason text CHECK (status = 'applied' OR COALESCE(btrim(reason), '') <> ''),
      resolved_by uuid NOT NULL REFERENCES profiles(id),
      resolved_at timestamptz NOT NULL DEFAULT now()
    );

    -- Sin SECURITY DEFINER: decide por current_user (quien borra), que en una DEFINER sería siempre su dueño.
    CREATE FUNCTION clock_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
      BEGIN
        -- La purga: solo service_role y solo filas de más de 4 años (resolved_at, created_at o at, la que tenga la tabla).
        IF TG_OP = 'DELETE' AND current_user = 'service_role' THEN
          IF COALESCE(to_jsonb(OLD) ->> 'resolved_at', to_jsonb(OLD) ->> 'created_at', to_jsonb(OLD) ->> 'at')::timestamptz
             < now() - interval '4 years' THEN
            RETURN OLD;
          END IF;
        END IF;
        RAISE EXCEPTION 'append_only' USING ERRCODE = '42501';
      END
      $$;
    ${TABLES.map((t) => `
    CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION clock_append_only();
    CREATE TRIGGER ${t}_no_truncate BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION clock_append_only();`).join('')}
    ALTER FUNCTION clock_append_only() OWNER TO service_role;
    REVOKE ALL ON FUNCTION clock_append_only() FROM PUBLIC;

    ${['teacher_employment', ...TABLES].map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON ${t} FROM app_user;`).join('\n    ')}

    GRANT SELECT, INSERT, UPDATE ON teacher_employment TO app_user;
    CREATE POLICY teacher_employment_select ON teacher_employment FOR SELECT TO app_user
      USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY teacher_employment_insert ON teacher_employment FOR INSERT TO app_user WITH CHECK (${IS_ADMIN});
    CREATE POLICY teacher_employment_update ON teacher_employment FOR UPDATE TO app_user
      USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});

    GRANT SELECT ON clock_events TO app_user;
    GRANT INSERT (profile_id, kind, origin) ON clock_events TO app_user;
    CREATE POLICY clock_events_select ON clock_events FOR SELECT TO app_user USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY clock_events_insert ON clock_events FOR INSERT TO app_user
      WITH CHECK (profile_id = ${UID} AND ${ROLE} = 'profesor'
                  AND EXISTS (SELECT 1 FROM teacher_employment te
                               WHERE te.profile_id = ${UID} AND te.employment = 'employee'));

    GRANT SELECT ON clock_corrections TO app_user;
    GRANT INSERT (profile_id, event_id, correction_id, kind, at, reason, requested_by) ON clock_corrections TO app_user;
    CREATE POLICY clock_corrections_select ON clock_corrections FOR SELECT TO app_user
      USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY clock_corrections_insert ON clock_corrections FOR INSERT TO app_user
      WITH CHECK (requested_by = ${UID} AND ((profile_id = ${UID} AND ${ROLE} = 'profesor') OR ${IS_ADMIN})
                  AND EXISTS (SELECT 1 FROM teacher_employment te
                               WHERE te.profile_id = clock_corrections.profile_id AND te.employment = 'employee')
                  AND (event_id IS NULL OR EXISTS (SELECT 1 FROM clock_events e
                                                    WHERE e.id = clock_corrections.event_id AND e.profile_id = clock_corrections.profile_id))
                  AND (correction_id IS NULL OR EXISTS (SELECT 1 FROM clock_corrections t
                                                    WHERE t.id = clock_corrections.correction_id AND t.profile_id = clock_corrections.profile_id)));

    GRANT SELECT ON clock_correction_resolutions TO app_user;
    GRANT INSERT (correction_id, status, reason, resolved_by) ON clock_correction_resolutions TO app_user;
    CREATE POLICY clock_correction_resolutions_select ON clock_correction_resolutions FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM clock_corrections c WHERE c.id = clock_correction_resolutions.correction_id));
    CREATE POLICY clock_correction_resolutions_insert ON clock_correction_resolutions FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN} AND resolved_by = ${UID});

    -- Fichajes como cuentan: los originales y los añadidos por corrección, cada uno con la hora de su última corrección
    -- aplicada (por orden de resolución; fuera si la anula). corrected: la hora o el fichaje vienen de una corrección.
    CREATE VIEW clock_effective WITH (security_invoker = true) AS
      WITH applied AS (
        SELECT c.*, COALESCE(c.event_id, c.correction_id) AS target, r.resolved_at
          FROM clock_corrections c
          JOIN clock_correction_resolutions r ON r.correction_id = c.id AND r.status = 'applied'),
      last AS (
        SELECT DISTINCT ON (target) target, at FROM applied WHERE target IS NOT NULL
         ORDER BY target, resolved_at DESC, id DESC),
      base AS (
        SELECT id, profile_id, kind, at, origin FROM clock_events
        UNION ALL
        SELECT id, profile_id, kind, at, 'correction' FROM applied WHERE target IS NULL)
      SELECT b.id, b.profile_id, b.kind, COALESCE(l.at, b.at) AS at, b.origin,
             l.target IS NOT NULL OR b.origin = 'correction' AS corrected
        FROM base b LEFT JOIN last l ON l.target = b.id
       WHERE l.target IS NULL OR l.at IS NOT NULL;
    REVOKE ALL ON clock_effective FROM app_user;
    GRANT SELECT ON clock_effective TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP VIEW clock_effective;
    DROP TABLE clock_correction_resolutions, clock_corrections, clock_events, teacher_employment;
    DROP FUNCTION clock_append_only();
    DROP TYPE clock_kind;
  `);
};
