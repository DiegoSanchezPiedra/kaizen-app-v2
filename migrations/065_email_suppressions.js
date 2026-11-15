// migrations/065_email_suppressions.js
// Direcciones a las que ya no se envía (ADR 0029): rebotes y quejas que Brevo notifica por webhook.
// Solo service_role: el webhook y el envío usan el servicePool; app_user no la ve (ni siquiera existe para él).
// El email va en minúsculas y puede no pertenecer a ningún perfil (la dirección rebotó igualmente).
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('email_suppressions', {
    email: { type: 'text', primaryKey: true, check: 'email = lower(email)' },
    reason: { type: 'text' }, // motivo en texto libre que da Brevo
    event: { type: 'text', notNull: true, check: `event IN ('hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribed')` },
    provider_message_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON email_suppressions FROM app_user;
  `);
};

export const down = (pgm) => {
  pgm.dropTable('email_suppressions');
};
