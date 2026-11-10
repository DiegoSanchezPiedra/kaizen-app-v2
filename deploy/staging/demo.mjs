// Datos de demo SOLO para el staging: ~40 alumnos, 6 tutores con 10 menores, 6 meses de cuotas, reservas, asistencia, eventos,
// auditoría y fotos diarias. Sin llamadas a Stripe: las cuotas llevan ids falsos `sub_test_demo_*`, sin portal ni webhooks.
// Uso: npm run staging:demo     (necesita el seed hecho: disciplinas, planes, clases y profes)
// Repetible: todo lo de demo lleva un id con prefijo `de0a0000-`; cada ejecución lo borra y lo recrea en una transacción.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) throw new Error('STRIPE_SECRET_KEY tiene que ser de PRUEBA (sk_test_ / rk_test_)');
const url = new URL(process.env.DATABASE_URL_SERVICE ?? 'x://');
// Staging (:5433) o la local de desarrollo (:5432): nunca otra.
if (!((url.pathname === '/kaizen_staging' && url.port === '5433') || (url.pathname === '/kaizen_db' && url.port === '5432'))) throw new Error('DATABASE_URL_SERVICE no apunta a kaizen_staging (:5433) ni a kaizen_db (:5432): me niego a correr');
const DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'staging.test';

const DAY = 864e5;
const NOW = Date.now();
const madrid = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const TODAY = madrid(NOW);
const dayMinus = (s, k) => new Date(new Date(s + 'T12:00:00Z').getTime() - k * DAY).toISOString().slice(0, 10);
const id = (key) => { const h = createHash('sha1').update('demo:' + key).digest('hex'); return `de0a0000-${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`; };
let seed = 20260;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ago = (days, extraH = 0) => new Date(NOW - days * DAY - extraH * 36e5).toISOString();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const ins = (t, rows) => rows.length ? db.query(`insert into ${t} (${Object.keys(rows[0])}) select ${Object.keys(rows[0])} from jsonb_populate_recordset(null::${t}, $1)`, [JSON.stringify(rows)]) : 0;

// --- Personas -----------------------------------------------------------------------------------------------------
const FIRST = ['Alejandro', 'Lucía', 'Carlos', 'Marta', 'David', 'Laura', 'Javier', 'Carmen', 'Sergio', 'Paula', 'Adrián', 'Elena', 'Pablo', 'Sofía', 'Álvaro', 'Irene', 'Rubén', 'Nuria', 'Iván', 'Claudia', 'Daniel', 'Andrea', 'Hugo', 'Cristina', 'Miguel', 'Raquel', 'Jorge', 'Beatriz', 'Óscar', 'Silvia', 'Raúl', 'Patricia', 'Víctor', 'Rocío', 'Mario', 'Alba', 'Gonzalo', 'Inés', 'Enrique', 'Natalia'];
const LAST = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Fernández', 'Ruiz', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Domínguez', 'Gil', 'Vázquez', 'Serrano', 'Ramos', 'Blanco', 'Molina', 'Castro', 'Ortega', 'Delgado', 'Marín', 'Iglesias', 'Medina', 'Cortés', 'Garrido'];
const KIDS = ['Mateo', 'Valeria', 'Leo', 'Martina', 'Lucas', 'Julia', 'Pau', 'Emma', 'Diego', 'Carla'];
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '.');
const person = (key, name, kind, birth) => ({ key, id: id('p:' + key), name, kind, birth, email: `${slug(name)}.${key.replace(/\D/g, '')}@demo.kaizen.test` });
const adults = FIRST.map((f, i) => person('a' + i, `${f} ${LAST[(i * 7) % 30]} ${LAST[(i * 11 + 3) % 30]}`, 'alumno', `${1962 + Math.floor(rnd() * 42)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`));
const tutors = ['Mercedes', 'Antonio', 'Pilar', 'Francisco', 'Dolores', 'Manuel'].map((f, i) => person('t' + i, `${f} ${LAST[(i * 5 + 1) % 30]} ${LAST[(i * 3 + 8) % 30]}`, 'tutor', `${1978 + i}-0${1 + i}-2${i}`));
const kids = KIDS.map((f, i) => { const t = tutors[[0, 0, 1, 1, 2, 2, 3, 3, 4, 5][i]]; const k = person('k' + i, `${f} ${t.name.split(' ')[1]} ${t.name.split(' ')[2]}`, 'alumno', `${2011 + (i % 8)}-0${1 + (i % 9)}-1${i % 9}`); k.tutor = t; return k; });

const [{ admin }] = await q(`select profile_id as admin from auth_credentials where email = $1`, [`admin@${DOMAIN}`]);
const [{ profile_id: marc }] = await q(`select profile_id from auth_credentials where email = $1`, [`profe1@${DOMAIN}`]);
// Disciplinas y planes por nombre (los ids cambian según la base).
const byName = async (t) => Object.fromEntries((await q(`select * from ${t}`)).map((x) => [x.name, x]));
const DS = await byName('disciplines'); const PS = await byName('plans');
const ADULT = ['Boxeo', 'BJJ/Grappling', 'Muay Thai'].map((n) => Number(DS[n]?.id));
const KIDS_D = Number(DS['Muay Thai Kids']?.id);
const [ONE, TWO, UNL, KID] = ['Una disciplina', 'Dos disciplinas', 'Ilimitado', 'Infantil'].map((n) => Number(PS[n]?.id));
const plans = Object.fromEntries(Object.values(PS).map((p) => [Number(p.id), p.price_cents]));
assert(admin && marc && [...ADULT, KIDS_D, ONE, TWO, UNL, KID].every(Boolean), 'falta el seed (admin, profes, disciplinas, planes)');

// --- Cuotas: [alumno, plan, estado, alta (días atrás), baja (días atrás), inactivo] ------------------------------------
const subs = [];
adults.forEach((p, i) => {
  const status = i < 30 ? 'active' : i < 33 ? 'past_due' : i < 36 ? 'unpaid' : 'cancelled';
  const created = i < 6 ? 100 + Math.floor(rnd() * 79) : i >= 27 && i < 30 ? 0 : status === 'active' ? 1 + Math.floor(rnd() * 150) : status === 'cancelled' ? [175, 160, 130, 90][i - 36] : 80 + Math.floor(rnd() * 90);
  const plan = pick([ONE, ONE, TWO, TWO, UNL]);
  subs.push({ student: p, payer: p, plan, status, created, cancelled: status === 'cancelled' ? [160, 120, 60, 5][i - 36] : null, inactive: i < 6, discs: plan === ONE ? [pick(ADULT)] : plan === TWO ? [ADULT[i % 3], ADULT[(i + 1) % 3]] : ADULT });
});
kids.forEach((k) => subs.push({ student: k, payer: k.tutor, plan: KID, status: 'active', created: 1 + Math.floor(rnd() * 178), cancelled: null, inactive: false, discs: [KIDS_D] }));
for (const s of subs) {
  s.id = id('sub:' + s.student.key);
  s.createdAt = s.created === 0 ? ago(0, 1 + rnd() * 2) : ago(s.created, rnd() * 8);
  s.cancelledAt = s.cancelled == null ? null : ago(s.cancelled, rnd() * 8);
  // Periodo mensual anclado en el alta; en las bajas termina en la baja.
  const start = new Date(s.createdAt); const end = s.cancelledAt ? new Date(s.cancelledAt) : null;
  for (;;) { const n = new Date(start); n.setUTCMonth(n.getUTCMonth() + 1); if (n > (end ?? NOW)) { s.periodStart = start.toISOString(); s.periodEnd = (end ?? n).toISOString(); break; } start.setTime(n.getTime()); }
}

// --- Transacción: borrar lo de demo y recrear ---------------------------------------------------------------------------
await db.query('begin');
try {
  const demo = `like 'de0a0000-%'`;
  await db.query(`delete from audit_log where actor_id::text ${demo}`);
  await db.query(`delete from event_registrations where profile_id::text ${demo} or event_id::text ${demo}`);
  await db.query(`delete from events where id::text ${demo}`);
  await db.query(`delete from bookings where student_id::text ${demo}`); // arrastra la asistencia
  await db.query(`delete from class_sessions where id::text ${demo}`);
  await db.query(`delete from subscription_disciplines where subscription_id::text ${demo}`);
  await db.query(`delete from subscriptions where id::text ${demo}`);
  await db.query(`delete from guardianships where minor_id::text ${demo}`);
  await db.query(`delete from user_roles where user_id::text ${demo}`);
  await db.query(`delete from auth_credentials where profile_id::text ${demo}`);
  await db.query(`delete from profiles where id::text ${demo}`);

  const payers = new Set(subs.map((s) => s.payer.key));
  const all = [...adults, ...tutors, ...kids];
  await ins('profiles', all.map((p) => ({ id: p.id, display_name: p.name, birth_date: p.birth, created_at: ago(181), stripe_customer_id: payers.has(p.key) ? 'cus_test_demo_' + p.key : null })));
  await ins('auth_credentials', [...adults, ...tutors].map((p) => ({ profile_id: p.id, email: p.email, google_sub: 'demo-' + p.key, email_verified: true })));
  await ins('user_roles', all.map((p) => ({ user_id: p.id, role: p.kind })));
  await ins('guardianships', kids.map((k) => ({ tutor_id: k.tutor.id, minor_id: k.id })));
  await ins('subscriptions', subs.map((s) => ({ id: s.id, student_id: s.student.id, payer_id: s.payer.id, plan_id: s.plan, status: s.status, payment_method: 'stripe', current_period_start: s.periodStart, current_period_end: s.periodEnd, cancel_at_period_end: false, cancelled_at: s.cancelledAt, stripe_subscription_id: 'sub_test_demo_' + s.student.key, created_at: s.createdAt })));
  await ins('subscription_disciplines', subs.flatMap((s) => s.discs.map((d) => ({ subscription_id: s.id, discipline_id: d }))));

  // Sesiones pasadas (180 días) de las clases que hay; las de hoy en adelante ya las genera el horizonte.
  await db.query(`insert into class_sessions (id, discipline_id, trainer_id, starts_at, duration_min, capacity, location, status, class_id, ends_at, adjusted_fields, slot, class_trainer_id, class_duration_min, class_capacity, class_location, attendance_closed_at, attendance_closed_by)
    select overlay(md5('demo:sess:' || c.id || d)::uuid::text placing 'de0a0000' from 1 for 8)::uuid, c.discipline_id, c.trainer_id, s, c.duration_min, c.capacity, c.location, 'scheduled', c.id,
           s + c.duration_min * interval '1 minute', '{}', s, c.trainer_id, c.duration_min, c.capacity, c.location, s + c.duration_min * interval '1 minute', c.trainer_id
      from classes c cross join generate_series($1::date - 180, $1::date - 1, '1 day') d
      cross join lateral (select (d::date + c.start_time) at time zone 'Europe/Madrid' as s) x
     where extract(isodow from d) = c.weekday
       and not exists (select 1 from class_sessions e where e.class_id = c.id and e.slot = x.s)`, [TODAY]);
  const sessions = await q(`select s.id, s.discipline_id, s.trainer_id, s.starts_at, s.ends_at, s.capacity - count(b.id) as free
      from class_sessions s left join bookings b on b.session_id = s.id and b.status <> 'cancelled'
     where s.class_id is not null and s.status = 'scheduled' and s.starts_at between now() - interval '180 days' and now() + interval '14 days'
     group by s.id order by s.starts_at`);

  // Reservas y asistencia, coherentes con las altas, las bajas y los inactivos (sin venir hace > 14 días).
  const bookings = []; const attendance = [];
  for (const s of sessions) {
    const t0 = s.starts_at.getTime();
    const cand = subs.filter((u) => u.discs.includes(Number(s.discipline_id)) && t0 > new Date(u.createdAt).getTime() + 36e5 && t0 < (u.cancelledAt ? new Date(u.cancelledAt).getTime() : Infinity)
      && !(u.inactive && t0 > NOW - 15 * DAY));
    let free = Number(s.free);
    for (const u of cand) {
      if (free <= 0 || rnd() > (u.plan === KID ? 0.8 : t0 > NOW ? 0.55 : 0.75)) continue;
      free--;
      const bid = id(`bk:${s.id}:${u.student.key}`);
      bookings.push({ id: bid, session_id: s.id, student_id: u.student.id, booked_by: u.payer.id, status: 'confirmed', created_at: new Date(Math.min(t0 - 36e5, Math.max(new Date(u.createdAt).getTime() + 3e5, t0 - 2 * DAY))).toISOString() });
      if (t0 < NOW) attendance.push({ session_id: s.id, student_id: u.student.id, booking_id: bid, status: rnd() < 0.8 ? 'present' : 'absent', method: 'manual', recorded_by: s.trainer_id, recorded_at: s.ends_at.toISOString() });
    }
    s.free = free;
  }
  // La app llama inactivo a quien no tiene un «presente» en 14 días: los que no deben serlo (y llevan más de 14 días) lo tienen.
  for (const u of subs) {
    if (u.inactive || u.cancelledAt || new Date(u.createdAt).getTime() > NOW - 14 * DAY) continue;
    const mine = attendance.filter((a) => a.student_id === u.student.id && new Date(a.recorded_at).getTime() > NOW - 14 * DAY);
    if (mine.some((a) => a.status === 'present')) continue;
    if (mine.length) { mine.at(-1).status = 'present'; continue; }
    const s = sessions.findLast((x) => x.ends_at < NOW && x.starts_at > NOW - 14 * DAY && x.free > 0 && u.discs.includes(Number(x.discipline_id)));
    if (!s) continue;
    s.free--;
    const bid = id(`bk:${s.id}:${u.student.key}`);
    bookings.push({ id: bid, session_id: s.id, student_id: u.student.id, booked_by: u.payer.id, status: 'confirmed', created_at: new Date(s.starts_at.getTime() - 2 * DAY).toISOString() });
    attendance.push({ session_id: s.id, student_id: u.student.id, booking_id: bid, status: 'present', method: 'manual', recorded_by: s.trainer_id, recorded_at: s.ends_at.toISOString() });
  }
  for (let i = 0; i < bookings.length; i += 1000) await ins('bookings', bookings.slice(i, i + 1000));
  for (let i = 0; i < attendance.length; i += 1000) await ins('attendance', attendance.slice(i, i + 1000));

  // Eventos: 2 próximos (uno gratis, otro de pago con inscripciones ya confirmadas, sin checkout) y 1 pasado.
  const at = (days, h) => { const d = new Date(NOW + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
  const EV = [
    ['open', 'Open mat de BJJ', 3, 17, 2, 0, null, 'adults', 30, 8],
    ['show', 'Exhibición de fin de trimestre', 6, 9, 3, 1500, 1000, 'all', 40, 10],
    ['cup', 'Velada interna de Boxeo', -20, 9, 4, 0, null, 'adults', 24, 12],
  ];
  await ins('events', EV.map(([k, title, d, h, dur, price, member, aud, cap]) => ({ id: id('ev:' + k), title, description: 'Evento de demo del staging.', starts_at: at(d, h), ends_at: at(d, h + dur), location: 'Tatami 1', discipline_id: k === 'show' ? null : k === 'open' ? ADULT[1] : ADULT[0], trainer_id: marc, capacity: cap, audience: aud, price_cents: price, member_price_cents: member, status: 'scheduled', created_by: admin, created_at: ago(d < 0 ? 40 : 10) })));
  const regs = [];
  for (const [k, , d, , , price, member, , , n] of EV) {
    const pool = k === 'show' ? [...subs.filter((u) => u.status === 'active' && u.plan !== KID).slice(0, n - 2).map((u) => u.student), kids[0], kids[2]] : subs.filter((u) => u.status === 'active' && u.plan !== KID).slice(6, 6 + n).map((u) => u.student);
    for (const p of pool) {
      const payer = p.tutor ?? p; const amount = price ? (member ?? price) : 0;
      regs.push({ id: id(`reg:${k}:${p.key}`), event_id: id('ev:' + k), profile_id: p.id, actor_id: payer.id, payer_id: amount ? payer.id : null, status: 'confirmed', amount_cents: amount, guest: false, attended: d < 0 ? rnd() < 0.85 : null, created_at: ago(d < 0 ? 25 + rnd() * 10 : rnd() * 5) });
    }
  }
  await ins('event_registrations', regs);

  // Auditoría, con la forma que escriben el webhook (alta) y billing.js (baja inmediata).
  await ins('audit_log', subs.flatMap((s) => [
    { id: id('au:c:' + s.student.key), actor_id: s.payer.id, action: 'subscription.create', resource_type: 'subscription', resource_id: s.id, changes: { student_id: s.student.id, payer_id: s.payer.id, plan_id: s.plan }, created_at: s.createdAt },
    ...(s.cancelledAt ? [{ id: id('au:x:' + s.student.key), actor_id: s.payer.id, action: 'subscription.cancel_now', resource_type: 'subscription', resource_id: s.id, changes: {}, created_at: s.cancelledAt }] : []),
  ]));

  // Fotos diarias: sintéticas los 180 días anteriores a ayer; ayer y hoy se reescriben con la función real (solo staging).
  const avg = Math.round(subs.reduce((a, u) => a + plans[u.plan], 0) / subs.length); // precio medio de los planes en uso
  const dayOf = (iso) => madrid(iso);
  for (let k = 181; k >= 2; k--) {
    const d = dayMinus(TODAY, k);
    const cum = subs.filter((s) => dayOf(s.createdAt) <= d && !(s.cancelledAt && dayOf(s.cancelledAt) <= d)).length;
    const pd = cum > 6 ? 1 + Math.floor(rnd() * 3) : 0; const un = cum > 10 ? Math.floor(rnd() * 3) : 0;
    const active = Math.max(0, cum - pd - un);
    await db.query(`insert into academy_stats_daily (date, active, past_due, unpaid, new_subscriptions, cancelled_subscriptions, mrr_cents) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (date) do update set active = excluded.active, past_due = excluded.past_due, unpaid = excluded.unpaid, new_subscriptions = excluded.new_subscriptions, cancelled_subscriptions = excluded.cancelled_subscriptions, mrr_cents = excluded.mrr_cents`,
    [d, active, pd, un, subs.filter((s) => dayOf(s.createdAt) === d).length, subs.filter((s) => s.cancelledAt && dayOf(s.cancelledAt) === d).length, (active + pd) * avg]);
  }
  for (const d of [dayMinus(TODAY, 1), TODAY]) {
    await db.query(`insert into academy_stats_daily select * from academy_stats_of($1::date)
      on conflict (date) do update set active = excluded.active, past_due = excluded.past_due, unpaid = excluded.unpaid, new_subscriptions = excluded.new_subscriptions, cancelled_subscriptions = excluded.cancelled_subscriptions, mrr_cents = excluded.mrr_cents`, [d]);
  }

  const [c] = await q(`select (select count(*) from profiles where id::text ${demo}) profiles, (select count(*) from subscriptions where id::text ${demo}) subs,
    (select count(*) from bookings where student_id::text ${demo}) bookings, (select count(*) from attendance where student_id::text ${demo}) attendance,
    (select count(*) from class_sessions where id::text ${demo}) past_sessions, (select count(*) from events where id::text ${demo}) events,
    (select count(*) from event_registrations where profile_id::text ${demo}) regs, (select count(*) from audit_log where actor_id::text ${demo}) audit`);
  assert.equal(Number(c.subs), 50); assert.equal(Number(c.profiles), 56);
  await db.query('commit');
  console.log('Demo creada:', JSON.stringify(c));
} catch (e) {
  await db.query('rollback');
  throw e;
} finally {
  await db.end();
}
