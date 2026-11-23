// Borra del todo un usuario de prueba del staging (y los hijos que solo tutela él): sus filas en la base, su foto y su
// cliente de Stripe (solo claves de PRUEBA). Para repetir la prueba de «usuario nuevo que paga» sin vaciar el staging.
// Uso: npm run staging:delete-user -- <email>          dry-run: qué borraría, sin tocar nada
//      npm run staging:delete-user -- <email> --yes    lo borra (pide escribir el email); todo en una transacción
// Se niega con admin o profesor: sus huellas (clases, fichajes, listas cerradas) son de otros y no se borran.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import pg from 'pg';

const DB = 'kaizen_staging';
const fail = (msg) => { console.error(`staging:delete-user: ${msg}`); process.exit(1); };
const args = process.argv.slice(2);
const YES = args.includes('--yes');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
if (!email || args.some((a) => a.startsWith('--') && a !== '--yes')) fail('uso: <email> [--yes]');

const url = new URL(process.env.DATABASE_URL_SERVICE ?? 'x://');
if (url.pathname !== `/${DB}` || url.port !== '5433') fail(`DATABASE_URL_SERVICE no apunta a ${DB} (:5433): me niego`);
if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) fail('STRIPE_SECRET_KEY tiene que ser de PRUEBA (sk_test_ / rk_test_)');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
const rows = async (sql, params) => (await db.query(sql, params)).rows;

const [me] = await rows(`SELECT profile_id AS id FROM auth_credentials WHERE lower(email) = $1`, [email]);
if (!me) fail(`no hay ninguna cuenta con ${email}`);
// Los hijos que solo tutela él se van con él; uno con otro tutor se queda (y pierde este vínculo).
const kids = (await rows(
  `SELECT g.minor_id AS id FROM guardianships g WHERE g.tutor_id = $1
      AND NOT EXISTS (SELECT 1 FROM guardianships o WHERE o.minor_id = g.minor_id AND o.tutor_id <> $1)`, [me.id])).map((r) => r.id);
const S = [me.id, ...kids];

const staff = await rows(`SELECT role FROM user_roles WHERE user_id = ANY($1) AND role IN ('admin', 'profesor')`, [S]);
if (staff.length) fail(`${email} (o un hijo) es ${staff.map((r) => r.role).join(', ')}: este script solo borra alumnos y tutores`);

const people = await rows(
  `SELECT p.id, p.display_name, p.avatar, p.stripe_customer_id, c.email
     FROM profiles p LEFT JOIN auth_credentials c ON c.profile_id = p.id WHERE p.id = ANY($1)`, [S]);
const subs = (await rows(`SELECT id FROM subscriptions WHERE student_id = ANY($1) OR payer_id = ANY($1)`, [S])).map((r) => r.id);
// Lo que el audit_log apunta como resource_id: las personas y sus suscripciones, facturas, reservas, pausas y cambios.
const resources = [...S, ...subs, ...(await rows(
  `SELECT id::text FROM invoices WHERE student_id = ANY($1) OR payer_id = ANY($1) OR subscription_id = ANY($2)
   UNION ALL SELECT id::text FROM bookings WHERE student_id = ANY($1) OR booked_by = ANY($1)
   UNION ALL SELECT id::text FROM pauses WHERE subscription_id = ANY($2) OR requested_by = ANY($1)
   UNION ALL SELECT id::text FROM payer_changes WHERE subscription_id = ANY($2) OR student_id = ANY($1)
   UNION ALL SELECT id::text FROM event_registrations WHERE profile_id = ANY($1) OR payer_id = ANY($1)`, [S, subs])).map((r) => r.id)]
  .map(String);

// En orden: primero lo que apunta al perfil o a sus suscripciones con RESTRICT / NO ACTION. Lo demás (credenciales, salud,
// asistencias, avisos, push, medallas, tutelas…) cae en cascada con el perfil. Si una FK de otra persona lo impide, rollback.
const STEPS = [
  ['audit_log', `DELETE FROM audit_log WHERE actor_id = ANY(p.people) OR resource_id = ANY(p.resources)`],
  ['event_registrations', `DELETE FROM event_registrations WHERE profile_id = ANY(p.people) OR payer_id = ANY(p.people) OR actor_id = ANY(p.people)`],
  ['payer_changes', `DELETE FROM payer_changes WHERE subscription_id = ANY(p.subs) OR student_id = ANY(p.people) OR old_payer_id = ANY(p.people)
                       OR new_payer_id = ANY(p.people) OR created_by = ANY(p.people)`],
  ['pauses', `DELETE FROM pauses WHERE subscription_id = ANY(p.subs) OR requested_by = ANY(p.people)`],
  ['invoices', `DELETE FROM invoices WHERE subscription_id = ANY(p.subs) OR student_id = ANY(p.people) OR payer_id = ANY(p.people)`],
  ['cash_payments', `DELETE FROM cash_payments WHERE subscription_id = ANY(p.subs) OR student_id = ANY(p.people)`],
  ['subscription_disciplines', `DELETE FROM subscription_disciplines WHERE subscription_id = ANY(p.subs)`],
  ['subscriptions', `DELETE FROM subscriptions WHERE id = ANY(p.subs)`],
  ['bookings', `DELETE FROM bookings WHERE student_id = ANY(p.people) OR booked_by = ANY(p.people)`],
  ['user_agreements', `DELETE FROM user_agreements WHERE profile_id = ANY(p.people) OR signed_by = ANY(p.people)`],
  // Sin FK a profiles: a mano.
  ['user_roles', `DELETE FROM user_roles WHERE user_id = ANY(p.people)`],
  ['user_mfa', `DELETE FROM user_mfa WHERE user_id = ANY(p.people)`],
  ['email_suppressions', `DELETE FROM email_suppressions WHERE lower(email) = ANY(p.emails)`],
  ['profiles', `DELETE FROM profiles WHERE id = ANY(p.people)`],
];

const avatars = path.join(path.dirname(path.resolve(process.env.AGREEMENTS_STORAGE_PATH || './storage-staging/agreements')), 'avatars');
const files = people.map((p) => p.avatar).filter(Boolean).map((a) => path.join(avatars, path.basename(a))).filter((f) => fs.existsSync(f));
const customers = [...new Set(people.map((p) => p.stripe_customer_id).filter((c) => c && !c.startsWith('cus_test_demo')))];

console.log(`${YES ? 'BORRADO' : 'DRY-RUN'} en ${DB}:`);
for (const p of people) console.log(`  ${p.id === me.id ? 'usuario' : 'hijo   '} ${p.display_name ?? '(sin nombre)'} ${p.email ?? ''} ${p.id}`);

// El dry-run hace los mismos DELETE dentro de la transacción (así cuenta lo que caería de verdad) y la deshace.
// Los conjuntos a borrar, calculados antes de borrar nada; cada DELETE los recibe en `p` (DELETE … USING p).
const P = `WITH p AS (SELECT $1::uuid[] AS people, $2::uuid[] AS subs, $3::text[] AS resources, $4::text[] AS emails)`;
const params = [S, subs, resources, people.map((p) => p.email?.toLowerCase()).filter(Boolean)];
await db.query('BEGIN');
try {
  console.log('\nFilas:');
  for (const [table, sql] of STEPS) {
    const { rowCount } = await db.query(`${P} ${sql.replace(/^DELETE FROM (\w+) WHERE/, 'DELETE FROM $1 USING p WHERE')}`, params);
    if (rowCount) console.log(`  ${table.padEnd(26)} ${rowCount}`);
  }
  console.log(`\nFotos: ${files.length ? files.join(', ') : 'ninguna'}`);
  console.log(`Stripe (clientes de prueba que se borran, con sus suscripciones): ${customers.length ? customers.join(', ') : 'ninguno'}`);
  if (!YES) {
    await db.query('ROLLBACK');
    await db.end();
    console.log('\nDry-run: no se ha cambiado nada. Con --yes se hace de verdad.');
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`\nEscribe ${email} para borrarlo: `)).trim().toLowerCase();
  rl.close();
  if (typed !== email) throw new Error('no coincide: abortado, no se ha cambiado nada');
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
  fail(e.message);
}
await db.end();
console.log('Base: borrado.');

for (const f of files) fs.rmSync(f, { force: true });
// Después de la base: el webhook de la baja ya no encuentra la suscripción y no hace nada (onSubscriptionChange).
if (customers.length) {
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  for (const id of customers) {
    try { await stripe.customers.del(id); console.log(`Stripe: cliente ${id} borrado`); }
    catch (e) { console.log(`Stripe: ${id} ${e.code === 'resource_missing' ? 'ya no existe' : `NO borrado: ${e.message}`}`); }
  }
}
console.log('Hecho.');
