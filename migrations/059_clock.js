// migrations/059_clock.js
// B31: registro de jornada de los profesores empleados (CONTEXT § Registro de jornada; ADR 0025).
// - teacher_employment: tipo de relación del profesor (sin fila, autónomo). Lo escribe solo el admin.
// - clock_events: fichajes (entra, sale, empieza y acaba una pausa). app_user solo inserta profile_id, kind y origin: la
//   hora es la del servidor (default now()). Solo el profesor empleado y para sí mismo.
// - clock_corrections: corrección = registro nuevo que apunta al fichaje (nueva hora, o anularlo con at NULL) o añade uno
//   que falta (kind + at). La pide el profesor (pendiente) o la hace el admin.
// - clock_correction_resolutions: el admin aplica o rechaza (con motivo) una corrección; una fila aparte, nunca un UPDATE.
// Las tres, solo añadir: sin UPDATE ni DELETE para app_user y un trigger que los rechaza a todos salvo el DELETE de
// service_role (la purga de la tarea nocturna, 4 años). RLS: el profesor lo suyo, el admin todo.
// clock_effective: los fichajes como cuentan (con las correcciones aplicadas), con la RLS de quien consulta.
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
      kind clock_kind,
      at timestamptz,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
      requested_by uuid NOT NULL REFERENCES profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      -- Con event_id: nueva hora (o anularlo, at NULL). Sin él: añade el fichaje que falta.
      CHECK (CASE WHEN event_id IS NOT NULL THEN kind IS NULL ELSE kind IS NOT NULL AND at IS NOT NULL END),
      CHECK (at IS NULL OR at <= created_at)
    );
    CREATE INDEX clock_corrections_profile ON clock_corrections (profile_id, created_at);
    CREATE INDEX clock_corrections_event ON clock_corrections (event_id);

    CREATE TABLE clock_correction_resolutions (
      correction_id uuid PRIMARY KEY REFERENCES clock_corrections(id),
      status text NOT NULL CHECK (status IN ('applied', 'rejected')),
      reason text CHECK (status = 'applied' OR COALESCE(btrim(reason), '') <> ''),
      resolved_by uuid NOT NULL REFERENCES profiles(id),
      resolved_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION clock_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_user = 'service_role' THEN RETURN OLD; END IF; -- la purga (4 años)
        RAISE EXCEPTION 'append_only' USING ERRCODE = '42501';
      END
      $$;
    ${TABLES.map((t) => `
    CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION clock_append_only();
    CREATE TRIGGER ${t}_no_truncate BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION clock_append_only();`).join('')}

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
    GRANT INSERT (profile_id, event_id, kind, at, reason, requested_by) ON clock_corrections TO app_user;
    CREATE POLICY clock_corrections_select ON clock_corrections FOR SELECT TO app_user
      USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY clock_corrections_insert ON clock_corrections FOR INSERT TO app_user
      WITH CHECK (requested_by = ${UID} AND ((profile_id = ${UID} AND ${ROLE} = 'profesor') OR ${IS_ADMIN})
                  AND (event_id IS NULL OR EXISTS (SELECT 1 FROM clock_events e
                                                    WHERE e.id = event_id AND e.profile_id = clock_corrections.profile_id)));

    GRANT SELECT ON clock_correction_resolutions TO app_user;
    GRANT INSERT (correction_id, status, reason, resolved_by) ON clock_correction_resolutions TO app_user;
    CREATE POLICY clock_correction_resolutions_select ON clock_correction_resolutions FOR SELECT TO app_user
      USING (EXISTS (SELECT 1 FROM clock_corrections c WHERE c.id = correction_id));
    CREATE POLICY clock_correction_resolutions_insert ON clock_correction_resolutions FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN} AND resolved_by = ${UID});

    -- Fichajes como cuentan: el original con la hora de su última corrección aplicada (fuera si la anula) y los
    -- añadidos por corrección. corrected: la hora o el fichaje vienen de una corrección.
    CREATE VIEW clock_effective WITH (security_invoker = true) AS
      WITH applied AS (
        SELECT c.* FROM clock_corrections c
          JOIN clock_correction_resolutions r ON r.correction_id = c.id AND r.status = 'applied'),
      last AS (
        SELECT DISTINCT ON (event_id) event_id, at FROM applied WHERE event_id IS NOT NULL
         ORDER BY event_id, created_at DESC, id DESC)
      SELECT e.id, e.profile_id, e.kind, COALESCE(l.at, e.at) AS at, e.origin, l.event_id IS NOT NULL AS corrected
        FROM clock_events e LEFT JOIN last l ON l.event_id = e.id
       WHERE l.event_id IS NULL OR l.at IS NOT NULL
      UNION ALL
      SELECT a.id, a.profile_id, a.kind, a.at, 'correction', true FROM applied a WHERE a.event_id IS NULL;
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
