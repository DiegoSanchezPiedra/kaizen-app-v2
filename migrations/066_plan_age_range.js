// migrations/066_plan_age_range.js
// Rango de edad de un plan (CONTEXT § Rango de edad de un plan): min_age y max_age, opcionales e inclusive, sustituyen a
// plans.minors_only (= máxima 17), como hizo la 058 con las disciplinas. Contratar y cambiar a un plan miran mínima y
// máxima con la edad de hoy (en billing.js); covers, solo la máxima, hoy. Sin barrido propio: al superar la máxima del
// plan deja de cubrir y sus reservas se quedan (CONTEXT § Superar la máxima); las de disciplinas con rango las barre la 058.
// write_audit admite subscription.age_change: el cambio de plan por edad sin cobro.
/* eslint-disable camelcase */

export const shorthands = undefined;

const ADULT = `p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years'`;

// Parches sobre la definición actual (como 058): [función, texto de antes, texto de después]. Si no encuentra, falla.
const PATCHES = [
  // Cambio de plan por edad sin cobro (billing.js): el alumno lo pide por sí mismo, como subida y bajada.
  ['write_audit(uuid, text, text, text, jsonb)', `'subscription.downgrade_cancel', `, `'subscription.downgrade_cancel', 'subscription.age_change', `],
  ['covers(uuid, bigint)', `AND (NOT (${ADULT}) OR NOT pl.minors_only)`, `AND in_age_range(p.birth_date, NULL, pl.max_age, now())`],
];
const patch = ([fn, from, to]) => `
  DO $do$
  DECLARE
    def text := pg_get_functiondef('${fn}'::regprocedure);
  BEGIN
    IF position($q$${from}$q$ IN def) = 0 THEN RAISE EXCEPTION '${fn}: no encuentro %', $q$${from}$q$; END IF;
    EXECUTE replace(def, $q$${from}$q$, $q$${to}$q$);
  END
  $do$;
`;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE plans
      ADD COLUMN min_age smallint, ADD COLUMN max_age smallint,
      ADD CONSTRAINT plans_age_range
        CHECK (min_age BETWEEN 0 AND 99 AND max_age BETWEEN 0 AND 99 AND min_age <= max_age);
    -- migrator es el dueño pero la RLS es FORCE: sin quitarla, el UPDATE no ve ninguna fila.
    ALTER TABLE plans NO FORCE ROW LEVEL SECURITY;
    UPDATE plans SET max_age = 17 WHERE minors_only;
    ALTER TABLE plans FORCE ROW LEVEL SECURITY;
  `);
  PATCHES.forEach((p) => pgm.sql(patch(p)));
  pgm.sql(`ALTER TABLE plans DROP COLUMN minors_only;`);
};

// No es exactamente reversible: minors_only = máxima ≤ 17; la mínima y otras máximas se pierden.
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE plans ADD COLUMN minors_only boolean NOT NULL DEFAULT false;
    ALTER TABLE plans NO FORCE ROW LEVEL SECURITY;
    UPDATE plans SET minors_only = true WHERE max_age <= 17;
    ALTER TABLE plans FORCE ROW LEVEL SECURITY;
  `);
  [...PATCHES].reverse().forEach(([fn, from, to]) => pgm.sql(patch([fn, to, from])));
  pgm.sql(`ALTER TABLE plans DROP COLUMN min_age, DROP COLUMN max_age;`);
};
