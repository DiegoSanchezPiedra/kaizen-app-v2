// migrations/038_profiles_protected_columns.js
// B20 ([Alta] de B13): profiles_update_self_or_admin dejaba a cualquiera cambiar por SQL cualquier columna de su perfil,
// también stripe_customer_id (lo que enlaza a cada persona con sus cobros) y birth_date (decide si es menor).
// app_user ahora solo actualiza las columnas que edita la API (PATCH /me, /me/profile, /me/children/:id, la foto y
// despublicar); stripe_customer_id, id, created_at, phone y avatar_url, nunca (stripe_customer_id lo pone el servicePool).
// birth_date: un adulto solo pone la suya si está vacía (alta con Google) y de adulto; la de un hijo, su tutor (el
// WITH CHECK de profiles_update_guardian la deja menor); el admin la corrige. Las funciones SECURITY DEFINER y el
// servicePool no pasan por aquí.
/* eslint-disable camelcase */

export const shorthands = undefined;

const EDITABLE = ['display_name', 'birth_date', 'bio', 'social_links', 'is_public', 'visible_fields', 'avatar'];

// La 045 la sustituye por profiles_update_guard y la recrea en su down.
export const birthDateGuard = `
    CREATE FUNCTION profiles_birth_date_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
      BEGIN
        IF current_user = 'app_user' AND NEW.birth_date IS DISTINCT FROM OLD.birth_date
           AND NOT COALESCE(current_setting('app.current_role', true) = 'admin', false)
           AND NOT is_guardian_of(OLD.id)
           AND NOT (OLD.birth_date IS NULL AND NEW.birth_date <= CURRENT_DATE - interval '18 years') THEN
          RAISE EXCEPTION 'birth_date_locked' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END
      $$;
    CREATE TRIGGER profiles_birth_date_guard BEFORE UPDATE OF birth_date ON profiles
      FOR EACH ROW EXECUTE FUNCTION profiles_birth_date_guard();`;

export const up = (pgm) => {
  pgm.sql(`
    REVOKE UPDATE ON profiles FROM app_user;
    GRANT UPDATE (${EDITABLE.join(', ')}) ON profiles TO app_user;
    ${birthDateGuard}
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER profiles_birth_date_guard ON profiles;
    DROP FUNCTION profiles_birth_date_guard();
    REVOKE UPDATE ON profiles FROM app_user; -- también quita los de columna
    GRANT UPDATE ON profiles TO app_user;
  `);
};
