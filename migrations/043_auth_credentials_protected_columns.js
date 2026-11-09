// migrations/043_auth_credentials_protected_columns.js
// B20 (auditoría de RLS, M5): auth_credentials_update_self_or_admin dejaba cambiar por SQL cualquier columna de la
// propia fila (y el admin de cualquiera): email, email_verified (se saltaría la verificación del ADR 0021), google_sub.
// Con app_user solo se actualiza lo que toca el cambio de contraseña; el resto lo escriben el registro (INSERT) y el
// servicePool. updated_at lo sigue poniendo su trigger.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    REVOKE UPDATE ON auth_credentials FROM app_user;
    GRANT UPDATE (password_hash, credentials_changed_at) ON auth_credentials TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    REVOKE UPDATE ON auth_credentials FROM app_user; -- también quita los de columna
    GRANT UPDATE ON auth_credentials TO app_user;
  `);
};
