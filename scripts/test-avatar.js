// B24: foto de perfil (ADR 0019). Quién toca la de quién (dueño, tutor de un menor, el admin solo la quita), ficheros
// no válidos, que cambiar o quitar borra el fichero viejo, y dónde sale la URL. Por HTTP con un express en memoria.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import meRouter from '../src/routes/me.js';
import adminProfilesRouter from '../src/routes/admin/profiles.js';
import attendanceRouter from '../src/routes/attendance.js';
import profilesRouter from '../src/routes/profiles.js';
import avatarsRouter from '../src/routes/avatars.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params);

const tag = `tav${crypto.randomBytes(3).toString('hex')}`;
// [rol, adulto]
const people = { admin: 'admin', prof: 'profesor', ana: 'alumno', tom: 'tutor', pep: 'tutor', kid: null };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
let session;
let disc;
const realError = console.error;

const app = express().use(express.json())
  .use('/me', meRouter).use('/admin', adminProfilesRouter).use('/sessions', attendanceRouter)
  .use('/profiles', profilesRouter).use('/avatars', avatarsRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, who, { body, type } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(who && { authorization: `Bearer ${signToken({ sub: U[who], role: people[who] ?? 'alumno' })}` }), ...(type && { 'content-type': type }) },
    body,
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
// Lo mínimo que pasa por una imagen: su firma y algo de relleno.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2000)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
const upload = (who, buf = JPEG, type = 'image/jpeg', query = '') => http('PUT', `/me/avatar${query}`, who, { body: buf, type });
const avatarOf = async (k) => (await q(`SELECT avatar FROM profiles WHERE id = $1`, [U[k]])).rows[0].avatar;

try {
  for (const [k, role] of Object.entries(people)) {
    await q(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, $2, $3)`,
      [U[k], `${tag}-${k}`, k === 'kid' ? '2016-03-03' : '1990-03-03']);
    if (role) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
    if (k !== 'kid') await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [U[k], `${tag}-${k}@kz.test`]);
  }
  await q(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [U.tom, U.kid]);
  disc = (await q(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-d`])).rows[0].id;
  session = (await q(
    `INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
     VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 60, 10, 'scheduled') RETURNING id`,
    [disc, U.prof])).rows[0].id;
  for (const k of ['ana', 'kid']) {
    await q(`INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed')`, [session, U[k]]);
  }
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('subir la propia: se guarda, se sirve con su tipo y sin poder ejecutarse, y sale en GET /me', async () => {
    const r = await upload('ana');
    assert.equal(r.status, 200);
    assert.match(r.body.avatar, /^[0-9a-f]{64}\.jpg$/);
    const img = await http('GET', `/avatars/${r.body.avatar}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.match(img.headers.get('content-security-policy'), /default-src 'none'/);
    assert.ok(img.body.equals(JPEG));
    assert.equal((await http('GET', '/me', 'ana')).body.avatar, r.body.avatar);
  });

  await run('cambiarla borra el fichero viejo; PNG vale', async () => {
    const old = await avatarOf('ana');
    const r = await upload('ana', PNG, 'image/png');
    assert.match(r.body.avatar, /\.png$/);
    assert.equal((await http('GET', `/avatars/${old}`)).status, 404);
    assert.equal((await http('GET', `/avatars/${r.body.avatar}`)).headers.get('content-type'), 'image/png');
  });

  await run('ficheros no válidos: otro tipo, firma que no cuadra, vacío o más de 1 MB', async () => {
    const before = await avatarOf('ana');
    const bad = async (buf, type, status, code) => {
      const r = await upload('ana', buf, type);
      assert.deepEqual([r.status, r.body.code], [status, code], `${type} ${buf.length}`);
    };
    await bad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 400, 'invalid_image');
    await bad(Buffer.from('GIF89a…'), 'image/jpeg', 400, 'invalid_image'); // dice JPEG pero no lo es
    await bad(PNG, 'image/jpeg', 400, 'invalid_image'); // la firma tiene que cuadrar con el tipo
    await bad(Buffer.alloc(0), 'image/jpeg', 400, 'invalid_image');
    await bad(Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]), 'image/jpeg', 413, 'too_large');
    assert.equal(await avatarOf('ana'), before, 'nada cambia');
  });

  await run('nombres de fichero raros al servir → 404, sin salir del directorio', async () => {
    for (const n of ['..%2F..%2Fpackage.json', 'x.jpg', `${'a'.repeat(64)}.svg`]) {
      assert.equal((await http('GET', `/avatars/${n}`)).status, 404, n);
    }
  });

  await run('el tutor sube y quita la del hijo; otro tutor, un alumno o el admin no (403)', async () => {
    const r = await upload('tom', JPEG, 'image/jpeg', `?profile_id=${U.kid}`);
    assert.equal(r.status, 200);
    assert.equal(await avatarOf('kid'), r.body.avatar);
    for (const who of ['pep', 'ana', 'admin']) {
      const x = await upload(who, JPEG, 'image/jpeg', `?profile_id=${U.kid}`);
      assert.deepEqual([x.status, x.body.code], [403, 'not_guardian'], who);
    }
    assert.equal((await http('DELETE', `/me/avatar?profile_id=${U.kid}`, 'pep')).status, 403);
    const [a] = (await q(`SELECT actor_id FROM audit_log WHERE action = 'profile.avatar_set' AND resource_id = $1`, [U.kid])).rows;
    assert.equal(a.actor_id, U.tom);
  });

  await run('dónde sale: hijos del tutor, admin (lista y ficha) y asistentes del profesor', async () => {
    const kidAvatar = await avatarOf('kid');
    const children = (await http('GET', '/me/children', 'tom')).body.children;
    assert.equal(children.find((c) => c.id === U.kid).avatar, kidAvatar);
    const list = (await http('GET', `/admin/profiles?q=${tag}-kid`, 'admin')).body.profiles;
    assert.equal(list[0].avatar, kidAvatar);
    assert.equal((await http('GET', `/admin/profiles/${U.kid}`, 'admin')).body.profile.avatar, kidAvatar);
    const att = (await http('GET', `/sessions/${session}/attendance`, 'prof')).body;
    const rows = att.attendees ?? att.students ?? att.rows ?? att;
    assert.equal(rows.find((x) => x.student_id === U.kid).avatar, kidAvatar);
  });

  await run('perfil público: la foto solo con su campo visible', async () => {
    await q(`UPDATE profiles SET is_public = true, visible_fields = '{}'::jsonb WHERE id = $1`, [U.ana]);
    assert.ok(!('avatar' in (await http('GET', `/profiles/${U.ana}`, 'prof')).body.profile), 'oculta, ni siquiera nula');
    await q(`UPDATE profiles SET visible_fields = '{"photo": true}'::jsonb WHERE id = $1`, [U.ana]);
    assert.equal((await http('GET', `/profiles/${U.ana}`, 'prof')).body.profile.avatar, await avatarOf('ana'));
  });

  await run('quitar la propia: 204, sin foto y el fichero ya no existe', async () => {
    const old = await avatarOf('ana');
    assert.equal((await http('DELETE', '/me/avatar', 'ana')).status, 204);
    assert.equal(await avatarOf('ana'), null);
    assert.equal((await http('GET', `/avatars/${old}`)).status, 404);
    assert.equal((await http('DELETE', '/me/avatar', 'ana')).status, 204, 'sin foto, también 204');
  });

  await run('el admin quita la del hijo: aviso al tutor sin motivo, auditado; un no admin no puede (403)', async () => {
    const old = await avatarOf('kid');
    assert.equal((await http('DELETE', `/admin/profiles/${U.kid}/avatar`, 'tom')).status, 403);
    assert.equal((await http('DELETE', `/admin/profiles/${U.kid}/avatar`, 'admin')).status, 204);
    assert.equal(await avatarOf('kid'), null);
    assert.equal((await http('GET', `/avatars/${old}`)).status, 404);
    const [n] = (await q(`SELECT actor_id, changes FROM audit_log WHERE action = 'notice.avatar_removed' AND resource_id = $1`, [U.kid])).rows;
    assert.deepEqual([n.actor_id, n.changes.recipients], [U.admin, [U.tom]]);
  });
} finally {
  console.error = realError;
  server.close();
  const { deleteAvatarFile } = await import('../src/services/avatar.js');
  for (const { avatar } of (await q(`SELECT avatar FROM profiles WHERE id = ANY($1::uuid[]) AND avatar IS NOT NULL`, [ids])).rows) {
    await deleteAvatarFile(avatar);
  }
  await q(`DELETE FROM notice_deliveries WHERE audit_id IN (SELECT id FROM audit_log WHERE resource_id = ANY($1::text[]))`, [ids]);
  await q(`DELETE FROM audit_log WHERE resource_id = ANY($1::text[])`, [ids]);
  await q(`DELETE FROM bookings WHERE session_id = $1`, [session]);
  await q(`DELETE FROM class_sessions WHERE id = $1`, [session]);
  await q(`DELETE FROM disciplines WHERE id = $1`, [disc]);
  await q(`DELETE FROM guardianships WHERE tutor_id = $1`, [U.tom]);
  await q(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
  await q(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
