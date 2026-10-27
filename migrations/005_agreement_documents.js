// migrations/005_agreement_documents.js
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  // Un rol por perfil (docs/adr/0001-rol-unico-por-perfil.md).
  pgm.addConstraint('user_roles', 'user_roles_user_id_key', { unique: ['user_id'] });

  pgm.createTable('agreement_documents', {
    id: { type: 'uuid', primaryKey: true }, // la app genera con crypto.randomUUID()
    type: { type: 'text', notNull: true },
    version: { type: 'text', notNull: true },
    storage_path: { type: 'text', notNull: true }, // relativa a AGREEMENTS_STORAGE_PATH
    checksum: { type: 'text', notNull: true }, // SHA-256 hex
    mime_type: { type: 'text', notNull: true, default: 'application/pdf' },
    published_at: { type: 'timestamptz' },
    retired_at: { type: 'timestamptz' },
    published_by: { type: 'uuid', references: 'profiles', onDelete: 'SET NULL' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  pgm.addConstraint('agreement_documents', 'agreement_documents_type_check', {
    check: "type IN ('waiver', 'data_protection', 'rights_of_image')",
  });
  pgm.addConstraint('agreement_documents', 'agreement_documents_type_version_key', {
    unique: ['type', 'version'],
  });
  // Una sola versión vigente por tipo.
  pgm.createIndex('agreement_documents', 'type', {
    name: 'agreement_documents_current_idx',
    unique: true,
    where: 'published_at IS NOT NULL AND retired_at IS NULL',
  });

  pgm.sql(`
    ALTER TABLE agreement_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agreement_documents FORCE ROW LEVEL SECURITY;
  `);
  pgm.sql(`
    CREATE POLICY agreement_documents_select ON agreement_documents
      FOR SELECT TO app_user
      USING (
        published_at IS NOT NULL
        OR current_setting('app.current_role', true) = 'admin'
      );
  `);
  pgm.sql(`
    CREATE POLICY agreement_documents_insert_admin ON agreement_documents
      FOR INSERT TO app_user
      WITH CHECK (current_setting('app.current_role', true) = 'admin');
  `);
  pgm.sql(`
    CREATE POLICY agreement_documents_update_admin ON agreement_documents
      FOR UPDATE TO app_user
      USING (current_setting('app.current_role', true) = 'admin')
      WITH CHECK (current_setting('app.current_role', true) = 'admin');
  `);
  // Nunca se borra un documento (las firmas históricas lo referencian por tipo+versión).
  pgm.sql(`REVOKE DELETE ON agreement_documents FROM app_user;`);
};

export const down = (pgm) => {
  pgm.sql(`GRANT DELETE ON agreement_documents TO app_user;`);
  pgm.sql(`DROP POLICY IF EXISTS agreement_documents_update_admin ON agreement_documents;`);
  pgm.sql(`DROP POLICY IF EXISTS agreement_documents_insert_admin ON agreement_documents;`);
  pgm.sql(`DROP POLICY IF EXISTS agreement_documents_select ON agreement_documents;`);
  pgm.dropTable('agreement_documents');
  pgm.dropConstraint('user_roles', 'user_roles_user_id_key');
};
