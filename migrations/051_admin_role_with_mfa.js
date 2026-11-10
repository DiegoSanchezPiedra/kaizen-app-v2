// migrations/051_admin_role_with_mfa.js
// B20 (auditoría de RLS, B3), decidido el 2026-11-09: el admin puede dar el rol admin desde la app si tiene el doble
// factor activado (la API pide además su código en la petición). Quitarlo sigue sin hacerse desde la app: una fila admin
// no la cambia ni la borra app_user. Antes, el admin podía poner y quitar admin por SQL sin más.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const HAS_MFA = `EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = ${UID} AND m.mfa_enabled)`;
// Las de 003 tal cual, para el down.
const ADMIN_003 = `current_setting('app.current_role', true) = 'admin'`;
const UID_003 = `(current_setting('app.current_user_id', true))::uuid`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER POLICY user_roles_insert_self_alumno_or_admin ON user_roles
      WITH CHECK ((${IS_ADMIN} AND (role <> 'admin' OR ${HAS_MFA})) OR (user_id = ${UID} AND role = 'alumno'));
    ALTER POLICY user_roles_update_admin ON user_roles
      USING (${IS_ADMIN} AND role <> 'admin') WITH CHECK (${IS_ADMIN} AND (role <> 'admin' OR ${HAS_MFA}));
    ALTER POLICY user_roles_delete_admin ON user_roles USING (${IS_ADMIN} AND role <> 'admin');
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER POLICY user_roles_insert_self_alumno_or_admin ON user_roles
      WITH CHECK ((${ADMIN_003}) OR (user_id = ${UID_003} AND role = 'alumno'));
    ALTER POLICY user_roles_update_admin ON user_roles USING (${ADMIN_003}) WITH CHECK (${ADMIN_003});
    ALTER POLICY user_roles_delete_admin ON user_roles USING (${ADMIN_003});
  `);
};
