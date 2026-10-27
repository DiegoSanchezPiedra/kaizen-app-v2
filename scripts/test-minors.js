import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';
import { createDocument, publishDocument, signAgreement } from '../src/services/agreements.js';
import { registerLocal } from '../src/services/auth.js';
import {
  getProfileStatus,
  upsertHealthInfo,
  createChild,
  updateChild,
  listChildren,
  assertGuardianOf,
} from '../src/services/profile.js';
import { deleteFile } from '../src/services/storage.js';

let failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`OK   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}

// `nino` simula un menor que (por un bug) llegara a actuar con JWT propio.
const [admin, tutor, otro, nino] = Array.from({ length: 4 }, () => crypto.randomUUID());
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const files = [];
const TYPES = ['waiver', 'data_protection', 'rights_of_image'];

await servicePool.query(
  `INSERT INTO profiles (id, display_name, birth_date) VALUES
     ($1,'admin-t',NULL),($2,'tutor-t',$5),($3,'otro-t',$5),($4,'nino-t',$6)`,
  [admin, tutor, otro, nino, yearsAgo(40), yearsAgo(10)]
);

const as = (c, uid, role) =>
  c.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.current_role',$2,true)`, [uid, role]);
// Ejecuta fn esperando un error (regex sobre el mensaje o código) sin abortar la transacción.
const fails = async (c, fn, expected) => {
  await c.query('SAVEPOINT s');
  await assert.rejects(fn(), (e) => (expected instanceof RegExp ? expected.test(e.message) : e.code === expected));
  await c.query('ROLLBACK TO s');
};
const denied = (c, fn) => fails(c, fn, /row-level security/);

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

    let hijo;
    await run('el tutor crea un hijo: perfil + alumno + vínculo, sin credenciales', async () => {
      await as(c, tutor, 'alumno');
      hijo = (await createChild(c, { displayName: 'hijo-t', birthDate: yearsAgo(8) })).id;
      await as(c, admin, 'admin');
      const { rows: [r] } = await c.query(
        `SELECT (SELECT array_agg(role::text) FROM user_roles WHERE user_id = $1) AS roles,
                EXISTS (SELECT 1 FROM guardianships WHERE tutor_id = $2 AND minor_id = $1) AS linked,
                EXISTS (SELECT 1 FROM auth_credentials WHERE profile_id = $1) AS creds`,
        [hijo, tutor]
      );
      assert.deepEqual(r, { roles: ['alumno'], linked: true, creds: false });
    });
    await run('un adulto no puede ser dado de alta como hijo', async () => {
      await as(c, tutor, 'alumno');
      await fails(c, () => createChild(c, { displayName: 'x', birthDate: yearsAgo(20) }), 'child_must_be_minor');
    });
    await run('un menor no puede crear hijos', async () => {
      await as(c, nino, 'alumno');
      await fails(c, () => createChild(c, { displayName: 'x', birthDate: yearsAgo(2) }), 'minor_cannot_create_child');
    });
    await run('create_child no permite vincularse a un perfil existente', async () => {
      await as(c, tutor, 'alumno');
      await fails(c, () => c.query(`SELECT create_child($1,'x',$2)`, [nino, yearsAgo(5)]), '23505');
      await as(c, admin, 'admin');
      const { rowCount } = await c.query(`SELECT 1 FROM guardianships WHERE minor_id = $1`, [nino]);
      assert.equal(rowCount, 0);
    });
    await run('el tutor no puede insertar vínculos a mano', async () => {
      await as(c, tutor, 'alumno');
      await denied(c, () => c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1,$2)`, [tutor, nino]));
    });
    await run('el tutor lee y escribe la salud del hijo; otro adulto no', async () => {
      await as(c, tutor, 'alumno');
      await upsertHealthInfo(c, hijo, { emergency_contact_name: 'x', emergency_contact_phone: '1' });
      await upsertHealthInfo(c, hijo, { allergies: 'polen' });
      const { rows } = await c.query(`SELECT allergies FROM student_health_info WHERE profile_id = $1`, [hijo]);
      assert.equal(rows[0].allergies, 'polen');
      await as(c, otro, 'alumno');
      assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id = $1`, [hijo])).rowCount, 0);
      await denied(c, () => upsertHealthInfo(c, hijo, { allergies: 'x' }));
    });
    await run('el tutor edita el perfil del hijo pero no puede hacerlo adulto; otro no lo edita', async () => {
      await as(c, tutor, 'alumno');
      assert.equal((await updateChild(c, hijo, { display_name: 'hijo-2' })).display_name, 'hijo-2');
      await fails(c, () => updateChild(c, hijo, { birth_date: yearsAgo(19) }), 'child_must_be_minor');
      await as(c, otro, 'alumno');
      await fails(c, () => updateChild(c, hijo, { display_name: 'x' }), 'child_not_found');
    });
    await run('el hijo no puede firmar por sí mismo (defensa en profundidad)', async () => {
      await as(c, hijo, 'alumno');
      await denied(c, () => sign('waiver', hijo, hijo));
    });
    await run('tutor no vinculado no puede firmar por el hijo', async () => {
      await as(c, otro, 'alumno');
      await denied(c, () => sign('waiver', hijo, otro));
    });
    await run('tutor no puede suplantar signed_by', async () => {
      await as(c, tutor, 'alumno');
      await denied(c, () => sign('waiver', hijo, otro));
    });
    await run('perfil del hijo incompleto hasta que el tutor firma los 3', async () => {
      await as(c, tutor, 'alumno');
      assert.deepEqual((await getProfileStatus(c, hijo, 'alumno')).missing, TYPES);
      const a = await sign('waiver', hijo, tutor);
      assert.equal(a.signed_by, tutor);
      assert.equal(a.profile_id, hijo);
      await sign('data_protection', hijo, tutor);
      await sign('rights_of_image', hijo, tutor);
      assert.deepEqual(await getProfileStatus(c, hijo, 'alumno'), { ok: true });
    });
    await run('a los 18: firmas del tutor no cuentan; sin edición, salud ni firma; sigue en la lista', async () => {
      await as(c, admin, 'admin');
      await c.query(`UPDATE profiles SET birth_date = $2 WHERE id = $1`, [hijo, yearsAgo(19)]);
      // Como admin: el tutor ya no ve la salud y saldría también 'health_info'.
      assert.deepEqual((await getProfileStatus(c, hijo, 'alumno')).missing, TYPES);
      await as(c, tutor, 'alumno');
      await denied(c, () => sign('data_protection', hijo, tutor));
      await fails(c, () => assertGuardianOf(c, hijo), 'not_guardian');
      await fails(c, () => updateChild(c, hijo, { display_name: 'x' }), 'child_not_found');
      assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id = $1`, [hijo])).rowCount, 0);
      const [listed] = await listChildren(c, tutor);
      assert.equal(listed.id, hijo);
      assert.equal(listed.pending_claim, true);
    });
    await run('rol tutor: completo con display_name + su data_protection', async () => {
      await as(c, tutor, 'tutor');
      assert.deepEqual(await getProfileStatus(c, tutor, 'tutor'), { ok: false, missing: ['data_protection'] });
      await sign('data_protection', tutor, tutor);
      assert.deepEqual(await getProfileStatus(c, tutor, 'tutor'), { ok: true });
    });
  }, { commit: false });

  await run('un menor no puede registrarse', async () => {
    await assert.rejects(
      registerLocal({ email: 'x@x.x', password: '12345678', birthDate: yearsAgo(17) }),
      { code: 'minor_cannot_register' }
    );
  });
} finally {
  await servicePool.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [[admin, tutor, otro, nino]]);
  await Promise.all(files.map(deleteFile));
  await closePools();
}
process.exit(failed ? 1 : 0);
