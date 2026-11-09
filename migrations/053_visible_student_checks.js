// migrations/053_visible_student_checks.js
// B20 (auditoría de RLS, B1): has_risk_cover, profile_missing y discipline_changes_used respondían a app_user sobre
// cualquier perfil o suscripción (si tiene cobertura de riesgo, ficha de salud, acuerdos firmados, cambios usados). Un
// control de actor dentro rompería sus llamadas internas (promote_waitlist pregunta por otro alumno), así que se quedan
// para las funciones SECURITY DEFINER y el servicePool, y app_user usa estas, que responden NULL a quien no ve:
// - profile_missing: el propio perfil, su tutor (un menor) y el admin;
// - has_risk_cover: además, el profesor de sus sesiones o eventos (solo el sí/no, CONTEXT § Quién ve el seguro);
// - discipline_changes_used: quien ve la suscripción (como subscriptions_select).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const SEES = `(p_id = ${UID} OR is_guardian_of(p_id) OR ${IS_ADMIN})`;
const FNS = ['visible_profile_missing(uuid)', 'visible_risk_cover(uuid)', 'visible_discipline_changes_used(uuid)'];
const INNER = 'has_risk_cover(uuid), profile_missing(uuid), discipline_changes_used(uuid)';

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION visible_profile_missing(p_id uuid) RETURNS text[]
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT profile_missing(p_id) WHERE ${SEES}
      $$;
    CREATE FUNCTION visible_risk_cover(p_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT has_risk_cover(p_id)
         WHERE ${SEES} OR (current_setting('app.current_role', true) = 'profesor' AND teaches_student(p_id))
      $$;
    CREATE FUNCTION visible_discipline_changes_used(p_subscription uuid) RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT discipline_changes_used(s.id) FROM subscriptions s
         WHERE s.id = p_subscription
           AND (s.student_id = ${UID} OR s.payer_id = ${UID} OR is_guardian_of(s.student_id, true) OR ${IS_ADMIN})
      $$;
    ${FNS.map((f) => `ALTER FUNCTION ${f} OWNER TO service_role; REVOKE ALL ON FUNCTION ${f} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${f} TO app_user;`).join('\n    ')}
    REVOKE EXECUTE ON FUNCTION ${INNER} FROM app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT EXECUTE ON FUNCTION ${INNER} TO app_user;
    ${FNS.map((f) => `DROP FUNCTION ${f};`).join('\n    ')}
  `);
};
