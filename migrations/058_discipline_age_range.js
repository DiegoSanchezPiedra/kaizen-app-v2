// migrations/058_discipline_age_range.js
// B29: rango de edad de una disciplina (CONTEXT § Rango de edad de una disciplina). min_age y max_age, opcionales e
// inclusive, sustituyen a disciplines.minors_only (= máxima 17). Una sola regla, in_age_range: años cumplidos el día de
// Madrid de un instante; sin fecha de nacimiento, adulto (18). covers mira solo la máxima, hoy (contratar, elegir,
// cambiar); book_session y promote_waitlist, mínima y máxima el día de la sesión (la promoción salta a quien no cumple).
// age_out_sweep (tarea nocturna): aviso a 30 días y, desde el cumpleaños que supera la máxima, cancela sus reservas y
// esperas futuras de esa disciplina (motivo out_of_age). change_discipline: la abandonada fuera de edad es gratis.
/* eslint-disable camelcase */
import { coversSql } from './019_progress_open_disciplines.js';

export const shorthands = undefined;

const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const BIRTH = `(SELECT birth_date FROM profiles WHERE id = s.student_id)`;

// Cubrir (019) con el rango: solo la máxima, con la edad de hoy («Plan solo menores» no cambia).
const coversAgeSql = `
  CREATE OR REPLACE FUNCTION covers(p_student uuid, p_discipline bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (
        SELECT 1
          FROM subscriptions s
          JOIN plans pl ON pl.id = s.plan_id
          JOIN profiles p ON p.id = s.student_id
          JOIN disciplines d ON d.id = p_discipline AND d.is_active
         WHERE s.student_id = p_student
           AND s.status IN ('active', 'past_due')
           AND (NOT (${ADULT}) OR NOT pl.minors_only)
           AND in_age_range(p.birth_date, NULL, d.max_age, now())
           AND (d.is_open OR CASE WHEN pl.max_disciplines IS NULL
                    -- «todas»: lista de elegibles vacía = cualquiera
                    THEN NOT EXISTS (SELECT 1 FROM plan_disciplines pd WHERE pd.plan_id = pl.id)
                      OR EXISTS (SELECT 1 FROM plan_disciplines pd
                                  WHERE pd.plan_id = pl.id AND pd.discipline_id = d.id)
                    ELSE EXISTS (SELECT 1 FROM subscription_disciplines sd
                                  WHERE sd.subscription_id = s.id AND sd.discipline_id = d.id)
               END)
      )
    $$;
`;

// Parches sobre la definición actual (como 019): [función, texto de antes, texto de después]. Si no encuentra, falla.
const BOOK_COVERS = `IF NOT covers(p_student, s.discipline_id) THEN`;
const BOOK_AGE = `-- Rango de edad el día de la sesión, antes que la cobertura (B29).
      IF NOT (SELECT in_age_range(p.birth_date, d.min_age, d.max_age, s.starts_at)
                FROM profiles p, disciplines d WHERE p.id = p_student AND d.id = s.discipline_id) THEN
        RAISE EXCEPTION 'age_out_of_range' USING DETAIL =
          (SELECT jsonb_build_object('min_age', min_age, 'max_age', max_age)::text FROM disciplines WHERE id = s.discipline_id);
      END IF;
      ${BOOK_COVERS}`;
const PROMOTE_COVERS = `IF NOT covers(w.student_id, s.discipline_id) THEN`;
const PROMOTE_AGE = `IF NOT (SELECT in_age_range(p.birth_date, d.min_age, d.max_age, s.starts_at)
                    FROM profiles p, disciplines d WHERE p.id = w.student_id AND d.id = s.discipline_id) THEN
          NULL; -- fuera de rango el día de la sesión (B29): se le salta y sigue en la lista
        ELS${PROMOTE_COVERS}`;
const PATCHES = [
  ['book_session(uuid, uuid)', BOOK_COVERS, BOOK_AGE],
  ['promote_waitlist(uuid)', PROMOTE_COVERS, PROMOTE_AGE],
  ['change_discipline(uuid, bigint, bigint, uuid)', 'AND NOT (adult AND d.minors_only)',
    `AND in_age_range(${BIRTH}, NULL, d.max_age, now())`],
  ['change_discipline(uuid, bigint, bigint, uuid)', 'OR (adult AND d.minors_only)',
    `OR NOT in_age_range(${BIRTH}, NULL, d.max_age, now())`],
  ['change_discipline(uuid, bigint, bigint, uuid)', 'o solo menores para un adulto', 'o fuera de su edad máxima'],
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

const SWEEP = 'age_out_sweep()';

export const up = (pgm) => {
  // Un valor nuevo de enum no se puede usar en la transacción que lo crea (como 012).
  pgm.noTransaction();
  // shortcut: ADD VALUE no es reversible; el down deja 'out_of_age' en el enum (inofensivo).
  pgm.sql(`ALTER TYPE booking_cancel_reason ADD VALUE IF NOT EXISTS 'out_of_age';`);
  pgm.sql('BEGIN;');

  pgm.sql(`
    ALTER TABLE disciplines
      ADD COLUMN min_age smallint, ADD COLUMN max_age smallint,
      ADD CONSTRAINT disciplines_age_range
        CHECK (min_age BETWEEN 0 AND 99 AND max_age BETWEEN 0 AND 99 AND min_age <= max_age);
    UPDATE disciplines SET max_age = 17 WHERE minors_only;
    ALTER TABLE disciplines DROP COLUMN minors_only;

    -- Si quien nació p_birth cumple el rango (inclusive, años cumplidos) el día de Madrid de p_at. Sin fecha: 18.
    CREATE FUNCTION in_age_range(p_birth date, p_min integer, p_max integer, p_at timestamptz) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT (p_min IS NULL OR a >= p_min) AND (p_max IS NULL OR a <= p_max)
          FROM (SELECT COALESCE(extract(year FROM age((p_at AT TIME ZONE 'Europe/Madrid')::date, p_birth))::int, 18) AS a) x
      $$;
  `);
  pgm.sql(coversAgeSql);
  PATCHES.forEach((p) => pgm.sql(patch(p)));

  pgm.sql(`
    CREATE FUNCTION ${SWEEP.replace('()', '(OUT warned integer, OUT cancelled integer)')}
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        r record;
        id_ uuid;
        aid uuid;
        rcpts uuid[];
      BEGIN
        warned := 0;
        cancelled := 0;
        -- Aviso a 30 días: hoy la cubre y dentro de 30 días supera la máxima. Uno por alumno, disciplina y máxima.
        -- Al tutor (o al alumno si no tiene); sin edad ni fecha de nacimiento en el aviso.
        FOR r IN SELECT p.id, p.display_name, d.id AS discipline_id, d.name, d.max_age
                   FROM profiles p JOIN disciplines d ON d.is_active AND d.max_age IS NOT NULL
                  WHERE p.birth_date IS NOT NULL
                    AND in_age_range(p.birth_date, NULL, d.max_age, now())
                    AND NOT in_age_range(p.birth_date, NULL, d.max_age, now() + interval '30 days')
                    AND covers(p.id, d.id)
                    AND NOT EXISTS (SELECT 1 FROM audit_log a
                                     WHERE a.action = 'notice.out_of_age_soon' AND a.resource_type = 'profile'
                                       AND a.resource_id = p.id::text AND a.changes->>'discipline_id' = d.id::text
                                       AND a.changes->>'max_age' = d.max_age::text) LOOP
          rcpts := COALESCE((SELECT array_agg(g.tutor_id) FROM guardianships g WHERE g.minor_id = r.id), ARRAY[r.id]);
          aid := gen_random_uuid();
          INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
          VALUES (aid, r.id, 'notice.out_of_age_soon', 'profile', r.id::text,
                  jsonb_build_object('discipline_id', r.discipline_id, 'max_age', r.max_age, 'discipline', r.name,
                                     'profile_name', r.display_name, 'recipients', to_jsonb(rcpts)));
          PERFORM enqueue_notice(aid, rcpts, NULL);
          warned := warned + 1;
        END LOOP;
        -- Desde el cumpleaños que supera la máxima: sus reservas y esperas futuras de esa disciplina, con aviso.
        -- shortcut: no promociona la espera de las plazas liberadas (como revoke_coverage y change_discipline).
        FOR id_ IN UPDATE bookings b SET status = 'cancelled', cancel_reason = 'out_of_age', cancelled_at = now()
                     FROM class_sessions x, disciplines d, profiles p
                    WHERE x.id = b.session_id AND d.id = x.discipline_id AND p.id = b.student_id
                      AND b.status <> 'cancelled' AND x.status = 'scheduled' AND x.starts_at > now()
                      AND NOT in_age_range(p.birth_date, NULL, d.max_age, now())
                RETURNING b.id LOOP
          PERFORM booking_notice(id_, 'notice.out_of_age');
          cancelled := cancelled + 1;
        END LOOP;
      END
      $$;
    ALTER FUNCTION ${SWEEP} OWNER TO service_role;
    REVOKE ALL ON FUNCTION ${SWEEP} FROM PUBLIC;
  `);
  pgm.sql('COMMIT;');
};

// No es exactamente reversible: minors_only = máxima ≤ 17; la mínima y otras máximas se pierden. Las reservas
// canceladas con out_of_age se quedan (el valor sigue en el enum).
export const down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('BEGIN;');
  pgm.sql(`
    DROP FUNCTION ${SWEEP};
    ALTER TABLE disciplines ADD COLUMN minors_only boolean NOT NULL DEFAULT false;
    UPDATE disciplines SET minors_only = true WHERE max_age <= 17;
  `);
  [...PATCHES].reverse().forEach(([fn, from, to]) => pgm.sql(patch([fn, to, from])));
  pgm.sql(coversSql(true));
  pgm.sql(`
    DROP FUNCTION in_age_range(date, integer, integer, timestamptz);
    ALTER TABLE disciplines DROP COLUMN min_age, DROP COLUMN max_age;
  `);
  pgm.sql('COMMIT;');
};
