// B13: perfiles públicos, directorio y lectura de profiles (CONTEXT § Perfil público y directorio; ADR 0010).
// Las rutas se prueban por HTTP con un express en memoria (sin la API levantada) y un JWT firmado.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { appPool, servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { signToken } from '../src/services/jwt.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import meRouter from '../src/routes/me.js';
import profilesRouter from '../src/routes/profiles.js';
import adminProfilesRouter from '../src/routes/admin/profiles.js';
import {
  listPublicProfiles, getPublicProfile, getMyProfile, updateMyProfile, unpublishProfile,
} from '../src/services/profiles.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);
let spN = 0;
const sp = async (c, fn) => { // savepoint (anidable): lo que hace fn no llega al siguiente caso
  const name = `t${spN++}`;
  await c.query(`SAVEPOINT ${name}`);
  try { await fn(); } finally { await c.query(`ROLLBACK TO ${name}`); }
};
const rejects = (c, fn, status, code) =>
  sp(c, () => assert.rejects(fn(), (e) => e.status === status && e.code === code));
const tx = (fn) => withRls({ uid: U.admin, role: 'admin' }, fn, { commit: false });
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);

const tag = `tprof${crypto.randomBytes(3).toString('hex')}`;
// [rol, público, fecha de nacimiento, con acceso propio]
const people = {
  admin: ['admin', true, null, true], prof1: ['profesor', true, null, true], prof2: ['profesor', false, null, true],
  aluPub: ['alumno', true, null, true], aluAll: ['alumno', true, null, true], aluNone: ['alumno', true, null, true],
  aluHidden: ['alumno', true, null, true], aluPriv: ['alumno', false, null, true], aluOther: ['alumno', false, null, true],
  tutor: ['tutor', true, null, true], child: ['alumno', true, yearsAgo(10), false],
  child18: ['alumno', true, yearsAgo(19), false],
};
const U = Object.fromEntries(Object.keys(people).map((k) => [k, crypto.randomUUID()]));
const ids = Object.values(U);
const CALLED = ['can_be_public', 'public_disciplines', 'public_achievements', 'covers', 'student_achievements',
  'student_present'];
const ALL_FLAGS = { bio: true, social_links: true, disciplines: true, member_since: true };
for (const [k, [role, isPublic, birth, creds]] of Object.entries(people)) {
  // is_public = true en el hijo, el tutor y el admin: forzado por SQL, la vista debe ignorarlo.
  await servicePool.query(
    `INSERT INTO profiles (id, display_name, birth_date, is_public, visible_fields, bio, social_links)
     VALUES ($1, $2, $3, $4, $5, 'bio de ' || $2, '{"web":"https://example.com"}')`,
    [U[k], `${tag}-${k}`, birth, isPublic, k === 'aluHidden' ? { bio: true } : ALL_FLAGS]);
  await servicePool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [U[k], role]);
  if (creds) {
    await servicePool.query(`INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES ($1, $2, 'x')`,
      [U[k], `${k}-${U[k]}@t.test`]);
  }
}
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2), ($1, $3)`,
  [U.tutor, U.child, U.child18]);

const D = {};
for (const k of ['A', 'B', 'C']) {
  D[k] = (await servicePool.query(`INSERT INTO disciplines (name) VALUES ($1) RETURNING id`, [`${tag}-${k}`])).rows[0].id;
}
const planN = (await servicePool.query(
  `INSERT INTO plans (name, price_cents, max_disciplines) VALUES ($1, 1000, 2) RETURNING id`, [`${tag}-N`])).rows[0].id;
const planAll = (await servicePool.query(
  `INSERT INTO plans (name, price_cents) VALUES ($1, 2000) RETURNING id`, [`${tag}-all`])).rows[0].id;
await servicePool.query(`INSERT INTO plan_disciplines VALUES ($1, $2), ($1, $3)`, [planAll, D.A, D.B]);
const sub = { aluPub: crypto.randomUUID(), aluAll: crypto.randomUUID(), aluHidden: crypto.randomUUID() };
for (const [k, plan] of [['aluPub', planN], ['aluAll', planAll], ['aluHidden', planN]]) {
  await servicePool.query(
    `INSERT INTO subscriptions (id, student_id, payer_id, plan_id, status, stripe_subscription_id)
     VALUES ($1, $2, $2, $3, 'active', $4)`, [sub[k], U[k], plan, `sub_test_${sub[k]}`]);
}
await servicePool.query(`INSERT INTO subscription_disciplines VALUES ($1, $3), ($2, $3)`, [sub.aluPub, sub.aluHidden, D.A]);

// prof1: clase de A en vigor y clase de C retirada; prof2: clase de B, con una sesión que sustituye prof1.
const klass = async (trainer, disc, endsOn = null) => (await servicePool.query(
  `INSERT INTO classes (discipline_id, trainer_id, weekday, start_time, duration_min, capacity, starts_on, ends_on)
   VALUES ($1, $2, 1, '18:00', 60, 10, CURRENT_DATE - 30, $3) RETURNING id`, [disc, U[trainer], endsOn])).rows[0].id;
const K = { a: await klass('prof1', D.A), c: await klass('prof1', D.C, yearsAgo(0.01)), b: await klass('prof2', D.B) };
const session = async (classId, disc, trainer, offset) => (await servicePool.query(
  `INSERT INTO class_sessions (class_id, discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
   VALUES ($1, $2, $3, now() + $4::interval, now() + $4::interval + interval '60 min', 60, 10, 'scheduled') RETURNING id`,
  [classId, disc, U[trainer], offset])).rows[0].id;
const S = { future: await session(K.a, D.A, 'prof1', '2 days'), pastSub: await session(K.b, D.B, 'prof1', '-7 days') };
await servicePool.query(
  `INSERT INTO bookings (session_id, student_id, booked_by, status) VALUES ($1, $2, $2, 'confirmed')`, [S.future, U.aluPub]);
await servicePool.query(
  `INSERT INTO bookings (session_id, student_id, booked_by, status, cancel_reason, cancelled_at)
   VALUES ($1, $2, $2, 'cancelled', 'student', now())`, [S.pastSub, U.aluPriv]);

const app = express().use(express.json()).use('/me', meRouter).use('/profiles', profilesRouter)
  .use('/admin', adminProfilesRouter).use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const http = async (method, path, who, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${signToken({ sub: U[who], role: people[who][0] })}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const realError = console.error; // el errorHandler registra cada 4xx esperado

try {
  console.error = (...a) => (String(a[0]).startsWith('[error]') || String(a[0]).startsWith('Error:') ? null : realError(...a));

  // ---------- Vista ----------
  await run('public_profiles tiene exactamente las 8 columnas; app_user solo lee las vistas', async () => {
    const { rows } = await servicePool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'public_profiles' ORDER BY ordinal_position`);
    assert.deepEqual(rows.map((r) => r.column_name),
      ['id', 'display_name', 'role', 'bio', 'social_links', 'disciplines', 'member_since', 'achievements']);
    const { rows: [p] } = await servicePool.query(
      `SELECT has_table_privilege('app_user', 'public_profiles', 'INSERT, UPDATE, DELETE') AS pw,
              has_table_privilege('app_user', 'trainer_names', 'INSERT, UPDATE, DELETE') AS tw,
              has_table_privilege('app_user', 'public_profiles', 'SELECT') AS pr`);
    assert.deepEqual(p, { pw: false, tw: false, pr: true });
  });
  await run('dependencias: solo tablas permitidas y nunca student_health_info', async () => {
    // view_table_usage solo lista tablas del rol conectado: las tablas son del migrator.
    const migrator = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await migrator.connect();
    try {
      const { rows } = await migrator.query(
        `SELECT view_name, array_agg(table_name::text ORDER BY table_name) AS t FROM information_schema.view_table_usage
          WHERE view_name IN ('public_profiles', 'trainer_names') GROUP BY view_name ORDER BY view_name`);
      const allowed = ['auth_credentials', 'classes', 'disciplines', 'plan_disciplines', 'plans', 'profiles',
        'subscription_disciplines', 'subscriptions', 'user_roles'];
      assert.equal(rows.length, 2);
      for (const r of rows) {
        assert.ok(r.t.length > 0 && r.t.every((t) => allowed.includes(t)), `${r.view_name}: ${r.t}`);
        assert.ok(!r.t.includes('student_health_info'));
      }
    } finally {
      await migrator.end();
    }
    // Las funciones de la vista (y las que llaman: covers, student_achievements, student_present) se saltan la RLS:
    // tampoco tocan la salud.
    // view_routine_usage solo lista funciones del rol conectado: son de service_role.
    const { rows: fns } = await servicePool.query(
      `SELECT array_agg(r.routine_name::text ORDER BY r.routine_name) AS f
         FROM information_schema.view_routine_usage u JOIN information_schema.routines r USING (specific_name)
        WHERE u.table_name IN ('public_profiles', 'trainer_names')`);
    assert.deepEqual(fns[0].f, ['can_be_public', 'public_achievements', 'public_disciplines']);
    const { rows: bodies } = await servicePool.query(
      `SELECT proname, prosrc FROM pg_proc WHERE proname = ANY($1)`, [CALLED]);
    assert.equal(bodies.length, CALLED.length);
    for (const b of bodies) assert.ok(!/student_health/i.test(b.prosrc), b.proname);
  });
  await run('sin app.current_user_id, 0 filas (también en trainer_names)', async () => {
    const c = await appPool.connect();
    try {
      for (const v of ['public_profiles', 'trainer_names']) {
        assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${v}`)).rows[0].n, 0);
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.current_user_id', '', true)`);
        assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${v}`)).rows[0].n, 0);
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
  });

  await tx(async (c) => {
    await as(c, U.aluOther, 'alumno');
    const visible = async (k) => (await getPublicProfile(c, U[k]).then(() => true, () => false));

    // ---------- Quién sale ----------
    await run('salen el alumno adulto público y el profesor público; no el resto', async () => {
      for (const k of ['aluPub', 'prof1']) assert.equal(await visible(k), true, k);
      for (const k of ['aluPriv', 'prof2', 'child', 'child18', 'tutor', 'admin']) assert.equal(await visible(k), false, k);
    });
    await run('el hijo con 18 sin reclamar no sale aunque sea adulto e is_public', async () => {
      const { rows: [r] } = await servicePool.query(`SELECT is_public, birth_date FROM profiles WHERE id = $1`, [U.child18]);
      assert.equal(r.is_public, true);
      assert.equal(await visible('child18'), false);
    });

    // ---------- Campos ----------
    await run('cada flag por separado; un campo oculto no aparece', async () => {
      for (const f of ['bio', 'social_links', 'disciplines', 'member_since']) {
        await sp(c, async () => {
          await as(c, U.aluPub, 'alumno');
          await updateMyProfile(c, U.aluPub, { visible_fields: { ...Object.fromEntries(Object.keys(ALL_FLAGS).map((k) => [k, false])), [f]: true } });
          const p = await getPublicProfile(c, U.aluPub);
          assert.deepEqual(Object.keys(p).sort(), ['display_name', 'id', 'role', f].sort());
        });
      }
      await as(c, U.aluOther, 'alumno');
    });
    await run('valores: bio, social_links, member_since', async () => {
      const p = await getPublicProfile(c, U.aluPub);
      assert.equal(p.bio, `bio de ${tag}-aluPub`);
      assert.deepEqual(p.social_links, { web: 'https://example.com' });
      assert.match(p.member_since, /^\d{4}-\d{2}$/);
      const madrid = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7);
      assert.equal(p.member_since, madrid);
      assert.equal(p.role, 'alumno');
    });
    await run('disciplines: plan de N, plan de «todas» (sus elegibles), sin suscripción → []', async () => {
      const names = async (k) => (await getPublicProfile(c, U[k])).disciplines.map((d) => d.name);
      assert.deepEqual(await names('aluPub'), [`${tag}-A`]);
      assert.deepEqual(await names('aluAll'), [`${tag}-A`, `${tag}-B`]);
      assert.deepEqual(await names('aluNone'), []);
      const [d] = (await getPublicProfile(c, U.aluPub)).disciplines;
      assert.deepEqual(d, { id: Number(D.A), name: `${tag}-A` });
    });
    await run('disciplines del profesor: clases no retiradas, sin sustituciones', async () => {
      assert.deepEqual((await getPublicProfile(c, U.prof1)).disciplines.map((d) => d.name), [`${tag}-A`]);
    });
    await run('una suscripción que ya no está en vigor no da disciplinas', async () => {
      await sp(c, async () => {
        await servicePool.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [sub.aluAll]);
        try {
          assert.deepEqual((await getPublicProfile(c, U.aluAll)).disciplines, []);
        } finally {
          await servicePool.query(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [sub.aluAll]);
        }
      });
    });

    // ---------- Filtros ----------
    const list = (o) => listPublicProfiles(c, { q: tag, ...o });
    const keys = (r) => r.profiles.map((p) => p.display_name.slice(tag.length + 1));
    await run('q y orden por nombre', async () => {
      const r = await list({});
      assert.deepEqual(keys(r), ['aluAll', 'aluHidden', 'aluNone', 'aluPub', 'prof1']);
      assert.equal(r.total, 5);
      assert.equal((await list({ q: `${tag}-ALUP` })).total, 1); // ILIKE
      assert.equal((await list({ q: `${tag}%` })).total, 0); // % literal
    });
    await run('role y discipline_id (quien oculta sus disciplinas no aparece)', async () => {
      assert.deepEqual(keys(await list({ role: 'profesor' })), ['prof1']);
      assert.deepEqual(keys(await list({ discipline_id: String(D.A) })), ['aluAll', 'aluPub', 'prof1']);
      assert.deepEqual(keys(await list({ discipline_id: String(D.B) })), ['aluAll']);
    });
    await run('paginación: total, límites y 400', async () => {
      const r = await list({ limit: '2', offset: '4' });
      assert.deepEqual([keys(r), r.total, r.limit, r.offset], [['prof1'], 5, 2, 4]);
      assert.equal((await list({ offset: '10' })).total, 5);
      assert.equal((await list({})).limit, 25);
      for (const bad of [{ limit: '0' }, { limit: '101' }, { offset: '-1' }, { limit: 'x' }]) {
        await rejects(c, () => list(bad), 400, 'invalid_pagination');
      }
      for (const bad of [{ role: 'admin' }, { role: 'tutor' }, { discipline_id: 'x' }, { q: ['a', 'b'] }]) {
        await rejects(c, () => list(bad), 400, 'invalid_field');
      }
    });

    // ---------- 404 iguales ----------
    await run('un id inexistente y uno no público dan el mismo 404', async () => {
      const err = (id) => getPublicProfile(c, id).catch((e) => ({ status: e.status, code: e.code, message: e.message }));
      const a = await err(crypto.randomUUID());
      assert.deepEqual(await err(U.aluPriv), a);
      assert.equal(a.code, 'profile_not_found');
    });

    // ---------- Edición ----------
    await run('not_eligible: tutor y admin; bio se guarda igualmente', async () => {
      for (const [k, role] of [['tutor', 'tutor'], ['admin', 'admin']]) {
        await as(c, U[k], role);
        assert.equal((await getMyProfile(c, U[k])).eligible, false);
        await rejects(c, () => updateMyProfile(c, U[k], { is_public: true }), 403, 'not_eligible');
        await sp(c, async () => {
          const me = await updateMyProfile(c, U[k], { bio: 'nueva' });
          assert.equal(me.bio, 'nueva');
        });
      }
      await as(c, U.aluPriv, 'alumno');
      assert.equal((await getMyProfile(c, U.aluPriv)).eligible, true);
    });
    await run('visible_fields se fusiona con lo guardado; los 6 flags siempre presentes', async () => {
      await sp(c, async () => {
        await as(c, U.aluPriv, 'alumno');
        await c.query(`UPDATE profiles SET visible_fields = NULL WHERE id = $1`, [U.aluPriv]);
          assert.deepEqual((await getMyProfile(c, U.aluPriv)).visible_fields,
            { bio: false, social_links: false, disciplines: false, member_since: false, ranking: false, achievements: false });
          await updateMyProfile(c, U.aluPriv, { visible_fields: { bio: true } });
          const me = await updateMyProfile(c, U.aluPriv, { is_public: true, visible_fields: { member_since: true } });
          assert.deepEqual(me, {
            is_public: true, eligible: true, bio: `bio de ${tag}-aluPriv`, social_links: { web: 'https://example.com' },
            visible_fields: { bio: true, social_links: false, disciplines: false, member_since: true, ranking: false,
              achievements: false },
          });
          await as(c, U.aluOther, 'alumno');
          assert.deepEqual(Object.keys(await getPublicProfile(c, U.aluPriv)).sort(),
            ['bio', 'display_name', 'id', 'member_since', 'role']);
          await as(c, U.aluPriv, 'alumno');
          const cleared = await updateMyProfile(c, U.aluPriv, { bio: null, social_links: null });
          assert.deepEqual([cleared.bio, cleared.social_links, cleared.is_public], [null, null, true]);
      });
    });
    await run('el tutor no puede poner is_public a su hijo por SQL (WITH CHECK), pero sí editarlo', async () => {
      await sp(c, async () => {
        await as(c, U.admin, 'admin');
        await c.query(`UPDATE profiles SET is_public = false WHERE id = $1`, [U.child]);
        await as(c, U.tutor, 'tutor');
        await sp(c, () => assert.rejects(
          c.query(`UPDATE profiles SET is_public = true WHERE id = $1`, [U.child]), /row-level security/));
        assert.equal((await c.query(`UPDATE profiles SET display_name = 'x' WHERE id = $1`, [U.child])).rowCount, 1);
      });
    });

    // ---------- Despublicar ----------
    await run('despublicar: admin, sin tocar el contenido, idempotente y con audit_log', async () => {
      await sp(c, async () => {
        await as(c, U.admin, 'admin');
        assert.deepEqual(await unpublishProfile(c, { id: U.aluPub, actorId: U.admin }), { id: U.aluPub, is_public: false });
        assert.deepEqual(await unpublishProfile(c, { id: U.aluPub, actorId: U.admin }), { id: U.aluPub, is_public: false });
        const { rows } = await c.query(
          `SELECT actor_id FROM audit_log WHERE action = 'profile.unpublish' AND resource_id = $1`, [U.aluPub]);
        assert.deepEqual(rows, [{ actor_id: U.admin }]);
        const { rows: [p] } = await c.query(`SELECT is_public, bio FROM profiles WHERE id = $1`, [U.aluPub]);
        assert.deepEqual(p, { is_public: false, bio: `bio de ${tag}-aluPub` });
        await rejects(c, () => unpublishProfile(c, { id: crypto.randomUUID(), actorId: U.admin }), 404, 'profile_not_found');
        await as(c, U.aluOther, 'alumno');
        assert.equal(await visible('aluPub'), false);
      });
    });

    // ---------- RLS ----------
    await run('profiles ya no muestra un perfil público ajeno a un alumno', async () => {
      await as(c, U.aluOther, 'alumno');
      assert.equal((await c.query(`SELECT 1 FROM profiles WHERE id = $1`, [U.aluPub])).rowCount, 0);
    });
    await run('el profesor ve a los alumnos de sus sesiones (cancelada, pasada, sustitución) y no al resto', async () => {
      const seen = async () => (await c.query(`SELECT id FROM profiles WHERE id = ANY($1::uuid[])`, [ids])).rows
        .map((r) => r.id).sort();
      await as(c, U.prof1, 'profesor');
      assert.deepEqual(await seen(), [U.prof1, U.aluPub, U.aluPriv].sort());
      await as(c, U.prof2, 'profesor');
      assert.deepEqual(await seen(), [U.prof2]);
    });
    await run('el profesor no lee user_roles ajenos', async () => {
      await as(c, U.prof1, 'profesor');
      const { rows } = await c.query(`SELECT user_id FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
      assert.deepEqual(rows, [{ user_id: U.prof1 }]);
    });
    await run('trainer_names lo lee un alumno (también el profesor no público)', async () => {
      await as(c, U.aluOther, 'alumno');
      const { rows } = await c.query(`SELECT id, display_name FROM trainer_names WHERE id = ANY($1::uuid[]) ORDER BY display_name`, [ids]);
      assert.deepEqual(rows, [{ id: U.prof1, display_name: `${tag}-prof1` }, { id: U.prof2, display_name: `${tag}-prof2` }]);
    });
  });

  // ---------- HTTP ----------
  await run('HTTP: GET /profiles y /profiles/:id; un campo oculto no está en el JSON', async () => {
    const r = await http('GET', `/profiles?q=${tag}&role=alumno&limit=2`, 'tutor');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.total, r.body.limit, r.body.offset, r.body.profiles.length], [4, 2, 0, 2]);
    const hidden = await http('GET', `/profiles/${U.aluHidden}`, 'child18');
    assert.equal(hidden.status, 200);
    assert.deepEqual(Object.keys(hidden.body.profile).sort(), ['bio', 'display_name', 'id', 'role']);
    assert.deepEqual((await http('GET', `/profiles/${U.aluPriv}`, 'aluOther')).body.code, 'profile_not_found');
    assert.equal((await http('GET', '/profiles/123', 'aluOther')).body.code, 'invalid_id');
    assert.equal((await http('GET', '/profiles?limit=500', 'aluOther')).body.code, 'invalid_pagination');
    assert.equal((await fetch(`${base}/profiles`)).status, 401);
  });
  await run('HTTP: validaciones de PATCH /me/profile (400 invalid_field)', async () => {
    const bad = [
      { is_public: 'yes' }, { visible_fields: { phone: true } }, { visible_fields: { bio: 1 } }, { visible_fields: [] },
      { bio: 'x'.repeat(501) }, { bio: 3 }, { social_links: { facebook: 'https://f.com' } },
      { social_links: { web: 'http://x.com' } }, { social_links: { web: `https://${'x'.repeat(200)}` } },
      { social_links: { web: 'https://' } }, { social_links: [] }, { phone: '600' }, { profile_id: U.child },
    ];
    for (const body of bad) {
      const r = await http('PATCH', '/me/profile', 'aluOther', body);
      assert.deepEqual([r.status, r.body.code], [400, 'invalid_field'], JSON.stringify(body));
    }
    const ok = await http('PATCH', '/me/profile', 'aluOther', {
      bio: 'x'.repeat(500), social_links: { instagram: 'https://instagram.com/x', tiktok: 'https://tiktok.com/@x',
        youtube: 'https://youtube.com/x', web: 'https://x.es' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.bio.length, 500);
    const tut = await http('PATCH', '/me/profile', 'tutor', { is_public: true });
    assert.deepEqual([tut.status, tut.body.code], [403, 'not_eligible']);
    const me = await http('GET', '/me/profile', 'prof2');
    assert.deepEqual([me.status, me.body.is_public, me.body.eligible], [200, false, true]);
  });
  await run('HTTP: despublicar solo el admin (403 a un no admin), idempotente', async () => {
    assert.equal((await http('POST', `/admin/profiles/${U.prof1}/unpublish`, 'prof1')).status, 403);
    assert.equal((await http('POST', `/admin/profiles/${U.prof1}/unpublish`, 'aluPub')).status, 403);
    for (let i = 0; i < 2; i++) {
      const r = await http('POST', `/admin/profiles/${U.prof1}/unpublish`, 'admin');
      assert.deepEqual([r.status, r.body], [200, { id: U.prof1, is_public: false }]);
    }
    const { rows } = await servicePool.query(
      `SELECT 1 FROM audit_log WHERE action = 'profile.unpublish' AND resource_id = $1`, [U.prof1]);
    assert.equal(rows.length, 1);
    assert.equal((await http('POST', `/admin/profiles/${crypto.randomUUID()}/unpublish`, 'admin')).status, 404);
  });
} finally {
  console.error = realError;
  server.close();
  await servicePool.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
  await servicePool.query(`DELETE FROM bookings WHERE session_id = ANY($1::uuid[])`, [Object.values(S)]);
  await servicePool.query(`DELETE FROM class_sessions WHERE id = ANY($1::uuid[])`, [Object.values(S)]);
  await servicePool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [Object.values(K)]);
  await servicePool.query(`DELETE FROM subscription_disciplines WHERE subscription_id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [Object.values(sub)]);
  await servicePool.query(`DELETE FROM plan_disciplines WHERE plan_id = ANY($1::bigint[])`, [[planN, planAll]]);
  await servicePool.query(`DELETE FROM plans WHERE id = ANY($1::bigint[])`, [[planN, planAll]]);
  await servicePool.query(`DELETE FROM disciplines WHERE id = ANY($1::bigint[])`, [Object.values(D)]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [ids]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
