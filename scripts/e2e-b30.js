// B30: pausa con cuota de mantenimiento de punta a punta (npm run test:e2e-b30), contra el sandbox de Stripe. La app en
// proceso sobre una BD efímera; `stripe listen` reenvía los eventos reales a su webhook; dos test clocks hacen pasar los
// meses (un reloj admite 3 clientes). Cuatro suscripciones a la vez:
//   A: pausa de 2 meses → se cobra la cuota de mantenimiento dos veces y luego el plan, con las mismas disciplinas.
//   B: pausa anulada antes de empezar → la suscripción sigue igual (se cobra el plan).
//   C: pausa de 3 meses y vuelta antes, ya empezada → el plan vuelve en la siguiente fecha de cobro.
//   D (otro reloj): impago de la cuota de mantenimiento → past_due (en gracia) y unpaid (morosos).
// Requiere la CLI de Stripe con sesión en la misma cuenta que STRIPE_SECRET_KEY (solo sandbox) y, para D, el ajuste de la
// cuenta «reintentos acabados → marcar la suscripción como impagada» (como test:dunning). Tarda unos minutos.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) throw new Error('test:e2e-b30 solo corre contra el sandbox');
const cli = JSON.parse(execFileSync('stripe', ['whoami', '--format', 'json'], { encoding: 'utf8' }));
// La firma del webhook: el secreto de `stripe listen`, antes de cargar la app (config/stripe.js lo lee al importarse).
process.env.STRIPE_WEBHOOK_SECRET = execFileSync('stripe', ['listen', '--print-secret'], { encoding: 'utf8' }).trim();

const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { stripe } = await import('../src/config/stripe.js');
const { createPlan } = await import('../src/services/catalog.js');
const { endPause } = await import('../src/services/billing.js');
const { handleEvent, HANDLED_EVENTS } = await import('../src/services/stripeWebhook.js');
const { hashPassword } = await import('../src/services/password.js');
const { startApp } = await import('./lib/app-server.js');

const account = await stripe.accounts.retrieve();
if (cli.mode !== 'test' || cli.account_id !== account.id) {
  throw new Error(`la CLI (${cli.account_id}, ${cli.mode}) no es la cuenta de la clave (${account.id})`);
}

const q = (text, params) => servicePool.query(text, params).then((r) => r.rows);
const DAY = 86400;
const MAINT = 500;
const PLAN = 2000;
const password = 'e2e-b30-password-1234';
const hash = await hashPassword(password);
const U = {};
for (const [name, role] of [['admin', 'admin'], ['a', 'alumno'], ['b', 'alumno'], ['c', 'alumno'], ['d', 'alumno']]) {
  [{ id: U[name] }] = await q(
    `WITH p AS (INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id),
          c AS (INSERT INTO auth_credentials (profile_id, email, password_hash, email_verified)
                SELECT id, $1 || '@test.local', $2, true FROM p),
          r AS (INSERT INTO user_roles (user_id, role) SELECT id, $3 FROM p)
     SELECT id FROM p`, [`e2e-b30-${name}`, hash, role]);
}
const [{ id: disc }] = await q(`INSERT INTO disciplines (name) VALUES ('E2E-B30') RETURNING id`);
const plan = await withRls({ uid: U.admin, role: 'admin' }, (c) =>
  createPlan(c, { name: `E2E-B30-${Date.now()}`, price_cents: PLAN, max_disciplines: 1 }));
const [{ stripe_price_id: price }] = await q(`SELECT stripe_price_id FROM plans WHERE id = $1`, [plan.id]);

const { http, base, close } = await startApp();
const tok = {};
for (const n of Object.keys(U)) {
  tok[n] = (await http('POST', '/auth/login', { body: { email: `e2e-b30-${n}@test.local`, password } })).body.token;
}
const as = (who) => (method, url, body) => http(method, url, { token: tok[who], body });

// Espera a que el webhook deje el estado esperado (los eventos llegan por `stripe listen`, desordenados).
const until = async (what, fn, secs = 120) => {
  let last;
  for (let i = 0; i < secs / 2; i++) {
    try { return await fn(); } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${what}: ${last?.message}`);
};
const local = async (who) => (await q(
  `SELECT s.*, ARRAY(SELECT discipline_id::text FROM subscription_disciplines WHERE subscription_id = s.id) AS discs
     FROM subscriptions s WHERE student_id = $1`, [U[who]]))[0];
const pauseOf = async (who) => (await q(
  `SELECT pa.* FROM pauses pa JOIN subscriptions s ON s.id = pa.subscription_id WHERE s.student_id = $1
    ORDER BY pa.created_at DESC LIMIT 1`, [U[who]]))[0];
const noticeCount = async (action, pauseId) =>
  (await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1 AND resource_id = $2`, [action, pauseId]))[0].n;
// Recibos de la suscripción en Stripe, del más viejo al más nuevo: [importe, estado].
const invoicesOf = async (subId) => (await stripe.invoices.list({ subscription: subId, limit: 20 })).data
  .sort((x, y) => x.created - y.created).map((i) => [i.amount_due, i.status]);

const clocks = [];
const steps = [];
let listen;
let failed = false;
const t = Date.now();
try {
  listen = spawn('stripe', ['listen', '--forward-to', `${base}/webhooks/stripe`, '--events', HANDLED_EVENTS.join(',')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    listen.stderr.on('data', (d) => { if (String(d).includes('Ready!')) resolve(); });
    listen.on('exit', (code) => reject(new Error(`stripe listen salió con ${code}`)));
  });

  assert.equal((await as('admin')('PUT', '/admin/settings/pause', { price_cents: MAINT })).status, 200);
  const t0 = Math.floor(Date.now() / 1000);
  const subs = {};
  for (const [clockName, who] of [['1', 'a'], ['1', 'b'], ['1', 'c'], ['2', 'd']]) {
    let clock = clocks.find((c) => c.name === `kaizen-e2e-b30-${clockName}`);
    if (!clock) clocks.push(clock = await stripe.testHelpers.testClocks.create({ frozen_time: t0, name: `kaizen-e2e-b30-${clockName}` }));
    const cus = await stripe.customers.create({
      test_clock: clock.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' },
    });
    await q(`UPDATE profiles SET stripe_customer_id = $2 WHERE id = $1`, [U[who], cus.id]);
    subs[who] = await stripe.subscriptions.create({
      customer: cus.id, items: [{ price }],
      metadata: { student_id: U[who], payer_id: U[who], plan_id: plan.id, discipline_ids: String(disc) },
    });
    // El Checkout no se automatiza: su evento, como en test:dunning.
    await handleEvent({
      id: `evt_test_${crypto.randomUUID()}`, type: 'checkout.session.completed',
      data: { object: { id: `cs_test_${crypto.randomUUID()}`, object: 'checkout.session', mode: 'subscription',
        payment_status: 'paid', subscription: subs[who].id, customer: cus.id } },
    });
    assert.equal((await local(who)).status, 'active');
  }
  const D1 = subs.a.items.data[0].current_period_end; // siguiente fecha de cobro (la misma en los cuatro: mismo t0)

  // Pedirlas por la app (HTTP), como el pagador.
  for (const [who, months] of [['a', 2], ['b', 1], ['c', 3], ['d', 1]]) {
    const r = await as(who)('POST', '/billing/pause', { months });
    assert.deepEqual([r.status, r.body.status, new Date(r.body.starts_at).getTime()], [201, 'scheduled', D1 * 1000], who);
  }
  assert.deepEqual((await as('a')('POST', '/billing/pause', { months: 1 })).body.code, 'change_scheduled');
  const sub = await as('a')('GET', '/billing/subscription');
  assert.deepEqual([sub.body.pause.status, sub.body.pause.months, sub.body.pause_settings.price_cents], ['scheduled', 2, MAINT]);
  // B: anularla antes de empezar.
  const annul = await as('b')('DELETE', '/billing/pause');
  assert.deepEqual([annul.status, annul.body.status], [200, 'cancelled']);
  assert.equal((await stripe.subscriptions.retrieve(subs.b.id)).schedule, null);
  // D: la cuota de mantenimiento no se podrá cobrar.
  const cusD = subs.d.customer;
  const bad = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: cusD });
  await stripe.customers.update(cusD, { invoice_settings: { default_payment_method: bad.id } });

  const advance = async (to, label) => {
    await Promise.all(clocks.map((c) => stripe.testHelpers.testClocks.advance(c.id, { frozen_time: to })));
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await Promise.all(clocks.map((c) => stripe.testHelpers.testClocks.retrieve(c.id)));
      if (st.every((c) => c.status === 'ready')) break;
    }
    steps.push(`${label} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  };

  // +1 mes: empieza la pausa de A, C y D. A y C pagan la cuota de mantenimiento; B, el plan; D falla.
  await advance(D1 + DAY, '+1 mes');
  await until('A en pausa', async () => {
    assert.equal((await pauseOf('a')).status, 'active');
    assert.equal(await noticeCount('notice.pause_started', (await pauseOf('a')).id), 1);
  });
  assert.deepEqual(await invoicesOf(subs.a.id), [[PLAN, 'paid'], [MAINT, 'paid']]);
  assert.deepEqual(await invoicesOf(subs.b.id), [[PLAN, 'paid'], [PLAN, 'paid']]);
  assert.equal((await pauseOf('b')).status, 'cancelled');
  await until('C en pausa', async () => assert.equal((await pauseOf('c')).status, 'active'));
  assert.deepEqual(await invoicesOf(subs.c.id), [[PLAN, 'paid'], [MAINT, 'paid']]);
  await until('D en gracia', async () => {
    assert.equal((await local('d')).status, 'past_due');
    const grace = await as('admin')('GET', '/admin/billing/grace?limit=100');
    assert.ok(grace.body.payers.some((p) => p.payer_id === U.d && p.invoices.some((i) => i.amount_due_cents === MAINT)));
  });
  // Eximir ya empezada: C (3 meses) desde la siguiente fecha de cobro; a D (1 mes) ya no le queda ningún cobro.
  const nextC = (await stripe.subscriptions.retrieve(subs.c.id)).items.data[0].current_period_end;
  const exC = await as('admin')('POST', `/admin/pauses/${(await pauseOf('c')).id}/exempt`, { reason: 'Lesión' });
  assert.deepEqual([exC.status, exC.body.exempt, new Date(exC.body.exempt_from).getTime()], [200, true, nextC * 1000]);
  const exD = await as('admin')('POST', `/admin/pauses/${(await pauseOf('d')).id}/exempt`, { reason: 'Lesión' });
  assert.deepEqual([exD.status, exD.body.code], [409, 'pause_nothing_to_exempt']);

  // C: volver antes con un fallo de la BD tras escribir en Stripe (un actor que no es un perfil): el Schedule se restaura.
  const before = (await stripe.subscriptions.retrieve(subs.c.id, { expand: ['schedule'] })).schedule;
  await assert.rejects(withRls({ uid: U.admin, role: 'admin' }, async (c) =>
    endPause(c, { id: (await local('c')).id, actorId: crypto.randomUUID(), isAdmin: true })), (e) => e.code === '23503');
  const restored = (await stripe.subscriptions.retrieve(subs.c.id, { expand: ['schedule'] })).schedule;
  const shape = (sch) => [sch.metadata.ends_at, ...sch.phases.map((x) => [x.start_date, x.end_date, x.items[0].price])];
  assert.deepEqual(shape(restored), shape(before), 'fases y metadata como antes');

  // C: volver antes, ya empezada → la fase del plan pasa a la siguiente fecha de cobro (+2 meses).
  const back = await as('c')('DELETE', '/billing/pause');
  assert.deepEqual([back.status, back.body.status, new Date(back.body.ends_at).getTime()], [200, 'active', nextC * 1000]);
  const schC = (await stripe.subscriptions.retrieve(subs.c.id, { expand: ['schedule'] })).schedule;
  assert.deepEqual([schC.phases.length, schC.phases[0].end_date, schC.metadata.ends_at], [2, nextC, new Date(nextC * 1000).toISOString()]);

  // D: sin cobrar tras los reintentos → unpaid (morosos).
  await advance(D1 + 20 * DAY, '+1 mes y 20 días');
  await until('D morosa', async () => {
    assert.equal((await local('d')).status, 'unpaid');
    const bad2 = await as('admin')('GET', '/admin/billing/delinquents?limit=100');
    assert.ok(bad2.body.payers.some((p) => p.payer_id === U.d && p.invoices.some((i) => i.amount_due_cents === MAINT)));
  });

  // +2 meses: A paga la segunda cuota de mantenimiento; C ha vuelto al plan.
  const D2 = (await stripe.subscriptions.retrieve(subs.a.id)).items.data[0].current_period_end;
  await advance(D2 + DAY, '+2 meses');
  assert.deepEqual(await invoicesOf(subs.a.id), [[PLAN, 'paid'], [MAINT, 'paid'], [MAINT, 'paid']]);
  assert.deepEqual(await invoicesOf(subs.c.id), [[PLAN, 'paid'], [MAINT, 'paid'], [PLAN, 'paid']]);
  await until('C de vuelta', async () => {
    const p = await pauseOf('c');
    assert.deepEqual([p.status, p.ends_at.getTime()], ['completed', nextC * 1000]);
    assert.equal(await noticeCount('notice.pause_ended', p.id), 1);
  });

  // +3 meses: A vuelve al plan con las mismas disciplinas.
  const D3 = (await stripe.subscriptions.retrieve(subs.a.id)).items.data[0].current_period_end;
  await advance(D3 + DAY, '+3 meses');
  assert.deepEqual(await invoicesOf(subs.a.id), [[PLAN, 'paid'], [MAINT, 'paid'], [MAINT, 'paid'], [PLAN, 'paid']]);
  await until('A de vuelta', async () => {
    const p = await pauseOf('a');
    assert.equal(p.status, 'completed');
    assert.equal(await noticeCount('notice.pause_ended', p.id), 1);
  });
  const a = await local('a');
  const st = await stripe.subscriptions.retrieve(subs.a.id);
  assert.deepEqual([a.status, a.plan_id, a.discs, a.scheduled_plan_id], ['active', plan.id, [String(disc)], null]);
  assert.deepEqual([st.items.data[0].price.id, st.metadata.plan_id, st.metadata.discipline_ids], [price, plan.id, String(disc)]);
  console.log(`OK   A: plan, cuota de mantenimiento ×2, plan con las mismas disciplinas; B: anulada, sigue igual; `
    + `C: vuelta antes en la siguiente fecha de cobro; D: impago → en gracia → morosos (${steps.join(', ')})`);
} catch (e) {
  failed = true;
  console.error('FAIL test:e2e-b30\n', e);
} finally {
  listen?.kill();
  for (const c of clocks) await stripe.testHelpers.testClocks.del(c.id).catch(() => {}); // borra clientes y suscripciones
  // El Product del plan, archivado (la BD efímera se borra entera). El de la cuota de mantenimiento se comparte en el
  // sandbox (se reutiliza por su metadata): solo se archiva el Price de esta prueba.
  const product = (await stripe.prices.retrieve(price)).product;
  await stripe.prices.update(price, { active: false });
  await stripe.products.update(product, { active: false });
  const [m] = await q(`SELECT value #>> '{}' AS id FROM academy_settings WHERE key = 'pause_stripe_price'`);
  if (m) await stripe.prices.update(m.id, { active: false });
  await close();
  await closePools();
}
if (!failed) console.log('todo OK');
process.exit(failed ? 1 : 0);
