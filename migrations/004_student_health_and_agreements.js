// migrations/004_student_health_and_agreements.js
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  // ============================================================
  // 1. student_health_info (1:1 con profiles)
  // ============================================================
  pgm.createTable('student_health_info', {
    profile_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'profiles',
      onDelete: 'CASCADE',
    },
    injuries: { type: 'text' },
    conditions: { type: 'text' },
    previous_experience: { type: 'text' },
    previous_discipline: { type: 'text' },
    medication: { type: 'text' },
    allergies: { type: 'text' },
    // NULL en tabla; requireCompleteProfile los exige.
    emergency_contact_name: { type: 'text' },
    emergency_contact_phone: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Reutiliza set_updated_at() creada en 002.
  pgm.createTrigger('student_health_info', 'student_health_info_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.sql(`
    ALTER TABLE student_health_info ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_health_info FORCE ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    CREATE POLICY student_health_info_select ON student_health_info
      FOR SELECT TO app_user
      USING (
        profile_id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) = 'admin'
      );
  `);

  pgm.sql(`
    CREATE POLICY student_health_info_insert_self ON student_health_info
      FOR INSERT TO app_user
      WITH CHECK (
        profile_id = current_setting('app.current_user_id', true)::uuid
      );
  `);

  pgm.sql(`
    CREATE POLICY student_health_info_update_self_or_admin ON student_health_info
      FOR UPDATE TO app_user
      USING (
        profile_id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) = 'admin'
      )
      WITH CHECK (
        profile_id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) = 'admin'
      );
  `);

  pgm.sql(`
    CREATE POLICY student_health_info_delete_self_or_admin ON student_health_info
      FOR DELETE TO app_user
      USING (
        profile_id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) = 'admin'
      );
  `);

  // ============================================================
  // 2. Vista profesor (SECURITY DEFINER, solo injuries + conditions)
  // ============================================================
  // SECURITY DEFINER: owner = migrator → bypassa RLS de la tabla base.
  // Filtra explícitamente por current_setting('app.current_role') = 'profesor'
  // (mismo patrón que las políticas RLS: confía en el contexto seteado
  // por withRlsContext desde el JWT verificado).
  pgm.sql(`
    CREATE VIEW student_health_professor_view
    WITH (security_barrier = true, security_invoker = false)
    AS
    SELECT
      profile_id,
      injuries,
      conditions
    FROM student_health_info
    WHERE current_setting('app.current_role', true) = 'profesor';
  `);

  pgm.sql(`ALTER VIEW student_health_professor_view OWNER TO migrator;`);
  pgm.sql(`GRANT SELECT ON student_health_professor_view TO app_user;`);

  // ============================================================
  // 3. user_agreements (append-only, 3 tipos versionados)
  // ============================================================
  pgm.createTable('user_agreements', {
    id: {
      type: 'uuid',
      primaryKey: true,
    },
    profile_id: {
      type: 'uuid',
      notNull: true,
      references: 'profiles',
      onDelete: 'CASCADE',
    },
    type: { type: 'text', notNull: true },
    version: { type: 'text', notNull: true },
    signed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
  });

  // id sin default → la app genera con crypto.randomUUID().
  // (Mismo patrón que profiles.id.)

  pgm.addConstraint('user_agreements', 'user_agreements_type_check', {
    check: "type IN ('waiver', 'data_protection', 'rights_of_image')",
  });

  pgm.addConstraint('user_agreements', 'user_agreements_profile_type_version_key', {
    unique: ['profile_id', 'type', 'version'],
  });

  pgm.createIndex('user_agreements', ['profile_id', 'type'], {
    name: 'user_agreements_profile_type_idx',
  });

  pgm.sql(`
    ALTER TABLE user_agreements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_agreements FORCE ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    CREATE POLICY user_agreements_select ON user_agreements
      FOR SELECT TO app_user
      USING (
        profile_id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) = 'admin'
      );
  `);

  pgm.sql(`
    CREATE POLICY user_agreements_insert_self ON user_agreements
      FOR INSERT TO app_user
      WITH CHECK (
        profile_id = current_setting('app.current_user_id', true)::uuid
      );
  `);

  // Append-only: sin política UPDATE ni DELETE + REVOKE.
  pgm.sql(`REVOKE UPDATE, DELETE ON user_agreements FROM app_user;`);
};

export const down = (pgm) => {
  // user_agreements
  pgm.sql(`GRANT UPDATE, DELETE ON user_agreements TO app_user;`);
  pgm.sql(`DROP POLICY IF EXISTS user_agreements_insert_self ON user_agreements;`);
  pgm.sql(`DROP POLICY IF EXISTS user_agreements_select ON user_agreements;`);
  pgm.sql(`
    ALTER TABLE user_agreements NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE user_agreements DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropTable('user_agreements');

  // Vista profesor
  pgm.sql(`REVOKE SELECT ON student_health_professor_view FROM app_user;`);
  pgm.sql(`DROP VIEW IF EXISTS student_health_professor_view;`);

  // student_health_info
  pgm.sql(`DROP POLICY IF EXISTS student_health_info_delete_self_or_admin ON student_health_info;`);
  pgm.sql(`DROP POLICY IF EXISTS student_health_info_update_self_or_admin ON student_health_info;`);
  pgm.sql(`DROP POLICY IF EXISTS student_health_info_insert_self ON student_health_info;`);
  pgm.sql(`DROP POLICY IF EXISTS student_health_info_select ON student_health_info;`);
  pgm.sql(`
    ALTER TABLE student_health_info NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE student_health_info DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropTrigger('student_health_info', 'student_health_info_set_updated_at', {
    ifExists: true,
  });
  pgm.dropTable('student_health_info');
};