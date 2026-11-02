// migrations/027_audit_log_write_audit.js
// B20 (hallazgo [Alta] de B8): audit_log dejaba insertar filas arbitrarias a cualquier autenticado (política
// `audit_log_insert_authenticated`), así que la auditoría era inalterable pero no auténtica. Ahora app_user no inserta:
// todo se anota con write_audit(): el actor tiene que ser el de la sesión (no se puede firmar como
// otro), el admin anota cualquier acción y el resto solo las suyas de la cuota. Los avisos y las auditorías de las funciones SECURITY DEFINER y del servicePool siguen como estaban.
/* eslint-disable camelcase */

export const shorthands = undefined;

// Lo único que un no admin anota él mismo (B10.5, /billing/subscriptions/:id/plan): el resto de sus acciones las anotan
// funciones SECURITY DEFINER o el servidor.
const SELF_SERVICE = ['subscription.upgrade', 'subscription.downgrade', 'subscription.downgrade_cancel'];

export const up = (pgm) => {
  pgm.sql(`
    -- p_actor: quien hace la acción. Con app_user tiene que ser el de la sesión (nadie firma como otro); el servidor
    -- (servicePool, que ya puede escribir en audit_log) lo pasa tal cual.
    CREATE FUNCTION write_audit(p_actor uuid, p_action text, p_resource_type text, p_resource_id text, p_changes jsonb)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE uid uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
      BEGIN
        IF session_user <> 'service_role' AND (
             uid IS NULL OR p_actor IS DISTINCT FROM uid
             OR (NOT COALESCE(current_setting('app.current_role', true) = 'admin', false)
                 AND p_action <> ALL (ARRAY[${SELF_SERVICE.map((a) => `'${a}'`).join(', ')}]))) THEN
          RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
        END IF;
        INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
        VALUES (gen_random_uuid(), p_actor, p_action, p_resource_type, p_resource_id, p_changes);
      END
      $$;
    ALTER FUNCTION write_audit(uuid, text, text, text, jsonb) OWNER TO service_role;
    REVOKE ALL ON FUNCTION write_audit(uuid, text, text, text, jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb) TO app_user;

    DROP POLICY audit_log_insert_authenticated ON audit_log;
    REVOKE INSERT ON audit_log FROM app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    GRANT INSERT ON audit_log TO app_user;
    CREATE POLICY audit_log_insert_authenticated ON audit_log
      FOR INSERT TO app_user WITH CHECK (current_setting('app.current_user_id', true) IS NOT NULL);
    DROP FUNCTION write_audit(uuid, text, text, text, jsonb);
  `);
};
