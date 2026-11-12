import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { createDocument, publishDocument, signAgreement } from '../src/services/agreements.js';
import { registerLocal } from '../src/services/auth.js';
import {
  getProfileStatus,
  upsertHealthInfo,
  createChild,
  updateChild,
  listChildren,
  assertGuardianOf,
} from '../src/services/profile.js';
import { deleteFile } from '../src/services/storage.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

// `nino` simula un menor que (por un bug) llegara a actuar con JWT propio.
const [admin, tutor, otro, nino] = Array.from({ length: 4 }, () => crypto.randomUUID());
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const files = [];
const TYPES = ['data_protection', 'rights_of_image'];

await servicePool.query(
  `INSERT INTO profiles (id, display_name, birth_date) VALUES
     ($1,'admin-t',NULL),($2,'tutor-t',$5),($3,'otro-t',$5),($4,'nino-t',$6)`,
  [admin, tutor, otro, nino, yearsAgo(40), yearsAgo(10)]
);

const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);
// Ejecuta fn esperando un error (regex sobre el mensaje o código) sin abortar la transacción.
const fails = async (c, fn, expected) => {
  await c.query('SAVEPOINT s');
  await assert.rejects(fn(), (e) => (expected instanceof RegExp ? expected.test(e.message) : e.code === expected));
  await c.query('ROLLBACK TO s');
};
const denied = (c, fn) => fails(c, fn, /row-level security/);

// ---------------------------------------------------------------------------
// B32: acceso propio del menor. Matriz por endpoint con el token del menor (la app en proceso sobre la BD efímera).
// A (10 años) y B (15, su hermano), hijos de T; T2 también es tutor de A. Los dos cubiertos y con el perfil completo.
// ---------------------------------------------------------------------------
let close;
const avatars = []; // las fotos subidas van al storage real: se borran al acabar
const NOTICE_VERSION = '1.0';
async function matrix() {
  const { startApp } = await import('./lib/app-server.js');
  const { signToken } = await import('../src/services/jwt.js');
  const { hashPassword } = await import('../src/services/password.js');
  const { qrCode, qrStep } = await import('../src/services/checkin.js');
  const app = await startApp();
  close = app.close;
  const q = (text, params) => servicePool.query(text, params).then((r) => r.rows);
  const tag = `m${crypto.randomBytes(3).toString('hex')}`;
  const P = {};
  for (const [k, role, years] of [['T', 'tutor', 40], ['T2', 'alumno', 42], ['A', 'alumno', 10], ['B', 'alumno', 15]]) {
    [{ id: P[k] }] = await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`${tag}-${k}`, yearsAgo(years)]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [P[k], role]);
  }
  for (const k of ['T', 'T2']) {
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, $3)`,
      [P[k], `${tag}-${k.toLowerCase()}@test.local`, await hashPassword('tutor-1234')]);
  }
  await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $3), ($1, $4), ($2, $3)`, [P.T, P.T2, P.A, P.B]);
  const V = `8.${Date.now() % 1e9}`;
  for (const type of TYPES) {
    await q(`INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
             VALUES (gen_random_uuid(), $1, $2, 'test-minors.pdf', 'x', now())`, [type, V]);
    for (const [who, by] of [['A', 'T'], ['B', 'T'], ['T', 'T'], ['T2', 'T2']]) {
      await q(`INSERT INTO user_agreements (id, profile_id, signed_by, type, version) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [P[who], P[by], type, V]);
    }
  }
  for (const k of ['A', 'B', 'T2']) {
    // De hace un mes: la ficha que el tutor rellenó antes de que B cumpla 18 (el trigger solo toca updated_at al UPDATE).
    await q(`INSERT INTO student_health_info (profile_id, allergies, emergency_contact_name, emergency_contact_phone, updated_at)
             VALUES ($1, 'polen', 'x', '600000000', now() - interval '30 days')`, [P[k]]);
  }
  const [{ id: D }] = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [tag]);
  const [{ id: plan }] = await q(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`, [tag]);
  const sub = {};
  for (const k of ['A', 'B']) {
    [{ id: sub[k] }] = await q(`INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
      VALUES (gen_random_uuid(), $1, $2, $3, 'active', 'sub_test_' || gen_random_uuid()) RETURNING id`, [P[k], P.T, plan]);
  }
  const [{ id: trainer }] = await q(`INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`${tag}-prof`]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'profesor')`, [trainer]);
  const session = async (offset) => (await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
     VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '60 min', 60, 10, 'scheduled') RETURNING id`,
    [D, trainer, offset]))[0].id;
  const S = { one: await session('2 days'), two: await session('3 days'), now: await session('5 min') };
  const event = async (price) => (await q(
    `INSERT INTO events (title, starts_at, ends_at, location, price_cents, created_by, trainer_id)
     VALUES ($1, now() + interval '5 days', now() + interval '5 days 2 hours', 'Tatami', $2, $3, $3) RETURNING id`,
    [`${tag}-${price}`, price, trainer]))[0].id;
  const E = { free: await event(0), paid: await event(1000) };

  const tok = { T: signToken({ sub: P.T, role: 'tutor' }), T2: signToken({ sub: P.T2, role: 'alumno' }) };
  const as = (who) => (method, url, body) => app.http(method, url, { token: tok[who], body });
  const T = as('T');
  const login = (email, password) => app.http('POST', '/auth/login', { body: { email, password } });
  const user = { A: `${tag}-a`, B: `${tag}.b` };
  const pass = { A: 'peque-1234', B: 'mayor-1234' };
  const expectErr = (r, status, code, what) => {
    assert.equal(r.status, status, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
    if (code) assert.equal(r.body.code, code, what);
  };
  const life = (t) => { const { exp, iat } = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); return exp - iat; };
  const deliveries = async (action, recipient) => (await q(
    `SELECT 1 FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id
      WHERE a.action = $1 AND d.recipient_id = $2 AND a.resource_id = ANY($3)`, [action, recipient, [P.A, P.B]])).length;

  await run('B32 alta: usuario con forma de email, contraseña corta, email por debajo de 14 y sin versión del texto → 400', async () => {
    const base = { username: user.A, password: pass.A, notice_version: NOTICE_VERSION };
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, username: 'nino@correo.es' }), 400, 'invalid_username', 'email');
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, username: 'a' }), 400, 'invalid_username', 'corto');
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, password: 'corta' }), 400, 'weak_password', 'pass');
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, email: `${tag}-a@test.local` }), 400, 'email_requires_14', '<14');
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, notice_version: undefined }), 400, 'invalid_field', 'versión');
    expectErr(await T('POST', `/me/children/${P.A}/access`, { ...base, notice_version: '0.1' }), 400, 'invalid_field', 'versión vieja');
    expectErr(await as('T2')('POST', `/me/children/${P.B}/access`, { ...base, username: user.B }), 403, 'not_guardian', 'no es su tutor');
  });

  await run('B32 alta: cualquier tutor activa; queda el consentimiento (quién, cuándo, IP, versión) y avisa a los demás tutores', async () => {
    const r = await T('POST', `/me/children/${P.A}/access`, { username: user.A.toUpperCase(), password: pass.A, notice_version: NOTICE_VERSION });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.access, { username: user.A, email: null, can_book: true });
    expectErr(await T('POST', `/me/children/${P.A}/access`, { username: `${user.A}x`, password: pass.A, notice_version: NOTICE_VERSION }),
      409, 'access_exists', 'dos veces');
    expectErr(await T('POST', `/me/children/${P.B}/access`, { username: user.A, password: pass.B, notice_version: NOTICE_VERSION }),
      409, 'username_taken', 'usuario repetido');
    const b = await T('POST', `/me/children/${P.B}/access`,
      { username: user.B, password: pass.B, email: `${tag}-b@test.local`, notice_version: NOTICE_VERSION });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    const [rec] = await q(`SELECT actor_id, created_at, changes FROM audit_log WHERE action = 'notice.minor_access_granted' AND resource_id = $1`, [P.A]);
    assert.equal(rec.actor_id, P.T);
    assert.equal(rec.changes.notice_version, NOTICE_VERSION);
    assert.match(rec.changes.ip, /127\.0\.0\.1/);
    assert.equal(await deliveries('notice.minor_access_granted', P.T2), 1, 'aviso al otro tutor');
    assert.equal(await deliveries('notice.minor_access_granted', P.T), 0, 'no al que lo hace');
    const kids = (await T('GET', '/me/children')).body.children;
    assert.deepEqual(kids.find((k) => k.id === P.A).access, { username: user.A, email: null, can_book: true });
  });

  await run('B32 login por usuario (sin distinguir mayúsculas) y por email desde 14; sesión de 7 días', async () => {
    const a = await login(user.A.toUpperCase(), pass.A);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    tok.A = a.body.token;
    assert.equal(life(tok.A), 7 * 86400, 'el menor, 7 días aunque cambie JWT_EXPIRES_IN');
    assert.equal(life((await login(`${tag}-t@test.local`, 'tutor-1234')).body.token), 3600, 'el adulto, JWT_EXPIRES_IN (1h en el test)');
    const b = await login(`${tag}-b@test.local`, pass.B);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    tok.B = b.body.token;
    assert.equal((await login(user.B, pass.B)).status, 200);
    assert.equal((await login(user.A, 'mala-1234')).status, 401);
  });

  await run('B32 /me del menor: minor { can_book, can_publish } y usuario; el adulto, minor null', async () => {
    const a = (await as('A')('GET', '/me')).body;
    assert.equal(a.username, user.A);
    assert.deepEqual(a.minor, { can_book: true, can_publish: false });
    assert.deepEqual((await as('B')('GET', '/me')).body.minor, { can_book: true, can_publish: true });
    assert.equal((await T('GET', '/me')).body.minor, null);
  });

  await run('B32 matriz: lo bloqueado → 403 minor_restricted, también con el profile_id del hermano', async () => {
    const A = as('A');
    const other = crypto.randomUUID();
    const blocked = [
      ['POST', '/billing/checkout', { plan_id: plan }], ['POST', '/billing/checkout', { plan_id: plan, profile_id: P.B }],
      ['GET', '/billing/subscription'], ['GET', `/billing/subscription?profile_id=${P.B}`],
      ['POST', '/billing/pause', { months: 1 }], ['POST', '/billing/pause', { months: 1, profile_id: P.B }], ['DELETE', '/billing/pause'],
      ['POST', '/billing/portal'], ['POST', `/billing/subscriptions/${sub.A}/plan`, { plan_id: plan }],
      ['DELETE', `/billing/subscriptions/${sub.A}/plan/scheduled`], ['POST', `/billing/subscriptions/${sub.B}/disciplines`, { from_id: 1, to_id: 2 }],
      ['GET', `/billing/payer-changes/${other}`], ['POST', `/billing/payer-changes/${other}/checkout`],
      ['GET', '/me/health'], ['GET', `/me/health?profile_id=${P.B}`],
      ['POST', '/me/health', { allergies: 'x' }], ['POST', '/me/health', { profile_id: P.B, allergies: 'x' }],
      ['POST', '/me/agreements', { type: 'data_protection', version: V }],
      ['POST', '/me/agreements', { type: 'data_protection', version: V, profile_id: P.B }],
      ['PATCH', '/me', { display_name: 'otro' }], ['PATCH', '/me', { birth_date: '2000-01-01' }],
      ['PATCH', '/me', { email: `${tag}-a@test.local` }],
      ['GET', '/me/children'], ['POST', '/me/children', { display_name: 'x', birth_date: yearsAgo(2) }],
      ['PATCH', `/me/children/${P.B}`, { display_name: 'x' }],
      ['POST', `/me/children/${P.B}/access`, { username: 'xyz', password: 'x', notice_version: NOTICE_VERSION }],
      ['PATCH', `/me/children/${P.B}/access`, { can_book: false }], ['DELETE', `/me/children/${P.B}/access`],
      ['PATCH', `/me/children/${P.B}/profile`, { is_public: true }],
      ['PATCH', '/me/profile', { is_public: true }], ['PATCH', '/me/profile', { visible_fields: { ranking: true } }],
      ['POST', `/events/${E.paid}/registrations`],
    ];
    for (const [method, url, body] of blocked) expectErr(await A(method, url, body), 403, 'minor_restricted', `${method} ${url}`);
    // /me cerrado por defecto: toda ruta del router que no esté en la lista blanca da minor_restricted (también una nueva).
    const { default: meRouter } = await import('../src/routes/me.js');
    const ALLOWED = ['GET /', 'GET /profile-status', 'GET /profile', 'PATCH /profile', 'GET /progress', 'POST /progress/seen',
      'POST /push-subscriptions', 'DELETE /push-subscriptions', 'POST /password', 'PUT /avatar', 'DELETE /avatar'];
    const routes = meRouter.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods)
      .map((m) => `${m.toUpperCase()} ${l.route.path}`));
    assert.ok(ALLOWED.every((r) => routes.includes(r)), 'la lista blanca existe');
    for (const r of routes.filter((x) => !ALLOWED.includes(x))) {
      const [method, path] = r.split(' ');
      expectErr(await A(method, `/me${path.replace(':id', P.B)}`, method === 'GET' ? undefined : {}), 403, 'minor_restricted', `/me ${r}`);
    }
    // Solo para adultos por rol: el menor es alumno.
    expectErr(await A('GET', '/admin/profiles'), 403, 'insufficient_role', 'admin');
    expectErr(await A('GET', '/professor/sessions'), 403, 'insufficient_role', 'profesor');
  });

  await run('B32 matriz: lo permitido funciona; con el profile_id del hermano, el 403 de siempre', async () => {
    const A = as('A');
    for (const url of ['/me', '/me/profile', '/me/progress', '/me/profile-status', `/sessions/calendar`, '/disciplines',
      '/plans', '/profiles', `/rankings/${D}`, '/events', `/events/${E.free}`, '/bookings']) {
      const r = await A('GET', url);
      assert.equal(r.status, 200, `GET ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    for (const url of [`/me/progress?profile_id=${P.B}`, `/me/profile-status?profile_id=${P.B}`, `/sessions/calendar?profile_id=${P.B}`]) {
      expectErr(await A('GET', url), 403, 'not_guardian', url);
    }
    assert.deepEqual((await A('GET', `/bookings?profile_id=${P.B}`)).body.bookings, []);
    expectErr(await A('POST', '/bookings', { session_id: S.one, profile_id: P.B }), 403, 'not_guardian', 'reservar por el hermano');
    expectErr(await A('POST', `/events/${E.free}/registrations`, { profile_id: P.B }), 403, 'not_guardian', 'inscribir al hermano');
    expectErr(await app.http('PUT', `/me/avatar?profile_id=${P.B}`, { token: tok.A, body: PNG, type: 'image/png' }),
      403, 'not_guardian', 'foto del hermano');

    const b = await A('POST', '/bookings', { session_id: S.one });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal(b.body.booking.booked_by, P.A, 'actor y sujeto');
    assert.equal((await A('POST', `/bookings/${b.body.booking.id}/cancel`)).status, 200);
    assert.equal((await A('POST', '/bookings', { session_id: S.now })).status, 201);
    const ci = await A('POST', '/checkin', { code: qrCode(qrStep(30)) });
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
    assert.equal(ci.body.status, 'checked_in');
    const reg = await A('POST', `/events/${E.free}/registrations`);
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal((await A('DELETE', `/events/registrations/${reg.body.registration.id}`)).status, 204);
    assert.equal((await A('PATCH', '/me/profile', { bio: 'hola' })).status, 200, 'su bio sí');
    expectErr(await A('PATCH', '/me/profile', { social_links: { web: 'https://example.com' } }), 403, 'minor_restricted',
      'sus redes, por debajo de 14, solo su tutor');
    const links = await T('PATCH', `/me/children/${P.A}/profile`, { social_links: { web: 'https://example.com' } });
    assert.deepEqual([links.status, links.body.social_links], [200, { web: 'https://example.com' }]);
    const push = await A('POST', '/me/push-subscriptions', { endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`,
      keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } });
    assert.equal(push.status, 201, JSON.stringify(push.body));
    const pic = await app.http('PUT', '/me/avatar', { token: tok.A, body: PNG, type: 'image/png' });
    assert.equal(pic.status, 200, JSON.stringify(pic.body));
    avatars.push(pic.body.avatar);
    assert.equal(await deliveries('notice.minor_avatar_changed', P.T), 1, 'aviso de la foto al tutor');
    assert.equal(await deliveries('notice.minor_avatar_changed', P.T2), 1, 'y al otro');
  });

  await run('B32 perfil público: por debajo de 14 lo decide el tutor; desde los 14, también el menor', async () => {
    const pub = await T('PATCH', `/me/children/${P.A}/profile`, { is_public: true, visible_fields: { photo: true, ranking: true } });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.equal(pub.body.is_public, true);
    assert.equal(pub.body.visible_fields.photo, true);
    const card = await T('GET', `/profiles/${P.A}`);
    assert.equal(card.status, 200, JSON.stringify(card.body));
    assert.ok(card.body.profile.avatar, 'la foto, pública porque el tutor lo ha decidido');
    const b = await as('B')('PATCH', '/me/profile', { is_public: true, visible_fields: { ranking: true } });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.is_public, true);
    expectErr(await as('T2')('PATCH', `/me/children/${P.B}/profile`, { is_public: false }), 403, 'not_guardian', 'no es su tutor');
  });

  await run('B32 GET /me/children trae las redes y can_publish (la edad de consentimiento, en SQL)', async () => {
    const kids = (await T('GET', '/me/children')).body.children;
    const a = kids.find((k) => k.id === P.A);
    const b = kids.find((k) => k.id === P.B);
    assert.deepEqual(a.social_links, { web: 'https://example.com' });
    assert.equal(a.can_publish, false, 'por debajo de 14');
    assert.equal(b.social_links, null);
    assert.equal(b.can_publish, true, 'desde los 14');
  });

  await run('B32 sin permiso de reservar: el menor no reserva, cancela ni se inscribe; el tutor sí', async () => {
    const off = await T('PATCH', `/me/children/${P.A}/access`, { can_book: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.body.access.can_book, false);
    assert.equal(await deliveries('notice.minor_access_changed', P.T2), 1, 'aviso al otro tutor');
    const A = as('A');
    assert.deepEqual((await A('GET', '/me')).body.minor, { can_book: false, can_publish: false });
    expectErr(await A('POST', '/bookings', { session_id: S.two }), 403, 'minor_restricted', 'reservar');
    const byTutor = await T('POST', '/bookings', { session_id: S.two, profile_id: P.A });
    assert.equal(byTutor.status, 201, JSON.stringify(byTutor.body));
    expectErr(await A('POST', `/bookings/${byTutor.body.booking.id}/cancel`), 403, 'minor_restricted', 'cancelar');
    expectErr(await A('POST', `/events/${E.free}/registrations`), 403, 'minor_restricted', 'inscribirse');
    const reg = await T('POST', `/events/${E.free}/registrations`, { profile_id: P.A });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    expectErr(await A('DELETE', `/events/registrations/${reg.body.registration.id}`), 403, 'minor_restricted', 'baja del evento');
    assert.equal((await T('POST', `/bookings/${byTutor.body.booking.id}/cancel`)).status, 200);
    // Y en SQL (defensa en profundidad): book_session con el menor como actor.
    await assert.rejects(withRls({ uid: P.A, role: 'alumno' }, (c) => c.query(`SELECT book_session($1, $2)`, [S.two, P.A]),
      { commit: false }), { message: 'not_allowed' });
    assert.equal((await T('PATCH', `/me/children/${P.A}/access`, { can_book: true })).status, 200);
  });

  await run('B32 el tutor restablece la contraseña: la sesión abierta del menor cae al momento', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // iat en segundos: un token del mismo segundo seguiría valiendo (ADR 0020)
    const r = await T('PATCH', `/me/children/${P.B}/access`, { password: 'nueva-12345' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    expectErr(await as('B')('GET', '/me'), 401, 'session_revoked', 'sesión vieja');
    assert.equal((await login(user.B, pass.B)).status, 401);
    const again = await login(user.B, 'nueva-12345');
    assert.equal(again.status, 200);
    tok.B = again.body.token;
    expectErr(await T('PATCH', `/me/children/${P.A}/access`, { email: `${tag}-a@test.local` }), 400, 'email_requires_14', 'email <14');
  });

  await run('B32 el menor cambia su propia contraseña con la sesión iniciada', async () => {
    const r = await as('A')('POST', '/me/password', { current_password: pass.A, new_password: 'propia-1234' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tok.A = r.body.token;
    assert.equal(life(tok.A), 7 * 86400, 'el token nuevo, también de 7 días');
    pass.A = 'propia-1234';
    const [n] = await q(`SELECT changes FROM audit_log WHERE action = 'notice.minor_access_changed' AND actor_id = $1`, [P.A]);
    assert.deepEqual(n?.changes.fields, ['own_password'], 'aviso a los tutores');
    assert.equal(await deliveries('notice.minor_access_changed', P.T), 1, 'al tutor (los cambios anteriores los hizo él)');
  });

  await run('B32 revocar invalida la sesión abierta al momento, borra sus dispositivos y avisa a los demás tutores', async () => {
    assert.equal((await T('DELETE', `/me/children/${P.A}/access`)).status, 204);
    expectErr(await as('A')('GET', '/me'), 401, 'session_revoked', 'token tras revocar');
    expectErr(await login(user.A, pass.A), 401, 'invalid_credentials', 'login tras revocar');
    expectErr(await T('DELETE', `/me/children/${P.A}/access`), 404, 'access_not_found', 'ya revocado');
    assert.equal((await q(`SELECT 1 FROM push_subscriptions WHERE profile_id = $1`, [P.A])).length, 0);
    assert.equal(await deliveries('notice.minor_access_revoked', P.T2), 1);
    assert.equal((await T('GET', '/me/children')).body.children.find((k) => k.id === P.A).access, null);
    // Un token firmado a mano para un hijo sin credenciales tampoco vale.
    expectErr(await app.http('GET', '/me', { token: signToken({ sub: P.A, role: 'alumno' }) }), 401, 'session_revoked', 'a mano');
  });

  await run('B32 a los 18 con acceso: reclama sin invitación (email, acuerdos y ficha) y conserva su historial', async () => {
    await q(`UPDATE profiles SET birth_date = $2 WHERE id = $1`, [P.B, yearsAgo(18.01)]);
    const B = as('B');
    assert.equal((await B('GET', '/me')).body.minor, null);
    let st = (await B('GET', '/me/profile-status')).body;
    assert.deepEqual(st.missing, ['health_info', 'data_protection', 'rights_of_image']);
    await q(`UPDATE auth_credentials SET email = NULL WHERE profile_id = $1`, [P.B]);
    assert.deepEqual((await B('GET', '/me/profile-status')).body.missing,
      ['health_info', 'data_protection', 'rights_of_image', 'email']);
    assert.equal((await B('PATCH', '/me', { email: `${tag}-b18@test.local` })).status, 200);
    expectErr(await B('PATCH', '/me', { email: `${tag}-otro@test.local` }), 409, 'email_already_set', 'segunda vez');
    for (const type of TYPES) assert.equal((await B('POST', '/me/agreements', { type, version: V })).status, 200);
    assert.equal((await B('GET', '/me/health')).body.health.allergies, 'polen', 'lee la ficha que hizo su tutor');
    assert.equal((await B('POST', '/me/health', { allergies: 'polen' })).status, 200);
    st = (await B('GET', '/me/profile-status')).body;
    assert.deepEqual(st, { ok: true });
    assert.equal((await login(`${tag}-b18@test.local`, 'nueva-12345')).status, 200);
    assert.equal((await q(`SELECT 1 FROM subscriptions WHERE student_id = $1`, [P.B])).length, 1, 'su suscripción sigue');
  });
}

// PNG mínimo (la firma basta para storeAvatar).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);

try {
  await withRls({ uid: admin, role: 'admin' }, async (c) => {
    // Versiones de prueba vigentes (el ROLLBACK final las descarta), únicas: no chocan con documentos ya subidos.
    const V = `9.${Date.now() % 1e9}`;
    for (const type of TYPES) {
      const d = await createDocument(c, { type, version: V, buffer: Buffer.from(`%PDF-1.4 ${type}`) });
      files.push(`${d.id}.pdf`);
      await publishDocument(c, { id: d.id, actorId: admin });
    }
    const sign = (type, profileId, signedBy) =>
      signAgreement(c, { profileId, signedBy, type, version: V });

    let hijo;
    await run('el tutor crea un hijo: perfil + alumno + vínculo, sin credenciales', async () => {
      await as(c, tutor, 'alumno');
      hijo = (await createChild(c, { displayName: 'hijo-t', birthDate: yearsAgo(8) })).id;
      await as(c, admin, 'admin');
      const { rows: [r] } = await c.query(
        `SELECT (SELECT array_agg(role::text) FROM user_roles WHERE user_id = $1) AS roles,
                EXISTS (SELECT 1 FROM guardianships WHERE tutor_id = $2 AND minor_id = $1) AS linked,
                EXISTS (SELECT 1 FROM auth_credentials WHERE profile_id = $1) AS creds`,
        [hijo, tutor]
      );
      assert.deepEqual(r, { roles: ['alumno'], linked: true, creds: false });
    });
    await run('un adulto no puede ser dado de alta como hijo', async () => {
      await as(c, tutor, 'alumno');
      await fails(c, () => createChild(c, { displayName: 'x', birthDate: yearsAgo(20) }), 'child_must_be_minor');
    });
    await run('un menor no puede crear hijos', async () => {
      await as(c, nino, 'alumno');
      await fails(c, () => createChild(c, { displayName: 'x', birthDate: yearsAgo(2) }), 'minor_cannot_create_child');
    });
    await run('create_child no permite vincularse a un perfil existente', async () => {
      await as(c, tutor, 'alumno');
      await fails(c, () => c.query(`SELECT create_child($1,'x',$2)`, [nino, yearsAgo(5)]), '23505');
      await as(c, admin, 'admin');
      const { rowCount } = await c.query(`SELECT 1 FROM guardianships WHERE minor_id = $1`, [nino]);
      assert.equal(rowCount, 0);
    });
    await run('el tutor no puede insertar vínculos a mano', async () => {
      await as(c, tutor, 'alumno');
      await denied(c, () => c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1,$2)`, [tutor, nino]));
    });
    await run('el tutor lee y escribe la salud del hijo; otro adulto no', async () => {
      await as(c, tutor, 'alumno');
      await upsertHealthInfo(c, hijo, { emergency_contact_name: 'x', emergency_contact_phone: '1' });
      await upsertHealthInfo(c, hijo, { allergies: 'polen' });
      const { rows } = await c.query(`SELECT allergies FROM student_health_info WHERE profile_id = $1`, [hijo]);
      assert.equal(rows[0].allergies, 'polen');
      await as(c, otro, 'alumno');
      assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id = $1`, [hijo])).rowCount, 0);
      await denied(c, () => upsertHealthInfo(c, hijo, { allergies: 'x' }));
    });
    await run('el tutor edita el perfil del hijo pero no puede hacerlo adulto; otro no lo edita', async () => {
      await as(c, tutor, 'alumno');
      assert.equal((await updateChild(c, hijo, { display_name: 'hijo-2' })).display_name, 'hijo-2');
      await fails(c, () => updateChild(c, hijo, { birth_date: yearsAgo(19) }), 'child_must_be_minor');
      await as(c, otro, 'alumno');
      await fails(c, () => updateChild(c, hijo, { display_name: 'x' }), 'child_not_found');
    });
    await run('el hijo no puede firmar por sí mismo (defensa en profundidad)', async () => {
      await as(c, hijo, 'alumno');
      await denied(c, () => sign('data_protection', hijo, hijo));
    });
    await run('tutor no vinculado no puede firmar por el hijo', async () => {
      await as(c, otro, 'alumno');
      await denied(c, () => sign('data_protection', hijo, otro));
    });
    await run('tutor no puede suplantar signed_by', async () => {
      await as(c, tutor, 'alumno');
      await denied(c, () => sign('data_protection', hijo, otro));
    });
    await run('perfil del hijo incompleto hasta que el tutor firma los acuerdos', async () => {
      await as(c, tutor, 'alumno');
      assert.deepEqual(await getProfileStatus(c, hijo, 'alumno'),
        { ok: false, missing: ['data_protection', 'rights_of_image'] });
      const a = await sign('data_protection', hijo, tutor);
      assert.equal(a.signed_by, tutor);
      assert.equal(a.profile_id, hijo);
      await sign('rights_of_image', hijo, tutor);
      assert.deepEqual(await getProfileStatus(c, hijo, 'alumno'), { ok: true });
    });
    await run('a los 18: firmas del tutor no cuentan; sin edición, salud ni firma; sigue en la lista', async () => {
      await as(c, admin, 'admin');
      await c.query(`UPDATE profiles SET birth_date = $2 WHERE id = $1`, [hijo, yearsAgo(19)]);
      assert.deepEqual(await getProfileStatus(c, hijo, 'alumno'),
        { ok: false, missing: ['data_protection', 'rights_of_image'] });
      await as(c, tutor, 'alumno');
      await denied(c, () => sign('data_protection', hijo, tutor));
      await fails(c, () => assertGuardianOf(c, hijo), 'not_guardian');
      await fails(c, () => updateChild(c, hijo, { display_name: 'x' }), 'child_not_found');
      assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id = $1`, [hijo])).rowCount, 0);
      const [listed] = await listChildren(c, tutor);
      assert.equal(listed.id, hijo);
      assert.equal(listed.pending_claim, true);
    });
    await run('rol tutor: completo con display_name + su data_protection', async () => {
      await as(c, tutor, 'tutor');
      assert.deepEqual(await getProfileStatus(c, tutor, 'tutor'), { ok: false, missing: ['data_protection'] });
      await sign('data_protection', tutor, tutor);
      assert.deepEqual(await getProfileStatus(c, tutor, 'tutor'), { ok: true });
    });
  }, { commit: false });

  await matrix();

  await run('un menor no puede registrarse', async () => {
    await assert.rejects(
      registerLocal({ email: 'x@x.x', password: '12345678', birthDate: yearsAgo(17) }),
      { code: 'minor_cannot_register' }
    );
  });
} finally {
  await close?.();
  const { deleteAvatarFile } = await import('../src/services/avatar.js');
  await Promise.all(avatars.map(deleteAvatarFile));
  await Promise.all(files.map(deleteFile));
  await closePools();
}
process.exit(failed ? 1 : 0);
