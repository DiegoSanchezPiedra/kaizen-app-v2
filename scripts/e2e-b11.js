// B20: endpoints de B11 (cambio de pagador) por HTTP, con la app en proceso y una BD efímera
// (npm run test:e2e-b11). Todo lo que se prueba falla antes de llamar a Stripe: el servicio relee a Stripe solo tras las
// validaciones, y los ids de Stripe de las filas son falsos. Lo que sí toca Stripe (pagar, traspaso) está en
// test:billing y test:webhook.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { hashPassword } from '../src/services/password.js';
import { startApp } from './lib/app-server.js';

const q = (text, params) => servicePool.query(text, params).then((r) => r.rows);
const password = 'e2e-b11-password-1234';
const hash = await hashPassword(password);
const users = {};
for (const [name, role, birth] of [['admin', 'admin'], ['alumno', 'alumno'], ['tutorA', 'tutor'], ['tutorB', 'tutor'],
  ['tutorC', 'tutor'], ['child', 'alumno', '2016-05-05']]) {
  [{ id: users[name] }] = await q(
    `WITH p AS (INSERT INTO profiles (id, display_name, birth_date) VALUES (gen_random_uuid(), $1, $4) RETURNING id),
          c AS (INSERT INTO auth_credentials (profile_id, email, password_hash, email_verified)
                SELECT id, $1 || '@test.local', $2, true FROM p),
          r AS (INSERT INTO user_roles (user_id, role) SELECT id, $3 FROM p)
     SELECT id FROM p`, [`e2e-${name}`, hash, role, birth ?? null]);
}
const U = users;
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $3), ($2, $3)`, [U.tutorA, U.tutorB, U.child]);
const [{ id: planId }] = await q(
  `INSERT INTO plans (name, price_cents, stripe_price_id) VALUES ('E2E B11', 1000, 'price_fake') RETURNING id`);
const [{ id: subId }] = await q(
  `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
   VALUES ($1, $2, $3, 'active', 'sub_fake_b11') RETURNING id`, [U.child, U.tutorA, planId]);
const newChange = async (status = 'requested', deadline = "now() + interval '1 day'") => (await q(
  `INSERT INTO payer_changes (subscription_id, student_id, old_payer_id, new_payer_id, plan_id, starts_at, deadline, status, created_by)
   VALUES ($1, $2, $3, $4, $5, now() + interval '2 days', ${deadline}, $6, $7) RETURNING id`,
  [subId, U.child, U.tutorA, U.tutorB, planId, status, U.admin]))[0].id;
await q(`UPDATE profiles SET stripe_customer_id = 'cus_fake_b' WHERE id = $1`, [U.tutorB]);

const { http, close } = await startApp();
const realError = console.error;
console.error = () => {}; // el errorHandler registra cada 4xx esperado
const status = (r) => [r.status, r.body?.code];
const tok = {};
try {
  for (const n of Object.keys(U)) {
    tok[n] = (await http('POST', '/auth/login', { body: { email: `e2e-${n}@test.local`, password } })).body.token;
  }
  const admin = (m, url, body) => http(m, `/admin${url}`, { token: tok.admin, body });

  // Cambio de pagador, pedirlo (admin): validaciones previas a Stripe.
  const request = (payer_id, sub = subId, token = tok.admin) => http('POST', `/admin/subscriptions/${sub}/payer-change`, { token, body: { payer_id } });
  assert.deepEqual(status(await request(U.tutorB, subId, tok.tutorA)), [403, 'insufficient_role']);
  assert.deepEqual(status(await request('x')), [400, 'invalid_field']);
  assert.deepEqual(status(await request(crypto.randomUUID())), [404, 'profile_not_found']);
  assert.deepEqual(status(await request(U.tutorB, crypto.randomUUID())), [404, 'subscription_not_found']);
  assert.deepEqual(status(await request(U.tutorA)), [409, 'same_payer']);
  assert.deepEqual(status(await request(U.tutorC)), [409, 'invalid_payer']); // adulto no vinculado al menor
  assert.deepEqual(status(await request(U.child)), [409, 'invalid_payer']); // el propio menor

  // Anular: sin cambio pendiente 404; con uno requested, 204 y queda cancelled por el admin; el pagado no se deshace.
  const cancel = () => admin('DELETE', `/subscriptions/${subId}/payer-change`);
  assert.deepEqual(status(await cancel()), [404, 'no_payer_change']);
  const toCancel = await newChange();
  assert.equal((await cancel()).status, 204);
  assert.deepEqual((await q(`SELECT status, cancel_reason FROM payer_changes WHERE id = $1`, [toCancel]))[0], { status: 'cancelled', cancel_reason: 'admin' });
  const paid = await newChange('paid');
  assert.deepEqual(status(await cancel()), [409, 'payer_change_paid']);
  await q(`UPDATE payer_changes SET status = 'completed' WHERE id = $1`, [paid]);

  // Lectura: el nuevo y el antiguo pagador y el admin lo ven; otro tutor, 404; el id malformado, 400.
  const pc = await newChange();
  const get = (token, id = pc, base = '/billing') => http('GET', `${base}/payer-changes/${id}`, { token });
  for (const who of ['tutorB', 'tutorA']) {
    const r = await get(tok[who]);
    assert.deepEqual([r.status, r.body.status, r.body.student.id, r.body.plan.id], [200, 'requested', U.child, String(planId)]);
  }
  assert.equal((await get(tok.admin, pc, '/admin')).status, 200);
  assert.deepEqual(status(await get(tok.tutorC)), [404, 'payer_change_not_found']);
  assert.deepEqual(status(await get(tok.tutorB, 'x')), [400, 'invalid_id']);
  const list = await admin('GET', `/payer-changes?subscription_id=${subId}&status=requested`);
  assert.deepEqual([list.status, list.body.total, list.body.rows[0].id], [200, 1, pc]);
  assert.deepEqual(status(await admin('GET', '/payer-changes?status=nope')), [400, 'invalid_field']);

  // Checkout del nuevo pagador: 403 not_new_payer (el pagador antiguo; los demás no lo ven: 404); con perfil incompleto, 403
  // profile_incomplete (la guarda mira al alumno del cambio y al pagador) antes de llegar a Stripe.
  const checkout = (who, id = pc) => http('POST', `/billing/payer-changes/${id}/checkout`, { token: tok[who], body: {} });
  assert.deepEqual(status(await checkout('tutorA')), [403, 'not_new_payer']); // el antiguo lo ve (RLS) pero no paga
  assert.deepEqual(status(await checkout('tutorC')), [404, 'payer_change_not_found']);
  assert.deepEqual(status(await checkout('child')), [403, 'minor_restricted']); // B32: un menor no paga
  assert.deepEqual(status(await checkout('tutorB', crypto.randomUUID())), [404, 'payer_change_not_found']);
  const r = await checkout('tutorB');
  assert.deepEqual(status(r), [403, 'profile_incomplete']);
  assert.ok(r.body.missing.length > 0);

  // Con los perfiles completos (hijo y tutor B) pasa la guarda; el estado decide antes de Stripe.
  await q(`INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone) VALUES ($1, 'x', '1'), ($2, 'x', '1')`, [U.child, U.tutorB]);
  for (const type of ['data_protection', 'rights_of_image']) {
    await q(`INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at) VALUES (gen_random_uuid(), $1, '1.0', 'e2e-b11.pdf', 'x', now())`, [type]);
    for (const p of [U.child, U.tutorB]) await q(`INSERT INTO user_agreements (id, profile_id, signed_by, type, version) VALUES (gen_random_uuid(), $1, $2, $3, '1.0')`, [p, U.tutorB, type]);
  }
  const set = (sql) => q(`UPDATE payer_changes SET ${sql} WHERE id = $1`, [pc]);
  await set("status = 'cancelled'");
  assert.deepEqual(status(await checkout('tutorB')), [409, 'payer_change_cancelled']);
  await set("status = 'paid'");
  assert.deepEqual(status(await checkout('tutorB')), [409, 'payer_change_paid']);
  await set("status = 'requested', deadline = now() - interval '1 minute'");
  assert.deepEqual(status(await checkout('tutorB')), [409, 'payer_change_expired']);
  await set("deadline = now() + interval '1 day'");
  await q(`UPDATE plans SET stripe_price_id = NULL WHERE id = $1`, [planId]);
  assert.deepEqual(status(await checkout('tutorB')), [409, 'plan_not_purchasable']);

  console.log('OK   E2E B11: pedir, anular, leer y listar el cambio de pagador; Checkout 403 con perfil incompleto');
} catch (e) {
  realError('FAIL E2E B11\n', e);
  process.exitCode = 1;
} finally {
  await close();
  await closePools();
}
