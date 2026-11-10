// migrations/049_published_agreement_immutable.js
// B20 (auditoría de RLS, B8): agreement_documents_update_admin dejaba al admin cambiar version, checksum o storage_path
// de un documento ya publicado (o despublicarlo), y las firmas apuntan a tipo y versión. CONTEXT § Acuerdos: borrador →
// publicado → retirado. Con app_user, a uno publicado solo se le pone retired_at; uno retirado ya no cambia. Los
// borradores siguen igual, y el servicePool (tests, seeds) no pasa por aquí.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION agreement_documents_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
      BEGIN
        IF current_user = 'app_user' AND OLD.published_at IS NOT NULL
           AND (OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
                OR to_jsonb(NEW) - 'retired_at' IS DISTINCT FROM to_jsonb(OLD) - 'retired_at') THEN
          RAISE EXCEPTION 'document_published' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END
      $$;
    CREATE TRIGGER agreement_documents_guard BEFORE UPDATE ON agreement_documents
      FOR EACH ROW EXECUTE FUNCTION agreement_documents_guard();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER agreement_documents_guard ON agreement_documents;
    DROP FUNCTION agreement_documents_guard();
  `);
};
