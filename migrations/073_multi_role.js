// migrations/073_multi_role.js
// ADR 0033: varios roles por cuenta, con un rol activo en la sesión.
// - user_roles: UNIQUE (user_id, role) en vez de UNIQUE (user_id) (005). Todo perfil sin fila pasa a tener 'alumno' (antes
//   «sin fila = alumno»). Con FORCE RLS el backfill no ve filas: se quita FORCE solo durante él.
// - profiles.last_role: el último rol activo, para el login. app_user solo actualiza las columnas de 038 y last_role no es una:
//   set_last_role (SECURITY DEFINER) la escribe solo en la fila propia y solo con un rol asignado.
// - Políticas de user_roles (003, 017, 051, 072): el admin da y quita roles de otros, nunca los suyos ni la fila admin de otro;
//   el autoregistro solo crea la primera fila (alumno).
// - Lo que una sola fila por perfil daba por hecho: register_event (057, parcheado por 061), enqueue_notice (020),
//   public_profiles (030) y public_disciplines (019). public_profiles da un solo rol por perfil: profesor > alumno > tutor > admin (la ficha pública
//   solo muestra alumno y profesor).
// down: deja una fila por perfil, la de mayor prioridad (admin > profesor > tutor > alumno), y todo como en la 072.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;

// multi = false: las de la 072 (insert, update) y la 051 (delete), para el down.
const policies = (multi) => `
  ALTER POLICY user_roles_insert_self_alumno_or_admin ON user_roles
    WITH CHECK (${multi
    ? `(${IS_ADMIN} AND user_id <> ${UID})
         OR (user_id = ${UID} AND role = 'alumno' AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = ${UID}))`
    : `${IS_ADMIN} OR (user_id = ${UID} AND role = 'alumno')`});
  ALTER POLICY user_roles_update_admin ON user_roles
    USING (${IS_ADMIN} AND role <> 'admin'${multi ? ` AND user_id <> ${UID}` : ''})
    WITH CHECK (${IS_ADMIN}${multi ? ` AND user_id <> ${UID}` : ''});
  ALTER POLICY user_roles_delete_admin ON user_roles
    USING (${IS_ADMIN} AND role <> 'admin'${multi ? ` AND user_id <> ${UID}` : ''});
`;

// register_event: «el sujeto no es alumno» sin subconsulta escalar. Como en 061, sobre la definición vigente; si no la encuentra, falla.
const OLD_NOT_STUDENT = `COALESCE((SELECT role::text FROM user_roles WHERE user_id = p_subject), 'alumno') <> 'alumno'`;
const NEW_NOT_STUDENT = `NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_subject AND role = 'alumno')`;
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

// enqueue_notice (020): excluía a quien tuviera admin o profesor; ahora solo si no es además alumno o tutor (un profesor o admin
// que entrena o es tutor recibe sus avisos). Sobre la definición vigente, como register_event.
const OLD_NOTICE_SKIP = `AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = r AND role IN ('admin', 'profesor'))`;
const NEW_NOTICE_SKIP = `AND (NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = r AND role IN ('admin', 'profesor'))
                OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = r AND role IN ('alumno', 'tutor')))`;

// public_disciplines (019): con varios roles, las que cubre como alumno y las que imparte; cada una una sola vez.
const publicDisciplines = (multi) => `
  CREATE OR REPLACE FUNCTION public_disciplines(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
                        FILTER (WHERE d.id IS NOT NULL), '[]')${multi ? `
        FROM profiles p
        LEFT JOIN disciplines d ON NOT d.is_open AND (
          (EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.id AND r.role = 'alumno') AND covers(p.id, d.id))
          OR (EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.id AND r.role <> 'alumno')
              AND EXISTS (SELECT 1 FROM classes c
                           WHERE c.trainer_id = p.id AND c.discipline_id = d.id
                             AND (c.ends_on IS NULL OR c.ends_on >= (now() AT TIME ZONE 'Europe/Madrid')::date))))` : `
        FROM profiles p JOIN user_roles r ON r.user_id = p.id
        LEFT JOIN disciplines d ON NOT d.is_open AND CASE r.role
          WHEN 'alumno' THEN covers(p.id, d.id)
          ELSE EXISTS (SELECT 1 FROM classes c
                        WHERE c.trainer_id = p.id AND c.discipline_id = d.id
                          AND (c.ends_on IS NULL OR c.ends_on >= (now() AT TIME ZONE 'Europe/Madrid')::date))
        END`}
       WHERE p.id = p_id AND p.is_public AND ${SHOWN('disciplines')} AND can_be_public(p.id)
       GROUP BY p.id
    $$;
`;

// public_profiles (030): las mismas columnas; con varios roles, una fila por perfil con el de mayor prioridad.
const publicProfiles = (multi) => `
  DROP VIEW public_profiles;
  CREATE VIEW public_profiles WITH (security_barrier) AS
    SELECT p.id, p.display_name, r.role,
           CASE WHEN ${SHOWN('bio')} THEN p.bio END AS bio,
           CASE WHEN ${SHOWN('social_links')} THEN p.social_links END AS social_links,
           CASE WHEN ${SHOWN('disciplines')} THEN public_disciplines(p.id) END AS disciplines,
           CASE WHEN ${SHOWN('member_since')} THEN to_char(p.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') END
             AS member_since,
           public_achievements(p.id) AS achievements,
           CASE WHEN ${SHOWN('photo')} THEN p.avatar END AS avatar
      FROM profiles p ${multi
    ? `JOIN LATERAL (SELECT x.role FROM user_roles x WHERE x.user_id = p.id
                      ORDER BY CASE x.role WHEN 'profesor' THEN 0 WHEN 'alumno' THEN 1 WHEN 'tutor' THEN 2 ELSE 3 END LIMIT 1) r ON true`
    : 'JOIN user_roles r ON r.user_id = p.id'}
     WHERE ${AUTHED} AND p.is_public AND can_be_public(p.id);
  REVOKE ALL ON public_profiles FROM PUBLIC, app_user;
  ALTER VIEW public_profiles OWNER TO service_role;
  GRANT SELECT ON public_profiles TO app_user;
`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_roles DROP CONSTRAINT user_roles_user_id_key;
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

    ALTER TABLE profiles NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE user_roles NO FORCE ROW LEVEL SECURITY;
    INSERT INTO user_roles (user_id, role)
      SELECT p.id, 'alumno' FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.id);
    ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
    ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

    ALTER TABLE profiles ADD COLUMN last_role app_role;
    CREATE FUNCTION set_last_role(p_role app_role) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        UPDATE profiles SET last_role = p_role
         WHERE id = ${UID} AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = ${UID} AND role = p_role);
        IF NOT FOUND THEN RAISE EXCEPTION 'role_not_assigned' USING ERRCODE = '42501'; END IF;
      END
      $$;
    ALTER FUNCTION set_last_role(app_role) OWNER TO service_role;
    REVOKE ALL ON FUNCTION set_last_role(app_role) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION set_last_role(app_role) TO app_user;

    ${policies(true)}
    ${patch(['register_event(uuid, uuid, boolean)', OLD_NOT_STUDENT, NEW_NOT_STUDENT])}
    ${patch(['enqueue_notice(uuid, uuid[], uuid)', OLD_NOTICE_SKIP, NEW_NOTICE_SKIP])}
    ${publicDisciplines(true)}
    ${publicProfiles(true)}
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ${publicProfiles(false)}
    ${publicDisciplines(false)}
    ${patch(['enqueue_notice(uuid, uuid[], uuid)', NEW_NOTICE_SKIP, OLD_NOTICE_SKIP])}
    ${patch(['register_event(uuid, uuid, boolean)', NEW_NOT_STUDENT, OLD_NOT_STUDENT])}
    ${policies(false)}

    DROP FUNCTION set_last_role(app_role);
    ALTER TABLE profiles DROP COLUMN last_role;

    ALTER TABLE user_roles NO FORCE ROW LEVEL SECURITY;
    DELETE FROM user_roles u USING (
      SELECT id, row_number() OVER (PARTITION BY user_id
               ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'profesor' THEN 1 WHEN 'tutor' THEN 2 ELSE 3 END, id) AS n
        FROM user_roles) k
     WHERE u.id = k.id AND k.n > 1;
    ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
    ALTER TABLE user_roles DROP CONSTRAINT user_roles_user_id_role_key;
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
  `);
};
