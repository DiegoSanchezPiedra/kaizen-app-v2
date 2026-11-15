// migrations/064_trainer_invites.js
// Alta de profesores por el admin (ADR 0028).
// - auth_credentials.disabled_at: profesor desactivado. Columna protegida: app_user la lee (requireAuth) y nunca la escribe.
// - password_resets.kind ('reset'|'invite'): la invitación vale 72 h, y al aceptarla se verifica el email.
// - create_password_reset ignora a los desactivados; consume_password_reset también los rechaza.
// - Escrituras del admin sobre profesores: funciones SECURITY DEFINER que comprueban dentro que quien llama es admin.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const FNS = [
  'admin_create_trainer(uuid, text, text, text, text)',
  'create_trainer_invite(uuid, text)',
  'admin_set_trainer_email(uuid, text, text)',
  'admin_update_trainer(uuid, text, text)',
  'admin_set_disabled(uuid, boolean)',
];

const createReset = (v2) => `
  CREATE OR REPLACE FUNCTION create_password_reset(p_email text, p_token_hash text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE pid uuid;
    BEGIN
      SELECT profile_id INTO pid FROM auth_credentials WHERE email = p_email AND NOT is_minor(profile_id)${v2 ? ' AND disabled_at IS NULL' : ''};
      IF NOT FOUND THEN RETURN false; END IF;
      UPDATE password_resets SET used_at = now() WHERE profile_id = pid AND used_at IS NULL${v2 ? " AND kind = 'reset'" : ''};
      INSERT INTO password_resets (profile_id, token_hash, expires_at) VALUES (pid, p_token_hash, now() + interval '1 hour');
      RETURN true;
    END
    $$;`;

const consumeReset = (v2) => `
  CREATE OR REPLACE FUNCTION consume_password_reset(p_token_hash text, p_password_hash text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE pid uuid;${v2 ? ' k text;' : ''}
    BEGIN
      UPDATE password_resets r SET used_at = now()
       WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now()${v2 ? `
         AND NOT EXISTS (SELECT 1 FROM auth_credentials c WHERE c.profile_id = r.profile_id AND c.disabled_at IS NOT NULL)` : ''}
      RETURNING r.profile_id${v2 ? ', r.kind' : ''} INTO pid${v2 ? ', k' : ''};
      IF pid IS NULL THEN RETURN false; END IF;
      UPDATE auth_credentials SET password_hash = p_password_hash, credentials_changed_at = date_trunc('second', now())${v2 ? `,
             email_verified = email_verified OR k = 'invite'` : ''} WHERE profile_id = pid;
      RETURN true;
    END
    $$;`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth_credentials ADD COLUMN disabled_at timestamptz;
    -- Un profesor recién invitado (o con el correo cambiado) no tiene aún ningún método de login: no verificado y sin ellos.
    ALTER TABLE auth_credentials DROP CONSTRAINT auth_credentials_login_method_check;
    ALTER TABLE auth_credentials ADD CONSTRAINT auth_credentials_login_method_check
      CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL OR (email IS NOT NULL AND NOT email_verified));
    GRANT SELECT (disabled_at) ON auth_credentials TO app_user;

    ALTER TABLE password_resets ADD COLUMN kind text NOT NULL DEFAULT 'reset' CHECK (kind IN ('reset', 'invite'));

    ${createReset(true)}
    ${consumeReset(true)}

    -- Auxiliares de las funciones de abajo (corren como service_role): sin permisos para nadie más.
    CREATE FUNCTION trainer_admin_guard() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF NOT (COALESCE(current_setting('app.current_role', true) = 'admin', false)
                AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = ${UID} AND role = 'admin')) THEN
          RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
        END IF;
      END
      $$;
    ALTER FUNCTION trainer_admin_guard() OWNER TO service_role;
    REVOKE ALL ON FUNCTION trainer_admin_guard() FROM PUBLIC;

    -- Bloquea al profesor y devuelve su disabled_at, o falla con trainer_not_found.
    CREATE FUNCTION trainer_lock(p_id uuid) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE d timestamptz;
      BEGIN
        SELECT c.disabled_at INTO d FROM auth_credentials c JOIN user_roles r ON r.user_id = c.profile_id AND r.role = 'profesor'
         WHERE c.profile_id = p_id FOR UPDATE OF c;
        IF NOT FOUND THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE = 'P0002'; END IF;
        RETURN d;
      END
      $$;
    ALTER FUNCTION trainer_lock(uuid) OWNER TO service_role;
    REVOKE ALL ON FUNCTION trainer_lock(uuid) FROM PUBLIC;

    CREATE FUNCTION trainer_audit(p_action text, p_id uuid, p_changes jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), ${UID}, p_action, 'trainer', p_id::text, p_changes)
      $$;
    ALTER FUNCTION trainer_audit(text, uuid, jsonb) OWNER TO service_role;
    REVOKE ALL ON FUNCTION trainer_audit(text, uuid, jsonb) FROM PUBLIC;

    CREATE FUNCTION trainer_new_invite(p_id uuid, p_token_hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      UPDATE password_resets SET used_at = now() WHERE profile_id = p_id AND used_at IS NULL;
      INSERT INTO password_resets (profile_id, token_hash, expires_at, kind) VALUES (p_id, p_token_hash, now() + interval '72 hours', 'invite')
      $$;
    ALTER FUNCTION trainer_new_invite(uuid, text) OWNER TO service_role;
    REVOKE ALL ON FUNCTION trainer_new_invite(uuid, text) FROM PUBLIC;

    CREATE FUNCTION admin_create_trainer(p_id uuid, p_email text, p_display_name text, p_employment text, p_token_hash text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        PERFORM trainer_admin_guard();
        INSERT INTO profiles (id, display_name) VALUES (p_id, p_display_name);
        INSERT INTO auth_credentials (profile_id, email, email_verified) VALUES (p_id, p_email, false);
        INSERT INTO user_roles (user_id, role) VALUES (p_id, 'profesor');
        INSERT INTO teacher_employment (profile_id, employment, updated_by) VALUES (p_id, p_employment, ${UID});
        PERFORM trainer_new_invite(p_id, p_token_hash);
        PERFORM trainer_audit('trainer.create', p_id, jsonb_build_object('employment', p_employment));
      END
      $$;

    CREATE FUNCTION create_trainer_invite(p_id uuid, p_token_hash text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        PERFORM trainer_admin_guard();
        IF trainer_lock(p_id) IS NOT NULL THEN RAISE EXCEPTION 'trainer_disabled' USING ERRCODE = 'P0001'; END IF;
        PERFORM trainer_new_invite(p_id, p_token_hash);
        PERFORM trainer_audit('trainer.invite', p_id, '{}'::jsonb);
      END
      $$;

    -- Conserva el id y el historial; anula contraseña y Google, cierra las sesiones y deja una invitación nueva.
    CREATE FUNCTION admin_set_trainer_email(p_id uuid, p_email text, p_token_hash text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        PERFORM trainer_admin_guard();
        IF trainer_lock(p_id) IS NOT NULL THEN RAISE EXCEPTION 'trainer_disabled' USING ERRCODE = 'P0001'; END IF;
        IF EXISTS (SELECT 1 FROM auth_credentials WHERE profile_id = p_id AND email = p_email) THEN
          RAISE EXCEPTION 'same_email' USING ERRCODE = 'P0001';
        END IF;
        UPDATE auth_credentials SET email = p_email, email_verified = false, password_hash = NULL, google_sub = NULL,
               credentials_changed_at = date_trunc('second', now()) WHERE profile_id = p_id;
        PERFORM trainer_new_invite(p_id, p_token_hash);
        PERFORM trainer_audit('trainer.update', p_id, '{"fields": ["email"]}'::jsonb);
        PERFORM trainer_audit('trainer.invite', p_id, '{}'::jsonb);
      END
      $$;

    -- NULL = sin cambio.
    CREATE FUNCTION admin_update_trainer(p_id uuid, p_display_name text, p_employment text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE fields text[] := '{}';
      BEGIN
        PERFORM trainer_admin_guard();
        PERFORM trainer_lock(p_id);
        IF p_display_name IS NOT NULL THEN
          UPDATE profiles SET display_name = p_display_name WHERE id = p_id; fields := fields || 'display_name'::text;
        END IF;
        IF p_employment IS NOT NULL THEN
          INSERT INTO teacher_employment (profile_id, employment, updated_by) VALUES (p_id, p_employment, ${UID})
          ON CONFLICT (profile_id) DO UPDATE SET employment = EXCLUDED.employment, updated_at = now(), updated_by = EXCLUDED.updated_by;
          fields := fields || 'employment'::text;
        END IF;
        PERFORM trainer_audit('trainer.update', p_id, jsonb_build_object('fields', to_jsonb(fields)));
      END
      $$;

    CREATE FUNCTION admin_set_disabled(p_id uuid, p_disabled boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE d timestamptz;
      BEGIN
        PERFORM trainer_admin_guard();
        d := trainer_lock(p_id);
        IF (d IS NOT NULL) = p_disabled THEN RAISE EXCEPTION 'same_state' USING ERRCODE = 'P0001'; END IF;
        UPDATE auth_credentials SET disabled_at = CASE WHEN p_disabled THEN now() END,
               credentials_changed_at = date_trunc('second', now()) WHERE profile_id = p_id;
        IF p_disabled THEN UPDATE password_resets SET used_at = now() WHERE profile_id = p_id AND used_at IS NULL; END IF;
        PERFORM trainer_audit(CASE WHEN p_disabled THEN 'trainer.deactivate' ELSE 'trainer.reactivate' END, p_id, '{}'::jsonb);
      END
      $$;
  `);
  for (const fn of FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }
};

export const down = (pgm) => {
  pgm.sql(`
    ${FNS.map((fn) => `DROP FUNCTION ${fn};`).join('\n')}
    DROP FUNCTION trainer_new_invite(uuid, text);
    DROP FUNCTION trainer_audit(text, uuid, jsonb);
    DROP FUNCTION trainer_lock(uuid);
    DROP FUNCTION trainer_admin_guard();
    -- FORCE RLS: el DELETE del migrator no vería filas; se quita solo durante el DELETE (como en 061).
    ALTER TABLE password_resets NO FORCE ROW LEVEL SECURITY;
    DELETE FROM password_resets WHERE kind = 'invite';
    ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;
    ${createReset(false)}
    ${consumeReset(false)}
    ALTER TABLE password_resets DROP COLUMN kind;
    -- Sin disabled_at, un desactivado volvería a entrar: se le invalida la contraseña (restablecer la devuelve, no es un borrado).
    ALTER TABLE auth_credentials NO FORCE ROW LEVEL SECURITY;
    UPDATE auth_credentials SET password_hash = NULL, credentials_changed_at = date_trunc('second', now()) WHERE disabled_at IS NOT NULL;
    ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;
    ALTER TABLE auth_credentials DROP COLUMN disabled_at;
    -- Los invitados sin contraseña quedan con un hash que no verifica nunca (siguen sin poder entrar hasta restablecer).
    ALTER TABLE auth_credentials NO FORCE ROW LEVEL SECURITY;
    UPDATE auth_credentials SET password_hash = '!' WHERE password_hash IS NULL AND google_sub IS NULL;
    ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;
    ALTER TABLE auth_credentials DROP CONSTRAINT auth_credentials_login_method_check;
    ALTER TABLE auth_credentials ADD CONSTRAINT auth_credentials_login_method_check
      CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);
  `);
};
