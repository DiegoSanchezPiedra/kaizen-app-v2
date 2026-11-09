// Demo de medallas por disciplina (staging y local). Dos cuentas con la contraseña de SEED_PASSWORD:
//  - «Demo Medallas» (medallas@<dominio>, adulto): asistencia de 2024 en Boxeo, BJJ/Grappling y Muay Thai, con las once medallas en cada una.
//  - «Tomás Medallas» (tutor.medallas@<dominio>, tutor) con su hijo Nico (2016): las once en Muay Thai Kids.
// Uso: npm run staging:medals [-- <código>]   (o local:medals; con la API arrancada; por defecto, hours_1000)
// Repetible: cada ejecución rehace su asistencia y deja como celebradas todas las medallas menos <código> de cada disciplina,
// que sale a pantalla completa al entrar (el adulto: 3 medallas nuevas; el tutor: al elegir a Nico). Las demás se ven tocándolas.
// El adulto es público y compite (ranking y logros), con 8 rivales de demo; Nico nunca es público.
// Cada disciplina tiene 1060 h y 53 semanas seguidas de 2024 (8 sesiones de 2 h 30 por semana), en franjas distintas
// para que ni el alumno ni el profesor se solapen. Es historia vieja: no sale en el calendario, la agenda ni los informes recientes.
// shortcut: la asistencia de Nico es de 2 h 30 por sesión (irreal en niños), para llegar a 1060 h; si molesta, bajar a menos horas y quitar hours_*.
import pg from 'pg';

const API = process.env.SEED_API || 'http://127.0.0.1:' + (process.env.PORT || 3100);
const PASSWORD = process.env.SEED_PASSWORD;
const DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'staging.test';
const EMAIL = `medallas@${DOMAIN}`;
const TUTOR = `tutor.medallas@${DOMAIN}`;
const CODES = ['first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000',
  'streak_4', 'streak_12', 'streak_26', 'streak_52'];
const show = process.argv[2] ?? 'hours_1000';
const OLD = 'Demo medallas (no tocar)'; // la disciplina propia de la versión anterior de este script
if (!CODES.includes(show)) throw new Error(`código desconocido: ${show} (${CODES.join(', ')})`);
if (!PASSWORD || PASSWORD.length < 8) throw new Error('SEED_PASSWORD (≥ 8 caracteres) es obligatorio');
const url = new URL(process.env.DATABASE_URL_SERVICE ?? 'x://');
// Staging (:5433) o la local de desarrollo (:5432): nunca otra.
if (!((url.pathname === '/kaizen_staging' && url.port === '5433') || (url.pathname === '/kaizen_db' && url.port === '5432'))) throw new Error('DATABASE_URL_SERVICE no apunta a kaizen_staging (:5433) ni a kaizen_db (:5432): me niego a correr');

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(API + path, { method, headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.code !== 'email_taken') throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
};
const register = (email, displayName) => call('/auth/register', { method: 'POST', body: { email, password: PASSWORD, displayName, birthDate: '1990-05-01' } });
await register(EMAIL, 'Demo Medallas');
await register(TUTOR, 'Tomás Medallas');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
try {
  await db.query(`INSERT INTO user_roles (user_id, role) SELECT profile_id, 'tutor' FROM auth_credentials WHERE email = $1
                  ON CONFLICT (user_id) DO UPDATE SET role = excluded.role`, [TUTOR]);
  const { token } = await call('/auth/login', { method: 'POST', body: { email: TUTOR, password: PASSWORD } });
  let nico = (await call('/me/children', { token })).children.find((c) => c.display_name === 'Nico');
  nico ??= (await call('/me/children', { method: 'POST', token, body: { display_name: 'Nico', birth_date: '2016-04-12' } })).child;

  const { alu } = await one(`SELECT profile_id AS alu FROM auth_credentials WHERE email = $1`, [EMAIL]);
  const { tut } = await one(`SELECT profile_id AS tut FROM auth_credentials WHERE email = $1`, [TUTOR]);
  const trainer = async (n) => (await one(`SELECT profile_id AS id FROM auth_credentials WHERE email = $1`, [`${n}@${DOMAIN}`])).id;
  const disc = async (name) => { const d = await one(`SELECT id FROM disciplines WHERE name = $1`, [name]); if (!d) throw new Error(`falta la disciplina ${name}: npm run staging:seed`); return d.id; };
  const [boxeo, bjj, mt, kids] = [await disc('Boxeo'), await disc('BJJ/Grappling'), await disc('Muay Thai'), await disc('Muay Thai Kids')];
  const [profe1, profe2] = [await trainer('profe1'), await trainer('profe2')];

  await db.query('BEGIN');
  // Fuera lo anterior: la disciplina de la versión vieja (se desactiva) y las sesiones sueltas (sin clase) de estas dos cuentas.
  const old = await one(`SELECT id FROM disciplines WHERE name = $1`, [OLD]);
  const { rows: gone } = await db.query(`SELECT DISTINCT s.id FROM class_sessions s LEFT JOIN bookings b ON b.session_id = s.id
                                          WHERE s.class_id IS NULL AND (b.student_id = ANY($1) OR s.discipline_id = $2)`, [[alu, nico.id], old?.id ?? 0]);
  const ids = gone.map((r) => r.id);
  await db.query(`DELETE FROM attendance WHERE session_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM bookings WHERE session_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM class_sessions WHERE id = ANY($1)`, [ids]);
  if (old) await db.query(`UPDATE disciplines SET is_active = false WHERE id = $1`, [old.id]);

  // 53 semanas desde el 1 de enero de 2024: 8 sesiones de 2 h 30 por semana (20 h) = 1060 h y racha de 53.
  // $5 son las dos franjas (hora de inicio) del día; se descartan 4 de las 12 combinaciones día/franja.
  const fill = async (d, prof, student, booker, hours) => (await db.query(`
    WITH s AS (
      INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
      SELECT $1, $2, t, t + interval '150 minutes', 150, 10, 'scheduled'
        FROM generate_series(0, 52) w, generate_series(0, 5) dd, generate_series(0, 1) hi,
             LATERAL (SELECT ('2024-01-01'::date + w * 7 + dd + ($5::int[])[hi + 1] * interval '1 hour') AT TIME ZONE 'Europe/Madrid' AS t) x
       WHERE (dd, hi) NOT IN ((5, 1), (4, 0), (3, 0), (2, 0))
      RETURNING id),
    b AS (INSERT INTO bookings (session_id, student_id, booked_by, status) SELECT id, $3, $4, 'confirmed' FROM s RETURNING id, session_id)
    INSERT INTO attendance (session_id, student_id, booking_id, status, method) SELECT session_id, $3, id, 'present', 'manual' FROM b`,
  [d, prof, student, booker, hours])).rowCount;
  let present = 0;
  for (const [d, hours] of [[boxeo, [6, 15]], [bjj, [9, 18]], [mt, [12, 21]]]) present += await fill(d, profe1, alu, alu, hours);
  present += await fill(kids, profe2, nico.id, tut, [10, 18]);
  // Racha actual: un presente por semana, el miércoles a las 12:00 de Madrid, en las últimas n semanas completas (-n..-1).
  // Se borran con el resto (sin clase y con reserva de estas cuentas). shortcut: si staging ya tiene una sesión del profe ese miércoles a esa hora, el solape aborta el script; cambiar la hora.
  const recent = async (d, prof, student, booker, n) => (await db.query(`
    WITH s AS (
      INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
      SELECT $1, $2, t, t + interval '60 minutes', 60, 10, 'scheduled'
        FROM generate_series(1, $5::int) k,
             LATERAL (SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Madrid') - k * interval '7 days' + interval '2 days 12 hours') AT TIME ZONE 'Europe/Madrid' AS t) x
      RETURNING id),
    b AS (INSERT INTO bookings (session_id, student_id, booked_by, status) SELECT id, $3, $4, 'confirmed' FROM s RETURNING id, session_id)
    INSERT INTO attendance (session_id, student_id, booking_id, status, method) SELECT session_id, $3, id, 'present', 'manual' FROM b`,
  [d, prof, student, booker, n])).rowCount;
  present += await recent(mt, profe1, alu, alu, 13);
  present += await recent(kids, profe2, nico.id, tut, 5);

  // El adulto, público y compitiendo (ranking y logros), para verse en los rankings de medallas y en Comunidad. Nico, nunca.
  await db.query(`UPDATE profiles SET is_public = true, visible_fields = COALESCE(visible_fields, '{}') || '{"ranking": true, "achievements": true}' WHERE id = $1`, [alu]);
  await db.query(`UPDATE profiles SET is_public = false WHERE id = $1`, [nico.id]);
  // Rivales: los 8 alumnos adultos de staging:demo (prefijo de0a0000) con más horas, también públicos y compitiendo.
  // Tras otro staging:demo vuelven a no serlo: se repite este script.
  const { rowCount: rivals } = await db.query(`
    UPDATE profiles SET is_public = true,
           visible_fields = COALESCE(visible_fields, '{}') || '{"ranking": true, "achievements": true}'
     WHERE id IN (SELECT a.student_id FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                    JOIN profiles p ON p.id = a.student_id
                   WHERE a.status = 'present' AND p.id::text LIKE 'de0a0000%'
                     AND (p.birth_date IS NULL OR p.birth_date <= CURRENT_DATE - interval '18 years')
                   GROUP BY a.student_id ORDER BY sum(s.ends_at - s.starts_at) DESC LIMIT 8)`);
  // Vistos por disciplina («<id>:<código>»): todas celebradas menos la que se quiere ver en cada una.
  const seen = (ds) => ds.flatMap((d) => CODES.filter((c) => c !== show).map((c) => `${d}:${c}`));
  for (const [viewer, profile, ds] of [[alu, alu, [boxeo, bjj, mt]], [tut, nico.id, [kids]]]) {
    await db.query(`INSERT INTO medal_views (viewer_id, profile_id, codes) VALUES ($1, $2, $3)
                    ON CONFLICT (viewer_id, profile_id) DO UPDATE SET codes = EXCLUDED.codes, seen_at = now()`, [viewer, profile, seen(ds)]);
  }
  await db.query('COMMIT');
  console.log(`${EMAIL} (3 disciplinas) y ${TUTOR} (hijo Nico): ${present} presentes y ${rivals} rivales en el ranking; al entrar sale ${show}. Las demás, tocándolas en Progreso.`);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  await db.end();
}
