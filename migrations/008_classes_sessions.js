// migrations/008_classes_sessions.js
// B6 (ADR 0004): `classes` (horario semanal) genera `class_sessions` reales. Eventos quedan fuera.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const ROLE = `current_setting('app.current_role', true)`;
const IS_ADMIN = `${ROLE} = 'admin'`;
const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;

export const up = (pgm) => {
  // Un evento no es una sesión (CONTEXT): se quita el FK erróneo; la tabla se aborda más adelante.
  pgm.dropConstraint('events', 'events_id_fkey');

  // «Celebrada» se calcula por la hora: el enum queda en scheduled | cancelled.
  // Un enum no puede perder valores: se recrea (la tabla viaja por text).
  pgm.sql(`
    ALTER TABLE class_sessions ALTER COLUMN status TYPE text;
    UPDATE class_sessions SET status = 'scheduled' WHERE status = 'completed';
    DROP TYPE session_status;
    CREATE TYPE session_status AS ENUM ('scheduled', 'cancelled');
    ALTER TABLE class_sessions ALTER COLUMN status TYPE session_status USING status::session_status;
  `);

  pgm.createTable('classes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    discipline_id: { type: 'bigint', notNull: true, references: 'disciplines', onDelete: 'RESTRICT' },
    // RESTRICT: no se da de baja a un profesor con clases (CONTEXT).
    trainer_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'RESTRICT' },
    weekday: { type: 'smallint', notNull: true }, // ISO: 1 = lunes … 7 = domingo
    start_time: { type: 'time', notNull: true }, // hora local de la academia (Europe/Madrid)
    duration_min: { type: 'integer', notNull: true },
    capacity: { type: 'integer', notNull: true },
    location: { type: 'text' },
    starts_on: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
    ends_on: { type: 'date' }, // último día inclusive; NULL = dura hasta que se retira (starts_on - 1 = retirada antes de empezar)
  });
  pgm.addConstraint('classes', 'classes_valid_check', {
    check: `weekday BETWEEN 1 AND 7 AND duration_min > 0 AND capacity > 0
            AND (ends_on IS NULL OR ends_on >= starts_on - 1)`,
  });
  pgm.createIndex('classes', ['discipline_id']);
  pgm.createIndex('classes', ['trainer_id']);

  pgm.dropConstraint('class_sessions', 'class_sessions_trainer_id_fkey');
  pgm.addConstraint('class_sessions', 'class_sessions_trainer_id_fkey', {
    foreignKeys: [{ columns: 'trainer_id', references: 'profiles(id)', onDelete: 'RESTRICT' }],
  });

  // Tabla vacía al aplicar (B6 es la primera que la usa): NOT NULL sin backfill.
  pgm.sql(`
    ALTER TABLE class_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE class_sessions ALTER COLUMN duration_min SET NOT NULL;
    ALTER TABLE class_sessions ALTER COLUMN capacity SET NOT NULL;
  `);
  pgm.addColumns('class_sessions', {
    class_id: { type: 'uuid', references: 'classes', onDelete: 'RESTRICT' }, // NULL = sesión suelta
    ends_at: { type: 'timestamptz', notNull: true }, // la fija quien inserta: starts_at + duration_min
    adjusted_fields: { type: 'text[]', notNull: true, default: '{}' }, // campos tocados a mano: la propagación no los pisa
  });
  pgm.addConstraint('class_sessions', 'class_sessions_valid_check', {
    check: 'duration_min > 0 AND capacity > 0 AND ends_at > starts_at',
  });
  pgm.createIndex('class_sessions', ['class_id', 'starts_at'], {
    unique: true, where: 'class_id IS NOT NULL', name: 'class_sessions_class_start_key',
  });

  // Solape (CONTEXT): un profesor no imparte dos sesiones programadas a la vez.
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_trainer_no_overlap
      EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
      WHERE (status = 'scheduled');
  `);

  pgm.sql(`
    ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE classes FORCE ROW LEVEL SECURITY;
    CREATE POLICY classes_select ON classes FOR SELECT TO app_user USING (${AUTHED});
    CREATE POLICY classes_insert_admin ON classes FOR INSERT TO app_user WITH CHECK (${IS_ADMIN});
    CREATE POLICY classes_update_admin ON classes FOR UPDATE TO app_user
      USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});

    ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE class_sessions FORCE ROW LEVEL SECURITY;
    -- Calendario completo para todos salvo el profesor, que solo ve las suyas (sustituciones incluidas).
    CREATE POLICY class_sessions_select ON class_sessions FOR SELECT TO app_user
      USING (${AUTHED} AND (${ROLE} <> 'profesor' OR trainer_id = ${UID}));
    CREATE POLICY class_sessions_insert_admin ON class_sessions FOR INSERT TO app_user
      WITH CHECK (${IS_ADMIN});
    CREATE POLICY class_sessions_update_admin ON class_sessions FOR UPDATE TO app_user
      USING (${IS_ADMIN}) WITH CHECK (${IS_ADMIN});

    GRANT SELECT, INSERT, UPDATE ON classes, class_sessions TO app_user;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON classes, class_sessions FROM app_user;
    DROP POLICY class_sessions_update_admin ON class_sessions;
    DROP POLICY class_sessions_insert_admin ON class_sessions;
    DROP POLICY class_sessions_select ON class_sessions;
    ALTER TABLE class_sessions NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE class_sessions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE class_sessions DROP CONSTRAINT class_sessions_trainer_no_overlap;
  `);
  pgm.dropIndex('class_sessions', ['class_id', 'starts_at'], { name: 'class_sessions_class_start_key' });
  pgm.dropConstraint('class_sessions', 'class_sessions_valid_check');
  pgm.dropColumns('class_sessions', ['class_id', 'ends_at', 'adjusted_fields']);
  pgm.sql(`
    ALTER TABLE class_sessions ALTER COLUMN capacity DROP NOT NULL;
    ALTER TABLE class_sessions ALTER COLUMN duration_min DROP NOT NULL;
    ALTER TABLE class_sessions ALTER COLUMN id DROP DEFAULT;
  `);
  pgm.dropConstraint('class_sessions', 'class_sessions_trainer_id_fkey');
  pgm.addConstraint('class_sessions', 'class_sessions_trainer_id_fkey', {
    foreignKeys: [{ columns: 'trainer_id', references: 'profiles(id)', onDelete: 'CASCADE' }],
  });
  pgm.dropTable('classes');

  pgm.sql(`
    ALTER TABLE class_sessions ALTER COLUMN status TYPE text;
    DROP TYPE session_status;
    CREATE TYPE session_status AS ENUM ('scheduled', 'cancelled', 'completed');
    ALTER TABLE class_sessions ALTER COLUMN status TYPE session_status USING status::session_status;
  `);
  pgm.addConstraint('events', 'events_id_fkey', {
    foreignKeys: [{ columns: 'id', references: 'class_sessions(id)', onDelete: 'CASCADE' }],
  });
};
