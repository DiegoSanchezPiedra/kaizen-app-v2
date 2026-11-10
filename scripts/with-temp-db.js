// B20: corre un test contra una base efímera: la crea (kaizen_test_<pid>), la migra con los roles de siempre, lanza
// `node <script>` con las DATABASE_URL* apuntando a ella y la borra al final, también si el test falla o se interrumpe.
// Uso: dotenv -e .env -- node scripts/with-temp-db.js scripts/test-x.js [args]. Crea y borra con el superusuario de
// POSTGRES_USER/POSTGRES_PASSWORD (migrator no tiene CREATEDB), en el host de DATABASE_URL.
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error('uso: node scripts/with-temp-db.js <script> [args]');
const name = `kaizen_test_${process.pid}`;
const urlFor = (envUrl, db) => Object.assign(new URL(envUrl), { pathname: `/${db}` }).href;
const admin = (db) => {
  const u = new URL(urlFor(process.env.DATABASE_URL, db));
  [u.username, u.password] = [process.env.POSTGRES_USER, process.env.POSTGRES_PASSWORD ?? ''];
  return new pg.Client({ connectionString: u.href });
};
const sql = async (db, text) => { const c = admin(db); await c.connect(); try { await c.query(text); } finally { await c.end(); } };

process.on('SIGINT', () => {}); // Ctrl+C lo recibe también el hijo; seguimos vivos para borrar la base

let status = 1;
try {
  await sql('postgres', `CREATE DATABASE ${name} OWNER migrator`);
  // Lo mismo que deploy/staging/init-roles.sh hace con la base (los roles ya existen en el servidor).
  await sql(name, `
    GRANT USAGE, CREATE ON SCHEMA public TO migrator, service_role;
    GRANT USAGE ON SCHEMA public TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;`);
  const env = {
    ...process.env,
    DATABASE_URL: urlFor(process.env.DATABASE_URL, name),
    DATABASE_URL_APP: urlFor(process.env.DATABASE_URL_APP, name),
    DATABASE_URL_SERVICE: urlFor(process.env.DATABASE_URL_SERVICE, name),
  };
  const migrate = spawnSync('node_modules/.bin/node-pg-migrate', ['up'], { env, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`migraciones de ${name}:\n${migrate.stdout}${migrate.stderr}`);
  console.log(`[temp-db] ${name} creada y migrada`);
  status = spawnSync(process.execPath, [script, ...args], { env, stdio: 'inherit' }).status ?? 1;
} catch (e) {
  console.error(e);
} finally {
  await sql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    .then(() => console.log(`[temp-db] ${name} borrada`), (e) => { status = 1; console.error(e); });
}
process.exit(status);
