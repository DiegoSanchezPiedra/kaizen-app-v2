// migrations/046_profiles_insert_columns.js
// B20 (auditoría de RLS, B4): profiles_insert_self dejaba a la transacción del registro insertar cualquier columna
// (stripe_customer_id, is_public…) y una birth_date de menor (CONTEXT § Registro: solo un adulto se registra). Con
// app_user solo se insertan las columnas de createUser y una fecha vacía (alta con Google) o de adulto. create_child
// (SECURITY DEFINER) no pasa por aquí.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `(current_setting('app.current_user_id', true))::uuid`;

export const up = (pgm) => {
  pgm.sql(`
    REVOKE INSERT ON profiles FROM app_user;
    GRANT INSERT (id, display_name, birth_date) ON profiles TO app_user;
    ALTER POLICY profiles_insert_self ON profiles
      WITH CHECK (id = ${UID} AND (birth_date IS NULL OR birth_date <= CURRENT_DATE - interval '18 years'));
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER POLICY profiles_insert_self ON profiles WITH CHECK (id = ${UID});
    REVOKE INSERT ON profiles FROM app_user; -- también quita los de columna
    GRANT INSERT ON profiles TO app_user;
  `);
};
