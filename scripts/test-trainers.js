// ADR 0028: alta de profesores por el admin. Por HTTP con un express en memoria y por SQL con app_user, en una base efímera
// (with-temp-db). El correo va al log (EMAIL_TRANSPORT=log) en un fichero temporal: de ahí sale el token de la invitación.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kz-trainers-')), 'emails.log');
Object.assign(process.env, { CORPORATE_EMAIL_DOMAIN: 'academia.test', EMAIL_TRANSPORT: 'log', EMAIL_LOG_PATH: logPath });
await import('dotenv/config');
const { default: express } = await import('express');
const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { signToken } = await import('../src/services/jwt.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { loginGoogle } = await import('../src/services/auth.js');
const { assertTrainer } = await import('../src/services/sessions.js');
const { default: authRouter } = await import('../src/routes/auth.js');
const { default: adminProfilesRouter } = await import('../src/routes/admin/profiles.js');
const { default: adminTrainersRouter } = await import('../src/routes/admin/trainers.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params);
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

const tag = `ttr${crypto.randomBytes(3).toString('hex')}`;
const people = { admin: 'admin', ana: 'alumno', tutor: 'tutor', old: 'profesor' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const mail = (k) => `${k}-${tag}@academia.test`;
const PASS = 'clave-segura-1';
const realError = console.error;

const app = express().use(express.json()).use('/auth', authRouter).use('/admin', adminProfilesRouter, adminTrainersRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, who, body) => {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${who.includes('.') ? who : signToken({ sub: U[who], role: people[who] })}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const code = (r) => r.body?.code;
const create = (body, who = 'admin') => http('POST', '/admin/trainers', who, body);
// El token de la última invitación enviada a ese correo (del log de emails).
const tokenFor = (to) => {
  const entries = fs.readFileSync(logPath, 'utf8').split('--- ').filter((e) => e.includes(`Para: ${to}\n`));
  return entries.at(-1)?.match(/reset-password\?token=([\w-]+)&invite=1/)?.[1];
};
const accept = (token, password = PASS) => http('POST', '/auth/password/reset', null, { token, password });
const login = (email, password = PASS) => http('POST', '/auth/login', null, { email, password });
const sqlAs = async (uid, role, sql, params) => {
  try { await withRls({ uid, role }, (c) => c.query(sql, params)); return null; } catch (e) { return e.code; }
};
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
// El correo sale sin esperar al envío (fire and forget): se espera a que llegue al log.
const waitToken = async (to) => { for (let i = 0; i < 40 && !tokenFor(to); i++) await nap(25); return tokenFor(to); };

try {
  for (const [k, role] of Object.entries(people)) {
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [U[k], `${tag}-${k}`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [U[k], `${k}-${tag}@kz.test`]);
  }
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  let ada; // el profesor del flujo principal
  await run('alta: 201, profesor sin contraseña, autónomo por defecto, invitación por email y solo su hash en la BD', async () => {
    const r = await create({ email: `  ADA-${tag}@Academia.Test `, display_name: 'Ada Profe' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ada = r.body.trainer;
    assert.deepEqual([ada.display_name, ada.email, ada.employment, ada.has_password, ada.email_verified, ada.disabled],
      ['Ada Profe', mail('ada'), 'self_employed', false, false, false]);
    const { rows: [role] } = await q(`SELECT role FROM user_roles WHERE user_id = $1`, [ada.id]);
    assert.equal(role.role, 'profesor');
    const token = await waitToken(mail('ada'));
    assert.ok(token && token.length >= 43, 'el enlace trae 32 bytes en base64url');
    const { rows: [inv] } = await q(`SELECT token_hash, kind, extract(epoch FROM expires_at - now()) / 3600 AS hours FROM password_resets WHERE profile_id = $1`, [ada.id]);
    assert.deepEqual([inv.token_hash, inv.kind], [sha256(token), 'invite']);
    assert.ok(inv.hours > 71.9 && inv.hours <= 72, `72 h (son ${inv.hours})`);
    assert.equal((await q(`SELECT count(*)::int AS n FROM password_resets WHERE token_hash = $1`, [token])).rows[0].n, 0, 'el token en claro no se guarda');
    const emp = await create({ email: mail('emp'), display_name: 'Emp', employment: 'employee' });
    assert.equal(emp.body.trainer.employment, 'employee');
  });

  await run('alta: validación (nombre, correo, relación) y dominio exacto, sin subdominios', async () => {
    for (const body of [{ display_name: 'X' }, { email: mail('v1') }, { email: 'sin-arroba', display_name: 'X' },
      { email: mail('v2'), display_name: '  ' }, { email: mail('v3'), display_name: 'X', employment: 'jefe' }]) {
      const r = await create(body);
      assert.deepEqual([r.status, code(r)], [400, 'invalid_field'], JSON.stringify(body));
    }
    for (const email of [`x-${tag}@gmail.com`, `x-${tag}@sub.academia.test`, `x-${tag}@academia.test.evil.com`, `x-${tag}@evilacademia.test`, `academia.test@gmail.com`]) {
      const r = await create({ email, display_name: 'X' });
      assert.deepEqual([r.status, code(r)], [400, 'email_domain_not_allowed'], email);
    }
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email LIKE $1`, [`x-${tag}@%`])).rowCount, 0);
  });

  await run('alta: correo repetido (también con otras mayúsculas) → 409 email_taken, sin dejar un perfil a medias', async () => {
    const before = (await q(`SELECT count(*)::int AS n FROM profiles`)).rows[0].n;
    for (const email of [mail('ada'), mail('ada').toUpperCase()]) {
      const r = await create({ email, display_name: 'Otra' });
      assert.deepEqual([r.status, code(r)], [409, 'email_taken'], email);
    }
    assert.equal((await q(`SELECT count(*)::int AS n FROM profiles`)).rows[0].n, before);
  });

  await run('aceptar: fija la contraseña, verifica el email, entra como profesor; el enlace no se reutiliza', async () => {
    const token = tokenFor(mail('ada'));
    assert.equal((await accept(token, 'corta')).body.code, 'weak_password');
    assert.equal((await login(mail('ada'))).status, 401, 'sin contraseña no entra');
    assert.equal((await accept(token)).status, 204);
    const { rows: [c] } = await q(`SELECT email_verified, has_password FROM auth_credentials WHERE profile_id = $1`, [ada.id]);
    assert.deepEqual(c, { email_verified: true, has_password: true });
    const l = await login(mail('ada'));
    assert.deepEqual([l.status, l.body.user.role, l.body.user.id], [200, 'profesor', ada.id]);
    const again = await accept(token, 'otra-clave-123');
    assert.deepEqual([again.status, code(again)], [400, 'invalid_reset_token']);
    assert.equal((await login(mail('ada'))).status, 200, 'la contraseña no cambió');
  });

  await run('la invitación caduca a las 72 h', async () => {
    const r = await create({ email: mail('cad'), display_name: 'Cad' });
    const token = await waitToken(mail('cad'));
    await q(`UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE profile_id = $1`, [r.body.trainer.id]);
    const a = await accept(token);
    assert.deepEqual([a.status, code(a)], [400, 'invalid_reset_token']);
    await q(`UPDATE password_resets SET expires_at = now() + interval '71 hours' WHERE profile_id = $1`, [r.body.trainer.id]);
    assert.equal((await accept(token)).status, 204, 'dentro del plazo vale');
  });

  await run('reenviar invalida la anterior (y 204); el reenvío nuevo sí vale', async () => {
    const r = await create({ email: mail('re'), display_name: 'Re' });
    const id = r.body.trainer.id;
    const t1 = await waitToken(mail('re'));
    assert.equal((await http('POST', `/admin/trainers/${id}/invite`, 'admin')).status, 204);
    let t2;
    for (let i = 0; i < 40 && (t2 = tokenFor(mail('re'))) === t1; i++) await nap(25);
    assert.notEqual(t2, t1);
    assert.equal(code(await accept(t1)), 'invalid_reset_token');
    assert.equal((await accept(t2)).status, 204);
    assert.equal((await q(`SELECT count(*)::int AS n FROM password_resets WHERE profile_id = $1 AND used_at IS NULL`, [id])).rows[0].n, 0);
  });

  await run('reenviar: límite por profesor (email-bombing) → 429 a la sexta; id inexistente → 404', async () => {
    const r = await create({ email: mail('bomb'), display_name: 'Bomb' });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await http('POST', `/admin/trainers/${r.body.trainer.id}/invite`, 'admin')).status);
    assert.deepEqual(statuses, [204, 204, 204, 204, 204, 429]);
    assert.equal((await http('POST', `/admin/trainers/${crypto.randomUUID()}/invite`, 'admin')).status, 404);
    assert.equal((await http('POST', `/admin/trainers/${U.ana}/invite`, 'admin')).status, 404, 'un alumno no es profesor');
    assert.equal((await http('POST', `/admin/trainers/nope/invite`, 'admin')).status, 400);
  });

  await run('desactivar corta la sesión viva, impide entrar y restablecer; reactivar devuelve el acceso', async () => {
    const live = (await login(mail('ada'))).body.token;
    assert.equal((await http('GET', '/auth/me', live)).status, 200);
    await nap(1100); // el iat del token y credentials_changed_at son de segundo: que el cierre sea posterior
    const d = await http('POST', `/admin/trainers/${ada.id}/deactivate`, 'admin');
    assert.deepEqual([d.status, d.body.trainer.disabled], [200, true], JSON.stringify(d.body));
    const me = await http('GET', '/auth/me', live);
    assert.deepEqual([me.status, code(me)], [401, 'session_revoked']);
    assert.equal((await login(mail('ada'))).status, 401);
    const before = (await q(`SELECT count(*)::int AS n FROM password_resets WHERE profile_id = $1`, [ada.id])).rows[0].n;
    assert.equal((await http('POST', '/auth/password/forgot', null, { email: mail('ada') })).status, 204);
    assert.equal((await q(`SELECT count(*)::int AS n FROM password_resets WHERE profile_id = $1`, [ada.id])).rows[0].n, before, 'no recibe restablecer');
    assert.equal(code(await http('POST', `/admin/trainers/${ada.id}/deactivate`, 'admin')), 'same_state');
    assert.equal(code(await http('POST', `/admin/trainers/${ada.id}/invite`, 'admin')), 'trainer_disabled');
    assert.equal(code(await http('PATCH', `/admin/trainers/${ada.id}`, 'admin', { email: mail('ada2') })), 'trainer_disabled');

    const rx = await http('POST', `/admin/trainers/${ada.id}/reactivate`, 'admin');
    assert.deepEqual([rx.status, rx.body.trainer.disabled], [200, false]);
    assert.equal((await http('GET', '/auth/me', live)).status, 401, 'el token de antes sigue muerto');
    assert.equal((await login(mail('ada'))).status, 200, 'su contraseña sigue valiendo');
    assert.equal(code(await http('POST', `/admin/trainers/${ada.id}/reactivate`, 'admin')), 'same_state');
  });

  await run('un desactivado no acepta una invitación pendiente ni se puede asignar a clases', async () => {
    const r = await create({ email: mail('dis'), display_name: 'Dis' });
    const token = await waitToken(mail('dis'));
    assert.equal((await http('POST', `/admin/trainers/${r.body.trainer.id}/deactivate`, 'admin')).status, 200);
    assert.equal(code(await accept(token)), 'invalid_reset_token');
    await assert.rejects(withRls({ uid: U.admin, role: 'admin' }, (c) => assertTrainer(c, r.body.trainer.id)), /desactivado/);
    await assert.doesNotReject(withRls({ uid: U.admin, role: 'admin' }, (c) => assertTrainer(c, ada.id)));
  });

  await run('desactivar con clase activa o sesión futura → 409 trainer_has_sessions y no cambia nada', async () => {
    const { rows: [{ id: disc }] } = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [tag]);
    const mk = async (k) => (await create({ email: mail(k), display_name: k })).body.trainer.id;
    const withClass = await mk('conclase');
    await q(`INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, starts_on)
             VALUES ($1, $2, 1, '19:00', 60, 10, CURRENT_DATE)`, [disc, withClass]);
    const withSession = await mk('consesion');
    await q(`INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
             VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 60 min', 60, 10, 'scheduled')`, [disc, withSession]);
    for (const id of [withClass, withSession]) {
      const r = await http('POST', `/admin/trainers/${id}/deactivate`, 'admin');
      assert.deepEqual([r.status, code(r)], [409, 'trainer_has_sessions'], id);
      assert.equal((await q(`SELECT disabled_at FROM auth_credentials WHERE profile_id = $1`, [id])).rows[0].disabled_at, null);
    }
    await q(`UPDATE class_sessions SET starts_at = now() - interval '2 days', ends_at = now() - interval '47 hours' WHERE trainer_id = $1`, [withSession]);
    assert.equal((await http('POST', `/admin/trainers/${withSession}/deactivate`, 'admin')).status, 200, 'una sesión pasada ya no cuenta');
  });

  await run('cambiar el correo: conserva id, anula contraseña, Google y sesiones, y reinvita al correo nuevo', async () => {
    const r = await create({ email: mail('mv'), display_name: 'Mv' });
    const id = r.body.trainer.id;
    assert.equal((await accept(await waitToken(mail('mv')))).status, 204);
    await q(`UPDATE auth_credentials SET google_sub = $2 WHERE profile_id = $1`, [id, `g-${tag}`]);
    const live = (await login(mail('mv'))).body.token;
    await nap(1100); // iat y credentials_changed_at son de segundo
    assert.equal(code(await http('PATCH', `/admin/trainers/${id}`, 'admin', { email: mail('mv') })), 'same_email');
    assert.equal(code(await http('PATCH', `/admin/trainers/${id}`, 'admin', { email: mail('ada') })), 'email_taken');
    assert.equal(code(await http('PATCH', `/admin/trainers/${id}`, 'admin', { email: 'x@gmail.com' })), 'email_domain_not_allowed');
    assert.equal(code(await http('PATCH', `/admin/trainers/${id}`, 'admin', {})), 'invalid_field');

    const p = await http('PATCH', `/admin/trainers/${id}`, 'admin', { email: mail('mv2'), display_name: 'Mv Nuevo', employment: 'employee' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual([p.body.trainer.id, p.body.trainer.email, p.body.trainer.display_name, p.body.trainer.employment, p.body.trainer.has_password, p.body.trainer.email_verified],
      [id, mail('mv2'), 'Mv Nuevo', 'employee', false, false]);
    assert.equal((await q(`SELECT google_sub FROM auth_credentials WHERE profile_id = $1`, [id])).rows[0].google_sub, null);
    assert.equal(code(await http('GET', '/auth/me', live)), 'session_revoked');
    assert.equal((await login(mail('mv'))).status, 401);
    assert.equal((await login(mail('mv2'))).status, 401, 'sin contraseña hasta aceptar');
    assert.equal((await accept(await waitToken(mail('mv2')))).status, 204);
    assert.equal((await login(mail('mv2'))).body.user.id, id);
  });

  await run('solo el admin: alumno, tutor y profesor reciben 403 en todas las rutas', async () => {
    for (const who of ['ana', 'tutor', 'old']) {
      for (const [method, url, body] of [['POST', '/admin/trainers', { email: mail('no'), display_name: 'No' }],
        ['POST', `/admin/trainers/${ada.id}/invite`], ['PATCH', `/admin/trainers/${ada.id}`, { display_name: 'No' }],
        ['POST', `/admin/trainers/${ada.id}/deactivate`], ['POST', `/admin/trainers/${ada.id}/reactivate`]]) {
        const r = await http(method, url, who, body);
        assert.deepEqual([r.status, code(r)], [403, 'insufficient_role'], `${who} ${method} ${url}`);
      }
    }
    assert.equal((await http('POST', '/admin/trainers', null, {})).status, 401);
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email = $1`, [mail('no')])).rowCount, 0);
  });

  await run('las funciones SQL fallan si quien llama no es admin, aunque el parámetro de rol diga admin', async () => {
    const cases = [
      ['SELECT admin_create_trainer(gen_random_uuid(), $1, \'X\', \'employee\', \'h\')', [mail('sql')]],
      ['SELECT create_trainer_invite($1, \'h\')', [ada.id]], ['SELECT admin_set_trainer_email($1, $2, \'h\')', [ada.id, mail('sql')]],
      ['SELECT admin_update_trainer($1, \'X\', NULL)', [ada.id]], ['SELECT admin_set_disabled($1, true)', [ada.id]],
    ];
    for (const [sql, params] of cases) {
      for (const [uid, role] of [[U.ana, 'alumno'], [U.old, 'profesor'], [U.ana, 'admin'], [null, 'admin']]) {
        assert.equal(await sqlAs(uid ?? crypto.randomUUID(), role, sql, params), '42501', `${role} ${sql}`);
      }
    }
    assert.equal(await sqlAs(U.admin, 'admin', 'SELECT trainer_admin_guard()'), '42501', 'los auxiliares no se llaman directamente');
    for (const fn of ['trainer_admin_guard()', 'trainer_lock(uuid)', 'trainer_audit(text, uuid, jsonb)', 'trainer_new_invite(uuid, text)']) {
      assert.equal((await q(`SELECT has_function_privilege('app_user', $1, 'EXECUTE') AS ok`, [fn])).rows[0].ok, false, fn);
    }
    assert.equal(await sqlAs(U.admin, 'admin', 'UPDATE auth_credentials SET disabled_at = NULL WHERE profile_id = $1', [ada.id]), '42501', 'disabled_at es columna protegida');
    assert.equal(await sqlAs(U.admin, 'admin', 'SELECT 1 FROM password_resets'), '42501');
    assert.equal((await q(`SELECT disabled_at FROM auth_credentials WHERE profile_id = $1`, [ada.id])).rows[0].disabled_at, null);
  });

  await run('rol: profesor no es destino (400) y un profesor no cambia de rol (409 trainer_role_locked)', async () => {
    const put = (id, role) => http('PUT', `/admin/profiles/${id}/role`, 'admin', { role });
    const toTrainer = await put(U.ana, 'profesor');
    assert.deepEqual([toTrainer.status, code(toTrainer)], [400, 'invalid_field']);
    for (const role of ['alumno', 'tutor']) {
      const r = await put(ada.id, role);
      assert.deepEqual([r.status, code(r)], [409, 'trainer_role_locked']);
    }
    assert.equal((await q(`SELECT role FROM user_roles WHERE user_id = $1`, [ada.id])).rows[0].role, 'profesor');
  });

  await run('registro público: el dominio corporativo está reservado (409 email_domain_reserved), sea cual sea la caja', async () => {
    for (const email of [`reg-${tag}@academia.test`, `reg-${tag}@ACADEMIA.test`]) {
      const r = await http('POST', '/auth/register', null, { email, password: PASS, displayName: 'Reg', birthDate: '1990-01-01' });
      assert.deepEqual([r.status, code(r)], [409, 'email_domain_reserved'], email);
    }
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email LIKE $1`, [`reg-${tag}@%`])).rowCount, 0);
    const ok = await http('POST', '/auth/register', null, { email: `reg-${tag}@sub.academia.test`, password: PASS, displayName: 'Reg', birthDate: '1990-01-01' });
    assert.equal(ok.status, 201, 'un subdominio no está reservado');
  });

  await run('Google: rechaza perfiles profesor (por sub y por email) y el dominio corporativo, sin crear ni vincular nada', async () => {
    const verify = (sub, email) => async () => ({ sub, email, name: 'G' });
    const bad = async (sub, email) => assert.rejects(loginGoogle({ idToken: 'x', verify: verify(sub, email) }), { status: 403, code: 'google_login_not_allowed' }, email);
    await q(`UPDATE auth_credentials SET google_sub = $2 WHERE profile_id = $1`, [ada.id, `g-ada-${tag}`]);
    await bad(`g-ada-${tag}`, `otro-${tag}@gmail.com`); // por sub
    await bad(`g-nuevo-${tag}`, `old-${tag}@kz.test`); // por email de un profesor no corporativo
    await bad(`g-corp-${tag}`, `nuevo-${tag}@academia.test`); // dominio corporativo sin cuenta
    await bad(`g-corp2-${tag}`, mail('ada')); // dominio corporativo con cuenta
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE google_sub LIKE $1 OR email = $2`, [`g-%${tag}`, `nuevo-${tag}@academia.test`])).rowCount, 1, 'solo el sub que ya tenía Ada');
    await q(`UPDATE auth_credentials SET google_sub = NULL WHERE profile_id = $1`, [ada.id]);
    const ok = await loginGoogle({ idToken: 'x', verify: verify(`g-ana-${tag}`, `g-ana-${tag}@gmail.com`) });
    assert.equal(ok.role, 'alumno', 'un alumno nuevo por Google sigue entrando');
  });

  await run('audit_log: trainer.create|invite|update|deactivate|reactivate con ids, nunca el email ni el token', async () => {
    const { rows } = await q(`SELECT action, actor_id, resource_id, changes FROM audit_log WHERE action LIKE 'trainer.%'`);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['trainer.create', 'trainer.invite', 'trainer.update', 'trainer.deactivate', 'trainer.reactivate']) assert.ok(actions.has(a), a);
    assert.ok(rows.every((r) => r.actor_id === U.admin));
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes('@') && !dump.includes('academia.test'), 'sin emails');
    const tokens = fs.readFileSync(logPath, 'utf8').match(/token=([\w-]+)/g).map((t) => t.slice(6));
    assert.ok(tokens.length > 5 && tokens.every((t) => !dump.includes(t)), 'sin tokens');
    assert.equal(rows.filter((r) => r.action === 'trainer.create' && r.resource_id === ada.id).length, 1);
  });

  await run('producción: sin CORPORATE_EMAIL_DOMAIN la app no arranca; con él, sí', async () => {
    const load = (domain) => spawnSync('node', ['--input-type=module', '-e', "await import('./src/config/corporate.js')"],
      { env: { ...process.env, NODE_ENV: 'production', CORPORATE_EMAIL_DOMAIN: domain }, encoding: 'utf8' });
    const none = load('');
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /CORPORATE_EMAIL_DOMAIN/);
    assert.notEqual(load('no es un dominio').status, 0);
    assert.equal(load('Academia.Test').status, 0);
  });
} finally {
  console.error = realError;
  server.close();
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
