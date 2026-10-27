// migrations/006_minors_guardians.js
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `current_setting('app.current_user_id', true)::uuid`;
const IS_ADMIN = `current_setting('app.current_role', true) = 'admin'`;
const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;

export const up = (pgm) => {
  // shortcut: ADD VALUE no es reversible; el down deja 'tutor' en el enum (inofensivo).
  pgm.sql(`ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'tutor';`);

  pgm.addColumn('profiles', { birth_date: { type: 'date' } });

  pgm.createTable('guardianships', {
    tutor_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    minor_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });
  pgm.addConstraint('guardianships', 'guardianships_pkey', { primaryKey: ['tutor_id', 'minor_id'] });
  pgm.addConstraint('guardianships', 'guardianships_distinct_check', {
    check: 'tutor_id <> minor_id',
  });
  pgm.createIndex('guardianships', 'minor_id');

  pgm.sql(`
    ALTER TABLE guardianships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE guardianships FORCE ROW LEVEL SECURITY;
    CREATE POLICY guardianships_select ON guardianships FOR SELECT TO app_user
      USING (tutor_id = ${UID} OR minor_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY guardianships_insert_admin ON guardianships FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN});
    CREATE POLICY guardianships_delete_admin ON guardianships FOR DELETE TO app_user
      USING (${IS_ADMIN});
  `);

  // El tutor necesita leer birth_date del menor (la política de insert de agreements lo comprueba).
  pgm.sql(`
    CREATE POLICY profiles_select_guardian ON profiles FOR SELECT TO app_user
      USING (EXISTS (
        SELECT 1 FROM guardianships g WHERE g.tutor_id = ${UID} AND g.minor_id = profiles.id
      ));
  `);

  // user_agreements: profile_id = sujeto, signed_by = quien firma realmente.
  pgm.addColumn('user_agreements', {
    signed_by: { type: 'uuid', references: 'profiles', onDelete: 'RESTRICT' },
  });
  // FORCE RLS oculta las filas incluso al dueño: se suspende solo para el backfill.
  pgm.sql(`
    ALTER TABLE user_agreements NO FORCE ROW LEVEL SECURITY;
    UPDATE user_agreements SET signed_by = profile_id;
    ALTER TABLE user_agreements FORCE ROW LEVEL SECURITY;
  `);
  pgm.alterColumn('user_agreements', 'signed_by', { notNull: true });

  // A los 18 el alumno firma la misma versión que ya firmó su tutor: la unicidad incluye al firmante.
  pgm.dropConstraint('user_agreements', 'user_agreements_profile_type_version_key');
  pgm.addConstraint('user_agreements', 'user_agreements_subject_signer_type_version_key', {
    unique: ['profile_id', 'signed_by', 'type', 'version'],
  });

  pgm.sql(`
    DROP POLICY user_agreements_select ON user_agreements;
    DROP POLICY user_agreements_insert_self ON user_agreements;

    CREATE POLICY user_agreements_select ON user_agreements FOR SELECT TO app_user
      USING (
        profile_id = ${UID} OR signed_by = ${UID} OR ${IS_ADMIN}
        OR EXISTS (SELECT 1 FROM guardianships g WHERE g.tutor_id = ${UID} AND g.minor_id = profile_id)
      );

    -- Propio: solo adultos (un menor no firma). Por representación: tutor vinculado y sujeto menor.
    CREATE POLICY user_agreements_insert ON user_agreements FOR INSERT TO app_user
      WITH CHECK (
        signed_by = ${UID}
        AND (
          (profile_id = ${UID}
            AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id AND (${ADULT})))
          OR (profile_id <> ${UID}
            AND EXISTS (SELECT 1 FROM guardianships g WHERE g.tutor_id = ${UID} AND g.minor_id = profile_id)
            AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id AND NOT (${ADULT})))
        )
      );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP POLICY user_agreements_insert ON user_agreements;
    DROP POLICY user_agreements_select ON user_agreements;
    CREATE POLICY user_agreements_select ON user_agreements FOR SELECT TO app_user
      USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY user_agreements_insert_self ON user_agreements FOR INSERT TO app_user
      WITH CHECK (profile_id = ${UID});
  `);
  pgm.dropConstraint('user_agreements', 'user_agreements_subject_signer_type_version_key', { ifExists: true });
  pgm.dropConstraint('user_agreements', 'user_agreements_profile_type_version_key', { ifExists: true });
  pgm.dropColumn('user_agreements', 'signed_by');
  // shortcut: falla si ya hay firmas de tutor + propia de la misma versión; limpiar a mano antes del down.
  pgm.addConstraint('user_agreements', 'user_agreements_profile_type_version_key', {
    unique: ['profile_id', 'type', 'version'],
  });

  pgm.sql(`DROP POLICY profiles_select_guardian ON profiles;`);
  pgm.sql(`
    DROP POLICY guardianships_delete_admin ON guardianships;
    DROP POLICY guardianships_insert_admin ON guardianships;
    DROP POLICY guardianships_select ON guardianships;
    ALTER TABLE guardianships NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE guardianships DISABLE ROW LEVEL SECURITY;
  `);
  pgm.dropTable('guardianships');
  pgm.dropColumn('profiles', 'birth_date');
};
