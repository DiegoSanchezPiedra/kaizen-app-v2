// src/services/notices.js — avisos y su entrega (B10.6; CONTEXT § Avisos; ADR 0008).
// notice() escribe el aviso en audit_log y sus entregas en notice_deliveries en una sentencia (outbox).
// El worker de la API las envía: compone el mensaje al enviar, con el aviso y los datos actuales.
// Los avisos de reservas y de re-firma (B15, ADR 0011) crean sus entregas en SQL (enqueue_notice): push, o email
// de respaldo si el destinatario no tenía dispositivos de push.
import { servicePool } from '../config/database.js';
import { APP_URL } from '../config/stripe.js';
import { EMAIL_REPLY_TO } from '../config/email.js';
import { send } from './email.js';
import { send as sendPush } from './push.js';

// Acción → canales de notice(). Los avisos de facturación van solo por email al pagador; los de reservas y
// re-firma no pasan por aquí (SQL). stripe_risk solo va a admins, que nunca reciben entregas.
const CHANNELS = Object.fromEntries([
  'payment_failed', 'checkout_payment_failed', 'checkout_race_refunded',
  'plan_downgraded', 'upgrade_requires_action', 'subscription_unpaid', 'subscription_cancelled',
  'payer_change_requested', 'payer_change_paid', 'payer_change_expired', 'payer_change_cancelled',
  'event_refunded', 'avatar_removed', 'clock_corrected', 'clock_open',
].map((a) => [`notice.${a}`, ['email']]));

/** Aviso + una entrega por destinatario no admin y canal, en una sentencia (también en autocommit). */
export async function notice(db, { action, actorId, type, resourceId, recipients, ...extra }) {
  await db.query(
    `WITH a AS (
       INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id)
     INSERT INTO notice_deliveries (audit_id, recipient_id, channel)
     SELECT a.id, r, ch FROM a, unnest($6::uuid[]) r, unnest($7::text[]) ch
      WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = r AND role = 'admin')
     ON CONFLICT DO NOTHING`,
    [actorId, action, type, resourceId, { ...extra, recipients }, recipients, CHANNELS[action] ?? []]);
}

// --- Plantillas (solo español). Datos mínimos: nunca salud, edad, fecha de nacimiento ni tarjeta ---

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const eur = (cents) => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const TZ = 'Europe/Madrid';
const day = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const moment = (d) => new Date(d).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: TZ });
const BILLING = `${APP_URL}/billing`;

const BILLING_FOOTER = 'Este es un email de servicio sobre tus pagos en Kaizen: no se puede dar de baja mientras '
  + 'tengas pagos con la academia.';

// Esqueleto común: saludo, párrafos, un enlace y el pie de email de servicio (LSSI art. 21: sin baja).
export function mail(subject, d, paragraphs, [label, url] = ['Ir a facturación', BILLING], about = BILLING_FOOTER) {
  const hello = d.payer ? `Hola, ${d.payer}:` : 'Hola:';
  const contact = EMAIL_REPLY_TO ? `escribe a ${EMAIL_REPLY_TO}` : 'contesta a este email';
  const footer = `${about} Para cualquier duda, ${contact}.`;
  const text = [hello, ...paragraphs, `${label}: ${url}`, '--', footer].join('\n\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;line-height:1.5">
<p>${esc(hello)}</p>
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p><a href="${esc(url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">${esc(label)}</a></p>
<p style="font-size:12px;color:#71717a">${esc(footer)}</p>
</div></body></html>`;
  return { subject, text, html };
}

const plan = (d, key) => d.plans[d.c[key]] ?? '';
const VOIDED = 'Los recibos que quedaban pendientes se han anulado: ya no se cobrarán.';
const future = (d) => new Date(d) > new Date();

// Cambio de pagador (B11). El mismo aviso va al pagador antiguo y al nuevo con textos distintos.
const isOld = (d) => d.to === d.change.old_payer_id;
const refund = (d) => (d.c.refunded ? [`Te hemos devuelto ${eur(d.c.refunded)} que se llegaron a cobrar.`] : []);
const CANCELLED = {
  admin: 'la academia lo ha anulado',
  replaced: 'la academia lo ha sustituido por otro',
  subscription_cancelled: 'la suscripción se ha dado de baja',
  expired: 'el plazo para pagarlo ya había terminado',
};

// d = { to, c: changes, payer, student, plans: { id: nombre }, invoice, change }
const TEMPLATES = {
  'notice.payment_failed': (d) => mail(`No hemos podido cobrar el recibo de ${d.student}`, d, [
    `El cobro de ${eur(d.invoice.amount_due_cents)}${d.invoice.plan ? ` del plan ${d.invoice.plan}` : ''} `
      + `de ${d.student} no se ha podido realizar.`,
    d.c.next_payment_attempt
      ? `Lo volveremos a intentar el ${day(d.c.next_payment_attempt)}. Si hace falta, cambia la tarjeta antes desde la app.`
      : 'No habrá más intentos automáticos. Cambia la tarjeta o paga el recibo desde la app.',
  ]),
  'notice.checkout_payment_failed': (d) => mail(`No se ha completado el pago de la suscripción de ${d.student}`, d, [
    `El pago de la suscripción de ${d.student} no se ha completado, así que la suscripción no se ha activado.`,
    'Puedes volver a intentarlo desde la app.',
  ]),
  'notice.checkout_race_refunded': (d) => mail(`Te hemos devuelto un pago duplicado de ${d.student}`, d, [
    `Se completaron dos pagos de suscripción para ${d.student} a la vez. Hemos mantenido la primera suscripción, `
      + 'cancelado la segunda y devuelto su importe.',
    'El reembolso puede tardar unos días en aparecer en tu cuenta.',
  ]),
  'notice.plan_downgraded': (d) => mail(`Cambio de plan de ${d.student} aplicado`, d, [
    `${d.student} ha pasado del plan ${plan(d, 'from_plan_id')} al plan ${plan(d, 'to_plan_id')}.`,
    'Las reservas de disciplinas que el nuevo plan no cubre se han cancelado.',
  ]),
  'notice.upgrade_requires_action': (d) => mail(`Confirma el pago del cambio de plan de ${d.student}`, d, [
    `La academia ha pedido cambiar a ${d.student} del plan ${plan(d, 'from_plan_id')} al plan ${plan(d, 'plan_id')}. `
      + `Tu banco pide que confirmes el pago de ${eur(d.c.amount_cents)} (la diferencia de este periodo).`,
    `Confírmalo antes del ${moment(d.c.expires_at)}. Si no, el plan no cambia y no se cobra nada.`,
  ], ['Confirmar el pago', d.c.hosted_invoice_url]),
  'notice.subscription_unpaid': (d) => mail(`La suscripción de ${d.student} está impagada`, d, [
    `No hemos podido cobrar ${eur(d.c.amount_cents)} del plan ${plan(d, 'plan_id')} de ${d.student} tras varios intentos.`,
    `Mientras siga impagada, ${d.student} no puede reservar clases y sus reservas futuras se han cancelado. `
      + 'Al pagar el recibo vuelve a estar activa.',
  ], ['Pagar el recibo', d.c.hosted_invoice_url]),
  'notice.subscription_cancelled': (d) => mail(`Baja de la suscripción de ${d.student}`, d, [
    `La academia ha dado de baja la suscripción de ${d.student} (plan ${plan(d, 'plan_id')}). `
      + (future(d.c.ends_at) ? `Seguirá activa hasta el ${day(d.c.ends_at)}.` : 'La baja es efectiva desde hoy.'),
    ...(d.c.discarded_plan_id ? [`El cambio al plan ${plan(d, 'discarded_plan_id')} que estaba programado queda anulado.`] : []),
    ...(d.c.voided ? [VOIDED] : []),
  ]),
  'notice.payer_change_requested': (d) => mail(`Pago de la suscripción de ${d.student}`, d, [
    `La academia ha pedido que pases a pagar la suscripción de ${d.student} (plan ${plan(d, 'plan_id')}, `
      + `${eur(d.change.price_cents)} al mes).`,
    `Hoy no se te cobra nada: empezarás a pagar el ${day(d.c.starts_at)}. Para aceptarlo, añade tu tarjeta antes `
      + `del ${moment(d.c.deadline)}.`,
  ], ['Revisar y pagar', `${BILLING}/payer-changes/${d.change.id}`]),
  'notice.payer_change_paid': (d) => mail(`Cambio de pagador de ${d.student} confirmado`, d, [
    isOld(d)
      ? `${d.change.new_payer} ha aceptado pagar la suscripción de ${d.student}. La que pagas tú termina el `
        + `${day(d.change.starts_at)} y desde entonces la paga ${d.change.new_payer}.`
      : `Desde el ${day(d.change.starts_at)} pagarás ${eur(d.change.price_cents)} al mes por la suscripción de `
        + `${d.student} (plan ${plan(d, 'plan_id')}), con la tarjeta que has añadido. Hasta entonces no se te cobra nada.`,
    ...(d.c.from_plan_id !== d.c.plan_id
      ? [`El cambio al plan ${plan(d, 'plan_id')} que estaba programado se aplica desde esa fecha.`] : []),
  ]),
  'notice.payer_change_expired': (d) => mail(`El cambio de pagador de ${d.student} ha caducado`, d, isOld(d)
    ? [`El nuevo pagador no completó el pago a tiempo, así que sigues pagando tú la suscripción de ${d.student}.`]
    : [`El plazo para pagar la suscripción de ${d.student} terminó sin completarse y el enlace ya no vale. `
        + 'Si sigue haciendo falta, la academia puede volver a pedirlo.', ...refund(d)]),
  'notice.payer_change_cancelled': (d) => mail(`Cambio de pagador de ${d.student} anulado`, d, isOld(d)
    ? [`El cambio de pagador de la suscripción de ${d.student} se ha anulado porque ${CANCELLED[d.c.reason]}.`]
    : [`El cambio para que pagues la suscripción de ${d.student} se ha anulado porque `
        + `${CANCELLED[d.c.reason] ?? 'ya no está vigente'}. El enlace que recibiste ya no vale.`,
    ...(d.c.refunded ? refund(d) : ['No se te cobrará nada.'])]),
  // Reembolso de una inscripción (B21.0): cualquiera que pida Kaizen, siempre entero.
  'notice.event_refunded': (d) => mail(`Te hemos devuelto el pago de ${d.c.title}`, d, [
    `Te hemos devuelto ${eur(d.c.amount_cents)} de la inscripción de ${d.student} en ${d.c.title}.`,
    'El reembolso puede tardar unos días en aparecer en tu cuenta.',
  ], ['Ver el evento', `${APP_URL}/events/${d.c.event_id}`]),
};

// --- Avisos de reservas y de re-firma (B15): push { title, body, url, tag } o email de respaldo ---

const when = (d) => new Date(d).toLocaleString('es-ES', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});
const label = (s) => `${s.discipline}, ${when(s.starts_at)}`;
// Uno o varios (agrupados): las reservas del grupo, con el nombre del alumno y nada más de él.
const one = (g, single, many) => (g.sessions.length === 1
  ? `${label(g.sessions[0])} (${g.student}): ${single}`
  : `Se han cancelado ${g.sessions.length} reservas de ${g.student}: ${many}`);
const BOOKINGS = `${APP_URL}/bookings`;
const AGREEMENTS_URL = `${APP_URL}/agreements`;
const CLOCK_URL = `${APP_URL}/clock`;
const AGREEMENT_NAMES = {
  data_protection: 'la política de protección de datos',
  rights_of_image: 'la autorización de derechos de imagen',
};

// Cambio que afecta a la sesión (B7.1): qué cambió, en este orden, con el valor que ayuda a decidir.
const CHANGE_ORDER = ['starts_at', 'duration_min', 'trainer_id'];
const hm = (min) => (min < 60 ? `${min} min`
  : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`);
const CHANGED = {
  starts_at: (s) => `la hora (antes ${when(s.changes.previous_starts_at)})`,
  duration_min: (s) => `la duración (ahora ${hm(s.duration_min)})`,
  trainer_id: (s) => `el profesor (ahora ${s.trainer})`,
};
const CHANGED_NAMES = { starts_at: 'la hora', duration_min: 'la duración', trainer_id: 'el profesor' };
const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0]);
const changedFields = (g) => CHANGE_ORDER.filter((f) => g.sessions.some((s) => s.changes.fields?.includes(f)));

// Avisos de eventos (B21.0): uno por inscripción, con el evento como está ahora.
const eventLabel = (g) => `${g.title}, ${when(g.starts_at)} (${g.student})`;
const EVENT_CHANGED = {
  starts_at: (g) => `el inicio (antes ${when(g.c.previous_starts_at)})`,
  ends_at: () => 'la hora de fin',
  location: (g) => `el lugar (ahora ${g.location})`,
};

// g = { student, sessions: [{ discipline, starts_at, duration_min, trainer, changes }] }, { c: changes } (re-firma)
// o { title, starts_at, location, student, c } (eventos)
// → { title, body }
const SERVICE = {
  'notice.no_coverage': (g) => ({
    title: g.sessions.length === 1 ? 'Reserva cancelada' : 'Reservas canceladas',
    body: one(g, 'ya no la cubre su suscripción', 'ya no las cubre su suscripción'),
  }),
  'notice.discipline_change': (g) => ({
    title: g.sessions.length === 1 ? 'Reserva cancelada' : 'Reservas canceladas',
    body: one(g, 'ha cambiado de disciplina', 'ha cambiado de disciplina'),
  }),
  'notice.out_of_age': (g) => ({
    title: g.sessions.length === 1 ? 'Reserva cancelada' : 'Reservas canceladas',
    body: one(g, 'ya no tiene la edad de la disciplina', 'ya no tiene la edad de la disciplina'),
  }),
  // Sin edad ni fecha de nacimiento: solo que en menos de un mes sale del rango (B29).
  'notice.out_of_age_soon': (g) => ({
    title: 'Cambio de disciplina por edad',
    body: `En menos de un mes, ${g.c.profile_name} deja de tener la edad de ${g.c.discipline}: no podrá reservar en ella y se `
      + 'cancelarán sus reservas. Si la tiene elegida en su plan, puedes cambiarla por otra sin que cuente para el límite '
      + 'de cambios',
  }),
  'notice.session_cancelled': (g) => ({
    title: g.sessions.length === 1 ? 'Sesión cancelada' : 'Sesiones canceladas',
    body: one(g, 'la academia ha cancelado la sesión', 'la academia ha cancelado las sesiones'),
  }),
  // Siempre una sesión: se recupera una por transacción, y un alumno solo tiene una reserva activa en cada sesión.
  'notice.session_restored': (g) => ({
    title: 'Sesión recuperada',
    body: `${label(g.sessions[0])} (${g.student}): la academia ha recuperado la sesión. Si quieres ir, vuelve a reservar`,
  }),
  'notice.booking_promoted': (g) => ({
    title: 'Tienes plaza',
    body: g.sessions.length === 1
      ? `${label(g.sessions[0])} (${g.student}): ha quedado una plaza libre y la reserva está confirmada`
      : `${g.student} tiene plaza en ${g.sessions.length} sesiones de su lista de espera`,
  }),
  'notice.session_changed': (g) => {
    const fields = changedFields(g);
    if (g.sessions.length === 1) {
      const [s] = g.sessions;
      return {
        title: 'Sesión cambiada',
        body: `${label(s)} (${g.student}): ha cambiado ${and(fields.map((f) => CHANGED[f](s)))}. `
          + 'Si ya no te viene bien, puedes cancelar sin que cuente como tardía',
      };
    }
    return {
      title: 'Sesiones cambiadas',
      body: `Han cambiado ${g.sessions.length} sesiones de ${g.sessions[0].discipline} de ${g.student} `
        + `(${and(fields.map((f) => CHANGED_NAMES[f]))}). Si ya no te vienen bien, puedes cancelarlas sin que cuente como tardía`,
    };
  },
  'notice.event_changed': (g) => ({
    title: 'Evento cambiado',
    body: `${eventLabel(g)}: ha cambiado ${and(g.c.fields.map((f) => EVENT_CHANGED[f](g)))}. `
      + 'Si no puedes venir, contacta con la academia',
  }),
  'notice.event_cancelled': (g) => ({
    title: 'Evento cancelado', body: `${eventLabel(g)}: la academia ha cancelado el evento`,
  }),
  'notice.event_registration_cancelled': (g) => ({
    title: 'Inscripción cancelada', body: `${eventLabel(g)}: la academia ha cancelado la inscripción`,
  }),
  'notice.avatar_removed': (g) => ({
    title: 'Foto de perfil quitada',
    body: `La academia ha quitado la foto de perfil de ${g.c.profile_name ?? 'tu cuenta'}. Puedes subir otra desde Cuenta.`,
  }),
  // Registro de jornada (B31): al profesor; clock_open también al panel.
  'notice.clock_corrected': (g) => ({
    title: 'Corrección en tu registro de jornada',
    body: `La academia ha corregido un fichaje de tu registro de jornada. Motivo: ${g.c.reason}. `
      + 'El fichaje original sigue a la vista junto a la corrección.',
  }),
  'notice.clock_open': (g) => ({
    title: 'Jornada sin salida',
    body: `Tu jornada del ${moment(g.c.in_at)} sigue abierta: no consta la salida. Pide una corrección desde tu registro.`,
  }),
  'notice.agreement_published': (g) => ({
    title: 'Nueva versión de un acuerdo',
    body: `Hay una versión nueva de ${AGREEMENT_NAMES[g.c.type]}. Fírmala para seguir reservando.`,
  }),
};

// Las reservas del grupo de la entrega (misma acción, alumno y transacción; ver booking_notice en 020), sin las
// sesiones que ya han empezado (B7.1). Por el id del aviso y no por created_at: un Date de JS pierde los microsegundos.
// El profesor sale de profiles: trainer_names exige sesión y el worker no la tiene.
async function bookingGroup(db, { audit_id: id }) {
  const { rows } = await db.query(
    `SELECT st.display_name AS student, d.name AS discipline, x.starts_at, x.duration_min, tr.display_name AS trainer,
            a.changes
       FROM audit_log a0 JOIN audit_log a ON a.created_at = a0.created_at AND a.resource_type = 'booking'
                                         AND a.action = a0.action AND a.changes->>'student_id' = a0.changes->>'student_id'
       JOIN bookings b ON b.id::text = a.resource_id
       JOIN class_sessions x ON x.id = b.session_id JOIN disciplines d ON d.id = x.discipline_id
       JOIN profiles st ON st.id = b.student_id JOIN profiles tr ON tr.id = x.trainer_id
      WHERE a0.id = $1 AND x.starts_at > now()
      ORDER BY x.starts_at, a.id`, [id]);
  return { student: rows[0]?.student ?? 'el alumno', sessions: rows };
}

// El evento de un aviso de eventos, como está ahora (la caducidad ya la comprobó el worker con expires_at).
async function eventOf(db, { changes: c }) {
  const { rows: [e] } = await db.query(
    `SELECT e.title, e.starts_at, e.location, p.display_name AS student
       FROM events e JOIN profiles p ON p.id = $2 WHERE e.id = $1`, [c.event_id, c.profile_id]);
  return { ...e, student: e.student ?? 'el alumno', c };
}

async function composeService(db, d) {
  const isBooking = d.resource_type === 'booking';
  const isEvent = d.resource_type === 'event_registration';
  const g = isBooking ? await bookingGroup(db, d) : isEvent ? await eventOf(db, d) : { c: d.changes };
  // Su última sesión empezó después de comprobar la caducidad: caducado, no fallido.
  if (isBooking && !g.sessions.length) throw Object.assign(new Error('stale'), { stale: true });
  const { title, body } = SERVICE[d.action](g);
  const isAvatar = d.action === 'notice.avatar_removed';
  const isAgeSoon = d.action === 'notice.out_of_age_soon';
  const isClock = d.action.startsWith('notice.clock_');
  const url = isBooking ? BOOKINGS : isEvent ? `${APP_URL}/events/${d.changes.event_id}` : isAvatar ? `${APP_URL}/account`
    : isAgeSoon ? BILLING : isClock ? CLOCK_URL : AGREEMENTS_URL;
  if (d.channel === 'push') return { title, body, url, tag: d.audit_id };
  const { rows: [r] } = await db.query(
    `SELECT pr.display_name AS payer, ac.email FROM profiles pr
       LEFT JOIN auth_credentials ac ON ac.profile_id = pr.id WHERE pr.id = $1`, [d.recipient_id]);
  if (!r?.email) return null;
  const list = isBooking && g.sessions.length > 1 ? g.sessions.map((s) => `· ${label(s)}`) : [];
  const msg = isBooking
    ? mail(`${title} de ${g.student}`, r, [`${body}.`, ...list],
      ['Ver las reservas', url], 'Este es un email de servicio sobre tus reservas en Kaizen.')
    : isEvent ? mail(`${title}: ${g.title}`, r, [`${body}.`], ['Ver el evento', url],
      'Este es un email de servicio sobre tus eventos en Kaizen.')
    : isAvatar ? mail(title, r, [body], ['Ir a Cuenta', url], 'Este es un email de servicio sobre tu cuenta en Kaizen.')
    : isAgeSoon ? mail(title, r, [`${body}.`], ['Ver la suscripción', url], 'Este es un email de servicio sobre tus reservas en Kaizen.')
    : isClock ? mail(title, r, [body], ['Ver mi registro', url], 'Este es un email de servicio sobre tu registro de jornada en Kaizen.')
    : mail(title, r, [body], ['Ver los acuerdos', url], 'Este es un email de servicio sobre tus acuerdos en Kaizen.');
  return { to: r.email, ...msg };
}

const PLAN_KEYS = ['plan_id', 'from_plan_id', 'to_plan_id', 'discarded_plan_id'];

/**
 * Mensaje de una entrega con los datos actuales: email { to, subject, text, html } o, en una entrega push,
 * payload { title, body, url, tag }. null si es email y el destinatario no tiene email.
 */
export async function compose(db, d) {
  if (SERVICE[d.action]) return composeService(db, d);
  const { recipient_id: to, action, resource_type: type, resource_id: resId, changes: c } = d;
  const { rows: [r] } = await db.query(
    `SELECT pr.display_name AS payer, ac.email, st.display_name AS student,
            CASE WHEN v.id IS NOT NULL THEN jsonb_build_object('amount_due_cents', v.amount_due_cents, 'plan', pl.name) END
              AS invoice,
            CASE WHEN pc.id IS NOT NULL THEN jsonb_build_object(
              'id', pc.id, 'old_payer_id', pc.old_payer_id, 'new_payer', np.display_name, 'starts_at', pc.starts_at,
              'price_cents', pp.price_cents) END AS change
       FROM profiles pr LEFT JOIN auth_credentials ac ON ac.profile_id = pr.id
       LEFT JOIN invoices v ON $3 = 'invoice' AND v.id::text = $4
       LEFT JOIN subscriptions s ON s.id = v.subscription_id LEFT JOIN plans pl ON pl.id = s.plan_id
       LEFT JOIN payer_changes pc ON $3 = 'payer_change' AND pc.id::text = $4
       LEFT JOIN profiles np ON np.id = pc.new_payer_id LEFT JOIN plans pp ON pp.id = pc.plan_id
       LEFT JOIN profiles st ON st.id = COALESCE($2::uuid, v.student_id)
      WHERE pr.id = $1`, [to, c.student_id ?? null, type, resId]);
  // Aunque email_verified = false: es la única dirección del pagador (plan B10.6).
  if (!r?.email) return null;
  const ids = PLAN_KEYS.map((k) => c[k]).filter(Boolean);
  const { rows: plans } = await db.query(`SELECT id::text, name FROM plans WHERE id = ANY($1::bigint[])`, [ids]);
  const msg = TEMPLATES[action]({ ...r, to, student: r.student ?? 'el alumno', c, plans: Object.fromEntries(plans.map((p) => [p.id, p.name])) });
  return { to: r.email, ...msg };
}

// --- Worker ---

const BATCH = 20;
// Alquiler del lote: se reserva empujando next_attempt_at; si el proceso muere enviando, vuelve a salir al vencer
// (se reenvía con la misma Idempotency-Key / Topic, sin duplicar y sin perder el aviso). Mayor que 20 × 15 s.
const LEASE_MIN = 10;
const RETRY_MIN = [1, 5, 30, 120, 360]; // tras el 6.º intento fallido, failed

const mark = (client, id, { status, attempts, retryMin = 0, messageId = null, error = null }) => client.query(
  `UPDATE notice_deliveries SET status = $2, attempts = $3, next_attempt_at = now() + $4 * interval '1 minute',
                                sent_at = CASE WHEN $2 = 'sent' THEN now() END, provider_message_id = $5, last_error = $6
    WHERE id = $1`, [id, status, attempts, retryMin, messageId, error]);

// Entrega push (ADR 0011): a todos los dispositivos del destinatario ahora. sent si alguno la acepta; 404/410
// borra ese dispositivo; transitorio → reintenta la entrega entera (tag y Topic evitan verla dos veces);
// si no, failed (401/403 y otros 4xx, sin borrar) o, sin ningún dispositivo que quede, skipped.
async function deliverPush(client, db, d, attempts, transport) {
  const { rows: devices } = await client.query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE profile_id = $1`, [d.recipient_id]);
  if (!devices.length) return mark(client, d.id, { status: 'skipped', attempts: d.attempts, error: 'no_subscription' });
  const payload = await compose(db, d);
  const topic = d.audit_id.replaceAll('-', ''); // Topic: como mucho 32 caracteres base64url
  const results = await Promise.all(devices.map((s) => transport({
    subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, ttl: d.ttl, topic,
  })));
  const gone = devices.filter((_, i) => results[i].status === 'gone').map((s) => s.id);
  if (gone.length) await client.query(`DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[])`, [gone]);
  const has = (status) => results.some((r) => r.status === status);
  const error = results.map((r) => r.error).filter(Boolean).join('; ') || null;
  if (has('sent')) return mark(client, d.id, { status: 'sent', attempts, error });
  const retry = has('transient') && RETRY_MIN[d.attempts];
  if (retry) return mark(client, d.id, { status: 'pending', attempts, retryMin: retry, error });
  if (has('transient') || has('permanent')) return mark(client, d.id, { status: 'failed', attempts, error });
  return mark(client, d.id, { status: 'skipped', attempts, error: 'no_subscription' });
}

/**
 * Un lote del worker: entregas pendientes y vencidas, bloqueadas con SKIP LOCKED (dos workers no se pisan).
 * Caducado (24 h desde el aviso o su expires_at, lo que sea antes) o sin email → skipped. Un aviso de reservas
 * caduca al empezar la última sesión de su grupo, con su inicio actual: un cambio posterior puede haberla movido (B7.1).
 * El TTL del push es lo que le queda hasta caducar.
 * @returns {Promise<number>} entregas tratadas
 */
export async function sendPending(db = servicePool, transport = send, pushTransport = sendPush) {
  const lock = await db.connect();
  let rows;
  try {
    await lock.query('BEGIN');
    ({ rows } = await lock.query(
      `SELECT d.*, now() > x.expires AS stale, GREATEST(ceil(extract(epoch FROM x.expires - now())), 0)::int AS ttl
         FROM (SELECT d.id, d.recipient_id, d.attempts, d.channel, d.audit_id, a.action, a.resource_type,
                      a.resource_id, a.changes, a.created_at
                 FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id
                WHERE d.status = 'pending' AND d.next_attempt_at <= now()
                ORDER BY d.next_attempt_at LIMIT ${BATCH} FOR UPDATE OF d SKIP LOCKED) d,
         LATERAL (SELECT LEAST(d.created_at + interval '24 hours', CASE WHEN d.resource_type = 'booking'
                    THEN (SELECT max(cs.starts_at) FROM audit_log g
                            JOIN bookings b ON b.id::text = g.resource_id JOIN class_sessions cs ON cs.id = b.session_id
                           WHERE g.created_at = d.created_at AND g.resource_type = 'booking'
                             AND g.action = d.action AND g.changes->>'student_id' = d.changes->>'student_id')
                    ELSE (d.changes->>'expires_at')::timestamptz END) AS expires) x`));
    // Reservar y confirmar: el envío (hasta 20 × 15 s) va fuera de la transacción.
    await lock.query(
      `UPDATE notice_deliveries SET next_attempt_at = now() + $2 * interval '1 minute' WHERE id = ANY($1::uuid[])`,
      [rows.map((d) => d.id), LEASE_MIN]);
    await lock.query('COMMIT');
  } catch (err) {
    await lock.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    lock.release();
  }
  // Cada marca se confirma sola: un fallo a mitad no deshace los envíos ya hechos.
  for (const d of rows) {
    const attempts = d.attempts + 1;
    if (d.stale) {
      await mark(db, d.id, { status: 'skipped', attempts: d.attempts, error: 'stale' });
      continue;
    }
    try {
      if (d.channel === 'push') {
        await deliverPush(db, db, d, attempts, pushTransport);
        continue;
      }
      const email = await compose(db, d);
      if (!email) {
        await mark(db, d.id, { status: 'skipped', attempts: d.attempts, error: 'no_email' });
        continue;
      }
      const { id } = await transport({ ...email, idempotencyKey: d.id });
      await mark(db, d.id, { status: 'sent', attempts, messageId: id });
    } catch (err) {
      if (err.stale) {
        await mark(db, d.id, { status: 'skipped', attempts: d.attempts, error: 'stale' });
        continue;
      }
      const retry = err.transient && RETRY_MIN[d.attempts];
      await mark(db, d.id, retry
        ? { status: 'pending', attempts, retryMin: retry, error: err.message }
        : { status: 'failed', attempts, error: err.message });
    }
  }
  return rows.length;
}

const EVERY_MS = 30_000;

/** Worker en el proceso de la API (ADR 0008). Devuelve la función que lo para y espera al lote en curso. */
export function startNoticeWorker() {
  let stopped = false;
  let timer;
  let running = Promise.resolve();
  const tick = async () => {
    running = (async () => {
      try {
        while (!stopped && (await sendPending()) === BATCH); // con cola, sin esperar al siguiente tick
      } catch (err) {
        console.error('[notices] worker:', err.message);
      }
    })();
    await running;
    if (!stopped) timer = setTimeout(tick, EVERY_MS);
  };
  timer = setTimeout(tick, 0);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
