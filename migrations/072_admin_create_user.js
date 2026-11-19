// migrations/072_admin_create_user.js
// Beta cerrada (ADR 0032): el admin da de alta alumnos, tutores y admins con invitación de 72 h, como a los profesores (064).
// Mismas piezas: trainer_admin_guard() y trainer_new_invite(); el audit va con resource_type 'profile' y solo ids.
// Además, dar el rol admin deja de exigir el doble factor del admin (riesgo aceptado, ADR 0032): se quita HAS_MFA de las
// políticas de user_roles que puso la 051 (una fila admin sigue sin cambiarse ni borrarse desde la app).
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;
const HAS_MFA = `EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = ${UID} AND m.mfa_enabled)`;
const FNS = [
  'admin_create_user(uuid, text, text, date, text, text)',
  'admin_user_invite(uuid, text)',
];

export const up = (pgm) => {
  pgm.sql(`
    ALTER POLICY user_roles_insert_self_alumno_or_admin ON user_roles
      WITH CHECK (${IS_ADMIN} OR (user_id = ${UID} AND role = 'alumno'));
    ALTER POLICY user_roles_update_admin ON user_roles
      USING (${IS_ADMIN} AND role <> 'admin') WITH CHECK (${IS_ADMIN});

    CREATE FUNCTION admin_create_user(p_id uuid, p_email text, p_display_name text, p_birth_date date, p_role text, p_token_hash text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        PERFORM trainer_admin_guard();
        IF p_role IS NULL OR p_role NOT IN ('alumno', 'tutor', 'admin') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0001'; END IF;
        INSERT INTO profiles (id, display_name, birth_date) VALUES (p_id, p_display_name, p_birth_date);
        INSERT INTO auth_credentials (profile_id, email, email_verified, can_create_children) VALUES (p_id, p_email, false, p_role = 'tutor');
        INSERT INTO user_roles (user_id, role) VALUES (p_id, p_role::app_role);
        PERFORM trainer_new_invite(p_id, p_token_hash);
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'profile.create', 'profile', p_id::text, jsonb_build_object('role', p_role));
      END
      $$;

    -- Solo quien nunca activó la cuenta (sin contraseña ni Google), adulto, activo y que no sea profesor (esos, por /admin/trainers).
    CREATE FUNCTION admin_user_invite(p_id uuid, p_token_hash text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE c record;
      BEGIN
        PERFORM trainer_admin_guard();
        SELECT email, password_hash, google_sub, disabled_at INTO c FROM auth_credentials WHERE profile_id = p_id FOR UPDATE;
        IF NOT FOUND THEN -- sin credenciales: un hijo (no invitable) o un perfil que no existe
          IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id) THEN RAISE EXCEPTION 'not_invitable' USING ERRCODE = 'P0001'; END IF;
          RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
        END IF;
        IF c.password_hash IS NOT NULL OR c.google_sub IS NOT NULL THEN RAISE EXCEPTION 'already_active' USING ERRCODE = 'P0001'; END IF;
        IF c.email IS NULL OR c.disabled_at IS NOT NULL OR is_minor(p_id)
           OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_id AND role = 'profesor') THEN
          RAISE EXCEPTION 'not_invitable' USING ERRCODE = 'P0001';
        END IF;
        PERFORM trainer_new_invite(p_id, p_token_hash);
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), ${UID}, 'profile.invite', 'profile', p_id::text, '{}'::jsonb);
      END
      $$;
  `);
  for (const fn of FNS) {
    pgm.sql(`ALTER FUNCTION ${fn} OWNER TO service_role; REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION ${fn} TO app_user;`);
  }
};

export const down = (pgm) => {
  pgm.sql(`${FNS.map((fn) => `DROP FUNCTION ${fn};`).join('\n')}
    ALTER POLICY user_roles_insert_self_alumno_or_admin ON user_roles
      WITH CHECK ((${IS_ADMIN} AND (role <> 'admin' OR ${HAS_MFA})) OR (user_id = ${UID} AND role = 'alumno'));
    ALTER POLICY user_roles_update_admin ON user_roles
      USING (${IS_ADMIN} AND role <> 'admin') WITH CHECK (${IS_ADMIN} AND (role <> 'admin' OR ${HAS_MFA}));`);
};
