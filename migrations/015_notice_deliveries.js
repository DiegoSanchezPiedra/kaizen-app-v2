// migrations/015_notice_deliveries.js
// B10.6: entregas de los avisos (outbox, ADR 0008). notice() (services/notices.js) crea el aviso en audit_log y
// sus entregas en la misma sentencia; el worker de la API las envía. audit_log sigue inalterable: el estado vive aquí.
/* eslint-disable camelcase */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('notice_deliveries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // CASCADE: los scripts de test borran audit_log y perfiles; en producción app_user no borra ninguno.
    audit_id: { type: 'uuid', notNull: true, references: 'audit_log', onDelete: 'CASCADE' },
    recipient_id: { type: 'uuid', notNull: true, references: 'profiles', onDelete: 'CASCADE' },
    channel: { type: 'text', notNull: true, check: `channel IN ('email')` }, // B15 añade 'push'
    status: {
      type: 'text', notNull: true, default: 'pending', check: `status IN ('pending', 'sent', 'failed', 'skipped')`,
    },
    attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    sent_at: { type: 'timestamptz' },
    provider_message_id: { type: 'text' },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('notice_deliveries', 'notice_deliveries_once', { unique: ['audit_id', 'recipient_id', 'channel'] });
  pgm.createIndex('notice_deliveries', 'next_attempt_at', { where: `status = 'pending'` });
  // Solo el servidor (servicePool), como webhook_events.
  pgm.sql(`REVOKE ALL ON notice_deliveries FROM app_user;`);
};

export const down = (pgm) => {
  pgm.dropTable('notice_deliveries');
};
