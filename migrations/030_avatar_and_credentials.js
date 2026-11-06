// migrations/030_avatar_and_credentials.js
// B24: foto de perfil (ADR 0019) y cambio de contraseña que invalida los tokens de antes (ADR 0020).
// - profiles.avatar: el nombre del fichero (32 bytes aleatorios en hex y su extensión), o NULL.
// - auth_credentials.credentials_changed_at: requireAuth rechaza los tokens con un iat anterior. NULL = nunca.
// - write_audit (027): el propio usuario puede anotar sus cambios de contraseña y de foto (la del hijo, el tutor).
// - consume_password_reset (025): restablecer también cierra las sesiones abiertas.
// - public_profiles (019): la foto, solo con su campo visible (`photo`).
/* eslint-disable camelcase */

export const shorthands = undefined;

const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;
const SHOWN = (field) => `COALESCE((p.visible_fields->>'${field}')::boolean, false)`;

const writeAudit = (selfService) => `
  CREATE OR REPLACE FUNCTION write_audit(p_actor uuid, p_action text, p_resource_type text, p_resource_id text, p_changes jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE uid uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    BEGIN
      IF session_user <> 'service_role' AND (
           uid IS NULL OR p_actor IS DISTINCT FROM uid
           OR (NOT COALESCE(current_setting('app.current_role', true) = 'admin', false)
               AND p_action <> ALL (ARRAY[${selfService.map((a) => `'${a}'`).join(', ')}]))) THEN
        RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
      END IF;
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), p_actor, p_action, p_resource_type, p_resource_id, p_changes);
    END
    $$;`;
const SELF_SERVICE_027 = ['subscription.upgrade', 'subscription.downgrade', 'subscription.downgrade_cancel'];
const SELF_SERVICE = [...SELF_SERVICE_027, 'auth.password_change', 'profile.avatar_set', 'profile.avatar_remove'];

const consumeReset = (closeSessions) => `
  CREATE OR REPLACE FUNCTION consume_password_reset(p_token_hash text, p_password_hash text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE pid uuid;
    BEGIN
      UPDATE password_resets SET used_at = now()
       WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
      RETURNING profile_id INTO pid;
      IF pid IS NULL THEN RETURN false; END IF;
      UPDATE auth_credentials SET password_hash = p_password_hash${closeSessions
        ? `, credentials_changed_at = date_trunc('second', now())` : ''} WHERE profile_id = pid;
      RETURN true;
    END
    $$;`;

const publicProfiles = (avatar) => `
  DROP VIEW public_profiles;
  CREATE VIEW public_profiles WITH (security_barrier) AS
    SELECT p.id, p.display_name, r.role,
           CASE WHEN ${SHOWN('bio')} THEN p.bio END AS bio,
           CASE WHEN ${SHOWN('social_links')} THEN p.social_links END AS social_links,
           CASE WHEN ${SHOWN('disciplines')} THEN public_disciplines(p.id) END AS disciplines,
           CASE WHEN ${SHOWN('member_since')} THEN to_char(p.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') END
             AS member_since,
           public_achievements(p.id) AS achievements${avatar ? `,
           CASE WHEN ${SHOWN('photo')} THEN p.avatar END AS avatar` : ''}
      FROM profiles p JOIN user_roles r ON r.user_id = p.id
     WHERE ${AUTHED} AND p.is_public AND can_be_public(p.id);
  REVOKE ALL ON public_profiles FROM PUBLIC, app_user;
  ALTER VIEW public_profiles OWNER TO service_role;
  GRANT SELECT ON public_profiles TO app_user;`;

export const up = (pgm) => {
  pgm.addColumns('profiles', { avatar: { type: 'text' } });
  pgm.addConstraint('profiles', 'profiles_avatar_format', { check: `avatar ~ '^[0-9a-f]{64}\\.(jpg|png|webp)$'` });
  pgm.addColumns('auth_credentials', { credentials_changed_at: { type: 'timestamptz' } });
  pgm.sql(writeAudit(SELF_SERVICE));
  pgm.sql(consumeReset(true));
  pgm.sql(publicProfiles(true));
};

export const down = (pgm) => {
  pgm.sql(publicProfiles(false));
  pgm.sql(consumeReset(false));
  pgm.sql(writeAudit(SELF_SERVICE_027));
  pgm.dropColumns('auth_credentials', ['credentials_changed_at']);
  pgm.dropColumns('profiles', ['avatar']);
};
