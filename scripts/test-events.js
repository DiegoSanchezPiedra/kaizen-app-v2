// B21.0: eventos e inscripciones. Como app_user por HTTP (express en memoria y JWT firmados, como test:admin) y el
// webhook simulado con handleEvent sobre objetos reales del sandbox de Stripe (como test:webhook). Solo sk_test_.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

await import('dotenv/config');
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !process.env.STRIPE_SECRET_KEY?.startsWith('rk_test_')) {
  throw new Error('test:events solo corre contra el sandbox de Stripe (sk_test_ / rk_test_)');
}
const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { stripe } = await import('../src/config/stripe.js');
const { signToken } = await import('../src/services/jwt.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { handleEvent, HANDLED_EVENTS } = await import('../src/services/stripeWebhook.js');
const { settleRequestedRefunds } = await import('../src/services/events.js');
const { default: eventsRouter } = await import('../src/routes/events.js');
const { default: adminEventsRouter } = await import('../src/routes/admin/events.js');
const { default: professorRouter } = await import('../src/routes/professor.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

const tag = `tev${crypto.randomBytes(3).toString('hex')}`;
// [rol, fecha de nacimiento]
const people = {
  admin: ['admin', null], prof: ['profesor', null], prof2: ['profesor', null],
  alu: ['alumno', yearsAgo(30)], // completo, socio
  alu2: ['alumno', yearsAgo(28)], // completo, no socio
  alu3: ['alumno', yearsAgo(26)], // sin ficha de salud
  alu4: ['alumno', yearsAgo(24)], // completo
  tutor1: ['tutor', yearsAgo(40)], tutor2: ['tutor', yearsAgo(41)], tutorX: ['tutor', yearsAgo(42)], // tutorX sin data_protection
  child: ['alumno', yearsAgo(10)], // de tutor1 y tutor2
  child2: ['alumno', yearsAgo(9)], // de tutorX
  grown: ['alumno', yearsAgo(19)], // de tutor1, 18 cumplidos sin reclamar
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
for (const [k, [role, birth]] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($3, $2), ($4, $5), ($1, $6)`,
  [U.tutor1, U.child, U.tutor2, U.tutorX, U.child2, U.grown]);

// Acuerdos vigentes: los existentes o unos de prueba (se borran al final).
const testDocs = [];
for (const type of ['data_protection', 'rights_of_image']) {
  const { length } = await q(
    `SELECT 1 FROM agreement_documents WHERE type = $1 AND published_at IS NOT NULL AND retired_at IS NULL`, [type]);
  if (length) continue;
  testDocs.push((await q(
    `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
     VALUES (gen_random_uuid(), $1, '99.' || floor(random() * 1e6), 'test-events.pdf', 'x', now()) RETURNING id`,
    [type]))[0].id);
}
const sign = (who, type, by = who) => q(
  `INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
   SELECT gen_random_uuid(), $1, $2, $3, version FROM agreement_documents
    WHERE type = $3 AND published_at IS NOT NULL AND retired_at IS NULL`, [U[who], U[by], type]);
const tutorOf = { child: 'tutor1', child2: 'tutorX', grown: 'tutor1' };
for (const k of ['alu', 'alu2', 'alu3', 'alu4', 'child', 'child2', 'grown']) {
  for (const type of ['data_protection', 'rights_of_image']) {
    await sign(k, type, tutorOf[k] ?? k);
  }
  if (k !== 'alu3') {
    await q(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone, allergies)
             VALUES ($1, 'x', '600000000', 'polen')`, [U[k]]);
  }
}
for (const k of ['tutor1', 'tutor2']) await sign(k, 'data_protection');

// alu es socio (suscripción en vigor); alu2, no.
const plan = (await q(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`, [tag]))[0].id;
const subId = crypto.randomUUID();
await q(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
         VALUES ($1, $2, $2, $3, 'active', $4)`, [subId, U.alu, plan, `sub_test_${subId}`]);

const app = express().use(express.json()).use('/events', eventsRouter).use('/admin', adminEventsRouter)
  .use('/professor', professorRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const tokens = {};
const http = async (method, url, who, body) => {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${(tokens[who] ??= signToken({ sub: U[who], role: people[who][0] }))}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const expectError = (r, status, code) => assert.deepEqual([r.status, r.body?.code], [status, code], JSON.stringify(r.body));

const events = [];
const mkEvent = async (body) => {
  const r = await http('POST', '/admin/events', 'admin', {
    title: `${tag} evento`, starts_at: inHours(48), ends_at: inHours(50), location: 'Tatami 1', ...body,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  events.push(r.body.event.id);
  return r.body.event;
};
const register = (who, eventId, subject) =>
  http('POST', `/events/${eventId}/registrations`, who, subject ? { profile_id: U[subject] } : {});
const reg = async (id) => (await q(`SELECT * FROM event_registrations WHERE id = $1`, [id]))[0];
const eventIds = [];
const evt = (type, object) => {
  const id = `evt_test_${crypto.randomUUID()}`;
  eventIds.push(id);
  return { id, type, data: { object } };
};
// Lo que deja un Checkout pagado: un PaymentIntent real del cliente del pagador y la sesión real con el pago.
const pay = async (registrationId, override = {}, pm = 'pm_card_visa') => {
  const r = await reg(registrationId);
  const [{ stripe_customer_id: customer }] = await q(`SELECT stripe_customer_id FROM profiles WHERE id = $1`, [r.payer_id]);
  const pi = await stripe.paymentIntents.create({
    amount: r.amount_cents, currency: 'eur', customer, payment_method: pm, confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  const session = await stripe.checkout.sessions.retrieve(r.checkout_session_id);
  const e = evt('checkout.session.completed', { ...session, payment_status: 'paid', payment_intent: pi.id, ...override });
  assert.equal(await handleEvent(e), 'processed');
  return { pi, e, session };
};
// Un reembolso que falla después de aceptarse, como se relee en Stripe (la tarjeta pm_card_refundFail tarda minutos).
const asRefundFailed = async (rf, fn) => {
  const saved = { retrieve: stripe.refunds.retrieve, list: stripe.refunds.list, charge: stripe.charges.retrieve };
  stripe.refunds.retrieve = async (...a) => (a[0] === rf.id ? rf : saved.retrieve.apply(stripe.refunds, a));
  stripe.refunds.list = async (...a) => {
    const l = await saved.list.apply(stripe.refunds, a);
    return { ...l, data: l.data.map((x) => (x.id === rf.id ? rf : x)) };
  };
  stripe.charges.retrieve = async (...a) => {
    const c = await saved.charge.apply(stripe.charges, a);
    return c.id === rf.charge ? { ...c, amount_refunded: 0, refunded: false } : c;
  };
  try { await fn(); } finally {
    Object.assign(stripe.refunds, { retrieve: saved.retrieve, list: saved.list });
    stripe.charges.retrieve = saved.charge;
  }
};
const refundsOf = async (pi) => (await stripe.refunds.list({ payment_intent: pi })).data;
const noticesOf = (action, resourceId) =>
  q(`SELECT id, changes FROM audit_log WHERE action = $1 AND resource_id = $2 ORDER BY created_at`, [action, resourceId]);
const deliveriesOf = async (action, resourceId) => (await q(
  `SELECT d.recipient_id, d.channel FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id
    WHERE a.action = $1 AND a.resource_id = $2 ORDER BY d.recipient_id`, [action, resourceId]));
const lastAudit = async (action, id) => (await q(
  `SELECT actor_id, resource_type, changes FROM audit_log WHERE action = $1 AND resource_id = $2
    ORDER BY created_at DESC LIMIT 1`, [action, id]))[0];
const sorted = (...ks) => ks.map((k) => U[k]).sort();
const realError = console.error;
const realWarn = console.warn;

let E = {};
try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));
  console.warn = (...a) => (String(a[0]).startsWith('[events]') ? null : realWarn(...a));

  await run('admin crea eventos (auditado); un alumno no; validación de campos', async () => {
    E.free = await mkEvent({ title: `${tag} gratis`, trainer_id: U.prof });
    assert.deepEqual([E.free.status, E.free.price_cents, E.free.audience, E.free.taken],
      ['scheduled', 0, 'all', 0]);
    assert.equal(E.free.trainer.id, U.prof);
    const a = await lastAudit('event.create', E.free.id);
    assert.deepEqual([a.actor_id, a.resource_type, a.changes.title], [U.admin, 'event', `${tag} gratis`]);
    E.paid = await mkEvent({ title: `${tag} pago`, price_cents: 1500, member_price_cents: 1000 });
    E.memberFree = await mkEvent({ title: `${tag} socios gratis`, price_cents: 800, member_price_cents: 0 });
    E.minors = await mkEvent({ title: `${tag} menores`, audience: 'minors' });
    E.adults = await mkEvent({ title: `${tag} adultos`, audience: 'adults' });
    E.social = await mkEvent({ title: `${tag} social` });
    E.closed = await mkEvent({ title: `${tag} cerrado`, registration_deadline: inHours(-1) });
    E.cap1 = await mkEvent({ title: `${tag} una plaza`, price_cents: 1500, capacity: 1 });
    E.fam = await mkEvent({ title: `${tag} cancelable`, price_cents: 1200 });
    expectError(await http('POST', '/admin/events', 'alu', { title: 'x' }), 403, 'insufficient_role');
    const bad = (body) => http('POST', '/admin/events', 'admin', {
      title: 'x', starts_at: inHours(48), ends_at: inHours(50), location: 'x', ...body });
    for (const [body, field] of [
      [{ price_cents: 30 }, 'price_cents'], [{ ends_at: inHours(47) }, 'ends_at'],
      [{ price_cents: 1000, member_price_cents: 1200 }, 'member_price_cents'],
      [{ registration_deadline: inHours(49) }, 'registration_deadline'], [{ trainer_id: U.alu }, 'trainer_id'],
      [{ capacity: 0 }, 'capacity'], [{ starts_at: inHours(-1) }, 'starts_at'],
    ]) {
      const r = await bad(body);
      assert.deepEqual([r.status, r.body.code, r.body.field], [400, 'invalid_field', field]);
    }
  });

  // Uno ya empezado del profesor (hoy en Madrid): asistencia y fichas.
  E.now = (await q(
    `INSERT INTO events (title, starts_at, ends_at, location, trainer_id, created_by)
     VALUES ($1, now() - interval '1 minute', now() + interval '3 hours', 'Tatami 2', $2, $3) RETURNING *`,
    [`${tag} ahora`, U.prof, U.admin]))[0];
  events.push(E.now.id);
  const R = {};

  await run('requisitos: perfil del sujeto y del actor, público, cierre, tutoría', async () => {
    let r = await register('alu3', E.free.id);
    expectError(r, 403, 'profile_incomplete');
    assert.deepEqual(r.body.missing, ['health_info']);
    r = await register('tutorX', E.free.id, 'child2'); // el hijo está completo; el tutor no
    expectError(r, 403, 'profile_incomplete');
    assert.deepEqual(r.body.missing, ['data_protection']);
    r = await register('alu4', E.social.id);
    assert.deepEqual([r.status, r.body.registration.status, r.body.url], [201, 'confirmed', undefined]);
    expectError(await register('alu', E.minors.id), 409, 'audience_mismatch');
    expectError(await register('tutor1', E.adults.id, 'child'), 409, 'audience_mismatch');
    r = await register('tutor1', E.minors.id, 'child');
    assert.deepEqual([r.status, r.body.registration.actor_id, r.body.registration.payer_id], [201, U.tutor1, null]);
    expectError(await register('alu', E.closed.id), 409, 'registration_closed');
    expectError(await register('tutor2', E.free.id, 'child2'), 403, 'not_guardian');
    expectError(await register('tutor1', E.free.id, 'grown'), 403, 'not_guardian');
    expectError(await register('tutor1', E.free.id), 409, 'not_a_student'); // un tutor no se inscribe a sí mismo
    expectError(await register('prof', E.free.id), 403, 'insufficient_role');
    expectError(await register('alu', crypto.randomUUID()), 404, 'event_not_found');
  });

  await run('gratis sin Checkout; una viva por alumno y evento', async () => {
    const r = await register('alu', E.free.id);
    assert.deepEqual([r.status, r.body.registration.status, r.body.registration.amount_cents, r.body.url],
      [201, 'confirmed', 0, undefined]);
    R.aluFree = r.body.registration.id;
    expectError(await register('alu', E.free.id), 409, 'already_registered');
  });

  await run('invitado solo el admin (también fuera de plazo), auditado', async () => {
    expectError(await http('POST', `/admin/events/${E.closed.id}/registrations`, 'alu', { profile_id: U.alu }), 403,
      'insufficient_role');
    await assert.rejects(withRls({ uid: U.alu, role: 'alumno' }, (c) =>
      c.query(`SELECT register_event($1, $2, true)`, [E.closed.id, U.alu])), /not_allowed/);
    const r = await http('POST', `/admin/events/${E.closed.id}/registrations`, 'admin', { profile_id: U.alu2 });
    assert.deepEqual([r.status, r.body.registration.guest, r.body.registration.status, r.body.registration.amount_cents],
      [201, true, 'confirmed', 0]);
    const a = await lastAudit('event_registration.guest', r.body.registration.id);
    assert.deepEqual([a.actor_id, a.changes.profile_id], [U.admin, U.alu2]);
    // Los requisitos siguen valiendo para el admin.
    expectError(await http('POST', `/admin/events/${E.free.id}/registrations`, 'admin', { profile_id: U.tutor1 }), 409,
      'not_a_student');
  });

  await run('precio de socio y de no socio; socio a 0 € sin Checkout', async () => {
    let r = await register('alu', E.paid.id);
    assert.deepEqual([r.status, r.body.registration.status, r.body.registration.amount_cents, r.body.registration.payer_id],
      [201, 'pending', 1000, U.alu]);
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
    R.aluPaid = r.body.registration.id;
    const s = await stripe.checkout.sessions.retrieve((await reg(R.aluPaid)).checkout_session_id);
    assert.deepEqual([s.mode, s.amount_total, s.metadata.kind, s.metadata.registration_id], ['payment', 1000, 'event', R.aluPaid]);
    r = await register('alu2', E.paid.id);
    assert.deepEqual([r.body.registration.status, r.body.registration.amount_cents], ['pending', 1500]);
    R.alu2Paid = r.body.registration.id;
    r = await register('alu', E.memberFree.id);
    assert.deepEqual([r.body.registration.status, r.body.registration.amount_cents, r.body.registration.payer_id, r.body.url],
      ['confirmed', 0, null, undefined]);
    r = await register('alu2', E.memberFree.id);
    assert.deepEqual([r.body.registration.status, r.body.registration.amount_cents], ['pending', 800]);
    R.alu2Member = r.body.registration.id;
  });

  await run('aforo cuenta las pendientes; checkout.session.expired libera la plaza', async () => {
    const r = await register('alu2', E.cap1.id);
    assert.equal(r.body.registration.status, 'pending');
    expectError(await register('alu', E.cap1.id), 409, 'event_full');
    const id = (await reg(r.body.registration.id)).checkout_session_id;
    const expired = await stripe.checkout.sessions.expire(id);
    assert.equal(await handleEvent(evt('checkout.session.expired', expired)), 'processed');
    const x = await reg(r.body.registration.id);
    assert.deepEqual([x.status, x.cancel_reason], ['cancelled', 'checkout_expired']);
    const again = await register('alu', E.cap1.id);
    assert.deepEqual([again.status, again.body.registration.amount_cents], [201, 1500]); // en cap1 no hay precio de socio
    R.aluCap = again.body.registration.id;
  });

  let aluPay;
  await run('checkout.session.completed confirma; repetido no duplica; sin kind se ignora', async () => {
    // Sin metadata.kind: es de otra app de la cuenta (maat), aunque sea un pago.
    const s = await stripe.checkout.sessions.retrieve((await reg(R.alu2Paid)).checkout_session_id);
    assert.equal(await handleEvent(evt('checkout.session.completed',
      { ...s, payment_status: 'paid', payment_intent: 'pi_test_maat', metadata: {} })), 'processed');
    assert.equal((await reg(R.alu2Paid)).status, 'pending');

    aluPay = await pay(R.aluPaid);
    let x = await reg(R.aluPaid);
    assert.deepEqual([x.status, x.payment_intent_id], ['confirmed', aluPay.pi.id]);
    assert.equal(await handleEvent(aluPay.e), 'duplicate');
    // Otro evento con la misma sesión (p. ej. async_payment_succeeded): nada cambia ni se devuelve.
    assert.equal(await handleEvent(evt('checkout.session.async_payment_succeeded', aluPay.e.data.object)), 'processed');
    x = await reg(R.aluPaid);
    assert.deepEqual([x.status, x.refund_status], ['confirmed', null]);
    assert.equal((await refundsOf(aluPay.pi.id)).length, 0);
    const ev = await http('GET', `/events/${E.paid.id}`, 'alu');
    assert.deepEqual([ev.body.event.taken, ev.body.event.registration], [2, { id: R.aluPaid, status: 'confirmed', amount_cents: 1000 }]);
  });

  await run('cancelar: gratis y pendiente sí (caduca su Checkout); pagada 409; empezado 409; ajena 404', async () => {
    assert.equal((await http('DELETE', `/events/registrations/${R.aluFree}`, 'alu')).status, 204);
    expectError(await http('DELETE', `/events/registrations/${R.aluFree}`, 'alu'), 409, 'already_cancelled');
    const back = await register('alu', E.free.id); // tras cancelar se puede volver
    assert.equal(back.status, 201);
    R.aluFree = back.body.registration.id;
    expectError(await http('DELETE', `/events/registrations/${R.aluPaid}`, 'alu'), 409, 'paid_registration');
    expectError(await http('DELETE', `/events/registrations/${R.aluPaid}`, 'alu2'), 404, 'registration_not_found');
    const pending = await reg(R.alu2Member);
    assert.equal((await http('DELETE', `/events/registrations/${R.alu2Member}`, 'alu2')).status, 204);
    assert.deepEqual([(await reg(R.alu2Member)).cancel_reason, (await stripe.checkout.sessions.retrieve(pending.checkout_session_id)).status],
      ['student', 'expired']);
    const g = await http('POST', `/admin/events/${E.now.id}/registrations`, 'admin', { profile_id: U.alu });
    R.aluNow = g.body.registration.id;
    expectError(await http('DELETE', `/events/registrations/${R.aluNow}`, 'alu'), 409, 'event_started');
  });

  await run('pago tardío sobre una cancelada: se devuelve entero, con la clave event-refund-<id>', async () => {
    // El admin la cancela con el Checkout abierto; el pago llega después.
    const c = await http('POST', `/admin/event-registrations/${R.alu2Paid}/cancel`, 'admin', { refund: false });
    assert.equal(c.status, 200);
    const late = await pay(R.alu2Paid);
    const x = await reg(R.alu2Paid);
    assert.deepEqual([x.status, x.payment_intent_id, x.refund_status], ['cancelled', late.pi.id, 'refunded']);
    const [rf, ...more] = await refundsOf(late.pi.id);
    assert.deepEqual([rf.amount, rf.metadata.kind, rf.metadata.registration_id, more.length], [1500, 'event', R.alu2Paid, 0]);
    const same = await stripe.refunds.create(
      { payment_intent: late.pi.id, metadata: { kind: 'event', registration_id: R.alu2Paid } },
      { idempotencyKey: `event-refund-${R.alu2Paid}` });
    assert.equal(same.id, rf.id);
    // Un segundo aviso del pago no devuelve otra vez.
    assert.equal(await handleEvent(evt('checkout.session.async_payment_succeeded', late.e.data.object)), 'processed');
    assert.equal((await refundsOf(late.pi.id)).length, 1);
  });

  await run('admin: cancela sin reembolso (avisa), reintenta con él (auditado) y no dos veces', async () => {
    const c = await http('POST', `/admin/event-registrations/${R.aluPaid}/cancel`, 'admin', { refund: false });
    assert.deepEqual([c.status, c.body.registration.status, c.body.registration.cancel_reason, c.body.registration.refund_status],
      [200, 'cancelled', 'admin', null]);
    assert.equal((await refundsOf(aluPay.pi.id)).length, 0);
    assert.deepEqual((await lastAudit('event_registration.cancel', R.aluPaid)).changes, { from: 'confirmed', refund: false });
    assert.deepEqual(await deliveriesOf('notice.event_registration_cancelled', R.aluPaid), [{ recipient_id: U.alu, channel: 'email' }]);
    const [n] = await noticesOf('notice.event_registration_cancelled', R.aluPaid);
    assert.equal(new Date(n.changes.expires_at).getTime(), new Date(E.paid.starts_at).getTime());
    const retry = await http('POST', `/admin/event-registrations/${R.aluPaid}/cancel`, 'admin', { refund: true });
    assert.deepEqual([retry.status, retry.body.registration.refund_status], [200, 'refunded']);
    assert.deepEqual((await refundsOf(aluPay.pi.id)).map((f) => f.amount), [1000]);
    assert.ok(await lastAudit('event_registration.refund', R.aluPaid));
    expectError(await http('POST', `/admin/event-registrations/${R.aluPaid}/cancel`, 'admin', { refund: true }), 409,
      'already_cancelled');
    expectError(await http('POST', `/admin/event-registrations/${R.aluPaid}/cancel`, 'admin', {}), 400, 'invalid_field');
  });

  await run('admin: reembolso rechazado → failed y aviso de la academia; el reintento lleva otra clave', async () => {
    const r = await register('alu2', E.paid.id);
    R.alu2Paid2 = r.body.registration.id;
    const { pi } = await pay(R.alu2Paid2);
    await q(`UPDATE event_registrations SET payment_intent_id = 'pi_test_missing_' || id WHERE id = $1`, [R.alu2Paid2]);
    let c = await http('POST', `/admin/event-registrations/${R.alu2Paid2}/cancel`, 'admin', { refund: true });
    assert.deepEqual([c.status, c.body.registration.refund_status], [200, 'failed']);
    const [n] = await noticesOf('notice.event_refund_failed', R.alu2Paid2);
    assert.ok(n.changes.recipients.includes(U.admin));
    assert.equal(n.changes.amount_cents, 1500);
    assert.equal((await deliveriesOf('notice.event_refund_failed', R.alu2Paid2)).length, 0); // el admin lo lee en su panel
    await q(`UPDATE event_registrations SET payment_intent_id = $2 WHERE id = $1`, [R.alu2Paid2, pi.id]);
    c = await http('POST', `/admin/event-registrations/${R.alu2Paid2}/cancel`, 'admin', { refund: true });
    assert.deepEqual([c.status, c.body.registration.refund_status], [200, 'refunded']);
    const again = await stripe.refunds.create(
      { payment_intent: pi.id, metadata: { kind: 'event', registration_id: R.alu2Paid2 } },
      { idempotencyKey: `event-refund-${R.alu2Paid2}-1` });
    assert.deepEqual((await refundsOf(pi.id)).map((f) => f.id), [again.id]);
  });

  await run('refund.failed (asíncrono): vuelve a failed y avisa; un charge.refunded tardío no lo deshace', async () => {
    assert.ok(HANDLED_EVENTS.includes('refund.failed') && HANDLED_EVENTS.includes('checkout.session.expired'));
    const r = await register('alu2', E.paid.id);
    const id = r.body.registration.id;
    const { pi } = await pay(id, {}, 'pm_card_refundFail'); // el reembolso se acepta y falla después
    const c = await http('POST', `/admin/event-registrations/${id}/cancel`, 'admin', { refund: true });
    assert.equal(c.body.registration.refund_status, 'refunded');
    const before = await stripe.charges.retrieve(pi.latest_charge); // charge.refunded tal como llega antes del fallo
    const [real] = await refundsOf(pi.id);
    // El sandbox lo hace fallar cuando quiere (de 2 a más de 5 minutos): se simula lo que se relee después, comprobado
    // con uno que falló de verdad (refund 'failed' con failure_reason y el cargo con amount_refunded 0).
    const rf = { ...real, status: 'failed', failure_reason: 'expired_or_canceled_card' };
    await asRefundFailed(rf, async () => {
      assert.equal(await handleEvent(evt('refund.failed', rf)), 'processed');
      const x = await reg(id);
      assert.deepEqual([x.refund_status, x.refunded_cents], ['failed', 0]);
      const [n] = await noticesOf('notice.event_refund_failed', id);
      assert.ok(n.changes.recipients.includes(U.admin) && n.changes.error.includes(rf.id));
      assert.equal(await handleEvent(evt('charge.refunded', before)), 'processed');
      assert.equal((await reg(id)).refund_status, 'failed');
      assert.equal((await noticesOf('notice.event_refunded', id)).length, 0); // al pagador no se le dice «devuelto»
    });
    const retry = await http('POST', `/admin/event-registrations/${id}/cancel`, 'admin', { refund: true });
    // Si el sandbox aún no lo ha hecho fallar de verdad, Stripe responde charge_already_refunded: también es «devuelto».
    assert.deepEqual([retry.status, retry.body.registration.refund_status], [200, 'refunded']);
  });

  await run('tarea nocturna: un reembolso pedido que no llegó a Stripe se pide con su clave', async () => {
    const r = await register('alu2', E.paid.id);
    const id = r.body.registration.id;
    const { pi } = await pay(id);
    // Lo que deja una caída entre el COMMIT de la cancelación y la llamada a Stripe.
    await q(`UPDATE event_registrations SET status = 'cancelled', cancel_reason = 'admin', cancelled_at = now(),
                                            refund_status = 'requested' WHERE id = $1`, [id]);
    const out = await settleRequestedRefunds();
    assert.ok(out.refunded >= 1);
    assert.equal((await reg(id)).refund_status, 'refunded');
    const [rf] = await refundsOf(pi.id);
    assert.deepEqual([rf.amount, rf.metadata.registration_id], [1500, id]);
    const same = await stripe.refunds.create({ payment_intent: pi.id, metadata: { kind: 'event', registration_id: id } },
      { idempotencyKey: `event-refund-${id}` });
    assert.equal(same.id, rf.id);
  });

  await run('charge.refunded: de Kaizen guarda lo devuelto y avisa al pagador sin stripe_risk; del Dashboard, con él', async () => {
    const charge = await stripe.charges.retrieve(aluPay.pi.latest_charge);
    assert.equal(await handleEvent(evt('charge.refunded', charge)), 'processed');
    const x = await reg(R.aluPaid);
    assert.deepEqual([x.refunded_cents, x.refund_status], [1000, 'refunded']);
    const [n] = await noticesOf('notice.event_refunded', R.aluPaid);
    assert.deepEqual([n.changes.amount_cents, n.changes.recipients], [1000, [U.alu]]);
    assert.deepEqual(await deliveriesOf('notice.event_refunded', R.aluPaid), [{ recipient_id: U.alu, channel: 'email' }]);
    assert.equal((await noticesOf('notice.stripe_risk', charge.id)).length, 0);

    const { pi } = await pay(R.aluCap);
    await stripe.refunds.create({ payment_intent: pi.id }); // a mano en el Dashboard: sin metadata
    const dash = await stripe.charges.retrieve(pi.latest_charge);
    assert.equal(await handleEvent(evt('charge.refunded', dash)), 'processed');
    const y = await reg(R.aluCap);
    assert.deepEqual([y.status, y.refunded_cents, y.refund_status], ['confirmed', 1500, null]);
    assert.equal((await noticesOf('notice.stripe_risk', dash.id)).length, 1);
    assert.equal((await noticesOf('notice.event_refunded', R.aluCap)).length, 0);
  });

  await run('PATCH: solo lo que cambia, auditado; aforo por debajo 409; inicio o lugar avisa a los inscritos (tutores)', async () => {
    await register('alu2', E.free.id);
    expectError(await http('PATCH', `/admin/events/${E.free.id}`, 'admin', { capacity: 1 }), 409, 'capacity_below_registrations');
    let r = await http('PATCH', `/admin/events/${E.free.id}`, 'admin', { capacity: 2, title: E.free.title });
    assert.deepEqual([r.status, r.body.event.capacity, r.body.notified], [200, 2, 0]);
    assert.deepEqual((await lastAudit('event.update', E.free.id)).changes, { from: { capacity: null }, to: { capacity: 2 } });
    expectError(await http('PATCH', `/admin/events/${E.free.id}`, 'admin', {}), 400, 'empty_patch');
    r = await http('PATCH', `/admin/events/${E.minors.id}`, 'admin', { location: 'Pabellón' });
    assert.deepEqual([r.status, r.body.notified], [200, 1]);
    const [childReg] = await q(`SELECT id FROM event_registrations WHERE event_id = $1`, [E.minors.id]);
    const [n] = await noticesOf('notice.event_changed', childReg.id);
    assert.deepEqual([n.changes.fields, n.changes.previous_location], [['location'], 'Tatami 1']);
    assert.deepEqual((await deliveriesOf('notice.event_changed', childReg.id)).map((d) => d.recipient_id),
      sorted('tutor1', 'tutor2'));
  });

  await run('cancelar el evento: todo cancelado, lo pagado devuelto, avisos a inscritos y tutores; auditado', async () => {
    const a = await register('tutor1', E.fam.id, 'child');
    await pay(a.body.registration.id);
    const b = await register('alu2', E.fam.id);
    await pay(b.body.registration.id);
    const c = await register('alu', E.fam.id); // se queda pendiente
    const r = await http('POST', `/admin/events/${E.fam.id}/cancel`, 'admin', { note: 'lluvia' });
    assert.deepEqual([r.status, r.body], [200, { refunded: 2, refund_failed: 0, notified: 3 }]);
    const regs = await q(`SELECT * FROM event_registrations WHERE event_id = $1 ORDER BY created_at`, [E.fam.id]);
    assert.deepEqual(regs.map((x) => [x.status, x.cancel_reason, x.refund_status]), [
      ['cancelled', 'event_cancelled', 'refunded'], ['cancelled', 'event_cancelled', 'refunded'],
      ['cancelled', 'event_cancelled', null]]);
    assert.equal((await refundsOf(regs[0].payment_intent_id))[0].amount, 1200);
    assert.equal((await stripe.checkout.sessions.retrieve(regs[2].checkout_session_id)).status, 'expired');
    assert.deepEqual((await deliveriesOf('notice.event_cancelled', a.body.registration.id)).map((d) => d.recipient_id),
      sorted('tutor1', 'tutor2'));
    assert.deepEqual((await deliveriesOf('notice.event_cancelled', c.body.registration.id)).map((d) => d.recipient_id), [U.alu]);
    const [ev] = await q(`SELECT status, cancel_note FROM events WHERE id = $1`, [E.fam.id]);
    assert.deepEqual(ev, { status: 'cancelled', cancel_note: 'lluvia' });
    assert.deepEqual((await lastAudit('event.cancel', E.fam.id)).changes, { note: 'lluvia', registrations: 3 });
    expectError(await http('POST', `/admin/events/${E.fam.id}/cancel`, 'admin', {}), 409, 'event_cancelled');
    expectError(await http('PATCH', `/admin/events/${E.fam.id}`, 'admin', { title: 'x' }), 409, 'event_cancelled');
    expectError(await register('alu4', E.fam.id), 409, 'event_cancelled');
    // Lo ve quien estuvo inscrito; quien no, no. El admin, con la nota.
    assert.equal((await http('GET', `/events/${E.fam.id}`, 'alu2')).body.event.status, 'cancelled');
    expectError(await http('GET', `/events/${E.fam.id}`, 'alu4'), 404, 'event_not_found');
    assert.equal((await http('GET', `/admin/events/${E.fam.id}`, 'admin')).body.event.cancel_note, 'lluvia');
  });

  await run('listas: alumno (registered), tutor por un hijo (not_guardian), admin con filtros', async () => {
    const all = await http('GET', '/events', 'alu4');
    const mine = all.body.events.filter((e) => e.title.startsWith(tag)).map((e) => e.id);
    assert.ok(mine.includes(E.free.id) && mine.includes(E.now.id) && !mine.includes(E.fam.id)); // E.now: en curso
    const reg4 = await http('GET', '/events?registered=true', 'alu4');
    assert.deepEqual(reg4.body.events.map((e) => e.id), [E.social.id]);
    const kid = await http('GET', `/events?registered=true&profile_id=${U.child}`, 'tutor1');
    assert.deepEqual(kid.body.events.map((e) => [e.id, e.registration.status]),
      [[E.minors.id, 'confirmed'], [E.fam.id, 'cancelled']]);
    expectError(await http('GET', `/events?profile_id=${U.child}`, 'tutorX'), 403, 'not_guardian');
    expectError(await http('GET', '/events?registered=si', 'alu'), 400, 'invalid_field');
    const adm = await http('GET', '/admin/events?status=cancelled&limit=100', 'admin');
    assert.ok(adm.body.events.some((e) => e.id === E.fam.id) && adm.body.events.every((e) => e.status === 'cancelled'));
    const d = await http('GET', `/admin/events/${E.paid.id}`, 'admin');
    const row = d.body.registrations.find((x) => x.id === R.aluPaid);
    assert.deepEqual([row.student.id, row.payer.id, row.refund_status, row.refunded_cents, row.amount_cents],
      [U.alu, U.alu, 'refunded', 1000, 1000]);
  });

  await run('RLS: un alumno no lee inscripciones ajenas ni escribe por SQL; el profesor solo las de su evento', async () => {
    const as = (who, fn) => withRls({ uid: U[who], role: people[who][0] }, fn, { commit: false });
    assert.equal((await as('alu2', (c) => c.query(`SELECT 1 FROM event_registrations WHERE id = $1`, [R.aluPaid]))).rowCount, 0);
    assert.equal((await as('alu', (c) => c.query(`SELECT 1 FROM event_registrations WHERE id = $1`, [R.aluPaid]))).rowCount, 1);
    assert.equal((await as('tutor2', (c) => c.query(
      `SELECT 1 FROM event_registrations WHERE event_id = $1`, [E.minors.id]))).rowCount, 1); // el de su hijo
    for (const sql of [
      [`INSERT INTO event_registrations (event_id, profile_id, actor_id, status, amount_cents) VALUES ($1, $2, $2, 'confirmed', 0)`, [E.free.id, U.alu]],
      [`UPDATE event_registrations SET status = 'confirmed' WHERE id = $1`, [R.aluPaid]],
      [`DELETE FROM event_registrations WHERE id = $1`, [R.aluPaid]],
      [`INSERT INTO events (title, starts_at, ends_at, location, created_by) VALUES ('x', now(), now() + interval '1h', 'x', $1)`, [U.alu]],
    ]) {
      await assert.rejects(as('alu', (c) => c.query(...sql)), (e) => e.code === '42501' || /row-level security/.test(e.message));
    }
    // UPDATE de events sin política para él: 0 filas, sin error.
    assert.equal((await as('alu', (c) => c.query(`UPDATE events SET title = 'x' WHERE id = $1`, [E.free.id]))).rowCount, 0);
    assert.equal((await q(`SELECT title FROM events WHERE id = $1`, [E.free.id]))[0].title, E.free.title);
    await assert.rejects(as('admin', (c) => c.query(`DELETE FROM events WHERE id = $1`, [E.free.id])), (e) => e.code === '42501');
    assert.equal((await as('prof', (c) => c.query(`SELECT 1 FROM event_registrations WHERE event_id = $1`, [E.now.id]))).rowCount, 1);
    assert.equal((await as('prof', (c) => c.query(`SELECT 1 FROM event_registrations WHERE event_id = $1`, [E.paid.id]))).rowCount, 0);
    assert.equal((await as('prof2', (c) => c.query(`SELECT 1 FROM event_registrations WHERE event_id = $1`, [E.now.id]))).rowCount, 0);
  });

  await run('asistencia: desde el inicio, el profesor del evento y el admin', async () => {
    await http('POST', `/admin/events/${E.now.id}/registrations`, 'admin', { profile_id: U.child });
    let r = await http('PUT', `/events/${E.now.id}/attendance/${U.alu}`, 'prof', { present: true });
    assert.deepEqual([r.status, r.body], [200, { profile_id: U.alu, present: true }]);
    assert.equal((await reg(R.aluNow)).attended, true);
    expectError(await http('PUT', `/events/${E.now.id}/attendance/${U.alu}`, 'prof2', { present: false }), 404, 'registration_not_found');
    expectError(await http('PUT', `/events/${E.free.id}/attendance/${U.alu}`, 'prof', { present: true }), 409, 'event_not_started');
    expectError(await http('PUT', `/events/${E.now.id}/attendance/${U.alu}`, 'alu', { present: true }), 403, 'insufficient_role');
    r = await http('PUT', `/events/${E.now.id}/attendance/${U.child}`, 'admin', { present: false });
    assert.equal(r.status, 200);
    const d = await http('GET', `/professor/events/${E.now.id}`, 'prof');
    assert.deepEqual(d.body.students.map((s) => [s.profile_id, s.attended]).sort(),
      [[U.alu, true], [U.child, false]].sort());
    assert.ok(d.body.students.every((s) => s.display_name?.startsWith(tag)));
    expectError(await http('GET', `/professor/events/${E.now.id}`, 'prof2'), 404, 'event_not_found');
    const list = await http('GET', '/professor/events?from=' + new Date(Date.now() - 864e5).toISOString().slice(0, 10), 'prof');
    assert.deepEqual(list.body.events.filter((e) => e.title.startsWith(tag)).map((e) => e.id), [E.now.id, E.free.id]);
  });

  await run('fichas de salud: solo el profesor del evento, el día del evento, con health.view', async () => {
    const r = await http('GET', `/professor/events/${E.now.id}/health`, 'prof');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.students.map((s) => s.student_id).sort(), sorted('alu', 'child'));
    assert.equal(r.body.students[0].allergies, 'polen');
    const a = await lastAudit('health.view', E.now.id);
    assert.deepEqual([a.actor_id, a.resource_type, a.changes.student_ids.sort()], [U.prof, 'event', sorted('alu', 'child')]);
    expectError(await http('GET', `/professor/events/${E.free.id}/health`, 'prof'), 404, 'event_not_found'); // dentro de 2 días
    expectError(await http('GET', `/professor/events/${E.now.id}/health`, 'prof2'), 404, 'event_not_found');
  });
} finally {
  console.error = realError;
  console.warn = realWarn;
  server.close();
  const regs = (await q(`SELECT id::text FROM event_registrations WHERE event_id = ANY($1::uuid[])`, [events])).map((r) => r.id);
  await q(`DELETE FROM audit_log WHERE resource_id = ANY($1::text[])`, [[...regs, ...events]]);
  await q(`DELETE FROM audit_log WHERE action = 'notice.stripe_risk' AND actor_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM event_registrations WHERE event_id = ANY($1::uuid[])`, [events]);
  await q(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [events]);
  await q(`DELETE FROM webhook_events WHERE id = ANY($1::text[])`, [eventIds]);
  for (const { stripe_customer_id: c } of await q(
    `SELECT stripe_customer_id FROM profiles WHERE id = ANY($1::uuid[]) AND stripe_customer_id IS NOT NULL`, [ids])) {
    await stripe.customers.del(c).catch(() => {});
  }
  await q(`DELETE FROM subscriptions WHERE id = $1`, [subId]);
  await q(`DELETE FROM plans WHERE id = $1`, [plan]);
  await q(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM student_health_info WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM guardianships WHERE minor_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM agreement_documents WHERE id = ANY($1::uuid[])`, [testDocs]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
