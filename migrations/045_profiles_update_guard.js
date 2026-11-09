// migrations/045_profiles_update_guard.js
// B20 (auditoría de RLS, B2 y B5): con app_user, el admin podía editar por SQL el contenido del perfil de otro y el tutor
// el perfil público de su hijo. Sobre un perfil ajeno (CONTEXT § Perfil público, § Foto de perfil, ADR 0002):
// - el contenido (bio, redes, campos visibles) es solo de su dueño; el nombre, también del tutor de un hijo;
// - nadie publica a otro (el admin despublica);
// - la foto: el tutor la pone o la quita; el admin solo la quita.
// Sustituye al trigger de birth_date de la 038, cuya regla se queda igual. Las funciones SECURITY DEFINER y el
// servicePool no pasan por aquí.
/* eslint-disable camelcase */
import { birthDateGuard } from './038_profiles_protected_columns.js';

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DROP TRIGGER profiles_birth_date_guard ON profiles;
    DROP FUNCTION profiles_birth_date_guard();

    CREATE FUNCTION profiles_update_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
      DECLARE
        is_admin boolean := COALESCE(current_setting('app.current_role', true) = 'admin', false);
        guardian boolean;
      BEGIN
        IF current_user <> 'app_user' THEN RETURN NEW; END IF;
        IF NEW.birth_date IS DISTINCT FROM OLD.birth_date AND NOT is_admin AND NOT is_guardian_of(OLD.id)
           AND NOT (OLD.birth_date IS NULL AND NEW.birth_date <= CURRENT_DATE - interval '18 years') THEN
          RAISE EXCEPTION 'birth_date_locked' USING ERRCODE = '42501';
        END IF;
        IF OLD.id IS DISTINCT FROM NULLIF(current_setting('app.current_user_id', true), '')::uuid THEN
          guardian := is_guardian_of(OLD.id); -- si no, es el admin (la RLS no deja a nadie más)
          IF (NEW.bio, NEW.social_links, NEW.visible_fields) IS DISTINCT FROM (OLD.bio, OLD.social_links, OLD.visible_fields)
             OR (NEW.display_name IS DISTINCT FROM OLD.display_name AND NOT guardian)
             OR (COALESCE(NEW.is_public, false) AND NOT COALESCE(OLD.is_public, false))
             OR (NEW.avatar IS DISTINCT FROM OLD.avatar AND NEW.avatar IS NOT NULL AND NOT guardian) THEN
            RAISE EXCEPTION 'profile_locked' USING ERRCODE = '42501';
          END IF;
        END IF;
        RETURN NEW;
      END
      $$;
    CREATE TRIGGER profiles_update_guard BEFORE UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION profiles_update_guard();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER profiles_update_guard ON profiles;
    DROP FUNCTION profiles_update_guard();
    ${birthDateGuard}
  `);
};
