// Comunicados del admin (ADR 0030): audiencias, ventana y email por persona, RLS, retirar y caducidad. Por HTTP con un
// express en memoria, en una base efímera (with-temp-db). El email con un transporte falso (sendPending), nada real.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { sendPending } from '../src/services/notices.js';
import meRouter from '../src/routes/me.js';
import panelRouter from '../src/routes/admin/panel.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

// ana: socia adulta (solo D1); tutor: dos hijos socios, kid (con acceso propio y email) y baby (sin acceso);
// free: alumno sin cuota; prof: profesor; off: cuenta deshabilitada con cuota; admin.
const people = { admin: 'admin', ana: 'alumno', tutor: 'tutor', kid: 'alumno', baby: 'alumno', free: 'alumno', prof: 'profesor', off: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
for (const [k, role] of Object.entries(people)) {
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
    [U[k], `T ${k}`, ['kid', 'baby'].includes(k) ? '2014-03-03' : null]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (k === 'baby') continue;
  await q(`INSERT INTO auth_credentials (profile_id, email, username, password_hash, disabled_at) VALUES ($1, $2, $3, 'x', $4)`,
    [U[k], `${k}-${U[k]}@communiques.test`, k === 'kid' ? `kid${U[k].slice(0, 6)}` : null, k === 'off' ? new Date() : null]);
}
await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3)`, [U.tutor, U.kid, U.baby]);
const [d1, d2] = (await q(`INSERT INTO disciplines (name) VALUES ('T-Com D1'), ('T-Com D2') RETURNING id`)).map((r) => r.id);
const [onlyD1, all] = await q(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ('T-Com Solo D1', 3000, NULL), ('T-Com Todo', 5000, NULL)
   RETURNING id`);
await q(`INSERT INTO plan_disciplines (plan_id, discipline_id) VALUES ($1, $2)`, [onlyD1.id, d1]);
const sub = (student, payer, plan, status) => q(
  `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id) VALUES ($1, $2, $3, $4, $5)`,
  [student, payer, plan, status, `sub_${student}`]);
await sub(U.ana, U.ana, onlyD1.id, 'active');
await sub(U.kid, U.tutor, all.id, 'past_due');
await sub(U.baby, U.tutor, all.id, 'active');
await sub(U.off, U.off, all.id, 'active');

const app = express().use(express.json()).use('/me', meRouter).use('/admin', panelRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, who, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken({ sub: U[who], role: people[who] })}` },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const send = (body) => http('POST', '/admin/communiques', 'admin',
  { title: 'Cerrado el lunes', body: 'Por obras.\nVolvemos el martes.', ...body });
const who = (id) => Object.keys(U).find((k) => U[k] === id);
const viewers = async (id) => (await q(`SELECT profile_id FROM communique_views WHERE communique_id = $1`, [id]))
  .map((r) => who(r.profile_id)).sort();
const mailed = async (id) => (await q(
  `SELECT d.recipient_id, d.status, d.last_error FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id
    WHERE a.action = 'notice.communique' AND a.resource_id = $1`, [id])).map((r) => ({ ...r, who: who(r.recipient_id) }));
const pending = async (k) => (await http('GET', '/me/communiques', k)).body.communiques.map((c) => c.id);

try {
  await run('todos: cuentas activas no admin; ventana al hijo con acceso, email solo a adultos', async () => {
    const r = await send({ audience: 'all', channels: ['app', 'email'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(await viewers(r.body.id), ['ana', 'free', 'kid', 'prof', 'tutor']);
    assert.deepEqual((await mailed(r.body.id)).map((m) => m.who).sort(), ['ana', 'free', 'prof', 'tutor']);
    assert.equal(r.body.app_count, 5);
    assert.equal(r.body.email_count, 4);
  });

  await run('socios: en vigor (también en gracia); un hijo cuenta por su tutor (una vez) y él si tiene acceso', async () => {
    const r = await send({ audience: 'members', channels: ['app', 'email'] });
    assert.deepEqual(await viewers(r.body.id), ['ana', 'kid', 'tutor']);
    assert.deepEqual((await mailed(r.body.id)).map((m) => m.who).sort(), ['ana', 'tutor']);
  });

  await run('socios de una disciplina: la regla de cobertura de Usuarios', async () => {
    const r1 = await send({ audience: 'members', discipline_ids: [String(d1)], channels: ['app'] });
    assert.deepEqual(await viewers(r1.body.id), ['ana', 'kid', 'tutor']);
    const r2 = await send({ audience: 'members', discipline_ids: [d2], channels: ['app'] });
    assert.deepEqual(await viewers(r2.body.id), ['kid', 'tutor']);
    assert.deepEqual(await mailed(r2.body.id), []);
  });

  await run('profesores; solo WhatsApp no fija destinatarios', async () => {
    const r = await send({ audience: 'trainers', channels: ['app'] });
    assert.deepEqual(await viewers(r.body.id), ['prof']);
    const w = await send({ audience: 'all', channels: ['whatsapp'] });
    assert.equal(w.status, 201);
    assert.deepEqual(await viewers(w.body.id), []);
    assert.equal(w.body.app_count, 0);
  });

  await run('vista previa: cifras de ventana y email', async () => {
    const r = await http('GET', `/admin/communiques/audience?audience=members&discipline_ids=${d1},${d2}`, 'admin');
    assert.deepEqual(r.body, { app: 3, email: 2 });
  });

  await run('validación y permisos', async () => {
    assert.equal((await send({ audience: 'all', channels: [] })).body.field, 'channels');
    assert.equal((await send({ audience: 'nadie', channels: ['app'] })).body.field, 'audience');
    assert.equal((await send({ audience: 'all', title: 'x'.repeat(81), channels: ['app'] })).body.field, 'title');
    assert.equal((await send({ audience: 'all', discipline_ids: [d1], channels: ['app'] })).body.field, 'discipline_ids');
    assert.equal((await http('POST', '/admin/communiques', 'ana', { audience: 'all', channels: ['app'] })).status, 403);
    assert.equal((await http('GET', '/admin/communiques', 'tutor')).status, 403);
  });

  await run('ventana: pendientes propias, «Entendido» idempotente; nadie marca la ajena; el menor también', async () => {
    const r = await send({ audience: 'members', channels: ['app'] });
    assert.ok((await pending('kid')).includes(r.body.id));
    assert.equal((await http('POST', '/me/communiques/seen', 'kid', { id: r.body.id })).status, 204);
    assert.equal((await http('POST', '/me/communiques/seen', 'kid', { id: r.body.id })).status, 204);
    assert.ok(!(await pending('kid')).includes(r.body.id));
    assert.ok((await pending('tutor')).includes(r.body.id));
    assert.equal((await http('POST', '/me/communiques/seen', 'free', { id: r.body.id })).status, 404);
    // Por SQL con app_user: free no ve el comunicado ni las filas de otros, ni las marca.
    const seen = await withRls({ uid: U.free, role: 'alumno' }, async (c) => ({
      c: (await c.query('SELECT 1 FROM communiques WHERE id = $1', [r.body.id])).rowCount,
      v: (await c.query('SELECT 1 FROM communique_views WHERE communique_id = $1', [r.body.id])).rowCount,
      u: (await c.query(`UPDATE communique_views SET seen_at = now() WHERE communique_id = $1`, [r.body.id])).rowCount,
    }));
    assert.deepEqual(seen, { c: 0, v: 0, u: 0 });
    const row = (await http('GET', '/admin/communiques', 'admin')).body.rows.find((c) => c.id === r.body.id);
    assert.equal(row.seen, 1);
    assert.equal(row.app_count, 3);
  });

  await run('email: un párrafo por línea, escapado, pie de servicio sin baja', async () => {
    const r = await send({ audience: 'trainers', title: 'Horario <nuevo>', channels: ['email'] });
    const outbox = [];
    const fake = async (m) => { outbox.push(m); return { id: `fake-${outbox.length}` }; };
    while (await sendPending(servicePool, fake)); // las de las pruebas anteriores también salen
    const m = outbox.find((e) => e.subject === 'Horario <nuevo>');
    assert.ok(m.text.includes('Por obras.\n\nVolvemos el martes.'), m.text);
    assert.ok(m.html.includes('<p>Por obras.</p>'));
    assert.ok(m.text.includes('comunicado de servicio'));
    assert.ok(!/baja/i.test(m.text));
    assert.equal((await mailed(r.body.id))[0].status, 'sent');
  });

  await run('retirar: la ventana deja de salir, los emails pendientes se saltan, 409 la segunda vez', async () => {
    const r = await send({ audience: 'members', channels: ['app', 'email'] });
    assert.equal((await http('POST', `/admin/communiques/${r.body.id}/withdraw`, 'admin')).status, 200);
    assert.ok(!(await pending('ana')).includes(r.body.id));
    const m = await mailed(r.body.id);
    assert.ok(m.length && m.every((x) => x.status === 'skipped' && x.last_error === 'withdrawn'));
    assert.equal((await http('POST', `/admin/communiques/${r.body.id}/withdraw`, 'admin')).status, 409);
    assert.equal((await http('POST', `/admin/communiques/${crypto.randomUUID()}/withdraw`, 'admin')).status, 404);
  });

  await run('caducidad: la ventana deja de salir a los 30 días', async () => {
    const r = await send({ audience: 'members', channels: ['app'] });
    assert.ok((await pending('ana')).includes(r.body.id));
    await q(`UPDATE communiques SET created_at = now() - interval '31 days' WHERE id = $1`, [r.body.id]);
    assert.ok(!(await pending('ana')).includes(r.body.id));
  });
} finally {
  server.close();
  await closePools();
}
if (failed) { console.error(`\n${failed} prueba(s) fallida(s)`); process.exit(1); }
console.log('\nTodo OK');
