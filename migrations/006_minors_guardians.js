// migrations/006_minors_guardians.js
// Cuenta familiar (ADR 0002): el hijo es un perfil sin credenciales que crea y gestiona su tutor.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `current_setting('app.current_user_id', true)::uuid`;
const IS_ADMIN = `current_setting('app.current_role', true) = 'admin'`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;
const SELF = `profile_id = ${UID}`;
const SELF_OR_ADMIN = `profile_id = ${UID} OR ${IS_ADMIN}`;

export const up = (pgm) => {
  // shortcut: ADD VALUE no es reversible; el down deja 'tutor' en el enum (inofensivo).
  pgm.sql(`ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'tutor';`);

  pgm.addColumn('profiles', { birth_date: { type: 'date' } });

  pgm.createTable('guardianships', {
    tutor_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    minor_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });
  pgm.addConstraint('guardianships', 'guardianships_pkey', { primaryKey: ['tutor_id', 'minor_id'] });
  pgm.addConstraint('guardianships', 'guardianships_distinct_check', {
    check: 'tutor_id <> minor_id',
  });
  pgm.createIndex('guardianships', 'minor_id');

  // El alta normal va por create_child; aquí solo el admin añade o quita tutores adicionales.
  pgm.sql(`
    ALTER TABLE guardianships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE guardianships FORCE ROW LEVEL SECURITY;
    CREATE POLICY guardianships_select ON guardianships FOR SELECT TO app_user
      USING (tutor_id = ${UID} OR minor_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY guardianships_insert_admin ON guardianships FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN});
    CREATE POLICY guardianships_delete_admin ON guardianships FOR DELETE TO app_user
      USING (${IS_ADMIN});
  `);

  // SECURITY DEFINER con owner service_role (BYPASSRLS; migrator no lo tiene): lee profiles sin
  // pasar por su RLS, así puede usarse dentro de las políticas de profiles sin recursión.
  // any_age = vínculo histórico (D16): sigue siendo cierto cuando el hijo cumple 18.
  pgm.sql(`
    CREATE FUNCTION is_guardian_of(p_id uuid, any_age boolean DEFAULT false) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM guardianships g JOIN profiles p ON p.id = g.minor_id
           WHERE g.tutor_id = ${UID} AND g.minor_id = p_id
             AND (any_age OR NOT (${ADULT}))
        )
      $$;
    ALTER FUNCTION is_guardian_of(uuid, boolean) OWNER TO service_role;
    REVOKE ALL ON FUNCTION is_guardian_of(uuid, boolean) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION is_guardian_of(uuid, boolean) TO app_user;
  `);

  // Alta del hijo en una operación: perfil + rol alumno + vínculo con quien llama.
  // Evita abrir profiles_insert / guardianships_insert a vínculos arbitrarios.
  pgm.sql(`
    CREATE FUNCTION create_child(p_id uuid, p_display_name text, p_birth_date date) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        caller uuid := ${UID};
      BEGIN
        IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = caller AND (${ADULT})) THEN
          RAISE EXCEPTION 'only adults can create children' USING ERRCODE = '42501';
        END IF;
        IF p_birth_date IS NULL OR p_birth_date > CURRENT_DATE
           OR p_birth_date <= CURRENT_DATE - interval '18 years' THEN
          RAISE EXCEPTION 'child must be under 18' USING ERRCODE = '22023';
        END IF;
        INSERT INTO profiles (id, display_name, birth_date) VALUES (p_id, p_display_name, p_birth_date);
        INSERT INTO user_roles (user_id, role) VALUES (p_id, 'alumno');
        INSERT INTO guardianships (tutor_id, minor_id) VALUES (caller, p_id);
      END
      $$;
    ALTER FUNCTION create_child(uuid, text, date) OWNER TO service_role;
    REVOKE ALL ON FUNCTION create_child(uuid, text, date) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION create_child(uuid, text, date) TO app_user;
  `);

  // El tutor ve al hijo aunque cumpla 18 (D16), pero solo edita mientras es menor.
  // El CHECK mira birth_date de la fila nueva: is_guardian_of leería la fila antigua (snapshot).
  pgm.sql(`
    CREATE POLICY profiles_select_guardian ON profiles FOR SELECT TO app_user
      USING (is_guardian_of(id, true));
    CREATE POLICY profiles_update_guardian ON profiles FOR UPDATE TO app_user
      USING (is_guardian_of(id))
      WITH CHECK (is_guardian_of(id, true) AND birth_date > CURRENT_DATE - interval '18 years');
  `);

  pgm.sql(`
    DROP POLICY student_health_info_select ON student_health_info;
    DROP POLICY student_health_info_insert_self ON student_health_info;
    DROP POLICY student_health_info_update_self_or_admin ON student_health_info;
    CREATE POLICY student_health_info_select ON student_health_info FOR SELECT TO app_user
      USING (${SELF_OR_ADMIN} OR is_guardian_of(profile_id));
    CREATE POLICY student_health_info_insert_self ON student_health_info FOR INSERT TO app_user
      WITH CHECK (${SELF} OR is_guardian_of(profile_id));
    CREATE POLICY student_health_info_update_self_or_admin ON student_health_info FOR UPDATE TO app_user
      USING (${SELF_OR_ADMIN} OR is_guardian_of(profile_id))
      WITH CHECK (${SELF_OR_ADMIN} OR is_guardian_of(profile_id));
  `);

  // user_agreements: profile_id = sujeto, signed_by = quien firma realmente.
  pgm.addColumn('user_agreements', {
    signed_by: { type: 'uuid', references: 'profiles', onDelete: 'RESTRICT' },
  });
  // FORCE RLS oculta las filas incluso al dueño: se suspende solo para el backfill.
  pgm.sql(`
    ALTER TABLE user_agreements NO FORCE ROW LEVEL SECURITY;
    UPDATE user_agreements SET signed_by = profile_id;
    ALTER TABLE user_agreements FORCE ROW LEVEL SECURITY;
  `);
  pgm.alterColumn('user_agreements', 'signed_by', { notNull: true });

  // A los 18 el alumno firma la misma versión que ya firmó su tutor: la unicidad incluye al firmante.
  pgm.dropConstraint('user_agreements', 'user_agreements_profile_type_version_key');
  pgm.addConstraint('user_agreements', 'user_agreements_subject_signer_type_version_key', {
    unique: ['profile_id', 'signed_by', 'type', 'version'],
  });

  pgm.sql(`
    DROP POLICY user_agreements_select ON user_agreements;
    DROP POLICY user_agreements_insert_self ON user_agreements;

    CREATE POLICY user_agreements_select ON user_agreements FOR SELECT TO app_user
      USING (profile_id = ${UID} OR signed_by = ${UID} OR ${IS_ADMIN} OR is_guardian_of(profile_id, true));

    -- Propio: solo adultos (un menor no firma). Por representación: tutor vinculado de un menor.
    CREATE POLICY user_agreements_insert ON user_agreements FOR INSERT TO app_user
      WITH CHECK (
        signed_by = ${UID}
        AND (
          (profile_id = ${UID}
            AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id AND (${ADULT})))
          OR (profile_id <> ${UID} AND is_guardian_of(profile_id))
        )
      );
  `);

  // Pagador de la cuota (D5/D14). La regla de quién puede pagar llega con Stripe en B10.
  pgm.addColumn('subscriptions', {
    payer_id: { type: 'uuid', references: 'profiles', onDelete: 'RESTRICT' },
  });
  pgm.sql(`UPDATE subscriptions SET payer_id = student_id;`);
  pgm.alterColumn('subscriptions', 'payer_id', { notNull: true });
  pgm.createIndex('subscriptions', 'payer_id');
};

export const down = (pgm) => {
  pgm.dropColumn('subscriptions', 'payer_id');

  pgm.sql(`
    DROP POLICY user_agreements_insert ON user_agreements;
    DROP POLICY user_agreements_select ON user_agreements;
    CREATE POLICY user_agreements_select ON user_agreements FOR SELECT TO app_user
      USING (${SELF_OR_ADMIN});
    CREATE POLICY user_agreements_insert_self ON user_agreements FOR INSERT TO app_user
      WITH CHECK (${SELF});
  `);
  pgm.dropConstraint('user_agreements', 'user_agreements_subject_signer_type_version_key', { ifExists: true });
  pgm.dropConstraint('user_agreements', 'user_agreements_profile_type_version_key', { ifExists: true });
  pgm.dropColumn('user_agreements', 'signed_by');
  // shortcut: falla si ya hay firmas de tutor + propia de la misma versión; limpiar a mano antes del down.
  pgm.addConstraint('user_agreements', 'user_agreements_profile_type_version_key', {
    unique: ['profile_id', 'type', 'version'],
  });

  pgm.sql(`
    DROP POLICY student_health_info_select ON student_health_info;
    DROP POLICY student_health_info_insert_self ON student_health_info;
    DROP POLICY student_health_info_update_self_or_admin ON student_health_info;
    CREATE POLICY student_health_info_select ON student_health_info FOR SELECT TO app_user
      USING (${SELF_OR_ADMIN});
    CREATE POLICY student_health_info_insert_self ON student_health_info FOR INSERT TO app_user
      WITH CHECK (${SELF});
    CREATE POLICY student_health_info_update_self_or_admin ON student_health_info FOR UPDATE TO app_user
      USING (${SELF_OR_ADMIN}) WITH CHECK (${SELF_OR_ADMIN});
  `);

  pgm.sql(`
    DROP POLICY profiles_update_guardian ON profiles;
    DROP POLICY profiles_select_guardian ON profiles;
    DROP FUNCTION create_child(uuid, text, date);
    DROP FUNCTION is_guardian_of(uuid, boolean);
  `);
  pgm.sql(`
    DROP POLICY guardianships_delete_admin ON guardianships;
    DROP POLICY guardianships_insert_admin ON guardianships;
    DROP POLICY guardianships_select ON guardianships;
    ALTER TABLE guardianships NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE guardianships DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropTable('guardianships');
  pgm.dropColumn('profiles', 'birth_date');
};
