// B15: push de avisos de reservas y re-firma con email de respaldo (CONTEXT § Avisos, ADR 0011).
// web-push real contra un servidor HTTPS local (web-push solo habla https; certificado autofirmado con openssl)
// que responde según la ruta del endpoint (201, 404, 410, 429, 500, 401, 403). Claves de cliente con
// crypto.createECDH: el test descifra el payload (aes128gcm, RFC 8291). Los endpoints se insertan con servicePool
// (localhost no pasa la lista cerrada de la ruta). La re-firma va en una transacción que se deshace al final.
// Con `npm run dev` en marcha, su worker se lleva entregas del test: pararlo antes.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import express from 'express';
import webpush from 'web-push';

// Antes de importar la config: transporte real con claves de prueba y sin verificar el certificado local.
const vapid = webpush.generateVAPIDKeys();
Object.assign(process.env, {
  PUSH_TRANSPORT: 'webpush', VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:test@kaizen.test', NODE_TLS_REJECT_UNAUTHORIZED: '0',
});
const { servicePool, closePools } = await import('../src/config/database.js');
const { withRls } = await import('../src/db/rls.js');
const { signToken } = await import('../src/services/jwt.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: meRouter } = await import('../src/routes/me.js');
const { default: pushRouter } = await import('../src/routes/push.js');
const { notice, sendPending, compose } = await import('../src/services/notices.js');

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = async (sql, params) => (await servicePool.query(sql, params)).rows;
const tag = `tpush${crypto.randomBytes(3).toString('hex')}`;

// --- Servidor de push local ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-push-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
const received = [];
const pushServer = https.createServer(
  { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
  (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const [, code, id] = req.url.split('/');
      received.push({ id, code: Number(code), headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(Number(code)).end();
    });
  });
await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
const pushBase = `https://localhost:${pushServer.address().port}`;

// Descifra un cuerpo aes128gcm (RFC 8188 + RFC 8291) con las claves del cliente.
function decrypt({ ecdh, auth }, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPub = body.subarray(21, 21 + idlen);
  const secret = ecdh.computeSecret(serverPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idlen);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString()); // delimitador 0x02 + relleno
}

// --- Fixtures (confirmados; se borran al final) ---
const ids = [];
async function person(role, { birth = null, email = true, name } = {}) {
  const id = crypto.randomUUID();
  ids.push(id);
  await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [id, name ?? `${tag}-${role}`, birth]);
  await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
  if (email) await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@push.test`]);
  return id;
}
const prof = await person('profesor');
const admin = await person('admin');
const [disc] = await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-BJJ`]);

const devices = [];
async function device(profileId, code) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const d = { ecdh, auth: crypto.randomBytes(16), id: crypto.randomUUID() };
  d.endpoint = `${pushBase}/${code}/${d.id}`;
  await q(`INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)`,
    [profileId, d.endpoint, ecdh.getPublicKey('base64url'), d.auth.toString('base64url')]);
  devices.push(d);
  return d;
}
const deviceCount = async (endpoint) => (await q(`SELECT 1 FROM push_subscriptions WHERE endpoint = $1`, [endpoint])).length;

const sessions = [];
async function booking(student, offset = '2 days') { // cada sesión con su profesor: sin solape
  const [s] = await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
     VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '60 min', 60, 5, 'scheduled')
     RETURNING id, starts_at`, [disc.id, await person('profesor'), offset]);
  sessions.push(s.id);
  const [b] = await q(`INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed')
                       RETURNING id`, [s.id, student]);
  return { id: b.id, startsAt: s.starts_at };
}
// En una transacción, con actor opcional (booking_notice lee app.current_user_id). Devuelve los avisos.
async function inTx(fn, actor = null) {
  const c = await servicePool.connect();
  try {
    await c.query('BEGIN');
    if (actor) await c.query(`SELECT set_config('app.current_user_id', $1, true)`, [actor]);
    await fn(c);
    await c.query('COMMIT');
  } finally { c.release(); }
}
async function bookingNotice(student, { offset, action = 'notice.session_cancelled', actor } = {}) {
  const b = await booking(student, offset);
  await inTx((c) => c.query(`SELECT booking_notice($1, $2)`, [b.id, action]), actor);
  const [a] = await q(`SELECT * FROM audit_log WHERE resource_id = $1`, [b.id]);
  return a;
}
const deliveries = (auditId) => q(
  `SELECT d.*, extract(epoch FROM d.next_attempt_at - now()) AS wait_s FROM notice_deliveries d
    WHERE d.audit_id = $1 ORDER BY d.recipient_id`, [auditId]);

const outbox = [];
const fakeEmail = async (email) => { outbox.push(email); return { id: `fake-${outbox.length}` }; };
const send = () => sendPending(servicePool, fakeEmail);
const got = (d) => received.filter((r) => r.id === d.id);

const parked = (await q(
  `UPDATE notice_deliveries SET next_attempt_at = next_attempt_at + interval '100 years' WHERE status = 'pending'
   RETURNING id`)).map((r) => r.id);

// --- HTTP (rutas de dispositivos y clave) ---
const app = express();
app.use(express.json());
app.use('/me', meRouter);
app.use('/push', pushRouter);
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const roleOf = {};
const http = async (method, url, who, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json',
      ...(who && { authorization: `Bearer ${signToken({ sub: who, role: roleOf[who] })}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const clientKeys = () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
};

try {
  await run('canal: push con dispositivo, email sin él; sin admin, profesor ni actor; facturación solo email', async () => {
    const child = await person('alumno', { birth: '2016-05-05', email: false });
    const [withDev, noDev, actor] = [await person('tutor'), await person('tutor'), await person('tutor')];
    for (const t of [withDev, noDev, actor, admin, prof]) {
      await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [t, child]);
    }
    await device(withDev, 201);
    await device(actor, 201);
    const a = await bookingNotice(child, { action: 'notice.discipline_change', actor });
    assert.equal(new Date(a.changes.expires_at).getTime(), (await q(
      `SELECT x.starts_at FROM bookings b JOIN class_sessions x ON x.id = b.session_id WHERE b.id = $1`,
      [a.resource_id]))[0].starts_at.getTime());
    assert.equal(a.changes.recipients.length, 5); // el aviso registra a todos
    const d = await deliveries(a.id);
    assert.deepEqual(d.map((x) => [x.recipient_id, x.channel]).sort(),
      [[withDev, 'push'], [noDev, 'email']].sort());
    // Facturación: notice() de JS, solo email aunque tenga dispositivo.
    const res = crypto.randomUUID();
    await notice(servicePool, { action: 'notice.payment_failed', actorId: admin, type: 'invoice', resourceId: res,
      recipients: [withDev] });
    const [b] = await q(`SELECT id FROM audit_log WHERE resource_id = $1`, [res]);
    assert.deepEqual((await deliveries(b.id)).map((x) => x.channel), ['email']);
    await q(`DELETE FROM audit_log WHERE id = $1`, [b.id]);
    await q(`UPDATE notice_deliveries SET status = 'skipped' WHERE audit_id = $1`, [a.id]); // fuera del worker
  });

  await run('envío: dos dispositivos reciben el payload cifrado con tag, Topic y TTL acotado', async () => {
    const alu = await person('alumno', { name: 'Lucía Push' });
    const [d1, d2] = [await device(alu, 201), await device(alu, 201)];
    const a = await bookingNotice(alu, { offset: '2 hours' });
    assert.equal(await send(), 1);
    const [del] = await deliveries(a.id);
    assert.deepEqual([del.channel, del.status, del.attempts], ['push', 'sent', 1]);
    for (const d of [d1, d2]) {
      const [r] = got(d);
      assert.equal(r.headers['content-encoding'], 'aes128gcm');
      assert.equal(r.headers.topic, a.id.replaceAll('-', ''));
      const ttl = Number(r.headers.ttl);
      assert.ok(ttl > 7000 && ttl <= 7200, `TTL ${ttl}`);
      assert.match(r.headers.authorization, /^vapid t=.+, k=/);
      const p = decrypt(d, r.body);
      assert.equal(p.tag, a.id);
      assert.equal(p.title, 'Sesión cancelada');
      assert.match(p.body, new RegExp(`^${tag}-BJJ, .+ \\(Lucía Push\\): la academia ha cancelado la sesión$`));
      assert.equal(p.url, `${process.env.APP_URL}/bookings`);
    }
  });

  await run('envío: 410 en uno lo borra y queda sent; 410 en todos → skipped no_subscription', async () => {
    const alu = await person('alumno');
    const [ok, gone] = [await device(alu, 201), await device(alu, 410)];
    const a = await bookingNotice(alu);
    await send();
    assert.equal((await deliveries(a.id))[0].status, 'sent');
    assert.deepEqual([await deviceCount(ok.endpoint), await deviceCount(gone.endpoint)], [1, 0]);

    const alu2 = await person('alumno');
    const [g1, g2] = [await device(alu2, 410), await device(alu2, 404)];
    const b = await bookingNotice(alu2);
    await send();
    const [del] = await deliveries(b.id);
    assert.deepEqual([del.status, del.last_error], ['skipped', 'no_subscription']);
    assert.deepEqual([await deviceCount(g1.endpoint), await deviceCount(g2.endpoint)], [0, 0]);
    // Sin dispositivos al enviar (canal ya decidido): skipped sin intentarlo.
    const c = await bookingNotice(alu, {});
    await q(`DELETE FROM push_subscriptions WHERE profile_id = $1`, [alu]);
    await send();
    assert.deepEqual((await deliveries(c.id)).map((x) => [x.status, x.last_error, x.attempts]),
      [['skipped', 'no_subscription', 0]]);
  });

  await run('envío: 429 y 500 → pending con espera; 401 y 403 → failed sin borrar', async () => {
    for (const code of [429, 500]) {
      const alu = await person('alumno');
      const d = await device(alu, code);
      const a = await bookingNotice(alu);
      await send();
      const [del] = await deliveries(a.id);
      assert.deepEqual([del.status, del.attempts, del.last_error], ['pending', 1, `push ${code}`], code);
      assert.ok(del.wait_s > 50 && del.wait_s <= 60, `${code}: espera ${del.wait_s}`);
      assert.equal(await deviceCount(d.endpoint), 1);
      await q(`UPDATE notice_deliveries SET status = 'skipped' WHERE id = $1`, [del.id]);
    }
    for (const code of [401, 403]) {
      const alu = await person('alumno');
      const d = await device(alu, code);
      const a = await bookingNotice(alu);
      await send();
      const [del] = await deliveries(a.id);
      assert.deepEqual([del.status, del.last_error], ['failed', `push ${code}`], code);
      assert.equal(await deviceCount(d.endpoint), 1, code);
    }
  });

  await run('envío: caducado al empezar la sesión → skipped stale, sin enviar', async () => {
    const alu = await person('alumno');
    const d = await device(alu, 201);
    const a = await bookingNotice(alu, { offset: '-1 minute' });
    await send();
    assert.deepEqual((await deliveries(a.id)).map((x) => [x.status, x.last_error]), [['skipped', 'stale']]);
    assert.equal(got(d).length, 0);
  });

  await run('agrupar: revoke_coverage de un alumno con 3 reservas → 3 avisos, 1 entrega por tutor, un mensaje', async () => {
    const child = await person('alumno', { birth: '2016-05-05', email: false, name: 'Nico Grupo' });
    const [t1, t2] = [await person('tutor'), await person('tutor')];
    for (const t of [t1, t2]) await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [t, child]);
    const d1 = await device(t1, 201);
    const bs = [await booking(child, '3 days'), await booking(child, '20 hours'), await booking(child, '5 days')];
    await inTx((c) => c.query(`SELECT revoke_coverage($1)`, [child])); // sin suscripción: no cubre ninguna
    const notices = await q(`SELECT * FROM audit_log WHERE resource_id = ANY($1) ORDER BY created_at, id`,
      [bs.map((b) => b.id)]);
    assert.equal(notices.length, 3);
    const all = await q(`SELECT * FROM notice_deliveries WHERE audit_id = ANY($1)`, [notices.map((n) => n.id)]);
    assert.deepEqual(all.map((x) => [x.recipient_id, x.channel]).sort(), [[t1, 'push'], [t2, 'email']].sort());
    outbox.length = 0;
    await send();
    const p = decrypt(d1, got(d1)[0].body);
    assert.equal(p.title, 'Reservas canceladas');
    assert.equal(p.body, 'Se han cancelado 3 reservas de Nico Grupo: ya no las cubre su suscripción');
    // TTL: hasta la sesión más próxima (20 h).
    assert.ok(Number(got(d1)[0].headers.ttl) <= 72_000);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].subject, 'Reservas canceladas de Nico Grupo');
    assert.equal((outbox[0].text.match(/^· /gm) ?? []).length, 3);
    assert.ok(outbox[0].text.includes(`${process.env.APP_URL}/bookings`));
    assert.match(outbox[0].text, /email de servicio sobre tus reservas en Kaizen/);
  });

  await run('re-firma: destinatarios, exclusiones, primera publicación y solo admin', async () => {
    const c = await servicePool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'admin', true)`,
        [admin]);
      const p = async (role, birth = null) => {
        const id = crypto.randomUUID();
        await c.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`, [id, `${tag}-rf`, birth]);
        await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
        return id;
      };
      const [plan] = (await c.query(`INSERT INTO plans (name, price_cents) VALUES ($1, 1000) RETURNING id`,
        [`${tag}-plan`])).rows;
      const sub = (student, payer, status = 'active') => c.query(
        `INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
         VALUES ($1, $2, $3, $4, $5)`, [student, payer, plan.id, status, `sub_${crypto.randomUUID()}`]);
      const sign = (profile, by, type, version) => c.query(
        `INSERT INTO user_agreements (id, profile_id, signed_by, type, version) VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), profile, by, type, version]);
      const guard = (t, m) => c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [t, m]);
      // Versiones: old (retirada antes), prev (la que se retira ahora), new. Las reales se apartan en la transacción.
      const publish = async (type) => {
        await c.query(`UPDATE agreement_documents SET published_at = NULL, retired_at = NULL WHERE type = $1`, [type]);
        const doc = async (v, published, retired) => (await c.query(
          `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at, retired_at)
           VALUES (gen_random_uuid(), $1, $2, 'x.pdf', 'x', $3, $4) RETURNING id`,
          [type, `${v}`, published, retired])).rows[0].id;
        await doc('77.1', '2020-01-01', '2021-01-01');
        await doc('77.2', '2021-01-01', '2022-01-01');
        const id = await doc('77.3', '2022-01-01', null);
        await c.query(`SELECT agreement_notice($1)`, [id]);
        return (await c.query(`SELECT a.changes, array(SELECT recipient_id FROM notice_deliveries WHERE audit_id = a.id
                                 ORDER BY recipient_id) AS delivered
                                 FROM audit_log a WHERE a.resource_id = $1::text`, [id])).rows;
      };

      // waiver: adulto con suscripción viva (sí), sin suscripción (no), firmó otra versión (no),
      // con seguro en vigor (no), con suscripción impagada (sí), menor firmado por su tutor (sus 2 tutores).
      const yes = await p('alumno');
      const noSub = await p('alumno');
      const older = await p('alumno');
      const insured = await p('alumno');
      const unpaid = await p('alumno');
      const kid = await p('alumno', '2016-05-05');
      const kid2 = await p('alumno', '2015-01-01');
      const [t1, t2] = [await p('tutor'), await p('tutor')];
      for (const [x, s] of [[yes, 'active'], [older, 'active'], [insured, 'past_due'], [unpaid, 'unpaid']]) await sub(x, x, s);
      await c.query(`INSERT INTO insurances (student_id, payer_id, status, bracket, stripe_subscription_id)
                     VALUES ($1, $1, 'active', 'adult', $2)`, [insured, `sub_ins_${insured}`]);
      for (const x of [yes, noSub, insured, unpaid]) await sign(x, x, 'waiver', '77.2');
      await sign(older, older, 'waiver', '77.1');
      for (const k of [kid, kid2]) {
        await guard(t1, k);
        await guard(t2, k);
        await sub(k, t1);
        await sign(k, t1, 'waiver', '77.2');
      }
      const [w] = await publish('waiver');
      assert.deepEqual([w.changes.type, w.changes.version, w.changes.previous_version], ['waiver', '77.3', '77.2']);
      assert.deepEqual(w.delivered, [yes, unpaid, t1, t2].sort(), 'waiver: una entrega por tutor aunque haya 2 hijos');

      // data_protection: tutor por su propio (con hijo con suscripción viva); tutor sin hijo con suscripción no;
      // hijo con 18 sin reclamar (firmado por su tutor cuando era menor) no avisa a nadie.
      const t3 = await p('tutor');
      const lonely = await p('tutor');
      const grown = await p('alumno', '2000-01-01');
      const t4 = await p('tutor');
      const lonelyKid = await p('alumno', '2016-01-01');
      await guard(t3, kid);
      await guard(t4, grown);
      await guard(lonely, lonelyKid);
      await sub(grown, t4);
      await sign(t3, t3, 'data_protection', '77.2');
      await sign(lonely, lonely, 'data_protection', '77.2');
      await sign(grown, t4, 'data_protection', '77.2');
      const [dp] = await publish('data_protection');
      assert.deepEqual(dp.delivered, [t3]);

      // Primera publicación de un tipo (las reales pasan a borrador en la transacción): sin aviso.
      await c.query(`UPDATE agreement_documents SET published_at = NULL, retired_at = NULL WHERE type = 'rights_of_image'`);
      const { rows: [{ id: first }] } = await c.query(
        `INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at)
         VALUES (gen_random_uuid(), 'rights_of_image', '77.9', 'x.pdf', 'x', now()) RETURNING id`);
      await c.query(`SELECT agreement_notice($1)`, [first]);
      assert.equal((await c.query(`SELECT 1 FROM audit_log WHERE resource_id = $1::text`, [first])).rowCount, 0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    // Un no admin (app_user) que la llama → 42501.
    const alu = await person('alumno');
    await assert.rejects(withRls({ uid: alu, role: 'alumno' },
      (x) => x.query(`SELECT agreement_notice($1)`, [crypto.randomUUID()]), { commit: false }), { code: '42501' });
  });

  await run('dispositivos: alta, traspaso, baja; RLS; sin INSERT directo; profesor y admin 403; validación', async () => {
    const [a, b] = [await person('alumno'), await person('tutor')];
    Object.assign(roleOf, { [a]: 'alumno', [b]: 'tutor', [prof]: 'profesor', [admin]: 'admin' });
    const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
    const keys = clientKeys();
    assert.equal((await http('POST', '/me/push-subscriptions', a, { endpoint, keys })).status, 201);
    assert.equal((await http('POST', '/me/push-subscriptions', a, { endpoint, keys })).status, 201); // idempotente
    const mine = (uid) => withRls({ uid, role: roleOf[uid] },
      async (x) => (await x.query(`SELECT endpoint FROM push_subscriptions`)).rows.map((r) => r.endpoint));
    assert.deepEqual(await mine(a), [endpoint]);
    // Traspaso: el mismo endpoint desde b pasa a ser suyo; a deja de verlo.
    assert.equal((await http('POST', '/me/push-subscriptions', b, { endpoint, keys: clientKeys() })).status, 201);
    assert.deepEqual([await mine(a), await mine(b)], [[], [endpoint]]);
    // a no borra el de b (204, sin distinguirlo); b sí.
    assert.equal((await http('DELETE', '/me/push-subscriptions', a, { endpoint })).status, 204);
    assert.equal(await deviceCount(endpoint), 1);
    assert.equal((await http('DELETE', '/me/push-subscriptions', b, { endpoint })).status, 204);
    assert.equal(await deviceCount(endpoint), 0);
    assert.equal((await http('DELETE', '/me/push-subscriptions', b, { endpoint })).status, 204); // ya no existe
    // app_user: ni INSERT ni UPDATE directos.
    await assert.rejects(withRls({ uid: a, role: 'alumno' }, (x) => x.query(
      `INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES ($1, 'https://x', 'k', 'a')`, [a]),
    { commit: false }), /permission denied/);
    for (const who of [prof, admin]) {
      assert.equal((await http('POST', '/me/push-subscriptions', who, { endpoint, keys })).status, 403);
      assert.equal((await http('DELETE', '/me/push-subscriptions', who, { endpoint })).status, 403);
    }
    assert.equal((await http('POST', '/me/push-subscriptions', null, { endpoint, keys })).status, 401);
    const bad = [
      'http://fcm.googleapis.com/fcm/send/x', 'https://evil.example.com/x', 'https://127.0.0.1/x', 'https://[::1]/x',
      'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x',
      'https://push.services.mozilla.com/x', 'no es una url', 42,
    ];
    for (const e of bad) {
      const r = await http('POST', '/me/push-subscriptions', a, { endpoint: e, keys });
      assert.deepEqual([r.status, r.body?.code], [400, 'invalid_field'], String(e));
    }
    for (const k of [{}, { ...keys, p256dh: '' }, { ...keys, auth: 'no base64!' }, { ...keys, auth: 'AAAA' }]) {
      assert.equal((await http('POST', '/me/push-subscriptions', a, { endpoint, keys: k })).status, 400, JSON.stringify(k));
    }
    for (const ok of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x',
      'https://web.push.apple.com/x']) {
      assert.equal((await http('POST', '/me/push-subscriptions', a, { endpoint: ok, keys })).status, 201, ok);
    }
    const r = await http('GET', '/push/vapid-public-key', a);
    assert.deepEqual([r.status, r.body], [200, { key: vapid.publicKey }]);
    assert.equal((await http('GET', '/push/vapid-public-key', null)).status, 401);
  });

  await run('contenido: los 5 avisos, push y email de respaldo, con el alumno y sin fecha de nacimiento ni edad', async () => {
    const child = await person('alumno', { birth: '2016-05-05', email: false, name: 'Nico <Hijo>' });
    const tutor = await person('tutor', { name: 'Tomás Tutor' });
    await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [tutor, child]);
    const actions = ['notice.no_coverage', 'notice.booking_promoted', 'notice.session_cancelled', 'notice.discipline_change'];
    const rows = [];
    for (const action of actions) rows.push(await bookingNotice(child, { action }));
    rows.push({ id: crypto.randomUUID(), action: 'notice.agreement_published', resource_type: 'agreement_document',
      changes: { type: 'waiver', version: '2.0', previous_version: '1.0' }, created_at: new Date() });
    for (const a of rows) {
      const d = { ...a, audit_id: a.id, recipient_id: tutor };
      const p = await compose(servicePool, { ...d, channel: 'push' });
      const e = await compose(servicePool, { ...d, channel: 'email' });
      const all = `${JSON.stringify(p)}\n${e.subject}\n${e.text}\n${e.html}`;
      assert.deepEqual(Object.keys(p).sort(), ['body', 'tag', 'title', 'url'], a.action);
      assert.equal(p.tag, a.id);
      assert.match(e.text, /^Hola, Tomás Tutor:/, a.action);
      assert.ok(e.text.includes(p.url) && e.html.includes(`href="${p.url}"`), a.action);
      assert.match(e.text, /email de servicio sobre tus (reservas|acuerdos) en Kaizen/, a.action);
      assert.doesNotMatch(all, /undefined|NaN|Invalid Date|null/, a.action);
      assert.doesNotMatch(all, /2016|5 de mayo|\d+ años|menor/i, `${a.action}: sin fecha de nacimiento ni edad`);
      if (a.resource_type === 'booking') {
        assert.ok(p.body.includes('(Nico <Hijo>)') && e.html.includes('Nico &#60;Hijo&#62;') && !e.html.includes('<Hijo>'), a.action);
        assert.equal(p.url, `${process.env.APP_URL}/bookings`);
      } else {
        assert.equal(p.body, 'Hay una versión nueva de la exención de responsabilidad (waiver). Fírmala para seguir reservando.');
        assert.equal(p.url, `${process.env.APP_URL}/agreements`);
      }
    }
    await q(`UPDATE notice_deliveries SET status = 'skipped' WHERE audit_id = ANY($1)`, [rows.map((r) => r.id)]);
  });
} finally {
  server.close();
  pushServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
  await q(`UPDATE notice_deliveries SET next_attempt_at = next_attempt_at - interval '100 years' WHERE id = ANY($1::uuid[])`, [parked]);
  await q(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]); // CASCADE a notice_deliveries
  await q(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
  await q(`DELETE FROM disciplines WHERE id = $1`, [disc.id]);
  await q(`DELETE FROM guardianships WHERE tutor_id = ANY($1::uuid[]) OR minor_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM auth_credentials WHERE profile_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]); // CASCADE a push_subscriptions
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
