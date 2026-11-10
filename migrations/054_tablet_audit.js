// migrations/054_tablet_audit.js
// B20: vincular una tablet queda en audit_log. La tablet no tiene usuario ni contexto RLS (write_audit lo rechazaría),
// así que link_tablet anota directamente, con quien generó el código (device_tokens.created_by) como actor.
// Revocar se anota desde la app con write_audit() (admin).
/* eslint-disable camelcase */

export const shorthands = undefined;

const linkTablet = (audit) => `
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
      IF id_ IS NULL THEN RAISE EXCEPTION 'invalid_link_code'; END IF;${audit ? `
      INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
      VALUES (gen_random_uuid(), by_, 'tablet.link', 'tablet', id_::text, '{}'::jsonb);` : ''}
      RETURN id_;
    END
    $$;`;

export const up = (pgm) => pgm.sql(linkTablet(true));
export const down = (pgm) => pgm.sql(linkTablet(false));
