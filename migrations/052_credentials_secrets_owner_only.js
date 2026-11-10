// migrations/052_credentials_secrets_owner_only.js
// B20 (auditoría de RLS, B9): el admin leía con app_user el password_hash de cualquiera y la fila de user_mfa (secreto
// TOTP y códigos de recuperación, cifrados) de cualquiera, y la API solo necesita saber si tiene contraseña.
// - auth_credentials: nadie lee password_hash con app_user; has_password (columna generada) dice si la hay y
//   own_password_hash() devuelve solo la propia (el cambio de contraseña la verifica). El login sigue con el servicePool.
// - user_mfa: solo su dueño la lee, la cambia o la borra (todo el doble factor se hace sobre el propio perfil).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const READABLE = ['profile_id', 'email', 'google_sub', 'email_verified', 'created_at', 'updated_at',
  'credentials_changed_at', 'has_password'];
// Las de user_mfa de 003 tal cual, para el down.
const SELF_003 = `user_id = (current_setting('app.current_user_id', true))::uuid`;
const SELF_OR_ADMIN_003 = `(${SELF_003}) OR (current_setting('app.current_role', true) = 'admin')`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth_credentials ADD COLUMN has_password boolean GENERATED ALWAYS AS (password_hash IS NOT NULL) STORED;
    REVOKE SELECT ON auth_credentials FROM app_user;
    GRANT SELECT (${READABLE.join(', ')}) ON auth_credentials TO app_user;

    CREATE FUNCTION own_password_hash() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT password_hash FROM auth_credentials WHERE profile_id = ${UID}
    $$;
    ALTER FUNCTION own_password_hash() OWNER TO service_role;
    REVOKE ALL ON FUNCTION own_password_hash() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION own_password_hash() TO app_user;

    ALTER POLICY user_mfa_select ON user_mfa USING (user_id = ${UID});
    ALTER POLICY user_mfa_update_self_or_admin ON user_mfa USING (user_id = ${UID}) WITH CHECK (user_id = ${UID});
    ALTER POLICY user_mfa_delete_self_or_admin ON user_mfa USING (user_id = ${UID});
    ALTER POLICY user_mfa_update_self_or_admin ON user_mfa RENAME TO user_mfa_update_self;
    ALTER POLICY user_mfa_delete_self_or_admin ON user_mfa RENAME TO user_mfa_delete_self;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER POLICY user_mfa_update_self ON user_mfa RENAME TO user_mfa_update_self_or_admin;
    ALTER POLICY user_mfa_delete_self ON user_mfa RENAME TO user_mfa_delete_self_or_admin;
    ALTER POLICY user_mfa_select ON user_mfa USING (${SELF_OR_ADMIN_003});
    ALTER POLICY user_mfa_update_self_or_admin ON user_mfa USING (${SELF_OR_ADMIN_003}) WITH CHECK (${SELF_OR_ADMIN_003});
    ALTER POLICY user_mfa_delete_self_or_admin ON user_mfa USING (${SELF_OR_ADMIN_003});

    DROP FUNCTION own_password_hash();
    REVOKE SELECT ON auth_credentials FROM app_user; -- también quita los de columna
    ALTER TABLE auth_credentials DROP COLUMN has_password;
    GRANT SELECT ON auth_credentials TO app_user;
  `);
};
