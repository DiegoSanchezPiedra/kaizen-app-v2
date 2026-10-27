import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { createDocument, publishDocument, signAgreement } from '../src/services/agreements.js';
import { getProfileStatus } from '../src/services/profile.js';
import { deleteFile } from '../src/services/storage.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const [admin, tutor, otro, menor] = Array.from({ length: 4 }, () => crypto.randomUUID());
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const files = [];
const TYPES = ['waiver', 'data_protection', 'rights_of_image'];

await servicePool.query(
  `INSERT INTO profiles (id, display_name, birth_date) VALUES
     ($1,'admin-t',NULL),($2,'tutor-t',$5),($3,'otro-t',$5),($4,'menor-t',$6)`,
  [admin, tutor, otro, menor, yearsAgo(40), yearsAgo(10)]
);
await servicePool.query(
  `INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
   VALUES ($1,'x','1')`, [menor]
);
await servicePool.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1,$2)`, [tutor, menor]);

const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);
const denied = async (c, fn) => {
  await c.query('SAVEPOINT s');
  await assert.rejects(fn(), /row-level security/);
  await c.query('ROLLBACK TO s');
};

try {
  await withRls({ uid: admin, role: 'admin' }, async (c) => {
    // Versiones de prueba vigentes (el ROLLBACK final las descarta).
    for (const type of TYPES) {
      const d = await createDocument(c, { type, version: '9.9', buffer: Buffer.from(`%PDF-1.4 ${type}`) });
      files.push(`${d.id}.pdf`);
      await publishDocument(c, { id: d.id, actorId: admin });
    }
    const sign = (type, profileId, signedBy) =>
      signAgreement(c, { profileId, signedBy, type, version: '9.9' });

    await run('menor no puede firmar por sí mismo', async () => {
      await as(c, menor, 'alumno');
      await denied(c, () => sign('waiver', menor, menor));
    });
    await run('tutor no vinculado no puede firmar por el menor', async () => {
      await as(c, otro, 'tutor');
      await denied(c, () => sign('waiver', menor, otro));
    });
    await run('tutor no puede suplantar signed_by', async () => {
      await as(c, tutor, 'tutor');
      await denied(c, () => sign('waiver', menor, otro));
    });
    await run('perfil del menor incompleto hasta que el tutor firma los 3', async () => {
      await as(c, menor, 'alumno');
      assert.deepEqual((await getProfileStatus(c, menor, 'alumno')).missing, TYPES);
      await as(c, tutor, 'tutor');
      const a = await sign('waiver', menor, tutor);
      assert.equal(a.signed_by, tutor);
      assert.equal(a.profile_id, menor);
      await sign('data_protection', menor, tutor);
      await sign('rights_of_image', menor, tutor);
      await as(c, menor, 'alumno');
      assert.deepEqual(await getProfileStatus(c, menor, 'alumno'), { ok: true });
    });
    await run('al cumplir 18 las firmas del tutor dejan de contar', async () => {
      await as(c, admin, 'admin');
      await c.query(`UPDATE profiles SET birth_date = $2 WHERE id = $1`, [menor, yearsAgo(19)]);
      await as(c, menor, 'alumno');
      assert.deepEqual((await getProfileStatus(c, menor, 'alumno')).missing, TYPES);
      await sign('waiver', menor, menor); // ya adulto: firma propia
      assert.ok(!(await getProfileStatus(c, menor, 'alumno')).missing.includes('waiver'));
    });
    await run('tutor ya no puede firmar por un menor que cumplió 18', async () => {
      await as(c, tutor, 'tutor');
      await denied(c, () => sign('data_protection', menor, tutor));
    });
    await run('solo admin crea vínculos', async () => {
      await as(c, tutor, 'tutor');
      await denied(c, () => c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1,$2)`, [tutor, otro]));
    });
  }, { commit: false });
} finally {
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[admin, tutor, otro, menor]]);
  await Promise.all(files.map(deleteFile));
  await closePools();
}
process.exit(failed ? 1 : 0);
