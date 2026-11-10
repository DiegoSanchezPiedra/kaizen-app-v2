// Datos de demo del staging, por la API (y roles por la base, que es la única vía: el rol admin nunca se da desde la app).
// Uso: npm run staging:seed     (con la API de staging arrancada y SEED_PASSWORD en .env.staging)
// Es repetible: lo que ya existe se deja como está. Stripe: crea Products y Prices en la cuenta de la clave, que tiene
// que ser de PRUEBA (sk_test_ / rk_test_).
import pg from 'pg';

const API = process.env.SEED_API || 'http://127.0.0.1:' + (process.env.PORT || 3100);
const PASSWORD = process.env.SEED_PASSWORD;
const DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'staging.test';
if (!PASSWORD || PASSWORD.length < 8) throw new Error('SEED_PASSWORD (≥ 8 caracteres) es obligatorio');
if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) throw new Error('STRIPE_SECRET_KEY tiene que ser de PRUEBA (sk_test_ / rk_test_)');

const call = async (path, { method = 'GET', body, token, raw } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { ...(raw ? { 'Content-Type': 'application/pdf' } : body ? { 'Content-Type': 'application/json' } : {}), ...(token && { Authorization: `Bearer ${token}` }) },
    body: raw ?? (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, code: data.code, data };
};
// Un 409 de «ya existe» es lo esperado al repetir; cualquier otro fallo para el script.
const must = (r, what, okCodes = []) => {
  if (!r.ok && !okCodes.includes(r.code)) throw new Error(`${what}: ${r.status} ${r.code ?? ''} ${JSON.stringify(r.data)}`);
  return r;
};

const email = (n) => `${n}@${DOMAIN}`;
const USERS = [
  ['admin', 'Ada Admin', 'admin'],
  ['profe1', 'Marc Soler', 'profesor'],
  ['profe2', 'Sensei Marta', 'profesor'],
  ['ana', 'Ana Alumna', null],
  ['luis', 'Luis Alumno', null],
  ['tutor', 'Tomás Tutor', 'tutor'],
];
for (const [n, name] of USERS) {
  must(await call('/auth/register', { method: 'POST', body: { email: email(n), password: PASSWORD, displayName: name, birthDate: '1990-05-01' } }), `registrar ${n}`, ['email_taken']);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
for (const [n, , role] of USERS.filter((u) => u[2])) {
  await db.query(`insert into user_roles(user_id, role) select profile_id, $2 from auth_credentials where email = $1 on conflict (user_id) do update set role = excluded.role`, [email(n), role]);
}
await db.end();

const login = async (n) => (must(await call('/auth/login', { method: 'POST', body: { email: email(n), password: PASSWORD } }), `login ${n}`).data.token);
const admin = await login('admin');

// Un hijo del tutor (menor).
const tutor = await login('tutor');
const kids = must(await call('/me/children', { token: tutor }), 'hijos').data;
if (!(kids.children ?? kids).length) must(await call('/me/children', { method: 'POST', token: tutor, body: { display_name: 'Hugo Hijo', birth_date: '2015-03-02' } }), 'crear hijo');

// Catálogo: una temática de medallas por disciplina (una sola disciplina activa por temática).
// [nombre, edad mínima, edad máxima (null = sin límite), temática]
const CATALOG = [['Boxeo', null, null, 'ippo'], ['BJJ/Grappling', null, null, 'titanes'], ['Muay Thai', null, null, 'saiyan'], ['Muay Thai Kids', 5, 12, 'mugiwara']];
for (const [name, min_age, max_age, medal_theme] of CATALOG) {
  must(await call('/admin/disciplines', { method: 'POST', token: admin, body: { name, min_age, max_age, medal_theme } }), `disciplina ${name}`, ['name_taken']);
}
const byName = Object.fromEntries((await call('/admin/disciplines', { token: admin })).data.disciplines.map((d) => [d.name, d]));
const D = Object.fromEntries(Object.values(byName).map((d) => [d.name, d.id]));
// Si ya existía (seed de antes), se le pone su rango y, si no tiene, su temática.
for (const [name, min_age, max_age, medal_theme] of CATALOG) {
  const d = byName[name];
  if (d.min_age === min_age && d.max_age === max_age && d.medal_theme) continue;
  must(await call(`/admin/disciplines/${D[name]}`, { method: 'PATCH', token: admin, body: { min_age, max_age, ...(d.medal_theme ? {} : { medal_theme }) } }), `rango y temática ${name}`, ['theme_taken']); // ocupada a mano: se deja
}
for (const [name, cents, max, minors] of [['Una disciplina', 3500, 1, false], ['Dos disciplinas', 5000, 2, false], ['Ilimitado', 7000, null, false], ['Infantil', 3000, 1, true]]) {
  must(await call('/admin/plans', { method: 'POST', token: admin, body: { name, price_cents: cents, max_disciplines: max, minors_only: minors } }), `plan ${name}`, ['name_taken']);
}

// Clases (por disciplina: si ya tiene, no se repiten). Dos a la semana; ningún profesor se solapa.
const trainers = (await call('/admin/profiles?role=profesor&limit=100', { token: admin })).data.profiles;
const t = (n) => trainers.find((p) => p.display_name === n)?.id;
const have = new Set((await call('/admin/classes', { token: admin })).data.classes.map((c) => String(c.discipline_id)));
for (const [disc, trainer, weekday, time, cap] of [
  ['Boxeo', 'Marc Soler', 1, '19:00', 16],
  ['Boxeo', 'Marc Soler', 3, '19:00', 16],
  ['BJJ/Grappling', 'Sensei Marta', 2, '20:00', 12],
  ['BJJ/Grappling', 'Sensei Marta', 4, '20:00', 12],
  ['Muay Thai', 'Marc Soler', 2, '20:00', 14],
  ['Muay Thai', 'Marc Soler', 4, '20:00', 14],
  ['Muay Thai Kids', 'Sensei Marta', 1, '16:00', 14],
  ['Muay Thai Kids', 'Sensei Marta', 3, '16:00', 14],
]) {
  if (have.has(String(D[disc]))) continue;
  must(await call('/admin/classes', { method: 'POST', token: admin, body: { discipline_id: D[disc], trainer_id: t(trainer), weekday, start_time: time, duration_min: 60, capacity: cap, location: 'Tatami 1' } }), `clase ${disc} ${weekday}`);
}

// Documentos legales: PDFs mínimos de prueba, versión 1.0 de cada tipo, publicados.
const pdf = (text) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 150]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% ${text}\n`);
for (const type of ['data_protection', 'rights_of_image']) {
  must(await call(`/admin/agreements/documents?type=${type}&version=1.0`, { method: 'POST', token: admin, raw: pdf(`${type} 1.0 · documento de prueba de staging`) }), `subir ${type}`, ['duplicate_document', 'version_exists_different_content']);
}
for (const d of (await call('/admin/agreements/documents', { token: admin })).data.documents.filter((d) => d.status === 'created')) {
  must(await call(`/admin/agreements/documents/${d.id}/publish`, { method: 'POST', token: admin }), `publicar ${d.type}`, ['already_published']);
}

console.log(`\nListo. Cuentas (contraseña: la de SEED_PASSWORD):\n${USERS.map(([n, name, role]) => `  ${email(n).padEnd(28)} ${role ?? 'alumno'}  (${name})`).join('\n')}\n  + Hugo Hijo, menor de ${email('tutor')}\n`);
