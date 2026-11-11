// B31: registro de jornada de los profesores empleados (CONTEXT § Registro de jornada; ADR 0025). Por HTTP con un express
// en memoria (tipo de relación, fichar, secuencia, correcciones, lectura, CSV) y por SQL con app_user (solo añadir, RLS).
// La purga y el aviso de jornada abierta, con las funciones de la tarea nocturna. En una base efímera (with-temp-db):
// lo que se ficha no se puede borrar, así que no hay limpieza.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { qrCode, qrStep } from '../src/services/checkin.js';
import clockRouter from '../src/routes/clock.js';
import adminClockRouter from '../src/routes/admin/clock.js';
import { purgeClock, warnOpenDays, csvCell } from '../src/services/clock.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const q = (sql, params) => servicePool.query(sql, params);

const tag = `tck${crypto.randomBytes(3).toString('hex')}`;
const people = { admin: 'admin', emp: 'profesor', emp2: 'profesor', emp3: 'profesor', emp4: 'profesor', emp5: 'profesor', auto: 'profesor', ana: 'alumno' };
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const realError = console.error;

const app = express().use(express.json()).use('/me/clock', clockRouter).use('/admin', adminClockRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, url, who, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { authorization: `Bearer ${signToken({ sub: U[who], role: people[who] })}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const clock = (who, kind, extra = {}) => http('POST', '/me/clock', who, { kind, ...extra });
// Fichaje con hora puesta (solo con service_role: app_user no elige la hora).
const raw = async (k, kind, at) => (await q(
  `INSERT INTO clock_events (profile_id, kind, at, origin) VALUES ($1, $2, $3, 'app') RETURNING id`, [U[k], kind, at])).rows[0].id;
// app_user: el error SQL o null.
const sqlAs = async (k, sql, params) => {
  try { await withRls({ uid: U[k], role: people[k] }, (c) => c.query(sql, params)); return null; } catch (e) { return e.code; }
};

try {
  for (const [k, role] of Object.entries(people)) {
    await q(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [U[k], `${tag}-${k}`]);
    await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
    await q(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`, [U[k], `${tag}-${k}@kz.test`]);
  }
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  await run('tipo de relación: por defecto autónomo; el admin marca empleado; solo profesores; valor válido', async () => {
    const r0 = await http('GET', '/me/clock', 'emp');
    assert.equal(r0.status, 200);
    assert.equal(r0.body.profile.employment, 'self_employed');
    for (const k of ['emp', 'emp2', 'emp3', 'emp4', 'emp5']) {
      const r = await http('PUT', `/admin/profiles/${U[k]}/employment`, 'admin', { employment: 'employee' });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { profile_id: U[k], employment: 'employee' });
    }
    assert.equal((await http('PUT', `/admin/profiles/${U.ana}/employment`, 'admin', { employment: 'employee' })).body.code, 'not_professor');
    assert.equal((await http('PUT', `/admin/profiles/${U.emp}/employment`, 'admin', { employment: 'x' })).status, 400);
    assert.equal((await http('PUT', `/admin/profiles/${U.emp}/employment`, 'emp', { employment: 'employee' })).status, 403);
    const { rowCount } = await q(`SELECT 1 FROM audit_log WHERE action = 'profile.employment' AND resource_id = $1`, [U.emp]);
    assert.equal(rowCount, 1);
  });

  await run('lista de empleados: solo profesores empleados, por nombre; solo el admin', async () => {
    const r = await http('GET', '/admin/clock/employees', 'admin');
    assert.equal(r.status, 200);
    const mine = r.body.employees.filter((e) => e.display_name.startsWith(tag));
    assert.deepEqual(mine.map((e) => e.id).sort(), ['emp', 'emp2', 'emp3', 'emp4', 'emp5'].map((k) => U[k]).sort());
    assert.deepEqual(Object.keys(mine[0]).sort(), ['display_name', 'id']);
    assert.deepEqual(mine.map((e) => e.display_name), [...mine.map((e) => e.display_name)].sort());
    assert.equal((await http('GET', '/admin/clock/employees', 'emp')).status, 403);
  });

  await run('autónomo → 403 not_employee al fichar; un alumno no entra', async () => {
    const r = await clock('auto', 'in');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'not_employee');
    assert.equal((await clock('ana', 'in')).status, 403);
    assert.equal((await http('GET', '/me/clock', 'ana')).status, 403);
    // Tampoco correcciones: ni las pide él ni se las hace el admin (servicio y política).
    const at = new Date(Date.now() - 3600_000).toISOString();
    assert.equal((await http('POST', '/me/clock/corrections', 'auto', { kind: 'in', at, reason: 'x' })).body.code, 'not_employee');
    assert.equal((await http('POST', '/admin/clock/corrections', 'admin', { profile_id: U.auto, kind: 'in', at, reason: 'x' })).body.code, 'not_employee');
    assert.equal(await sqlAs('auto', `INSERT INTO clock_corrections (profile_id, kind, at, reason, requested_by)
                                      VALUES ($1, 'in', now() - interval '1 hour', 'x', $1)`, [U.auto]), '42501');
    assert.equal(await sqlAs('admin', `INSERT INTO clock_corrections (profile_id, kind, at, reason, requested_by)
                                       VALUES ($1, 'in', now() - interval '1 hour', 'x', $2)`, [U.auto, U.admin]), '42501');
  });

  await run('empleado ficha con la hora del servidor; la del cliente u otro campo → 400', async () => {
    assert.equal((await clock('emp', 'in', { at: '2000-01-01T00:00:00Z' })).status, 400);
    assert.equal((await clock('emp', 'llegar')).status, 400);
    const t0 = Date.now();
    const r = await clock('emp', 'in');
    assert.equal(r.status, 201);
    assert.equal(r.body.state, 'in');
    assert.equal(r.body.event.kind, 'in');
    assert.equal(r.body.event.origin, 'app');
    assert.ok(Math.abs(new Date(r.body.event.at) - t0) < 5000);
  });

  await run('secuencia: sin dos entradas, salida en pausa ni vuelta sin pausa → 409 con el estado', async () => {
    let r = await clock('emp', 'in');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'invalid_sequence');
    assert.equal(r.body.state, 'in');
    assert.equal((await clock('emp', 'pause_end')).status, 409);
    assert.equal((await clock('emp', 'pause_start')).status, 201);
    r = await clock('emp', 'out');
    assert.deepEqual([r.status, r.body.state], [409, 'paused']);
    assert.equal((await clock('emp', 'pause_end')).status, 201);
    assert.equal((await clock('emp', 'out')).status, 201);
    r = await clock('emp', 'out');
    assert.deepEqual([r.status, r.body.state], [409, 'out']);
    r = await http('GET', '/me/clock', 'emp');
    assert.equal(r.body.state, 'out');
    assert.equal(r.body.events.length, 4);
  });

  await run('tablet: con el QR vigente, origen tablet; QR malo → 400 invalid_qr', async () => {
    assert.equal((await clock('emp', 'in', { code: 'x'.repeat(16) })).body.code, 'invalid_qr');
    const r = await clock('emp', 'in', { code: qrCode(qrStep(30)) });
    assert.equal(r.status, 201);
    assert.equal(r.body.event.origin, 'tablet');
    assert.equal((await clock('emp', 'out')).status, 201);
  });

  await run('solo añadir: UPDATE y DELETE fallan en la BD (profesor, admin y UPDATE de service_role); la hora no se elige', async () => {
    const [{ id }] = (await q(`SELECT id FROM clock_events WHERE profile_id = $1 LIMIT 1`, [U.emp])).rows;
    for (const k of ['emp', 'admin']) {
      for (const sql of [`UPDATE clock_events SET at = now() WHERE id = $1`, `DELETE FROM clock_events WHERE id = $1`,
        `UPDATE clock_corrections SET reason = 'x' WHERE id = $1`, `DELETE FROM clock_corrections WHERE id = $1`,
        `DELETE FROM clock_correction_resolutions WHERE correction_id = $1`]) {
        assert.equal(await sqlAs(k, sql, [id]), '42501', `${k}: ${sql}`);
      }
    }
    await assert.rejects(q(`UPDATE clock_events SET at = now() WHERE id = $1`, [id]), /append_only/);
    assert.equal(await sqlAs('emp', `INSERT INTO clock_events (profile_id, kind, at) VALUES ($1, 'in', now() - interval '1 day')`, [U.emp]), '42501');
    assert.equal(await sqlAs('emp', `INSERT INTO clock_events (profile_id, kind) VALUES ($1, 'in')`, [U.emp2]), '42501');
    assert.equal(await sqlAs('auto', `INSERT INTO clock_events (profile_id, kind) VALUES ($1, 'in')`, [U.auto]), '42501');
  });

  await run('corrección: el profesor solicita, el admin aplica; quedan original, corrección, autor y motivo', async () => {
    const day = await http('GET', '/me/clock', 'emp');
    const orig = day.body.events.find((e) => e.kind === 'in');
    const at = new Date(new Date(orig.at).getTime() - 3600_000).toISOString();
    assert.equal((await http('POST', '/me/clock/corrections', 'emp', { event_id: orig.id, at })).status, 400); // sin motivo
    assert.equal((await http('POST', '/me/clock/corrections', 'emp', { event_id: orig.id, at: '2999-01-01T00:00:00Z', reason: 'x' })).status, 400);
    for (const bad of ['2026-02-30T10:00:00Z', 'March 1 2026', '2026-03-01', '2026-03-01T25:00:00Z', 1767225600000]) {
      assert.equal((await http('POST', '/me/clock/corrections', 'emp', { event_id: orig.id, at: bad, reason: 'x' })).body.field, 'at', String(bad));
    }
    assert.equal((await http('POST', '/me/clock/corrections', 'emp', { event_id: orig.id, at, reason: '  ' })).body.field, 'reason');
    let r = await http('POST', '/me/clock/corrections', 'emp', { event_id: orig.id, at, reason: 'Entré una hora antes' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'pending');
    const cid = r.body.id;
    // Otro profesor no corrige lo ajeno.
    assert.equal((await http('POST', '/me/clock/corrections', 'emp2', { event_id: orig.id, at, reason: 'x' })).status, 404);
    const before = (await http('GET', '/me/clock', 'emp')).body.total_seconds;
    assert.equal((await http('POST', `/admin/clock/corrections/${cid}/apply`, 'emp')).status, 403);
    r = await http('POST', `/admin/clock/corrections/${cid}/apply`, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'applied');
    assert.equal((await http('POST', `/admin/clock/corrections/${cid}/reject`, 'admin', { reason: 'no' })).body.code, 'already_resolved');
    const me = (await http('GET', '/me/clock', 'emp')).body;
    assert.equal(me.events.find((e) => e.id === orig.id).at, orig.at); // el original no cambia
    const c = me.corrections.find((x) => x.id === cid);
    assert.equal(c.status, 'applied');
    assert.equal(c.reason, 'Entré una hora antes');
    assert.equal(c.event_id, orig.id);
    assert.equal(c.requested_by.id, U.emp);
    assert.equal(c.resolved_by.id, U.admin);
    assert.equal(me.total_seconds - before, 3600);
    // Aviso al profesor al aplicar su solicitud (email); la solicitud solo va al panel: sin entregas.
    const channels = async (action, id) => (await q(
      `SELECT a.changes, ARRAY(SELECT channel FROM notice_deliveries d WHERE d.audit_id = a.id) AS ch
         FROM audit_log a WHERE a.action = $1 AND a.resource_id = $2`, [action, id])).rows[0];
    assert.deepEqual((await channels('notice.clock_correction_applied', cid)).ch, ['email']);
    assert.deepEqual((await channels('notice.clock_correction_requested', cid)).ch, []);
  });

  await run('corrección: el admin rechaza con motivo; sin motivo → 400; la que rompe la secuencia → 409', async () => {
    const me = (await http('GET', '/me/clock', 'emp')).body;
    const out = me.events.find((e) => e.kind === 'out');
    let r = await http('POST', '/me/clock/corrections', 'emp', { kind: 'in', at: new Date(new Date(out.at).getTime() - 1000).toISOString(), reason: 'olvidé' });
    assert.equal(r.status, 201);
    const cid = r.body.id;
    assert.equal((await http('POST', `/admin/clock/corrections/${cid}/reject`, 'admin', {})).status, 400);
    assert.equal((await http('POST', `/admin/clock/corrections/${cid}/apply`, 'admin')).body.code, 'invalid_sequence');
    r = await http('POST', `/admin/clock/corrections/${cid}/reject`, 'admin', { reason: 'No consta' });
    assert.equal(r.status, 200);
    const c = (await http('GET', '/me/clock', 'emp')).body.corrections.find((x) => x.id === cid);
    assert.deepEqual([c.status, c.resolution_reason], ['rejected', 'No consta']);
    const { rows: [n] } = await q(
      `SELECT a.changes, ARRAY(SELECT channel FROM notice_deliveries d WHERE d.audit_id = a.id AND d.recipient_id = $1) AS ch
         FROM audit_log a WHERE a.action = 'notice.clock_correction_rejected' AND a.resource_id = $2`, [U.emp, cid]);
    assert.deepEqual([n.ch, n.changes.resolution_reason], [['email'], 'No consta']);
  });

  await run('corregir una corrección: un fichaje añadido se corrige y se anula; cuenta la última aplicada, no la última pedida', async () => {
    const now = Date.now();
    const h = (n) => new Date(now - n * 3600_000).toISOString();
    let r = await http('POST', '/admin/clock/corrections', 'admin', { profile_id: U.emp5, kind: 'in', at: h(2), reason: 'No fichó' });
    assert.equal(r.status, 201);
    const added = r.body.id;
    const eff = async () => (await http('GET', `/admin/clock?profile_id=${U.emp5}`, 'admin')).body;
    assert.deepEqual((await eff()).days.flatMap((d) => d.events.map((x) => [x.id, x.at])), [[added, h(2)]]);
    // Una solicitud pendiente de añadir no se puede corregir.
    const pend = (await http('POST', '/me/clock/corrections', 'emp5', { kind: 'in', at: h(9), reason: 'x' })).body.id;
    assert.equal((await http('POST', '/me/clock/corrections', 'emp5', { event_id: pend, at: h(8), reason: 'x' })).body.code, 'event_not_found');
    const a = (await http('POST', '/me/clock/corrections', 'emp5', { event_id: added, at: h(4), reason: 'A' })).body.id;
    const b = (await http('POST', '/me/clock/corrections', 'emp5', { event_id: added, at: h(5), reason: 'B' })).body.id;
    assert.equal((await http('POST', `/admin/clock/corrections/${b}/apply`, 'admin')).status, 200);
    assert.equal((await http('POST', `/admin/clock/corrections/${a}/apply`, 'admin')).status, 200);
    let e = await eff();
    assert.deepEqual(e.days.flatMap((d) => d.events.map((x) => [x.id, x.at, x.corrected])), [[added, h(4), true]]);
    assert.equal(e.state, 'in');
    assert.equal(e.corrections.find((c) => c.id === a).event_id, added);
    r = await http('POST', '/admin/clock/corrections', 'admin', { profile_id: U.emp5, event_id: added, reason: 'Ese día no vino' });
    assert.equal(r.status, 201);
    e = await eff();
    assert.deepEqual([e.days.length, e.state], [0, 'out']);
  });

  await run('corrección directa del admin: aplicada al momento y aviso al profesor (email)', async () => {
    const adm = (await http('GET', `/admin/clock?profile_id=${U.emp}`, 'admin')).body;
    const out = adm.events.findLast((e) => e.kind === 'out');
    const r = await http('POST', '/admin/clock/corrections', 'admin', {
      profile_id: U.emp, event_id: out.id, at: out.at, reason: 'Salió más tarde' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'applied');
    const { rows: [n] } = await q(
      `SELECT a.changes, (SELECT array_agg(channel) FROM notice_deliveries d WHERE d.audit_id = a.id AND d.recipient_id = $1) AS ch
         FROM audit_log a WHERE a.action = 'notice.clock_corrected' AND a.resource_id = $2`, [U.emp, r.body.id]);
    assert.deepEqual(n.ch, ['email']);
    assert.equal(n.changes.reason, 'Salió más tarde');
    const c = (await http('GET', '/me/clock', 'emp')).body.corrections.find((x) => x.id === r.body.id);
    assert.equal(c.requested_by.id, U.admin);
    // La solicitud del profesor también avisa al panel (admins, sin entregas).
    const { rowCount } = await q(`SELECT 1 FROM audit_log WHERE action = 'notice.clock_correction_requested' AND changes->>'profile_id' = $1`, [U.emp]);
    assert.ok(rowCount >= 2);
  });

  // emp2 (horas de Madrid; los días y meses se cortan en su medianoche): 2026-02-28 23:00 → 03-01 01:00 (1 h en cada
  // mes); 03-28 22:00 → 03-29 04:00 CEST con pausa 23:00–23:30 (cambio de hora: 1,5 h el 28 y 3 h el 29); 03-31
  // 09:00–13:00 y 22:00 → 04-01 02:00 (2 h en marzo, 2 en abril); 2026-10-25 00:00 CEST → 06:00 CET (7 h reales).
  const E = {
    febIn: await raw('emp2', 'in', '2026-02-28T22:00:00Z'), febOut: await raw('emp2', 'out', '2026-03-01T00:00:00Z'),
    in28: await raw('emp2', 'in', '2026-03-28T21:00:00Z'), p1: await raw('emp2', 'pause_start', '2026-03-28T22:00:00Z'),
    p2: await raw('emp2', 'pause_end', '2026-03-28T22:30:00Z'), out29: await raw('emp2', 'out', '2026-03-29T02:00:00Z'),
    in31: await raw('emp2', 'in', '2026-03-31T07:00:00Z'), out31: await raw('emp2', 'out', '2026-03-31T11:00:00Z'),
    in31n: await raw('emp2', 'in', '2026-03-31T20:00:00Z'), outApr: await raw('emp2', 'out', '2026-04-01T00:00:00Z'),
    inOct: await raw('emp2', 'in', '2026-10-24T22:00:00Z'), outOct: await raw('emp2', 'out', '2026-10-25T05:00:00Z'),
  };

  await run('totales: cambio de hora y jornada que cruza la medianoche (y el fin de mes)', async () => {
    const mar = (await http('GET', '/me/clock?month=2026-03', 'emp2')).body;
    assert.equal(mar.total_seconds, 11.5 * 3600);
    assert.deepEqual(mar.days.map((d) => [d.date, d.worked_seconds, d.pause_seconds]),
      [['2026-03-01', 3600, 0], ['2026-03-28', 1.5 * 3600, 1800], ['2026-03-29', 3 * 3600, 0], ['2026-03-31', 6 * 3600, 0]]);
    assert.deepEqual(mar.days.find((d) => d.date === '2026-03-29').events.map((x) => x.kind), ['out']);
    const apr = (await http('GET', '/me/clock?month=2026-04', 'emp2')).body;
    assert.deepEqual(apr.days.map((d) => [d.date, d.worked_seconds]), [['2026-04-01', 2 * 3600]]);
    assert.equal((await http('GET', '/me/clock?month=2026-02', 'emp2')).body.total_seconds, 3600);
    assert.equal((await http('GET', '/me/clock?month=2026-10', 'emp2')).body.total_seconds, 7 * 3600);
    assert.equal((await http('GET', '/me/clock?month=2026-13', 'emp2')).status, 400);
  });

  await run('un profesor no lee el registro de otro (RLS y API); el admin sí', async () => {
    const n = async (k, sql) => withRls({ uid: U[k], role: people[k] }, async (c) => (await c.query(sql, [U.emp2])).rowCount);
    assert.equal(await n('emp', `SELECT 1 FROM clock_events WHERE profile_id = $1`), 0);
    assert.equal(await n('emp', `SELECT 1 FROM clock_effective WHERE profile_id = $1`), 0);
    assert.equal(await n('emp2', `SELECT 1 FROM clock_events WHERE profile_id = $1`), 12);
    assert.equal(await n('admin', `SELECT 1 FROM clock_events WHERE profile_id = $1`), 12);
    const other = (sql) => withRls({ uid: U.emp2, role: 'profesor' }, async (c) => (await c.query(sql, [U.emp])).rowCount);
    assert.equal(await other(`SELECT 1 FROM clock_corrections WHERE profile_id = $1`), 0);
    assert.equal(await other(`SELECT 1 FROM clock_correction_resolutions r JOIN clock_corrections c ON c.id = r.correction_id WHERE c.profile_id = $1`), 0);
    assert.ok(await n('admin', `SELECT 1 FROM clock_corrections WHERE profile_id <> $1`) > 0);
    assert.equal((await http('GET', `/admin/clock?profile_id=${U.emp2}&month=2026-03`, 'emp')).status, 403);
    const adm = await http('GET', `/admin/clock?profile_id=${U.emp2}&month=2026-03`, 'admin');
    assert.equal(adm.body.total_seconds, 11.5 * 3600);
    assert.equal(adm.body.profile.display_name, `${tag}-emp2`);
    assert.equal((await http('GET', `/admin/clock?profile_id=${U.ana}`, 'admin')).body.code, 'not_professor');
  });

  await run('CSV: BOM, una fila por fichaje y corrección, total del mes y celdas = + - @ escapadas', async () => {
    const r0 = await http('POST', '/admin/clock/corrections', 'admin', {
      profile_id: U.emp2, event_id: E.in31, at: '2026-03-31T07:00:00Z', reason: '=HYPERLINK("http://x")' });
    assert.equal(r0.status, 201);
    assert.equal((await http('GET', `/admin/clock/export?profile_id=${U.emp2}&month=2026-03&format=pdf`, 'admin')).status, 400);
    assert.equal((await http('GET', `/admin/clock/export?profile_id=${U.emp2}&month=2026-03&format=csv`, 'emp2')).status, 403);
    const r = await http('GET', `/admin/clock/export?profile_id=${U.emp2}&month=2026-03&format=csv`, 'admin');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="registro-jornada-2026-03-.+\.csv"/);
    assert.deepEqual([...r.body.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = r.body.subarray(3).toString('utf8').trim().split('\r\n');
    assert.equal(lines.filter((l) => l.startsWith('Fichaje;')).length, 8);
    assert.equal(lines.filter((l) => l.startsWith('Corrección;')).length, 1);
    assert.ok(lines.some((l) => l.includes(`"'=HYPERLINK(""http://x"")"`)), lines.join('\n'));
    const head = lines[0].split(';');
    assert.equal(head.at(-1), 'Total');
    const days = lines.filter((l) => l.startsWith('Total del día;'));
    assert.deepEqual(days.map((l) => [l.split(';')[1], l.split(';').at(-1)]),
      [['2026-03-01', '1:00'], ['2026-03-28', '1:30'], ['2026-03-29', '3:00'], ['2026-03-31', '6:00']]);
    assert.match(lines.at(-1), /^Total del mes;2026-03;/);
    assert.equal(lines.at(-1).split(';').length, head.length);
    assert.equal(lines.at(-1).split(';').at(-1), '11:30');
    assert.equal(lines.at(-1).split(';').at(-2), ''); // no en «Motivo de la resolución»
    assert.deepEqual(['\tx', '-1', '@a', '+a', 'ok'].map(csvCell), ["'\tx", "'-1", "'@a", "'+a", 'ok']);
    assert.equal(csvCell('\rx'), `"'\rx"`);
  });

  await run('jornada abierta: entrada sin salida a las 16 h → aviso al profesor y al admin, una sola vez', async () => {
    const inId = await raw('emp3', 'in', new Date(Date.now() - 17 * 3600_000).toISOString());
    await raw('emp4', 'in', new Date(Date.now() - 15 * 3600_000).toISOString());
    const r1 = await warnOpenDays();
    assert.ok(r1 >= 1);
    const notices = async (k) => (await q(`SELECT changes FROM audit_log WHERE action = 'notice.clock_open' AND changes->>'profile_id' = $1`, [U[k]])).rows;
    const [{ changes: n }] = await notices('emp3');
    assert.equal(n.event_id, inId);
    assert.ok(n.recipients.includes(U.emp3) && n.recipients.includes(U.admin));
    assert.equal((await notices('emp4')).length, 0);
    await warnOpenDays();
    assert.equal((await notices('emp3')).length, 1);
  });

  await run('conservación: se purga una jornada solo si todas sus filas tienen más de 4 años; lo deja en audit_log', async () => {
    // emp4 tiene una entrada de hace 15 h: todo lo viejo va antes, la secuencia sigue válida.
    const ago = async (kind, interval) => (await q(
      `INSERT INTO clock_events (profile_id, kind, at) VALUES ($1, $2, now() - $3::interval) RETURNING id`, [U.emp4, kind, interval])).rows[0].id;
    // J0: vieja, con una corrección vieja (se purga); J1: vieja (se purga); J2: vieja con una corrección de hoy (se queda);
    // J3: entrada hace 4 años y 1 día, salida dentro del plazo (se queda).
    const j0 = [await ago('in', '4 years 30 days'), await ago('out', '4 years 30 days - 1 hour')];
    const { rows: [c0] } = await q(`INSERT INTO clock_corrections (profile_id, event_id, at, reason, requested_by, created_at)
      VALUES ($1, $2, now() - interval '4 years 30 days - 2 hours', 'x', $1, now() - interval '4 years 29 days') RETURNING id`, [U.emp4, j0[1]]);
    await q(`INSERT INTO clock_correction_resolutions (correction_id, status, resolved_by, resolved_at)
             VALUES ($1, 'applied', $2, now() - interval '4 years 29 days')`, [c0.id, U.admin]);
    const j1 = [await ago('in', '4 years 20 days'), await ago('out', '4 years 20 days - 1 hour')];
    const j2 = [await ago('in', '4 years 10 days'), await ago('out', '4 years 10 days - 1 hour')];
    const { rows: [c2] } = await q(`INSERT INTO clock_corrections (profile_id, event_id, at, reason, requested_by)
      VALUES ($1, $2, now() - interval '4 years 10 days - 2 hours', 'x', $1) RETURNING id`, [U.emp4, j2[1]]);
    await q(`INSERT INTO clock_correction_resolutions (correction_id, status, resolved_by) VALUES ($1, 'applied', $2)`, [c2.id, U.admin]);
    const j3 = [await ago('in', '4 years 1 day'), await ago('out', '4 years - 1 day')];
    // El trigger no deja a service_role borrar nada de menos de 4 años.
    await assert.rejects(q(`DELETE FROM clock_events WHERE id = $1`, [j3[1]]), /append_only/);
    await assert.rejects(q(`DELETE FROM clock_correction_resolutions WHERE correction_id = $1`, [c2.id]), /append_only/);
    const deleted = await purgeClock();
    assert.equal(deleted, 6);
    const left = (await q(`SELECT id FROM clock_events WHERE id = ANY($1::uuid[])`, [[...j0, ...j1, ...j2, ...j3]])).rows.map((r) => r.id);
    assert.deepEqual(left.sort(), [...j2, ...j3].sort());
    assert.deepEqual((await q(`SELECT id FROM clock_corrections WHERE id = ANY($1::uuid[])`, [[c0.id, c2.id]])).rows, [{ id: c2.id }]);
    const { rows: [a] } = await q(`SELECT actor_id, changes FROM audit_log WHERE action = 'clock.purge' AND resource_id = $1`, [U.emp4]);
    assert.deepEqual(a, { actor_id: U.emp4, changes: { deleted: 6, events: 4, corrections: 1, resolutions: 1, by: 'nightly' } });
    assert.equal(await purgeClock(), 0);
  });
} finally {
  console.error = realError;
  server.close();
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
