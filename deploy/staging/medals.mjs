// Demo de medallas SOLO para el staging: «Demo Medallas» (medallas@<dominio>, contraseña SEED_PASSWORD) con las once.
// Uso: npm run staging:medals [-- <código>]   (con la API de staging arrancada; por defecto, hours_1000)
// Repetible: cada ejecución rehace su asistencia y deja como celebradas todas menos <código>, que sale a pantalla
// completa al entrar. Las demás se ven tocándolas en Progreso. Es público y compite (ranking y logros),
// con 8 rivales de staging:demo. Su asistencia es de 2024 (más de 1000 h y 53 semanas
// seguidas) en una disciplina desactivada propia: no sale en el calendario, la agenda ni los informes recientes.
import pg from 'pg';

const API = process.env.SEED_API || 'http://127.0.0.1:' + (process.env.PORT || 3100);
const PASSWORD = process.env.SEED_PASSWORD;
const EMAIL = `medallas@${process.env.SEED_EMAIL_DOMAIN || 'staging.test'}`;
const CODES = ['first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000',
  'streak_4', 'streak_12', 'streak_26', 'streak_52'];
const show = process.argv[2] ?? 'hours_1000';
const DISC = 'Demo medallas (no tocar)';
if (!CODES.includes(show)) throw new Error(`código desconocido: ${show} (${CODES.join(', ')})`);
if (!PASSWORD || PASSWORD.length < 8) throw new Error('SEED_PASSWORD (≥ 8 caracteres) es obligatorio');
const url = new URL(process.env.DATABASE_URL_SERVICE ?? 'x://');
if (url.pathname !== '/kaizen_staging' || url.port !== '5433') throw new Error('DATABASE_URL_SERVICE no apunta a kaizen_staging (:5433): me niego a correr');

const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: 'Demo Medallas', birthDate: '1990-05-01' }) });
const body = await res.json().catch(() => ({}));
if (!res.ok && body.code !== 'email_taken') throw new Error(`registrar ${EMAIL}: ${res.status} ${JSON.stringify(body)}`);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
try {
  await db.query('BEGIN');
  const { rows: [{ alu }] } = await db.query(`SELECT profile_id AS alu FROM auth_credentials WHERE email = $1`, [EMAIL]);
  const { rows: [{ prof }] } = await db.query(`SELECT profile_id AS prof FROM auth_credentials WHERE email = $1`,
    [`profe1@${process.env.SEED_EMAIL_DOMAIN || 'staging.test'}`]);
  let { rows: [d] } = await db.query(`SELECT id FROM disciplines WHERE name = $1`, [DISC]);
  d ??= (await db.query(`INSERT INTO disciplines (name, is_active) VALUES ($1, false) RETURNING id`, [DISC])).rows[0];

  await db.query(`DELETE FROM attendance WHERE session_id IN (SELECT id FROM class_sessions WHERE discipline_id = $1)`, [d.id]);
  await db.query(`DELETE FROM bookings WHERE session_id IN (SELECT id FROM class_sessions WHERE discipline_id = $1)`, [d.id]);
  await db.query(`DELETE FROM class_sessions WHERE discipline_id = $1`, [d.id]);
  // 53 semanas desde el 1 de enero de 2024, 8 sesiones de 2 h 30 por semana (20 h): 1060 h y racha de 53.
  const { rowCount } = await db.query(`
    WITH s AS (
      INSERT INTO class_sessions (discipline_id, trainer_id, starts_at, ends_at, duration_min, capacity, status)
      SELECT $1, $2, t, t + interval '150 minutes', 150, 10, 'scheduled'
        FROM generate_series(0, 52) w, unnest(ARRAY[0, 1, 2, 3, 4, 5]) dd, unnest(ARRAY[10, 18]) h,
             LATERAL (SELECT ('2024-01-01'::date + w * 7 + dd + h * interval '1 hour') AT TIME ZONE 'Europe/Madrid' AS t) x
       WHERE (dd, h) NOT IN ((5, 18), (4, 10), (3, 10), (2, 10))
      RETURNING id),
    b AS (INSERT INTO bookings (session_id, student_id, booked_by, status) SELECT id, $3, $3, 'confirmed' FROM s RETURNING id, session_id)
    INSERT INTO attendance (session_id, student_id, booking_id, status, method) SELECT session_id, $3, id, 'present', 'manual' FROM b`,
  [d.id, prof, alu]);
  // Público y compitiendo (ranking y logros), para verse en el ranking de medallas y en Comunidad.
  await db.query(`UPDATE profiles SET is_public = true,
                  visible_fields = COALESCE(visible_fields, '{}') || '{"ranking": true, "achievements": true}' WHERE id = $1`, [alu]);
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
  // Quien mira es el propio alumno: todas celebradas menos la que se quiere ver.
  await db.query(`INSERT INTO medal_views (viewer_id, profile_id, codes) VALUES ($1, $1, $2)
                  ON CONFLICT (viewer_id, profile_id) DO UPDATE SET codes = EXCLUDED.codes, seen_at = now()`,
  [alu, CODES.filter((c) => c !== show)]);
  await db.query('COMMIT');
  console.log(`${EMAIL}: ${rowCount} presentes y ${rivals} rivales en el ranking; al entrar sale ${show}. Las demás, tocándolas en Progreso.`);
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  await db.end();
}
