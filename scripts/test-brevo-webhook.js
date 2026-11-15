// ADR 0029: webhook de rebotes de Brevo y supresión de direcciones. Por HTTP con un express en memoria y por SQL con app_user,
// en una base efímera (with-temp-db). El transporte es un stub: se comprueba qué llega y qué no.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET = `s-${crypto.randomBytes(8).toString('hex')}`;
const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kz-brevo-')), 'emails.log');
Object.assign(process.env, { BREVO_WEBHOOK_SECRET: SECRET, EMAIL_TRANSPORT: 'log', EMAIL_LOG_PATH: logPath });
await import('dotenv/config');
const { default: express } = await import('express');
const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: webhooksRouter } = await import('../src/routes/webhooks.js');
const { send, sendWith } = await import('../src/services/email.js');
const { notice, sendPending } = await import('../src/services/notices.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;

// El errorHandler traza cada 4xx: aquí son esperados.
const realError = console.error;
console.error = (...a) => (/^\[error\]|^(Syntax)?Error:/.test(String(a[0])) ? null : realError(...a));

const tag = `bw${crypto.randomBytes(3).toString('hex')}`;
const addr = (k) => `${k}-${tag}@brevo.test`;
const app = express().use('/webhooks', webhooksRouter).use(errorHandler);
const server = app.listen(0);
const url = `http://127.0.0.1:${server.address().port}/webhooks/brevo`;
const post = async (body, secret = SECRET, raw = false) => {
  const headers = { 'content-type': 'application/json', ...(secret && { 'x-brevo-secret': secret }) };
  const res = await fetch(url, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const row = async (email) => (await q(`SELECT * FROM email_suppressions WHERE email = $1`, [email]))[0];
const sqlAs = async (uid, role, sql, params) => {
  try { await withRls({ uid, role }, (c) => c.query(sql, params)); return null; } catch (e) { return e.code; }
};

try {
  await run('secreto malo, ausente o de otra longitud → 401 y la BD no se toca', async () => {
    const e = addr('nosecret');
    for (const secret of ['otro', '', null, `${SECRET}x`]) {
      const r = await post({ event: 'hard_bounce', email: e }, secret);
      assert.equal(r.status, 401, `secreto ${JSON.stringify(secret)}`);
      assert.equal(r.body.code, 'invalid_secret');
    }
    assert.equal(await row(e), undefined);
  });

  await run('hard_bounce, blocked, spam e invalid_email suprimen (con motivo, id de mensaje y email normalizado)', async () => {
    for (const event of ['hard_bounce', 'blocked', 'spam', 'invalid_email']) {
      const r = await post({ event, email: `  ${addr(event).toUpperCase()} `, reason: `motivo ${event}`, 'message-id': `<${event}@brevo>` });
      assert.deepEqual([r.status, r.body.result], [200, 'suppressed'], event);
      const s = await row(addr(event));
      assert.deepEqual([s.event, s.reason, s.provider_message_id], [event, `motivo ${event}`, `<${event}@brevo>`]);
    }
  });

  await run('soft_bounce no suprime (solo log); un evento que no nos importa se acepta e ignora', async () => {
    const warn = console.warn;
    const logged = [];
    console.warn = (...a) => logged.push(a.join(' '));
    try {
      const r = await post({ event: 'soft_bounce', email: addr('soft'), reason: 'mailbox full' });
      assert.deepEqual([r.status, r.body.result], [200, 'ignored']);
    } finally { console.warn = warn; }
    assert.ok(logged.some((l) => l.includes('soft_bounce') && l.includes(addr('soft'))), 'queda en el log');
    assert.equal((await post({ event: 'delivered', email: addr('soft') })).body.result, 'ignored');
    assert.equal(await row(addr('soft')), undefined);
  });

  await run('cuerpo inválido → 400 y nada guardado', async () => {
    for (const body of [{}, { event: 'hard_bounce' }, { event: 'hard_bounce', email: 'sin-arroba' }, { email: addr('x') }, { event: 7, email: addr('x') }]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await post('{no es json', SECRET, true)).status, 400);
  });

  await run('idempotente: repetir el evento no falla ni cambia la fila; lo duro sustituye a la baja, no al revés', async () => {
    const e = addr('dup');
    const ev = { event: 'hard_bounce', email: e, reason: 'r1', 'message-id': 'm1' };
    assert.equal((await post(ev)).status, 200);
    const first = await row(e);
    assert.equal((await post({ ...ev, reason: 'r2', 'message-id': 'm2' })).status, 200);
    assert.deepEqual(await row(e), first, 'un duro repetido no cambia nada');
    assert.equal((await post({ event: 'unsubscribed', email: e })).status, 200);
    assert.equal((await row(e)).event, 'hard_bounce', 'una baja no rebaja un duro');
    const u = addr('unsub');
    await post({ event: 'unsubscribed', email: u });
    assert.equal((await row(u)).event, 'unsubscribed');
    await post({ event: 'spam', email: u });
    assert.equal((await row(u)).event, 'spam', 'un duro sustituye a la baja');
    assert.equal((await q(`SELECT 1 FROM email_suppressions WHERE email IN ($1, $2)`, [e, u])).length, 2);
  });

  await run('un email que no es de ningún perfil se guarda igual', async () => {
    const e = addr('ghost');
    assert.equal((await q(`SELECT 1 FROM auth_credentials WHERE email = $1`, [e])).length, 0);
    assert.equal((await post({ event: 'hard_bounce', email: e })).status, 200);
    assert.ok(await row(e));
  });

  await run('RLS: app_user (alumno o admin) no lee ni escribe email_suppressions; service_role sí', async () => {
    const [{ id }] = await q(`INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`${tag}-rls`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [id]);
    for (const role of ['alumno', 'admin']) {
      assert.equal(await sqlAs(id, role, `SELECT * FROM email_suppressions`), '42501', `SELECT como ${role}`);
      assert.equal(await sqlAs(id, role, `INSERT INTO email_suppressions (email, event) VALUES ('x@y.test', 'spam')`), '42501', `INSERT como ${role}`);
      assert.equal(await sqlAs(id, role, `DELETE FROM email_suppressions`), '42501', `DELETE como ${role}`);
    }
    assert.ok((await q(`SELECT 1 FROM email_suppressions`)).length > 0);
  });

  // --- Envío: una dirección suprimida no llega al transporte ---
  const mkPerson = async (k) => {
    const id = crypto.randomUUID();
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [id, `${tag}-${k}`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`, [id]);
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [id, addr(k)]);
    return id;
  };
  const sent = [];
  const stub = async (email) => { sent.push(email); return { id: `stub-${sent.length}` }; };
  const deliver = () => sendPending(servicePool, sendWith(stub));
  const delivery = async (rid) => (await q(
    `SELECT d.status, d.last_error, d.attempts FROM notice_deliveries d JOIN audit_log a ON a.id = d.audit_id WHERE a.resource_id = $1`, [rid]))[0];
  // Facturación: sale por el outbox con notice(). Informativo: un aviso de re-firma con entrega por email (el respaldo de enqueue_notice).
  const billing = async (to) => {
    const rid = crypto.randomUUID();
    await notice(servicePool, { action: 'notice.checkout_race_refunded', actorId: to, type: 'subscription', resourceId: rid, recipients: [to], student_id: to });
    return rid;
  };
  const optional = async (to) => {
    const rid = crypto.randomUUID();
    await notice(servicePool, { action: 'notice.agreement_published', actorId: to, type: 'agreement', resourceId: rid, recipients: [to] });
    // `type` de notice() es el tipo de recurso: el del acuerdo va en changes, a mano.
    await q(`UPDATE audit_log SET changes = changes || '{"type": "data_protection"}' WHERE resource_id = $1`, [rid]);
    await q(`INSERT INTO notice_deliveries (audit_id, recipient_id, channel) SELECT id, $2, 'email' FROM audit_log WHERE resource_id = $1`, [rid, to]);
    return rid;
  };
  await q(`UPDATE notice_deliveries SET next_attempt_at = next_attempt_at + interval '100 years' WHERE status = 'pending'`);

  await run('dirección suprimida (duro): ni facturación ni informativo llegan al transporte; quedan skipped / email_suppressed', async () => {
    const p = await mkPerson('hardsent');
    await q(`INSERT INTO email_suppressions (email, event) VALUES ($1, 'hard_bounce')`, [addr('hardsent')]);
    const [b, o] = [await billing(p), await optional(p)];
    sent.length = 0;
    await deliver();
    assert.equal(sent.length, 0, 'el transporte no se llama');
    for (const rid of [b, o]) assert.deepEqual(await delivery(rid), { status: 'skipped', last_error: 'email_suppressed', attempts: 0 });
  });

  await run('baja (unsubscribed): calla el aviso informativo, no el de facturación', async () => {
    const p = await mkPerson('unsubsent');
    await q(`INSERT INTO email_suppressions (email, event) VALUES ($1, 'unsubscribed')`, [addr('unsubsent')]);
    const [b, o] = [await billing(p), await optional(p)];
    sent.length = 0;
    await deliver();
    assert.deepEqual(sent.map((e) => [e.to, e.optional]), [[addr('unsubsent'), false]]);
    assert.equal((await delivery(b)).status, 'sent');
    assert.deepEqual(await delivery(o), { status: 'skipped', last_error: 'email_suppressed', attempts: 0 });
  });

  await run('sin supresión: ambos salen, el informativo marcado optional', async () => {
    const p = await mkPerson('clean');
    const [b, o] = [await billing(p), await optional(p)];
    sent.length = 0;
    await deliver();
    assert.deepEqual(sent.map((e) => e.optional).sort(), [false, true]);
    assert.deepEqual([(await delivery(b)).status, (await delivery(o)).status], ['sent', 'sent']);
  });

  await run('send real (los emails directos de auth y profesores): suprimida → error suppressed y nada en el log; una baja no los calla', async () => {
    const mail = (to) => ({ to, subject: 'x', text: 'x', idempotencyKey: crypto.randomUUID() });
    await assert.rejects(send(mail(addr('hardsent'))), { suppressed: true, message: 'email_suppressed' });
    await send(mail(addr('unsubsent'))); // sin optional: obligatorio, sale (por el log)
    const log = fs.readFileSync(logPath, 'utf8');
    assert.ok(!log.includes(`Para: ${addr('hardsent')}`), 'la dirección suprimida no está en el log');
    assert.ok(log.includes(`Para: ${addr('unsubsent')}`), 'la dada de baja sí');
  });
} finally {
  server.close();
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
