// migrations/036_medal_themes.js
// Temáticas de medallas (CONTEXT § Temática, ADR 0022): el repertorio vive aquí y el arte y los nombres en el
// frontend (frontend/src/lib/themes/), por código. Añadir un anime = un INSERT en una migración + su archivo de arte.
// Una temática está en una sola disciplina activa a la vez (índice único parcial); la desactivada la conserva.
// Los códigos son internos y estables: al pasar a nombres de género (antes de producción) solo cambian name y el arte.
/* eslint-disable camelcase */

export const shorthands = undefined;

const AUTHED = `NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL`;

export const THEMES = [
  ['ippo', 'Hajime no Ippo', 1],
  ['titanes', 'Shingeki no Kyojin', 2],
  ['saiyan', 'Dragon Ball', 3],
  ['mugiwara', 'One Piece', 4],
  ['naruto', 'Naruto', 5],
  ['shinigami', 'Bleach', 6],
  ['hunter', 'Hunter x Hunter', 7],
];

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE medal_themes (
      code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{1,32}$'),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      sort integer NOT NULL DEFAULT 0
    );
    INSERT INTO medal_themes (code, name, sort) VALUES ${THEMES.map(([c, n, s]) => `('${c}', '${n}', ${s})`).join(', ')};
    ALTER TABLE medal_themes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE medal_themes FORCE ROW LEVEL SECURITY;
    CREATE POLICY medal_themes_select ON medal_themes FOR SELECT TO app_user USING (${AUTHED});
    REVOKE ALL ON medal_themes FROM app_user;
    GRANT SELECT ON medal_themes TO app_user;

    ALTER TABLE disciplines ADD COLUMN medal_theme text REFERENCES medal_themes (code) ON UPDATE CASCADE;
    CREATE UNIQUE INDEX disciplines_medal_theme_active ON disciplines (medal_theme) WHERE is_active;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE disciplines DROP COLUMN medal_theme;
    DROP TABLE medal_themes;
  `);
};
