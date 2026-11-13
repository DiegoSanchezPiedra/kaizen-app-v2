// migrations/063_jit_off.js
// JIT (compilación al vuelo) apagado en la base de datos. Las consultas de los rankings llaman a funciones SQL con un coste
// estimado alto (por perfil: racha y medallas), y Postgres las compilaba con JIT en cada llamada: ~90 ms de compilación para
// 3 ms de trabajo, así que un ranking de 7 filas tardaba 5 s (medal_ranking 674 → 34 ms; sus insignias, 4,3 s → 0,2 s sin JIT).
// JIT solo compensa en analítica pesada, no en una app transaccional como esta. Vale para las conexiones nuevas.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET jit = off', current_database()); END $$;`);
};

export const down = (pgm) => {
  pgm.sql(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I RESET jit', current_database()); END $$;`);
};
