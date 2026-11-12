// migrations/062_can_create_children.js
// Crear hijos (POST /me/children) pasa a ser un permiso que concede un admin, por usuario:
// - auth_credentials.can_create_children (por defecto no). app_user solo lo lee; lo cambia set_can_create_children (admin).
// - Los tutores que ya tienen hijos conservan el permiso (backfill).
// - create_child rechaza con 'child_creation_not_allowed' (P0001, distinto del 42501 de «menor») a quien no lo tiene.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `current_setting('app.current_user_id', true)::uuid`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;

const createChild = (gate) => `
  CREATE OR REPLACE FUNCTION create_child(p_id uuid, p_display_name text, p_birth_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      caller uuid := ${UID};
    BEGIN
      IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = caller AND (${ADULT})) THEN
        RAISE EXCEPTION 'only adults can create children' USING ERRCODE = '42501';
      END IF;${gate ? `
      IF NOT EXISTS (SELECT 1 FROM auth_credentials WHERE profile_id = caller AND can_create_children) THEN
        RAISE EXCEPTION 'child_creation_not_allowed' USING ERRCODE = 'P0001';
      END IF;` : ''}
      IF p_birth_date IS NULL OR p_birth_date > CURRENT_DATE
         OR p_birth_date <= CURRENT_DATE - interval '18 years' THEN
        RAISE EXCEPTION 'child must be under 18' USING ERRCODE = '22023';
      END IF;
      INSERT INTO profiles (id, display_name, birth_date) VALUES (p_id, p_display_name, p_birth_date);
      INSERT INTO user_roles (user_id, role) VALUES (p_id, 'alumno');
      INSERT INTO guardianships (tutor_id, minor_id) VALUES (caller, p_id);
    END
    $$;`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth_credentials ADD COLUMN can_create_children boolean NOT NULL DEFAULT false;
    GRANT SELECT (can_create_children) ON auth_credentials TO app_user;
    -- migrator es NOBYPASSRLS: con FORCE RLS el UPDATE no vería ninguna fila. Se quita solo durante el backfill (misma transacción).
    ALTER TABLE auth_credentials NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE guardianships NO FORCE ROW LEVEL SECURITY;
    UPDATE auth_credentials SET can_create_children = true WHERE profile_id IN (SELECT tutor_id FROM guardianships);
    ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;
    ALTER TABLE guardianships FORCE ROW LEVEL SECURITY;
    ${createChild(true)}

    CREATE FUNCTION set_can_create_children(p_id uuid, p_value boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF NOT ${IS_ADMIN} THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
        UPDATE auth_credentials SET can_create_children = p_value WHERE profile_id = p_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002'; END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'profile.can_create_children', 'profile', p_id::text,
                jsonb_build_object('can_create_children', p_value));
      END
      $$;
    ALTER FUNCTION set_can_create_children(uuid, boolean) OWNER TO service_role;
    REVOKE ALL ON FUNCTION set_can_create_children(uuid, boolean) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION set_can_create_children(uuid, boolean) TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ${createChild(false)}
    DROP FUNCTION set_can_create_children(uuid, boolean);
    ALTER TABLE auth_credentials DROP COLUMN can_create_children;
  `);
};
