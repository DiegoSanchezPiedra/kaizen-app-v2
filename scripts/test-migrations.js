// Migraciones con datos, sobre la base efímera de with-temp-db (ya migrada): se baja la última, se siembra y se sube.
// B29 (058): disciplines.minors_only = true pasa a max_age = 17; false, sin rango; la columna desaparece.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const migrate = (dir) => {
  const r = spawnSync('node_modules/.bin/node-pg-migrate', [dir, ...(dir === 'down' ? ['1'] : [])], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
};
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_SERVICE }); // la RLS frena a migrator
await c.connect();
let failed = 0;
try {
  const [{ name }] = (await c.query(`SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1`)).rows;
  assert.equal(name, '058_discipline_age_range', 'el test baja solo la última: actualízalo si hay otra después');
  migrate('down');
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
