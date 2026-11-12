// B19.0: usuarios y roles del panel (GET /admin/profiles[/:id], PUT …/role, POST/DELETE …/guardians) y el rol de la
// base en requireAuth. B19.1: las lecturas del panel (ajustes, auditoría, avisos, entregas, cambios de pagador, detalle de
// sesión y PDF de un documento). Como app_user por HTTP con un express en memoria y JWT firmados (como test:account).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

await import('dotenv/config');
const { servicePool, closePools } = await import('../src/config/database.js');
const { signToken } = await import('../src/services/jwt.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: authRouter } = await import('../src/routes/auth.js');
const { default: adminProfilesRouter } = await import('../src/routes/admin/profiles.js');
const { default: professorRouter } = await import('../src/routes/professor.js');
const { default: panelRouter } = await import('../src/routes/admin/panel.js');
const { default: adminBillingRouter } = await import('../src/routes/admin/billing.js');
const { default: adminCheckinRouter } = await import('../src/routes/admin/checkin.js');
const { default: adminSessionsRouter } = await import('../src/routes/admin/sessions.js');
const { default: adminAgreementsRouter } = await import('../src/routes/admin/agreements.js');
const { withRls } = await import('../src/db/rls.js');
const OTPAuth = await import('otpauth');
const { encrypt } = await import('../src/services/crypto.js');
const { MFA_TOTP_ISSUER } = await import('../src/config/mfa.js');
const { notice } = await import('../src/services/notices.js');
const { createDocument } = await import('../src/services/agreements.js');
const { deleteFile } = await import('../src/services/storage.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);

const tag = `tadm${crypto.randomBytes(3).toString('hex')}`;
// [rol en user_roles (null = sin fila), fecha de nacimiento, con credenciales]
const people = {
  admin: ['admin', null, true], stu: ['alumno', yearsAgo(30), true], stu2: ['alumno', yearsAgo(25), true],
  prof: ['profesor', null, true], prof2: ['profesor', null, true], parent: ['alumno', yearsAgo(40), true],
  tutor2: ['tutor', yearsAgo(42), true], child: ['alumno', yearsAgo(10), false], child2: ['alumno', yearsAgo(8), false],
  grown: ['alumno', yearsAgo(19), false], norole: [null, yearsAgo(35), true], newadmin: ['alumno', yearsAgo(33), true],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
const email = (k) => `${tag}-${k}@test.local`;
for (const [k, [role, birth, creds]] of Object.entries(people)) {
  await servicePool.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [U[k], `${tag}-${k}`, birth]);
  if (role) await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (creds) {
    await servicePool.query(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`,
      [U[k], email(k)]);
  }
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3), ($1, $4)`,
  [U.parent, U.child, U.child2, U.grown]);
await servicePool.query(`INSERT INTO student_health_info (profile_id, injuries, allergies) VALUES ($1, 'rodilla', 'polen')`,
  [U.child]);

// stu se paga su cuota; el padre paga la del hijo. prof tiene una sesión futura.
const disc = (await servicePool.query(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [tag])).rows[0].id;
const plan = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, 1) RETURNING id`, [tag])).rows[0].id;
const subs = [];
for (const [student, payer] of [[U.stu, U.stu], [U.child, U.parent]]) {
  const id = crypto.randomUUID();
  subs.push(id);
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [id, student, payer, plan, `sub_test_${id}`]);
}
const session = (await servicePool.query(
  `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, location, status)
   VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 60 min', 60, 10, 'tatami 1', 'scheduled')
   RETURNING id`, [disc, U.prof])).rows[0].id;

const app = express().use(express.json()).use('/auth', authRouter).use('/admin', adminProfilesRouter)
  .use('/professor', professorRouter).use('/admin/agreements', adminAgreementsRouter)
  .use('/admin', panelRouter, adminBillingRouter, adminCheckinRouter, adminSessionsRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
// Token firmado con el rol que se pasa (por defecto el de la fixture): la API debe usar el de la base.
const tokens = {};
const tokenOf = (who, role = people[who][0] ?? 'alumno') => (tokens[`${who}:${role}`] ??= signToken({ sub: U[who], role }));
const http = async (method, url, who, body, role) => {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${tokenOf(who, role)}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const code = (r) => r.body?.code;
const expectError = (r, status, c) => assert.deepEqual([r.status, code(r)], [status, c]);
const lastAudit = async (action, id) => (await servicePool.query(
  `SELECT actor_id, resource_type, changes FROM audit_log WHERE action = $1 AND resource_id = $2
    ORDER BY created_at DESC LIMIT 1`, [action, id])).rows[0];
const rawGet = async (url, who) => {
  const res = await fetch(base + url, { headers: { authorization: `Bearer ${tokenOf(who)}` } });
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};
const audits = []; // ids de audit_log creados por los tests de B19.1 (su actor puede no ser el admin)
const documents = []; // [{ id, file }]
const realError = console.error;

try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));
  await run('lista: búsqueda por nombre, sin distinguir mayúsculas, por nombre', async () => {
    const r = await http('GET', `/admin/profiles?q=${tag.toUpperCase()}&limit=100`, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, ids.length);
    const names = r.body.profiles.map((p) => p.display_name);
    assert.deepEqual(names, [...names].sort());
  });
  await run('lista: búsqueda por email, filtro por rol y paginación', async () => {
    const byEmail = await http('GET', `/admin/profiles?q=${encodeURIComponent(email('tutor2'))}`, 'admin');
    assert.deepEqual(byEmail.body.profiles.map((p) => p.id), [U.tutor2]);
    const profs = await http('GET', `/admin/profiles?q=${tag}&role=profesor`, 'admin');
    assert.deepEqual(profs.body.profiles.map((p) => p.id).sort(), [U.prof, U.prof2].sort());
    const page = await http('GET', `/admin/profiles?q=${tag}&limit=2&offset=2`, 'admin');
    assert.deepEqual([page.body.profiles.length, page.body.total, page.body.limit, page.body.offset], [2, ids.length, 2, 2]);
    expectError(await http('GET', '/admin/profiles?role=jefe', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/profiles?limit=0', 'admin'), 400, 'invalid_pagination');
  });
  await run('lista: un hijo sin email, menor; el de 18 sin reclamar; cuota viva', async () => {
    const { profiles } = (await http('GET', `/admin/profiles?q=${tag}&limit=100`, 'admin')).body;
    const by = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const pick = (p) => [p.email, p.role, p.is_minor, p.pending_claim, p.subscription_status];
    assert.deepEqual(pick(by[U.child]), [null, 'alumno', true, false, 'active']);
    assert.deepEqual(pick(by[U.grown]), [null, 'alumno', false, true, null]);
    assert.deepEqual(pick(by[U.norole]), [email('norole'), 'alumno', false, false, null]);
    for (const p of profiles) assert.ok(!('birth_date' in p));
  });
  await run('ficha: el hijo con su pagador, sus tutores y su estado; sin birth_date ni salud', async () => {
    const r = await http('GET', `/admin/profiles/${U.child}`, 'admin');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['children', 'guardians', 'profile', 'status', 'subscription']);
    assert.equal(r.body.subscription.id, subs[1]);
    assert.deepEqual(r.body.subscription.payer, { id: U.parent, display_name: `${tag}-parent` });
    assert.deepEqual(r.body.guardians, [{ id: U.parent, display_name: `${tag}-parent`, email: email('parent') }]);
    assert.equal(typeof r.body.status.ok, 'boolean');
    const json = JSON.stringify(r.body);
    for (const k of ['birth_date', 'injuries', 'allergies', 'rodilla', 'polen', 'emergency_contact_name']) {
      assert.ok(!json.includes(k), `la ficha incluye ${k}`);
    }
    assert.deepEqual(Object.keys(r.body.profile).sort(), ['avatar', 'can_create_children', 'created_at', 'display_name', 'email', 'has_google',
      'has_password', 'id', 'is_minor', 'is_public', 'pending_claim', 'role']);
  });
  await run('ficha: el padre con sus hijos; status solo de un alumno; 404', async () => {
    const parent = (await http('GET', `/admin/profiles/${U.parent}`, 'admin')).body;
    assert.deepEqual(parent.children.map((c) => c.id).sort(), [U.child, U.child2, U.grown].sort());
    assert.equal(parent.children.find((c) => c.id === U.grown).pending_claim, true);
    assert.equal(parent.subscription, null);
    assert.equal((await http('GET', `/admin/profiles/${U.tutor2}`, 'admin')).body.status, null);
    expectError(await http('GET', `/admin/profiles/${crypto.randomUUID()}`, 'admin'), 404, 'profile_not_found');
    expectError(await http('GET', '/admin/profiles/nope', 'admin'), 400, 'invalid_id');
  });
  await run('rol: errores', async () => {
    const put = (who, role) => http('PUT', `/admin/profiles/${U[who]}/role`, 'admin', { role });
    expectError(await put('stu2', 'root'), 400, 'invalid_field');
    expectError(await put('stu2', 'admin'), 403, 'mfa_required'); // el admin del test no tiene doble factor
    expectError(await put('stu2', undefined), 400, 'invalid_field');
    expectError(await http('PUT', `/admin/profiles/${crypto.randomUUID()}/role`, 'admin', { role: 'tutor' }), 404,
      'profile_not_found');
    expectError(await put('stu2', 'alumno'), 409, 'same_role');
    expectError(await put('admin', 'alumno'), 409, 'admin_role_locked');
    expectError(await put('child', 'tutor'), 409, 'child_role_locked');
    expectError(await put('prof', 'alumno'), 409, 'trainer_has_sessions');
    expectError(await put('stu', 'profesor'), 409, 'student_has_subscription');
    expectError(await put('stu', 'tutor'), 409, 'student_has_subscription');
    assert.equal(await lastAudit('profile.role_change', U.stu), undefined);
  });
  await run('rol: un profesor degradado pierde /professor con el mismo token; queda en audit_log', async () => {
    assert.equal((await http('GET', '/professor/reports/sessions?by=discipline', 'prof2')).status, 200);
    const r = await http('PUT', `/admin/profiles/${U.prof2}/role`, 'admin', { role: 'alumno' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.profile.id, r.body.profile.role], [U.prof2, 'alumno']);
    expectError(await http('GET', '/professor/reports/sessions?by=discipline', 'prof2'), 403, 'insufficient_role');
    assert.equal((await http('GET', '/auth/me', 'prof2')).body.user.role, 'alumno');
    assert.deepEqual(await lastAudit('profile.role_change', U.prof2),
      { actor_id: U.admin, resource_type: 'profile', changes: { from: 'profesor', to: 'alumno' } });
  });
  await run('rol: un alumno ascendido entra en /professor con el mismo token', async () => {
    expectError(await http('GET', '/professor/sessions', 'stu2'), 403, 'insufficient_role');
    assert.equal((await http('PUT', `/admin/profiles/${U.stu2}/role`, 'admin', { role: 'profesor' })).status, 200);
    assert.equal((await http('GET', '/professor/sessions', 'stu2')).status, 200);
  });
  await run('rol: sin fila en user_roles actúa como alumno aunque el token diga admin', async () => {
    assert.equal((await http('GET', '/auth/me', 'norole', undefined, 'admin')).body.user.role, 'alumno');
    expectError(await http('GET', '/admin/profiles', 'norole', undefined, 'admin'), 403, 'insufficient_role');
    // Y se le puede dar un rol: la fila se crea.
    assert.equal((await http('PUT', `/admin/profiles/${U.norole}/role`, 'admin', { role: 'tutor' })).body.profile.role,
      'tutor');
  });
  // B20 (B3): un admin con el doble factor activado da el rol admin, confirmándolo con su código; quitarlo, no.
  // La sesión tiene que haber entrado con el doble factor (amr en el token, /auth/mfa/verify): activarlo a media sesión
  // con un token robado no basta. Y 10 intentos de dar admin cada 15 min por IP, para no adivinar el código.
  await run('rol admin: solo un admin que entró con doble factor y su código; desde la app no se quita', async () => {
    const mfaToken = signToken({ sub: U.admin, role: 'admin', mfa: true });
    const put = async (who, body, token = mfaToken) => {
      const res = await fetch(`${base}/admin/profiles/${U[who]}/role`, { method: 'PUT', body: JSON.stringify({ role: 'admin', ...body }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json() };
    };
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: MFA_TOTP_ISSUER, label: U.admin, algorithm: 'SHA1', digits: 6, period: 30, secret });
    await servicePool.query(`INSERT INTO user_mfa (id, user_id, totp_secret_encrypted, recovery_codes_encrypted, mfa_enabled)
                             VALUES ($1, $2, $3, $4, true)`, [crypto.randomUUID(), U.admin, encrypt(secret.base32), encrypt('[]')]);
    try {
      // Con el doble factor activado pero un token sin amr (entró antes de activarlo): no.
      expectError(await put('newadmin', { mfa_code: totp.generate() }, tokenOf('admin')), 403, 'mfa_login_required');
      expectError(await put('newadmin', {}), 403, 'invalid_mfa_code');
      expectError(await put('newadmin', { mfa_code: totp.generate() === '000000' ? '111111' : '000000' }), 403, 'invalid_mfa_code');
      assert.equal(await lastAudit('profile.role_change', U.newadmin), undefined);
      const r = await put('newadmin', { mfa_code: totp.generate() });
      assert.deepEqual([r.status, r.body.profile.role], [200, 'admin']);
      assert.deepEqual(await lastAudit('profile.role_change', U.newadmin),
        { actor_id: U.admin, resource_type: 'profile', changes: { from: 'alumno', to: 'admin' } });
      expectError(await http('PUT', `/admin/profiles/${U.newadmin}/role`, 'admin', { role: 'alumno' }), 409, 'admin_role_locked');
      let limited;
      for (let i = 0; i < 12 && !limited; i++) {
        const res = await put('stu2', { mfa_code: 'xxxxxx' });
        if (res.status === 429) limited = res;
        else expectError(res, 403, 'invalid_mfa_code');
      }
      assert.equal(limited?.body.code, 'rate_limited');
    } finally {
      await servicePool.query(`DELETE FROM user_mfa WHERE user_id = $1`, [U.admin]);
    }
  });
  await run('alumno y profesor → 403', async () => {
    expectError(await http('GET', '/admin/profiles', 'stu'), 403, 'insufficient_role');
    expectError(await http('GET', '/admin/profiles', 'prof'), 403, 'insufficient_role');
    expectError(await http('GET', '/admin/profiles', 'stu2', undefined, 'admin'), 403, 'insufficient_role');
  });
  await run('tutores: errores al vincular', async () => {
    const post = (who, tutor) => http('POST', `/admin/profiles/${U[who]}/guardians`, 'admin', { tutor_id: tutor });
    expectError(await post('child', 'nope'), 400, 'invalid_field');
    expectError(await http('POST', `/admin/profiles/${crypto.randomUUID()}/guardians`, 'admin', { tutor_id: U.tutor2 }),
      404, 'profile_not_found');
    expectError(await post('stu', U.tutor2), 409, 'not_a_child');
    expectError(await post('child', U.child2), 409, 'invalid_guardian');
    expectError(await post('child', crypto.randomUUID()), 409, 'invalid_guardian');
    expectError(await post('child', U.parent), 409, 'already_guardian');
  });
  await run('tutores: vincular y desvincular, con su audit_log', async () => {
    const r = await http('POST', `/admin/profiles/${U.child}/guardians`, 'admin', { tutor_id: U.tutor2 });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.guardians.map((g) => g.id).sort(), [U.parent, U.tutor2].sort());
    assert.deepEqual(await lastAudit('guardian.add', U.child),
      { actor_id: U.admin, resource_type: 'guardian', changes: { tutor_id: U.tutor2 } });
    const del = (who, tutor) => http('DELETE', `/admin/profiles/${U[who]}/guardians/${tutor}`, 'admin');
    expectError(await del('child', U.parent), 409, 'guardian_is_payer');
    expectError(await del('child2', U.parent), 409, 'last_guardian');
    expectError(await del('child', U.stu), 404, 'profile_not_found');
    expectError(await del('stu', U.parent), 409, 'not_a_child');
    assert.equal((await del('child', U.tutor2)).status, 204);
    assert.deepEqual(await lastAudit('guardian.remove', U.child),
      { actor_id: U.admin, resource_type: 'guardian', changes: { tutor_id: U.tutor2 } });
    const rows = (await servicePool.query(`SELECT tutor_id FROM guardianships WHERE minor_id = $1`, [U.child])).rows;
    assert.deepEqual(rows, [{ tutor_id: U.parent }]);
  });
  // ── B19.1: lecturas del panel ──────────────────────────────────────────────
  await run('ajustes: GET igual a lo que devuelven los PUT, y ve un cambio', async () => {
    const get = async () => (await http('GET', '/admin/settings', 'admin')).body;
    const before = await get();
    assert.deepEqual(Object.keys(before).sort(), ['checkin', 'discipline_changes', 'pause']);
    assert.deepEqual(Object.keys(before.checkin).sort(), ['closes_minutes', 'opens_minutes', 'qr_seconds']);
    // Sin cambiar nada: los PUT devuelven lo mismo.
    assert.deepEqual((await http('PUT', '/admin/settings/checkin', 'admin', {})).body.settings, before.checkin);
    assert.deepEqual((await http('PUT', '/admin/settings/pause', 'admin', {})).body.settings, before.pause); // B30
    const put = (n) => http('PUT', '/admin/settings/discipline-changes', 'admin', { per_period: n });
    assert.deepEqual((await put(before.discipline_changes.per_period)).body.settings, before.discipline_changes);
    const n = before.discipline_changes.per_period + 1;
    try {
      assert.deepEqual((await put(n)).body.settings, { per_period: n });
      assert.deepEqual((await get()).discipline_changes, { per_period: n });
    } finally {
      await put(before.discipline_changes.per_period);
    }
    assert.deepEqual(await get(), before);
  });

  // Auditoría: acciones propias de la prueba, con fechas fijas, y un aviso (notice.*) que nunca debe salir.
  const A = (s) => `zz${tag}.${s}`;
  const auditRows = [
    [A('one'), U.admin, 'session', `${tag}-s1`, '2020-01-10T12:00:00Z'],
    [A('two'), U.stu, 'session', `${tag}-s2`, '2020-01-20T12:00:00Z'],
    [`yy${tag}.three`, U.admin, 'class', `${tag}-c1`, '2020-02-01T12:00:00Z'],
    [`notice.${tag}_x`, U.admin, 'subscription', `${tag}-n1`, '2020-01-25T12:00:00Z'],
  ];
  for (const [action, actor, type, rid, at] of auditRows) {
    audits.push((await servicePool.query(
      `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id, changes, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, '{"k":1}', $5) RETURNING id`, [actor, action, type, rid, at])).rows[0].id);
  }
  const auditQ = async (q) => {
    const r = await http('GET', `/admin/audit?${q.includes('limit') ? '' : 'limit=100&'}${q}`, 'admin');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const actions = (b) => b.rows.map((r) => r.action);
  await run('auditoría: por prefijos (varios con comas), más nuevo primero, sin notice.*', async () => {
    const one = await auditQ(`action=${A('')}`);
    assert.deepEqual(actions(one), [A('two'), A('one')]);
    assert.equal(one.total, 2);
    assert.deepEqual(Object.keys(one.rows[0]).sort(),
      ['action', 'actor', 'changes', 'created_at', 'id', 'resource_id', 'resource_type']);
    assert.deepEqual(one.rows[0].actor, { id: U.stu, display_name: `${tag}-stu` });
    assert.deepEqual(one.rows[0].changes, { k: 1 });
    assert.deepEqual(actions(await auditQ(`action=${A('')},yy${tag}.`)), [`yy${tag}.three`, A('two'), A('one')]);
    // Un aviso no sale ni por su acción exacta, ni por su prefijo, ni por actor, ni sin filtro.
    assert.deepEqual((await auditQ(`action=notice.`)).rows, []);
    assert.deepEqual((await auditQ(`action=notice.${tag}_x`)).rows, []);
    assert.ok(!actions(await auditQ(`actor_id=${U.admin}`)).includes(`notice.${tag}_x`));
    assert.ok((await auditQ('')).rows.every((r) => !r.action.startsWith('notice.')));
  });
  await run('auditoría: por persona, recurso y fechas', async () => {
    assert.deepEqual(actions(await auditQ(`actor_id=${U.admin}&action=zz${tag},yy${tag}`)), [`yy${tag}.three`, A('one')]);
    assert.deepEqual(actions(await auditQ(`resource_type=class&action=yy${tag}`)), [`yy${tag}.three`]);
    assert.deepEqual(actions(await auditQ(`resource_type=session&resource_id=${tag}-s2`)), [A('two')]);
    assert.deepEqual(actions(await auditQ(`action=${A('')},yy${tag}.&from=2020-01-15&to=2020-01-31`)), [A('two')]);
    assert.deepEqual(actions(await auditQ(`action=${A('')},yy${tag}.&from=2020-01-20`)), [`yy${tag}.three`, A('two')]);
    assert.deepEqual(actions(await auditQ(`action=${A('')},yy${tag}.&to=2020-01-10`)), [A('one')]);
    const page = await auditQ(`action=${A('')},yy${tag}.&limit=1&offset=1`);
    assert.deepEqual([actions(page), page.total, page.limit, page.offset], [[A('two')], 3, 1, 1]);
  });
  await run('auditoría: errores', async () => {
    expectError(await http('GET', '/admin/audit?from=2020-02-01&to=2020-01-01', 'admin'), 400, 'invalid_range');
    expectError(await http('GET', '/admin/audit?from=ayer', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/audit?actor_id=nope', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/audit?action=,', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/audit?limit=101', 'admin'), 400, 'invalid_pagination');
  });

  // Avisos: con notice() de verdad. Uno para el admin y un alumno, otro solo para alumnos.
  const noticeOf = async (action, recipients, rid) => {
    await notice(servicePool, { action, actorId: U.stu, type: 'subscription', resourceId: rid, recipients, student_id: U.stu });
    const { rows: [a] } = await servicePool.query(`SELECT id FROM audit_log WHERE resource_id = $1`, [rid]);
    audits.push(a.id);
    return a.id;
  };
  const nBoth = await noticeOf('notice.payer_change_expired', [U.stu, U.admin], `${tag}-nboth`);
  const nStu = await noticeOf('notice.payment_failed', [U.stu, U.stu2], `${tag}-nstu`);
  const nAdmin = await noticeOf('notice.stripe_risk', [U.admin], `${tag}-nadmin`);
  await run('avisos: solo los que tienen un admin entre sus destinatarios, sin los recipients', async () => {
    const r = await http('GET', '/admin/notices?limit=100', 'admin');
    assert.equal(r.status, 200);
    const mine = r.body.rows.filter((x) => x.resource_id.startsWith(tag));
    assert.deepEqual(mine.map((x) => x.id).sort(), [nBoth, nAdmin].sort());
    const both = mine.find((x) => x.id === nBoth);
    assert.deepEqual(Object.keys(both).sort(), ['action', 'created_at', 'details', 'id', 'resource_id', 'resource_type']);
    assert.deepEqual([both.action, both.resource_type, both.details], ['notice.payer_change_expired', 'subscription', { student_id: U.stu }]);
    assert.ok(r.body.rows.every((x) => x.action.startsWith('notice.') && !('recipients' in x.details)));
    assert.deepEqual(Object.keys(r.body).sort(), ['limit', 'offset', 'rows', 'total']);
    const dates = r.body.rows.map((x) => +new Date(x.created_at));
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
    expectError(await http('GET', '/admin/notices?offset=-1', 'admin'), 400, 'invalid_pagination');
  });

  // Entregas: nBoth → una para stu (el admin nunca recibe); nStu → una para stu y otra para stu2.
  const delivery = async (audit, who) => (await servicePool.query(
    `SELECT id FROM notice_deliveries WHERE audit_id = $1 AND recipient_id = $2`, [audit, U[who]])).rows[0].id;
  const dFailed = await delivery(nBoth, 'stu');
  const dOld = await delivery(nStu, 'stu');
  const dPending = await delivery(nStu, 'stu2');
  await servicePool.query(`UPDATE notice_deliveries SET status = 'failed', attempts = 3, last_error = 'smtp 550' WHERE id = $1`, [dFailed]);
  await servicePool.query(
    `UPDATE notice_deliveries SET status = 'failed', attempts = 1, last_error = 'timeout', created_at = '2020-01-01' WHERE id = $1`, [dOld]);
  await run('entregas: solo las failed, la más nueva primero, y desde from', async () => {
    assert.equal(await servicePool.query(`SELECT 1 FROM notice_deliveries WHERE recipient_id = $1`, [U.admin]).then((r) => r.rowCount), 0);
    const r = await http('GET', '/admin/notice-deliveries?limit=100', 'admin');
    assert.equal(r.status, 200);
    const mine = r.body.rows.filter((x) => [dFailed, dOld, dPending].includes(x.id));
    assert.deepEqual(mine.map((x) => x.id), [dFailed, dOld]);
    assert.deepEqual(mine[0], {
      id: dFailed, created_at: mine[0].created_at, action: 'notice.payer_change_expired', channel: 'email',
      recipient: { id: U.stu, display_name: `${tag}-stu` }, attempts: 3, last_error: 'smtp 550',
    });
    const since = await http('GET', '/admin/notice-deliveries?limit=100&from=2020-06-01', 'admin');
    assert.deepEqual(since.body.rows.filter((x) => [dFailed, dOld, dPending].includes(x.id)).map((x) => x.id), [dFailed]);
    const old = await http('GET', '/admin/notice-deliveries?limit=100&from=2020-01-01', 'admin');
    assert.ok(old.body.total >= since.body.total + 1);
    expectError(await http('GET', '/admin/notice-deliveries?from=x', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/notice-deliveries?limit=0', 'admin'), 400, 'invalid_pagination');
  });
  await run('entregas: un alumno no lee notice_deliveries, ni por la API ni con SQL directo (RLS)', async () => {
    expectError(await http('GET', '/admin/notice-deliveries', 'stu'), 403, 'insufficient_role');
    const count = (uid, role) => withRls({ uid, role }, async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM notice_deliveries`)).rows[0].n);
    assert.equal(await count(U.stu, 'alumno'), 0);
    assert.equal(await count(U.prof, 'profesor'), 0);
    assert.ok((await count(U.admin, 'admin')) >= 2);
    await assert.rejects(withRls({ uid: U.admin, role: 'admin' }, (c) =>
      c.query(`UPDATE notice_deliveries SET status = 'sent' WHERE id = $1`, [dFailed])), { code: '42501' });
  });

  // Cambios de pagador. subs[0]: stu paga su cuota; subs[1]: el padre paga a child; sub2: el padre paga a child2.
  const sub2 = crypto.randomUUID();
  subs.push(sub2);
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5)`, [sub2, U.child2, U.parent, plan, `sub_test_${sub2}`]);
  const payerChanges = [];
  for (const [subscription, student, oldP, newP, status, reason, deadline, updated] of [
    [subs[1], U.child, U.parent, U.tutor2, 'completed', null, '+30 days', '2020-01-01'],
    [subs[1], U.child, U.parent, U.tutor2, 'cancelled', 'admin', '+30 days', '2020-03-01'],
    [subs[1], U.child, U.parent, U.tutor2, 'paid', null, '+30 days', null],
    [sub2, U.child2, U.parent, U.tutor2, 'requested', null, '+30 days', null],
    [subs[0], U.stu, U.stu, U.parent, 'requested', null, '-1 day', null],
  ]) {
    payerChanges.push((await servicePool.query(
      `INSERT INTO payer_changes (subscription_id, student_id, old_payer_id, new_payer_id, plan_id, starts_at, deadline,
                                  status, cancel_reason, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '31 days', now() + $6::interval, $7, $8, $9, COALESCE($10::timestamptz, now()))
       RETURNING id`, [subscription, student, oldP, newP, plan, deadline, status, reason, U.admin, updated])).rows[0].id);
  }
  const [pcDone, pcCancelled, pcPaid, pcRequested, pcLate] = payerChanges;
  await run('cambios de pagador: por estado (varios), con el caducado como expired, y su subscription_id', async () => {
    const q = async (s) => {
      const r = await http('GET', `/admin/payer-changes?limit=100&${s}`, 'admin');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.rows.filter((x) => payerChanges.includes(x.id));
    };
    assert.deepEqual((await q('status=requested,paid')).map((x) => x.id).sort(), [pcPaid, pcRequested].sort());
    assert.deepEqual((await q('status=expired')).map((x) => x.id), [pcLate]);
    assert.deepEqual((await q('status=completed')).map((x) => x.id), [pcDone]);
    assert.deepEqual((await q('status=cancelled')).map((x) => [x.id, x.cancel_reason]), [[pcCancelled, 'admin']]);
    const all = await q('');
    assert.equal(all.length, 5);
    const late = all.find((x) => x.id === pcLate);
    assert.deepEqual(Object.keys(late).sort(), ['cancel_reason', 'deadline', 'id', 'new_payer', 'old_payer', 'plan',
      'starts_at', 'status', 'student', 'subscription_id', 'updated_at']);
    assert.deepEqual([late.status, late.subscription_id, late.student, late.old_payer, late.new_payer, late.plan],
      ['expired', subs[0], { id: U.stu, display_name: `${tag}-stu` }, { id: U.stu, display_name: `${tag}-stu` },
        { id: U.parent, display_name: `${tag}-parent` }, { id: String(plan), name: tag }]);
    // Una suscripción: sus cambios, el más reciente primero.
    assert.deepEqual((await q(`subscription_id=${subs[1]}`)).map((x) => x.id), [pcPaid, pcCancelled, pcDone]);
    // from sobre updated_at.
    assert.deepEqual((await q(`subscription_id=${subs[1]}&from=2020-02-01`)).map((x) => x.id), [pcPaid, pcCancelled]);
    assert.deepEqual((await q(`subscription_id=${subs[1]}&from=2020-03-02`)).map((x) => x.id), [pcPaid]);
    const page = await http('GET', `/admin/payer-changes?subscription_id=${subs[1]}&limit=2&offset=2`, 'admin');
    assert.deepEqual([page.body.rows.map((x) => x.id), page.body.total, page.body.limit, page.body.offset], [[pcDone], 3, 2, 2]);
    expectError(await http('GET', '/admin/payer-changes?status=requested,hecho', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/payer-changes?subscription_id=nope', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/payer-changes?from=nope', 'admin'), 400, 'invalid_field');
    expectError(await http('GET', '/admin/payer-changes?limit=0', 'admin'), 400, 'invalid_pagination');
    // El GET de uno sigue siendo el de B11.
    assert.equal((await http('GET', `/admin/payer-changes/${pcPaid}`, 'admin')).body.status, 'paid');
  });

  // Detalle de sesión: una de clase con sustituto, aforo ajustado y reservas desordenadas; otra cancelada con nota.
  const klass = (await servicePool.query(
    `INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, location, starts_on)
     VALUES ($1, $2, 3, '19:00', 60, 20, 'sala A', current_date) RETURNING id`, [disc, U.prof2])).rows[0].id;
  const classSession = (slot, status, note) => servicePool.query(
    `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, slot, ends_at, duration_min, capacity, location,
                                 status, adjusted_fields, class_trainer_id, class_duration_min, class_capacity, class_location,
                                 cancelled_at, cancelled_by, cancel_note)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $4::timestamptz + interval '60 min', 60, 2, 'sala A', $5::text::session_status,
             $6::text[], $7, 60, 20, 'sala A', CASE WHEN $5::text = 'cancelled' THEN now() END,
             CASE WHEN $5::text = 'cancelled' THEN $8::uuid END, $9) RETURNING id`,
    [klass, disc, U.prof, slot, status, status === 'cancelled' ? '{}' : '{trainer_id,capacity}', U.prof2, U.admin, note])
    .then((r) => r.rows[0].id);
  const slot = new Date(Date.now() + 3 * 864e5).toISOString();
  const detail = await classSession(slot, 'scheduled', null);
  const cancelled = await classSession(new Date(Date.now() + 4 * 864e5).toISOString(), 'cancelled', 'lesión del profesor');
  const t0 = Date.now();
  for (const [who, status, offset] of [['child2', 'waitlisted', 4], ['stu2', 'confirmed', 2], ['child', 'waitlisted', 3],
    ['stu', 'confirmed', 1], ['grown', 'cancelled', 0]]) {
    await servicePool.query(
      `INSERT INTO bookings (id, session_id, student_id, status, booked_by, created_at, cancel_reason, cancelled_at)
       VALUES (gen_random_uuid(), $1, $2, $3::booking_status, $2, $4, CASE WHEN $3::text = 'cancelled' THEN 'student' END::booking_cancel_reason,
               CASE WHEN $3::text = 'cancelled' THEN now() END)`,
      [detail, U[who], status, new Date(t0 + offset * 1000)]);
  }
  await run('detalle de sesión: ajustes, valores de la clase y reservas en orden de llegada', async () => {
    const r = await http('GET', `/admin/sessions/${detail}`, 'admin');
    assert.equal(r.status, 200);
    const s = r.body.session;
    assert.deepEqual(s.adjusted_fields, ['trainer_id', 'capacity']);
    assert.deepEqual(s.class_values, { trainer_id: U.prof2, starts_at: s.class_values.starts_at, duration_min: 60,
      capacity: 20, location: 'sala A' });
    assert.equal(+new Date(s.class_values.starts_at), +new Date(slot));
    assert.deepEqual([s.id, s.class_id, s.capacity, s.cancel_note, s.status, s.held, s.location, s.duration_min],
      [detail, klass, 2, null, 'scheduled', false, 'sala A', 60]);
    assert.deepEqual([s.discipline, s.trainer], [{ id: Number(disc), name: tag }, { id: U.prof, display_name: `${tag}-prof` }]);
    assert.deepEqual(r.body.bookings.map((b) => [b.student.id, b.status]),
      [[U.stu, 'confirmed'], [U.stu2, 'confirmed'], [U.child, 'waitlisted'], [U.child2, 'waitlisted']]);
    assert.deepEqual(Object.keys(r.body.bookings[0]).sort(), ['created_at', 'id', 'status', 'student']);
  });
  await run('detalle de sesión: cancelada con su nota, suelta sin class_values, 404', async () => {
    const c = (await http('GET', `/admin/sessions/${cancelled}`, 'admin')).body;
    assert.deepEqual([c.session.status, c.session.cancel_note, c.bookings], ['cancelled', 'lesión del profesor', []]);
    const loose = (await http('GET', `/admin/sessions/${session}`, 'admin')).body.session;
    assert.deepEqual([loose.class_id, loose.class_values, loose.adjusted_fields], [null, null, []]);
    expectError(await http('GET', `/admin/sessions/${crypto.randomUUID()}`, 'admin'), 404, 'session_not_found');
    expectError(await http('GET', '/admin/sessions/nope', 'admin'), 400, 'invalid_id');
  });

  // PDF: un borrador y un retirado, idénticos a lo subido (servicePool: no se publica nada en la base compartida).
  const nonce = 1000 + Math.floor(Math.random() * 9000);
  const pdfs = {
    draft: Buffer.from(`%PDF-1.4 borrador ${tag}`), retired: Buffer.from(`%PDF-1.4 retirado ${tag}`),
  };
  const docs = {
    draft: await createDocument(servicePool, { type: 'rights_of_image', version: `${nonce}.1`, buffer: pdfs.draft }),
    retired: await createDocument(servicePool, { type: 'rights_of_image', version: `${nonce}.2`, buffer: pdfs.retired }),
  };
  for (const d of Object.values(docs)) documents.push(d.id);
  await servicePool.query(
    `UPDATE agreement_documents SET published_at = now() - interval '2 days', retired_at = now() - interval '1 day' WHERE id = $1`,
    [docs.retired.id]);
  await run('PDF: un borrador y un retirado idénticos al subido; 404; no es de alumno', async () => {
    for (const k of ['draft', 'retired']) {
      const r = await rawGet(`/admin/agreements/documents/${docs[k].id}/file`, 'admin');
      assert.deepEqual([r.status, r.type], [200, 'application/pdf']);
      assert.ok(r.body.equals(pdfs[k]), `${k} distinto del subido`);
    }
    expectError(await http('GET', `/admin/agreements/documents/${crypto.randomUUID()}/file`, 'admin'), 404, 'document_not_found');
    expectError(await http('GET', '/admin/agreements/documents/nope/file', 'admin'), 400, 'invalid_id');
    expectError(await http('GET', `/admin/agreements/documents/${docs.draft.id}/file`, 'stu'), 403, 'insufficient_role');
  });
  await run('lecturas del panel: alumno y profesor → 403', async () => {
    for (const url of ['/admin/settings', '/admin/audit', '/admin/notices', '/admin/notice-deliveries', '/admin/payer-changes',
      `/admin/sessions/${detail}`]) {
      expectError(await http('GET', url, 'stu'), 403, 'insufficient_role');
      expectError(await http('GET', url, 'prof'), 403, 'insufficient_role');
    }
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM audit_log WHERE actor_id = $1 OR id = ANY($2::uuid[])`, [U.admin, audits]);
  for (const id of documents) {
    const { rows: [d] } = await servicePool.query(`DELETE FROM agreement_documents WHERE id = $1 RETURNING storage_path`, [id]);
    if (d) await deleteFile(d.storage_path);
  }
  await servicePool.query(`DELETE FROM payer_changes WHERE created_by = $1`, [U.admin]);
  await servicePool.query(`DELETE FROM bookings WHERE student_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = $1 OR class_id IN (SELECT id FROM classes WHERE discipline_id = $2)`, [session, disc]);
  await servicePool.query(`DELETE FROM classes WHERE discipline_id = $1`, [disc]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [subs]);
  await servicePool.query(`DELETE FROM plans WHERE id = $1`, [plan]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await servicePool.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
