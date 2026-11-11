// Migraciones con datos, sobre la base efímera de with-temp-db (ya migrada): se baja la última, se siembra y se sube.
// B29 (058): disciplines.minors_only = true pasa a max_age = 17; false, sin rango; la columna desaparece.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const migrate = (dir, n = 1) => {
  const r = spawnSync('node_modules/.bin/node-pg-migrate', [dir, ...(dir === 'down' ? [String(n)] : [])], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
};
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE }); // la RLS frena a migrator
await c.connect();
let failed = 0;
try {
  const [{ name }] = (await c.query(`SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1`)).rows;
  // B31 y B30: la 059 (registro de jornada) y la 060 (pausas) no tienen datos que migrar; se bajan con la 058 y vuelven
  // a subir (la 060 deshace y rehace sus parches de book_session y de la racha).
  assert.equal(name, '060_pauses', 'el test baja las tres últimas: actualízalo si hay otra después');
  migrate('down', 3);
  await c.query(`INSERT INTO disciplines (name, minors_only) VALUES ('T-Mig-Kids', true), ('T-Mig-BJJ', false)`);
  migrate('up');
  const { rows } = await c.query(`SELECT name, min_age, max_age FROM disciplines WHERE name LIKE 'T-Mig-%' ORDER BY name`);
  assert.deepEqual(rows, [{ name: 'T-Mig-BJJ', min_age: null, max_age: null }, { name: 'T-Mig-Kids', min_age: null, max_age: 17 }]);
  const { rowCount } = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'disciplines' AND column_name = 'minors_only'`);
  assert.equal(rowCount, 0);
  console.log('OK   058: minors_only → max_age = 17 (y down/up de ida y vuelta)');
} catch (e) {
  failed++;
  console.error('FAIL 058: minors_only → max_age = 17\n', e);
} finally {
  await c.end();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
