// src/services/emailSuppressions.js — direcciones que rebotan o se quejan (ADR 0029). Solo servicePool.
import { servicePool } from '../config/database.js';

// Eventos de Brevo que suprimen la dirección. soft_bounce no (solo se registra) y el resto se ignora.
export const SUPPRESSING = ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribed'];

/**
 * Suprime la dirección. Idempotente: un evento repetido no falla ni cambia nada; uno duro sustituye a una baja previa
 * (la baja solo afecta a los avisos opcionales, el duro a todos).
 */
export async function suppress({ email, event, reason = null, messageId = null }, db = servicePool) {
  await db.query(
    `INSERT INTO email_suppressions (email, event, reason, provider_message_id) VALUES (lower($1), $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET event = EXCLUDED.event, reason = EXCLUDED.reason,
       provider_message_id = EXCLUDED.provider_message_id, created_at = now()
      WHERE email_suppressions.event = 'unsubscribed' AND EXCLUDED.event <> 'unsubscribed'`,
    [email, event, reason, messageId]);
}

/** ¿No se le debe enviar? Una baja solo cuenta para los avisos opcionales; cualquier otro motivo, para todos. */
export async function isSuppressed(email, { optional = false } = {}, db = servicePool) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM email_suppressions WHERE email = lower($1) AND ($2 OR event <> 'unsubscribed')`, [email, optional]);
  return rowCount > 0;
}
