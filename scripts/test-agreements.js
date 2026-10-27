import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import {
  createDocument, publishDocument, getCurrentVersions, signAgreement,
} from '../src/services/agreements.js';
import { getProfileStatus } from '../src/services/profile.js';
import { deleteFile } from '../src/services/storage.js';

const pdf = (s) => Buffer.from(`%PDF-1.4 ${s}`);
const rejects = (p, status, code) =>
  assert.rejects(p, (e) => e.status === status && e.code === code);

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

const admin = crypto.randomUUID();
const alumno = crypto.randomUUID();
const files = [];

await servicePool.query(
  `INSERT INTO profiles (id, display_name) VALUES ($1,'admin-t'),($2,'alumno-t')`,
  [admin, alumno]
);
await servicePool.query(
  `INSERT INTO student_health_info (profile_id, emergency_contact_name, emergency_contact_phone)
   VALUES ($1,'x','1')`, [alumno]
);

// Todo en una transacción con ROLLBACK; `as` cambia el contexto RLS dentro de ella.
const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);

try {
  await withRls({ uid: admin, role: 'admin' }, async (c) => {
    let d1, d2;
    await run('admin sube borrador; no es vigente hasta publicar', async () => {
      d1 = await createDocument(c, { type: 'waiver', version: '9.1', buffer: pdf('a') });
      files.push(`${d1.id}.pdf`);
      assert.notEqual((await getCurrentVersions(c)).waiver, '9.1');
    });
    await run('validaciones de subida (400/409)', async () => {
      await rejects(createDocument(c, { type: 'x', version: '9.1', buffer: pdf('a') }), 400, 'invalid_type');
      await rejects(createDocument(c, { type: 'waiver', version: 'v1', buffer: pdf('a') }), 400, 'invalid_version');
      await rejects(createDocument(c, { type: 'waiver', version: '9.3', buffer: Buffer.from('nope') }), 400, 'invalid_file');
      await rejects(createDocument(c, { type: 'waiver', version: '9.1', buffer: pdf('a') }), 409, 'duplicate_document');
      await rejects(createDocument(c, { type: 'waiver', version: '9.1', buffer: pdf('b') }), 409, 'version_exists_different_content');
    });
    await run('publicar hace vigente; publicar otro retira el anterior', async () => {
      await publishDocument(c, { id: d1.id, actorId: admin });
      assert.equal((await getCurrentVersions(c)).waiver, '9.1');
      d2 = await createDocument(c, { type: 'waiver', version: '9.2', buffer: pdf('c') });
      files.push(`${d2.id}.pdf`);
      await publishDocument(c, { id: d2.id, actorId: admin });
      assert.equal((await getCurrentVersions(c)).waiver, '9.2');
      await rejects(publishDocument(c, { id: d1.id, actorId: admin }), 409, 'already_published');
      await rejects(publishDocument(c, { id: crypto.randomUUID(), actorId: admin }), 404, 'document_not_found');
    });
    await run('admin no puede borrar documentos', async () => {
      await c.query('SAVEPOINT d');
      await assert.rejects(c.query(`DELETE FROM agreement_documents WHERE id=$1`, [d2.id]), /permission denied/);
      await c.query('ROLLBACK TO d');
    });

    // Como alumno (mismo txn, otro contexto)
    await as(c, alumno, 'alumno');
    await run('alumno no puede subir (RLS)', async () => {
      await c.query('SAVEPOINT s');
      await assert.rejects(
        createDocument(c, { type: 'waiver', version: '9.4', buffer: pdf('d') }),
        /row-level security/
      );
      await c.query('ROLLBACK TO s');
    });
    await run('alumno no ve borradores', async () => {
      await as(c, admin, 'admin');
      const d3 = await createDocument(c, { type: 'waiver', version: '9.5', buffer: pdf('e') });
      files.push(`${d3.id}.pdf`);
      await as(c, alumno, 'alumno');
      const { rowCount } = await c.query(`SELECT 1 FROM agreement_documents WHERE id=$1`, [d3.id]);
      assert.equal(rowCount, 0);
    });
    await run('firma: versión no vigente 400, vigente OK; perfil completo con los 3 tipos', async () => {
      await rejects(signAgreement(c, { profileId: alumno, type: 'waiver', version: '9.1' }), 400, 'invalid_version');
      await signAgreement(c, { profileId: alumno, type: 'waiver', version: '9.2' });
      const st = await getProfileStatus(c, alumno, 'alumno');
      assert.equal(st.ok, false);
      assert.ok(st.missing.includes('data_protection') && !st.missing.includes('waiver'));
      // Con las otras vigentes (o sin vigente → falla cerrado) el perfil sigue incompleto salvo que se firmen.
      assert.deepEqual(
        st.missing.filter((m) => ['display_name', 'health_info', 'emergency_contact'].includes(m)), []
      );
    });
  }, { commit: false });
} finally {
  await Promise.all(files.map(deleteFile));
  await servicePool.query(`DELETE FROM student_health_info WHERE profile_id=$1`, [alumno]);
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[admin, alumno]]);
  await closePools();
}
console.log(failed ? `${failed} FAIL` : 'todo OK');
process.exit(failed ? 1 : 0);
