// Avisos y su entrega (B10.6, ADR 0008): notice() crea aviso + entregas; sendPending con un transporte falso.
// Sin Stripe. Las entregas pendientes ajenas a este test se aparcan y se restauran al final.
// Con `npm run dev` en marcha, su worker se lleva entregas del test: pararlo antes (también para test:webhook).
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { APP_URL } from '../src/config/stripe.js';
import { notice, sendPending } from '../src/services/notices.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

const people = { admin: 'admin', payer: 'alumno', tutor: 'tutor', child: 'alumno', nomail: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const NAMES = { payer: 'Ana Pagadora', tutor: 'Tomás Tutor', child: 'Nico <Hijo>', admin: 'Admin', nomail: 'Sin Email' };
for (const [k, role] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], NAMES[k], k === 'child' ? '2016-05-05' : null]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (!['child', 'nomail'].includes(k)) {
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`,
      [U[k], `${k}-${U[k]}@notices.test`]);
  }
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tutor, U.child]);
const [planA, planB] = await q(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ('T-Not Oro', 4000, NULL), ('T-Not Plata', 2000, 1)
   RETURNING id, name`);
const [sub] = await q(
  `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
   VALUES ($1, $2, $3, 'past_due', $4) RETURNING id`, [U.child, U.tutor, planA.id, `sub_test_${U.child}`]);
const [inv] = await q(
  `INSERT INTO invoices (student_id, payer_id, subscription_id, stripe_invoice_id, status, amount_due_cents)
   VALUES ($1, $2, $3, $4, 'open', 4000) RETURNING id`, [U.child, U.tutor, sub.id, `in_test_${U.child}`]);
const [ins] = await q(
  `INSERT INTO insurances (student_id, payer_id, status, bracket, stripe_subscription_id, current_period_end)
   VALUES ($1, $2, 'active', 'minor', $3, '2027-03-01T12:00:00Z') RETURNING id`, [U.child, U.tutor, `sub_ins_${U.child}`]);

// Transporte falso: guarda lo enviado; `fail` decide si lanza.
const outbox = [];
let fail = null;
const fake = async (email) => {
  if (fail) throw fail;
  outbox.push(email);
  return { id: `fake-${outbox.length}` };
};
const err = (transient) => Object.assign(new Error(transient ? 'resend 503' : 'resend 422'), { transient });

// Cada aviso con su propio resource_id para encontrar sus entregas.
const emit = async (action, extra = {}, recipients = [U.tutor], db = servicePool) => {
  const resourceId = extra.resourceId ?? crypto.randomUUID();
  await notice(db, { action, actorId: U.tutor, type: extra.type ?? 'subscription', resourceId, recipients, ...extra });
  return resourceId;
};
const deliveries = (resourceId) => q(
  `SELECT d.*, extract(epoch FROM d.next_attempt_at - now()) AS wait_s FROM notice_deliveries d
     JOIN audit_log a ON a.id = d.audit_id WHERE a.resource_id = $1 ORDER BY d.recipient_id`, [resourceId]);
const send = () => sendPending(servicePool, fake);

const parked = (await q(
  `UPDATE notice_deliveries SET next_attempt_at = next_attempt_at + interval '100 years' WHERE status = 'pending'
   RETURNING id`)).map((r) => r.id);
try {
  await run('entregas: solo acciones con email, una por destinatario, sin admins; reservas y riesgo sin entregas', async () => {
    const r = await emit('notice.checkout_race_refunded', { student_id: U.child }, [U.tutor, U.admin, U.tutor]);
    const d = await deliveries(r);
    assert.deepEqual(d.map((x) => [x.recipient_id, x.channel, x.status, x.attempts]), [[U.tutor, 'email', 'pending', 0]]);
    for (const action of ['notice.no_coverage', 'notice.booking_promoted', 'notice.session_cancelled', 'notice.discipline_change']) {
      assert.deepEqual(await deliveries(await emit(action, { type: 'booking' }, [U.child, U.tutor])), [], action);
    }
    assert.deepEqual(await deliveries(await emit('notice.stripe_risk', { type: 'charge' }, [U.admin])), []);
  });

  await run('aviso y entregas en una sentencia: un rollback no deja ninguno de los dos', async () => {
    const c = await servicePool.connect();
    let r;
    try {
      await c.query('BEGIN');
      r = await emit('notice.payment_failed', {}, [U.tutor], c);
      await c.query('ROLLBACK');
    } finally { c.release(); }
    assert.deepEqual(await q(`SELECT 1 FROM audit_log WHERE resource_id = $1`, [r]), []);
  });

  await run('envío: al pagador (tutor), nunca al hijo; sent con id del proveedor e Idempotency-Key = id de la entrega', async () => {
    outbox.length = 0;
    await emit('notice.payment_failed', { type: 'invoice', resourceId: inv.id, next_payment_attempt: null });
    await send();
    const [d] = await deliveries(inv.id);
    const e = outbox.find((x) => x.idempotencyKey === d.id);
    assert.deepEqual([d.status, d.attempts, d.provider_message_id, !!d.sent_at], ['sent', 1, `fake-${outbox.indexOf(e) + 1}`, true]);
    assert.equal(e.to, `tutor-${U.tutor}@notices.test`);
    assert.equal((await q(`SELECT 1 FROM notice_deliveries WHERE recipient_id = $1`, [U.child])).length, 0);
  });

  await run('sin duplicados: dos workers a la vez (SKIP LOCKED) y una segunda pasada', async () => {
    outbox.length = 0;
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await emit('notice.checkout_payment_failed', { student_id: U.child }));
    await Promise.all([send(), send()]);
    await send();
    assert.equal(outbox.length, 5);
    for (const id of ids) assert.equal((await deliveries(id))[0].status, 'sent');
  });

  await run('error transitorio: reintento a 1, 5, 30, 120 y 360 min; después failed', async () => {
    const r = await emit('notice.checkout_payment_failed', { student_id: U.child });
    fail = err(true);
    try {
      for (const min of [1, 5, 30, 120, 360]) {
        await send();
        const [d] = await deliveries(r);
        assert.equal(d.status, 'pending');
        assert.ok(Math.abs(d.wait_s - min * 60) < 30, `espera ${d.wait_s}s ≠ ${min} min`);
        await q(`UPDATE notice_deliveries SET next_attempt_at = now() WHERE id = $1`, [d.id]);
      }
      await send();
      const [d] = await deliveries(r);
      assert.deepEqual([d.status, d.attempts, d.last_error], ['failed', 6, 'resend 503']);
    } finally { fail = null; }
  });

  await run('error permanente (4xx) o desconocido: failed a la primera', async () => {
    const r1 = await emit('notice.checkout_payment_failed', { student_id: U.child });
    fail = err(false);
    await send();
    fail = new Error('bug');
    const r2 = await emit('notice.checkout_payment_failed', { student_id: U.child });
    await send();
    fail = null;
    assert.deepEqual((await deliveries(r1)).map((d) => [d.status, d.attempts, d.last_error]), [['failed', 1, 'resend 422']]);
    assert.deepEqual((await deliveries(r2)).map((d) => d.status), ['failed']);
  });

  await run('skipped: más de 24 h, expires_at pasado o pagador sin email; no se envía', async () => {
    outbox.length = 0;
    const old = await emit('notice.checkout_payment_failed', { student_id: U.child });
    await q(`UPDATE audit_log SET created_at = now() - interval '25 hours' WHERE resource_id = $1`, [old]);
    const expired = await emit('notice.upgrade_requires_action', {
      student_id: U.child, from_plan_id: planA.id, plan_id: planB.id, amount_cents: 500,
      hosted_invoice_url: 'https://invoice.stripe.com/i/x', expires_at: new Date(Date.now() - 60_000),
    });
    const fresh = await emit('notice.upgrade_requires_action', {
      student_id: U.child, from_plan_id: planA.id, plan_id: planB.id, amount_cents: 500,
      hosted_invoice_url: 'https://invoice.stripe.com/i/x', expires_at: new Date(Date.now() + 3600_000),
    });
    const nomail = await emit('notice.checkout_payment_failed', { student_id: U.child }, [U.nomail]);
    await send();
    assert.deepEqual((await deliveries(old)).map((d) => [d.status, d.last_error]), [['skipped', 'stale']]);
    assert.deepEqual((await deliveries(expired)).map((d) => [d.status, d.last_error]), [['skipped', 'stale']]);
    assert.deepEqual((await deliveries(nomail)).map((d) => [d.status, d.last_error]), [['skipped', 'no_email']]);
    assert.deepEqual((await deliveries(fresh)).map((d) => d.status), ['sent']);
    assert.equal(outbox.length, 1);
  });

  await run('las 11 plantillas: asunto, alumno, enlace, texto y HTML; sin fecha de nacimiento ni edad', async () => {
    outbox.length = 0;
    const hosted = 'https://invoice.stripe.com/i/acct_test/test_123';
    const billing = `${APP_URL}/billing`;
    const cases = [
      ['notice.payment_failed', { type: 'invoice', resourceId: inv.id, next_payment_attempt: '2026-11-05T10:00:00Z' }, billing, /5 de noviembre/],
      ['notice.checkout_payment_failed', { student_id: U.child }, billing],
      ['notice.checkout_race_refunded', { student_id: U.child }, billing],
      ['notice.insurance_not_paid', { type: 'insurance', resourceId: ins.id, student_id: U.child, reason: 'not_paid' }, billing],
      ['notice.insurance_renewal', { type: 'insurance', resourceId: ins.id, student_id: U.child, bracket: 'minor', amount_cents: 3500, renews_at: '2027-03-01T12:00:00Z' }, billing, /35,00\s€/],
      ['notice.insurance_wont_renew', { type: 'insurance', resourceId: ins.id, student_id: U.child, reason: 'turns_18' }, billing, /cambio de tramo de edad/],
      ['notice.plan_downgraded', { student_id: U.child, from_plan_id: planA.id, to_plan_id: planB.id }, billing, /T-Not Oro.*T-Not Plata/],
      ['notice.upgrade_requires_action', { student_id: U.child, from_plan_id: planB.id, plan_id: planA.id, amount_cents: 1250, hosted_invoice_url: hosted, expires_at: new Date(Date.now() + 23 * 3600_000) }, hosted, /12,50\s€/],
      ['notice.subscription_unpaid', { student_id: U.child, plan_id: planA.id, amount_cents: 4000, hosted_invoice_url: hosted }, hosted, /40,00\s€/],
      ['notice.insurance_unpaid', { type: 'insurance', resourceId: ins.id, student_id: U.child, amount_cents: 3500, hosted_invoice_url: hosted }, hosted],
      ['notice.subscription_cancelled', { student_id: U.child, plan_id: planA.id, ends_at: '2026-12-01T00:00:00Z', discarded_plan_id: planB.id }, billing, /1 de diciembre de 2026.*\n*.*T-Not Plata/],
    ];
    for (const [action, extra] of cases) await emit(action, extra);
    await send();
    assert.equal(outbox.length, cases.length);
    for (const [i, [action, , link, extra]] of cases.entries()) {
      const e = outbox[i];
      const all = `${e.subject}\n${e.text}\n${e.html}`;
      assert.ok(e.subject && e.text && e.html.startsWith('<!doctype html>'), action);
      assert.equal(e.to, `tutor-${U.tutor}@notices.test`, action);
      assert.match(e.text, /^Hola, Tomás Tutor:/, action);
      assert.ok(e.text.includes('Nico <Hijo>') && e.html.includes('Nico &#60;Hijo&#62;') && !e.html.includes('<Hijo>'), action);
      assert.ok(e.text.includes(link) && e.html.includes(`href="${link}"`), `${action}: enlace`);
      assert.match(e.text, /email de servicio/, action);
      assert.doesNotMatch(all, /undefined|NaN|Invalid Date|null/, action);
      assert.doesNotMatch(all, /\b(de|a) el\b/, `${action}: «del» / «al»`);
      assert.doesNotMatch(all, /2016|5 de mayo|\d+ años|menor/i, `${action}: sin fecha de nacimiento ni edad`);
      if (extra) assert.match(e.text, extra, action);
    }
  });
} finally {
  await q(`UPDATE notice_deliveries SET next_attempt_at = next_attempt_at - interval '100 years' WHERE id = ANY($1::uuid[])`, [parked]);
  const ids = Object.values(U);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]); // CASCADE a notice_deliveries
  await q(`DELETE FROM invoices WHERE student_id = $1`, [U.child]);
  await q(`DELETE FROM insurances WHERE student_id = $1`, [U.child]);
  await q(`DELETE FROM subscriptions WHERE student_id = $1`, [U.child]);
  await q(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[planA.id, planB.id]]);
  await q(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tutor]);
  await q(`DELETE FROM auth_credentials WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
