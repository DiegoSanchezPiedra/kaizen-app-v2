/* eslint-disable camelcase */

export const shorthands = undefined;

export async function up(pgm) {
  // ---------- helpers ----------
  const uid = "current_setting('app.current_user_id', true)::uuid";
  const role = "current_setting('app.current_role', true)";

  // ============================================================
  // profiles
  // ============================================================
  pgm.sql(`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE profiles FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY profiles_select ON profiles
      FOR SELECT TO app_user
      USING (
        id = ${uid}
        OR is_public = true
        OR ${role} IN ('admin','profesor')
      );
  `);
  pgm.sql(`
    CREATE POLICY profiles_insert_self ON profiles
      FOR INSERT TO app_user
      WITH CHECK (id = ${uid});
  `);
  pgm.sql(`
    CREATE POLICY profiles_update_self_or_admin ON profiles
      FOR UPDATE TO app_user
      USING (id = ${uid} OR ${role} = 'admin')
      WITH CHECK (id = ${uid} OR ${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY profiles_delete_admin ON profiles
      FOR DELETE TO app_user
      USING (${role} = 'admin');
  `);

  // ============================================================
  // auth_credentials
  // ============================================================
  pgm.sql(`ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY auth_credentials_select_self_or_admin ON auth_credentials
      FOR SELECT TO app_user
      USING (profile_id = ${uid} OR ${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY auth_credentials_insert_self ON auth_credentials
      FOR INSERT TO app_user
      WITH CHECK (profile_id = ${uid});
  `);
  pgm.sql(`
    CREATE POLICY auth_credentials_update_self_or_admin ON auth_credentials
      FOR UPDATE TO app_user
      USING (profile_id = ${uid} OR ${role} = 'admin')
      WITH CHECK (profile_id = ${uid} OR ${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY auth_credentials_delete_admin ON auth_credentials
      FOR DELETE TO app_user
      USING (${role} = 'admin');
  `);

  // ============================================================
  // user_roles  (nota 4a: auto-asignación de 'alumno' en registro)
  // ============================================================
  pgm.sql(`ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY user_roles_select ON user_roles
      FOR SELECT TO app_user
      USING (user_id = ${uid} OR ${role} IN ('admin','profesor'));
  `);
  pgm.sql(`
    CREATE POLICY user_roles_insert_self_alumno_or_admin ON user_roles
      FOR INSERT TO app_user
      WITH CHECK (
        ${role} = 'admin'
        OR (user_id = ${uid} AND role = 'alumno')
      );
  `);
  pgm.sql(`
    CREATE POLICY user_roles_update_admin ON user_roles
      FOR UPDATE TO app_user
      USING (${role} = 'admin')
      WITH CHECK (${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY user_roles_delete_admin ON user_roles
      FOR DELETE TO app_user
      USING (${role} = 'admin');
  `);

  // ============================================================
  // user_mfa
  // ============================================================
  pgm.sql(`ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY user_mfa_select ON user_mfa
      FOR SELECT TO app_user
      USING (user_id = ${uid} OR ${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY user_mfa_insert_self ON user_mfa
      FOR INSERT TO app_user
      WITH CHECK (user_id = ${uid});
  `);
  pgm.sql(`
    CREATE POLICY user_mfa_update_self_or_admin ON user_mfa
      FOR UPDATE TO app_user
      USING (user_id = ${uid} OR ${role} = 'admin')
      WITH CHECK (user_id = ${uid} OR ${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY user_mfa_delete_self_or_admin ON user_mfa
      FOR DELETE TO app_user
      USING (user_id = ${uid} OR ${role} = 'admin');
  `);

  // ============================================================
  // audit_log  (append-only)
  // ============================================================
  pgm.sql(`ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY audit_log_select_admin ON audit_log
      FOR SELECT TO app_user
      USING (${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY audit_log_insert_authenticated ON audit_log
      FOR INSERT TO app_user
      WITH CHECK (${uid} IS NOT NULL);
  `);
  // Sin política FOR UPDATE / FOR DELETE + REVOKE (doble barrera)
  pgm.sql(`REVOKE UPDATE, DELETE ON audit_log FROM app_user;`);

  // ============================================================
  // academy_settings
  // ============================================================
  pgm.sql(`ALTER TABLE academy_settings ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE academy_settings FORCE ROW LEVEL SECURITY;`);

  pgm.sql(`
    CREATE POLICY academy_settings_select_all_authenticated ON academy_settings
      FOR SELECT TO app_user
      USING (${uid} IS NOT NULL);
  `);
  pgm.sql(`
    CREATE POLICY academy_settings_insert_admin ON academy_settings
      FOR INSERT TO app_user
      WITH CHECK (${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY academy_settings_update_admin ON academy_settings
      FOR UPDATE TO app_user
      USING (${role} = 'admin')
      WITH CHECK (${role} = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY academy_settings_delete_admin ON academy_settings
      FOR DELETE TO app_user
      USING (${role} = 'admin');
  `);
}

export async function down(pgm) {
  // audit_log
  pgm.sql(`DROP POLICY IF EXISTS academy_settings_delete_admin ON academy_settings;`);
  pgm.sql(`DROP POLICY IF EXISTS academy_settings_update_admin ON academy_settings;`);
  pgm.sql(`DROP POLICY IF EXISTS academy_settings_insert_admin ON academy_settings;`);
  pgm.sql(`DROP POLICY IF EXISTS academy_settings_select_all_authenticated ON academy_settings;`);
  pgm.sql(`ALTER TABLE academy_settings NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE academy_settings DISABLE ROW LEVEL SECURITY;`);

  pgm.sql(`DROP POLICY IF EXISTS audit_log_insert_authenticated ON audit_log;`);
  pgm.sql(`DROP POLICY IF EXISTS audit_log_select_admin ON audit_log;`);
  pgm.sql(`GRANT UPDATE, DELETE ON audit_log TO app_user;`);
  pgm.sql(`ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;`);

  pgm.sql(`DROP POLICY IF EXISTS user_mfa_delete_self_or_admin ON user_mfa;`);
  pgm.sql(`DROP POLICY IF EXISTS user_mfa_update_self_or_admin ON user_mfa;`);
  pgm.sql(`DROP POLICY IF EXISTS user_mfa_insert_self ON user_mfa;`);
  pgm.sql(`DROP POLICY IF EXISTS user_mfa_select ON user_mfa;`);
  pgm.sql(`ALTER TABLE user_mfa NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE user_mfa DISABLE ROW LEVEL SECURITY;`);

  pgm.sql(`DROP POLICY IF EXISTS user_roles_delete_admin ON user_roles;`);
  pgm.sql(`DROP POLICY IF EXISTS user_roles_update_admin ON user_roles;`);
  pgm.sql(`DROP POLICY IF EXISTS user_roles_insert_self_alumno_or_admin ON user_roles;`);
  pgm.sql(`DROP POLICY IF EXISTS user_roles_select ON user_roles;`);
  pgm.sql(`ALTER TABLE user_roles NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;`);

  pgm.sql(`DROP POLICY IF EXISTS auth_credentials_delete_admin ON auth_credentials;`);
  pgm.sql(`DROP POLICY IF EXISTS auth_credentials_update_self_or_admin ON auth_credentials;`);
  pgm.sql(`DROP POLICY IF EXISTS auth_credentials_insert_self ON auth_credentials;`);
  pgm.sql(`DROP POLICY IF EXISTS auth_credentials_select_self_or_admin ON auth_credentials;`);
  pgm.sql(`ALTER TABLE auth_credentials NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE auth_credentials DISABLE ROW LEVEL SECURITY;`);

  pgm.sql(`DROP POLICY IF EXISTS profiles_delete_admin ON profiles;`);
  pgm.sql(`DROP POLICY IF EXISTS profiles_update_self_or_admin ON profiles;`);
  pgm.sql(`DROP POLICY IF EXISTS profiles_insert_self ON profiles;`);
  pgm.sql(`DROP POLICY IF EXISTS profiles_select ON profiles;`);
  pgm.sql(`ALTER TABLE profiles NO FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;`);
}
