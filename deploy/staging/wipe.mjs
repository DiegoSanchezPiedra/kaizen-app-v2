// Vacía el staging para la beta cerrada: recrea la base kaizen_staging (los triggers append-only y no_truncate de
// clock_* impiden vaciarla) y borra las fotos y los PDFs. Los roles son del clúster y siguen.
// Uso: npm run staging:wipe                       dry-run: recuentos y nada más
//      npm run staging:wipe -- --yes              backup, recrear, migrar y limpiar ficheros (pide escribir kaizen_staging)
//      npm run staging:wipe -- --yes --cancel-stripe   antes, cancela en Stripe (solo claves de PRUEBA) las suscripciones reales
// Antes hay que parar la API de staging.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import pg from 'pg';

const DB = 'kaizen_staging';
const CONTAINER = 'kaizen-staging-db';
const PG_USER = process.env.POSTGRES_USER || 'postgres';
const args = new Set(process.argv.slice(2));
const YES = args.has('--yes');
const CANCEL = args.has('--cancel-stripe');
const fail = (msg) => { console.error(`staging:wipe: ${msg}`); process.exit(1); };

for (const a of args) if (!['--yes', '--cancel-stripe'].includes(a)) fail(`opción desconocida ${a}`);
if (CANCEL && !YES) fail('--cancel-stripe requiere --yes');
for (const name of ['DATABASE_URL', 'DATABASE_URL_SERVICE']) {
  const url = new URL(process.env[name] ?? 'x://');
  if (url.pathname !== `/${DB}` || url.port !== '5433') fail(`${name} no apunta a ${DB} (:5433): me niego`);
}
if (CANCEL && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) fail('STRIPE_SECRET_KEY tiene que ser de PRUEBA (sk_test_ / rk_test_)');

const agreements = path.resolve(process.env.AGREEMENTS_STORAGE_PATH || './storage-staging/agreements');
const avatars = path.join(path.dirname(agreements), 'avatars');
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// ── Lectura: recuentos, ficheros, suscripciones reales y otras conexiones ──
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE });
await db.connect();
const { rows: tables } = await db.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations' ORDER BY 1`);
const counts = {};
for (const { tablename } of tables) {
  const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM ${pg.escapeIdentifier(tablename)}`);
  if (r.n) counts[tablename] = r.n;
}
// Suscripciones reales de Stripe (las de demo llevan `sub_test_demo_*` y no existen allí).
const { rows } = await db.query(
  `SELECT stripe_subscription_id AS id FROM subscriptions WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id NOT LIKE 'sub_test_demo%' ORDER BY 1`);
const real = rows.map((r) => r.id);
const { rows: [{ others }] } = await db.query(
  `SELECT count(*)::int AS others FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB]);
await db.end();

console.log(`${YES ? 'BORRADO' : 'DRY-RUN'} de ${DB} (:5433)\n\nFilas por tabla (solo las que tienen):`);
for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(36)} ${n}`);
if (!Object.keys(counts).length) console.log('  (ninguna)');
const [nAvatars, nAgreements] = [files(avatars).length, files(agreements).length];
console.log(`\nFicheros: avatars ${nAvatars} (${avatars}), agreements ${nAgreements} (${agreements})`);
console.log(`\nSuscripciones reales en Stripe (${real.length}):${real.length ? `\n  ${real.join('\n  ')}` : ' ninguna'}`);

if (others) {
  const msg = `hay ${others} conexión(es) más a ${DB}: para la API de staging antes`;
  if (YES) fail(msg);
  console.log(`\nAVISO: ${msg}`);
}
if (!YES) { console.log('\nDry-run: no se ha cambiado nada. Con --yes se hace de verdad.'); process.exit(0); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const typed = (await rl.question(`\nEscribe ${DB} para borrar todo: `)).trim();
rl.close();
if (typed !== DB) fail('no coincide: abortado, no se ha cambiado nada');

// ── Stripe, antes de perder los ids ──
if (CANCEL) {
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  for (const id of real) {
    try { await stripe.subscriptions.cancel(id); console.log(`Stripe: ${id} cancelada`); }
    catch (e) { if (e.code === 'resource_missing') console.log(`Stripe: ${id} ya no existe`); else fail(`Stripe ${id}: ${e.message}`); }
  }
}

// ── (a) Backup ──
const stamp = new Date().toISOString().replace(/\D/g, '').replace(/^(\d{8})(\d{6}).*/, '$1-$2');
const backup = path.join(os.homedir(), 'kaizen-backups', stamp);
fs.mkdirSync(backup, { recursive: true });
const dump = path.join(backup, `${DB}.dump`);
const fd = fs.openSync(dump, 'w');
const pgDump = spawnSync('docker', ['exec', CONTAINER, 'pg_dump', '-U', PG_USER, '-Fc', DB], { stdio: ['ignore', fd, 'inherit'] });
fs.closeSync(fd);
if (pgDump.status !== 0 || fs.statSync(dump).size === 0) fail(`el backup de la base ha fallado (${dump}): no se ha borrado nada`);
const tar = spawnSync('tar', ['-czf', path.join(backup, 'storage.tar.gz'), '-C', path.dirname(agreements), path.basename(avatars), path.basename(agreements)], { stdio: 'inherit' });
if (tar.status !== 0) fail(`el backup de los ficheros ha fallado (${backup}): no se ha borrado nada`);
console.log(`\nBackup en ${backup}`);

// ── (b) Recrear la base con lo que hace init-roles.sh por base ──
// Copia del bloque por base de deploy/staging/init-roles.sh (y de scripts/with-temp-db.js): si cambia allí, cámbialo aquí.
const sql = (dbName, text) => {
  const r = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', PG_USER, '-d', dbName], { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) fail(`psql ha fallado: la base puede haber quedado a medias, el backup está en ${backup}`);
};
sql('postgres', `DROP DATABASE ${DB} WITH (FORCE);\nCREATE DATABASE ${DB} OWNER migrator;`);
sql(DB, `
GRANT USAGE, CREATE ON SCHEMA public TO migrator, service_role;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;`);

// ── (c) Migrar y (d) vaciar ficheros (las carpetas se quedan) ──
const migrate = spawnSync('npm', ['run', 'staging:migrate'], { stdio: 'inherit' });
if (migrate.status !== 0) fail(`staging:migrate ha fallado; el backup está en ${backup}`);
for (const dir of [avatars, agreements]) for (const f of files(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });

// ── (e) Informe ──
console.log(`\nHecho. Borrado: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ') || 'nada (la base estaba vacía)'}.`);
console.log(`Ficheros borrados: avatars ${nAvatars}, agreements ${nAgreements}.`);
console.log(`Backup: ${backup}\nSiguiente: npm run staging:admin -- <email> "<Nombre>"`);
