// migrations/056_link_tablet_sin_creador.js
// B20: device_tokens.created_by es nullable (ON DELETE SET NULL) y audit_log.actor_id NOT NULL: si se borró al admin que
// generó el código, link_tablet (054) daba 500. Ahora solo anota la auditoría cuando hay creador.
/* eslint-disable camelcase */

export const shorthands = undefined;

const linkTablet = (guard) => `
  CREATE OR REPLACE FUNCTION link_tablet(p_code_hash text, p_token_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      id_ uuid;
      by_ uuid;
    BEGIN
      UPDATE device_tokens SET token_hash = p_token_hash, linked_at = now(), link_code_hash = NULL,
                               link_expires_at = NULL
       WHERE link_code_hash = p_code_hash AND link_expires_at > now() AND revoked_at IS NULL
         AND token_hash IS NULL
      RETURNING id, created_by INTO id_, by_;
      IF id_ IS NULL THEN RAISE EXCEPTION 'invalid_link_code'; END IF;${guard ? `
      IF by_ IS NOT NULL THEN` : ''}
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), by_, 'tablet.link', 'tablet', id_::text, '{}'::jsonb);${guard ? `
      END IF;` : ''}
      RETURN id_;
    END
    $$;`;

export const up = (pgm) => pgm.sql(linkTablet(true));
export const down = (pgm) => pgm.sql(linkTablet(false));
