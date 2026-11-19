// migrations/071_communiques.js
// Comunicados del admin (ADR 0030): texto que la academia envía a los usuarios desde el panel. Los destinatarios de la
// ventana se fijan al enviar (communique_views, una fila por persona); el email va por el outbox (notice_deliveries).
// Escribe solo el servidor (servicePool); el usuario lee los suyos y marca seen_at; el admin lee todo.
/* eslint-disable camelcase */

export const shorthands = undefined;

const UID = `NULLIF(current_setting('app.current_user_id', true), '')::uuid`;
const IS_ADMIN = `COALESCE(current_setting('app.current_role', true) = 'admin', false)`;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE communiques (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
      body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
      audience text NOT NULL CHECK (audience IN ('all', 'members', 'trainers')),
      discipline_ids bigint[] CHECK (discipline_ids IS NULL OR (audience = 'members' AND cardinality(discipline_ids) > 0)),
      channels text[] NOT NULL CHECK (cardinality(channels) > 0 AND channels <@ ARRAY['app', 'email', 'whatsapp']),
      app_count integer NOT NULL DEFAULT 0,
      email_count integer NOT NULL DEFAULT 0,
      created_by uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      withdrawn_at timestamptz,
      withdrawn_by uuid REFERENCES profiles ON DELETE SET NULL
    );
    CREATE INDEX communiques_created_at ON communiques (created_at DESC);

    CREATE TABLE communique_views (
      communique_id uuid NOT NULL REFERENCES communiques ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
      seen_at timestamptz,
      PRIMARY KEY (communique_id, profile_id)
    );
    CREATE INDEX communique_views_pending ON communique_views (profile_id) WHERE seen_at IS NULL;

    ALTER TABLE communiques ENABLE ROW LEVEL SECURITY;
    ALTER TABLE communiques FORCE ROW LEVEL SECURITY;
    ALTER TABLE communique_views ENABLE ROW LEVEL SECURITY;
    ALTER TABLE communique_views FORCE ROW LEVEL SECURITY;

    CREATE POLICY communique_views_select ON communique_views FOR SELECT TO app_user
      USING (profile_id = ${UID} OR ${IS_ADMIN});
    CREATE POLICY communique_views_update_own ON communique_views FOR UPDATE TO app_user
      USING (profile_id = ${UID}) WITH CHECK (profile_id = ${UID});
    CREATE POLICY communiques_select ON communiques FOR SELECT TO app_user
      USING (${IS_ADMIN} OR EXISTS (SELECT 1 FROM communique_views v
                                     WHERE v.communique_id = communiques.id AND v.profile_id = ${UID}));

    GRANT SELECT ON communiques TO app_user;
    GRANT SELECT, UPDATE (seen_at) ON communique_views TO app_user;
  `);
};

export const down = (pgm) => {
  // communiques_select depende de communique_views: primero communiques (con su política y la FK de las vistas).
  pgm.sql(`DROP TABLE communiques CASCADE; DROP TABLE communique_views;`);
};
