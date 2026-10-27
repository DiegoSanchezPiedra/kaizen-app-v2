import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { servicePool, closePools } from '../src/config/database.js';
import { withRls } from '../src/db/rls.js';

// withCtx: transacción appPool con RLS, SIEMPRE rollback (no persiste).
const withCtx = (ctx, fn) => withRls(ctx, fn, { commit: false });

// ---------------------------------------------------------------------------
// withServiceCommit: transacción servicePool que SÍ persiste (seed/cleanup).
// ---------------------------------------------------------------------------
async function withServiceCommit(fn) {
  const client = await servicePool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function expectDenied(promise) {
  let denied = false;
  try {
    await promise;
  } catch (err) {
    if (err.code === '42501' || /row-level security/i.test(err.message)) {
      denied = true;
    } else {
      throw err;
    }
  }
  assert.equal(denied, true, 'se esperaba que RLS denegara la operación');
}

let passed = 0;
let failed = 0;
function ok(name) { passed++; console.log(`OK   ${name}`); }
function ko(name, err) { failed++; console.error(`FAIL ${name}`); console.error(err); }

async function run(name, fn) {
  try { await fn(); ok(name); } catch (err) { ko(name, err); }
}

// ---------------------------------------------------------------------------
// seed con COMMIT
// ---------------------------------------------------------------------------
async function seed() {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const pub = crypto.randomUUID();
  const professor = crypto.randomUUID();
  const admin = crypto.randomUUID();

  await withServiceCommit(async (c) => {
    await c.query(
      `INSERT INTO profiles (id, display_name, is_public) VALUES
         ($1,'alumnoA',false),($2,'alumnoB',false),($3,'publico',true),
         ($4,'profe',false),($5,'admin',false)`,
      [a, b, pub, professor, admin]
    );
    await c.query(
      `INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES
         ($1,$2,'x'),($3,$4,'x')`,
      [a, `a-${a}@t.test`, b, `b-${b}@t.test`]
    );
    await c.query(
      `INSERT INTO user_roles (user_id, role) VALUES
         ($1,'alumno'),($2,'alumno'),($3,'alumno'),($4,'profesor'),($5,'admin')`,
      [a, b, pub, professor, admin]
    );
    await c.query(
      `INSERT INTO student_health_info
         (profile_id, injuries, conditions, emergency_contact_name, emergency_contact_phone)
       VALUES
         ($1, 'lesion A', 'cond A', 'Ana', '+34600000000'),
         ($2, 'lesion B', 'cond B', NULL, NULL)`,
      [a, b]
    );

    // B4.5 — agreements: A firma los 3 en v1.0; B no firma ninguno.
    await c.query(
      `INSERT INTO user_agreements (id, profile_id, type, version) VALUES
         ($1, $2, 'waiver', '1.0'),
         ($3, $2, 'data_protection', '1.0'),
         ($4, $2, 'rights_of_image', '1.0')`,
      [crypto.randomUUID(), a, crypto.randomUUID(), crypto.randomUUID()]
    );
  });

  return { a, b, pub, professor, admin };
}

// ---------------------------------------------------------------------------
// cleanup con COMMIT (idempotente)
// ---------------------------------------------------------------------------
async function cleanup(ids) {
  const arr = Object.values(ids);
  await withServiceCommit(async (c) => {
    await c.query(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM student_health_info WHERE profile_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM auth_credentials WHERE profile_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [arr]);
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
async function main() {
  const ids = await seed();
  try {
    await run('alumno A ve su propio perfil', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = $1`, [ids.a])
      );
      assert.equal(rows.length, 1);
    });

    await run('alumno A NO ve el perfil privado de B', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = $1`, [ids.b])
      );
      assert.equal(rows.length, 0);
    });

    await run('alumno A ve perfiles públicos', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = $1`, [ids.pub])
      );
      assert.equal(rows.length, 1);
    });

    await run('alumno A no puede insertar un profile con id ajeno', async () => {
      await expectDenied(
        withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
          c.query(
            `INSERT INTO profiles (id, display_name) VALUES ($1, 'hack')`,
            [crypto.randomUUID()]
          )
        )
      );
    });

    await run('alumno A no puede actualizar el perfil de B', async () => {
      const r = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`UPDATE profiles SET display_name='x' WHERE id=$1`, [ids.b])
      );
      assert.equal(r.rowCount, 0);
    });

    await run('alumno A no puede leer auth_credentials de B', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT profile_id FROM auth_credentials WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 0);
    });

    await run('alumno A lee sus user_roles pero no los de B', async () => {
      const r1 = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT user_id FROM user_roles WHERE user_id = $1`, [ids.a])
      );
      const r2 = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT user_id FROM user_roles WHERE user_id = $1`, [ids.b])
      );
      assert.equal(r1.rows.length, 1);
      assert.equal(r2.rows.length, 0);
    });

    await run('alumno A no puede asignarse rol admin', async () => {
      await expectDenied(
        withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
          c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'admin')`, [ids.a])
        )
      );
    });

    await run('profesor ve perfiles de alumnos', async () => {
      const { rows } = await withCtx({ uid: ids.professor, role: 'profesor' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = $1`, [ids.a])
      );
      assert.equal(rows.length, 1);
    });

    await run('admin ve auth_credentials de cualquiera', async () => {
      const { rows } = await withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
        c.query(`SELECT profile_id FROM auth_credentials WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 1);
    });

    await run('admin puede INSERT en audit_log', async () => {
      await withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
        c.query(
          `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id)
           VALUES ($1,$2,'test','profiles',$3)`,
          [crypto.randomUUID(), ids.admin, String(ids.a)]
        )
      );
    });

    await run('admin NO puede UPDATE en audit_log', async () => {
      await expectDenied(
        withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
          c.query(`UPDATE audit_log SET action='x' WHERE actor_id=$1`, [ids.admin])
        )
      );
    });

    await run('admin NO puede DELETE en audit_log', async () => {
      await expectDenied(
        withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
          c.query(`DELETE FROM audit_log WHERE actor_id=$1`, [ids.admin])
        )
      );
    });

    await run('service_role se salta RLS y lee auth_credentials', async () => {
      const { rows } = await withServiceCommit((c) =>
        c.query(`SELECT profile_id FROM auth_credentials WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 1);
    });
    await run('B4.5 — alumno A NO ve el health de B', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT profile_id FROM student_health_info WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 0);
    });

    await run('B4.5 — alumno A SÍ ve su propio health', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT profile_id FROM student_health_info WHERE profile_id = $1`, [ids.a])
      );
      assert.equal(rows.length, 1);
    });

    await run('B4.5 — admin SÍ ve el health de A', async () => {
      const { rows } = await withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
        c.query(`SELECT profile_id FROM student_health_info WHERE profile_id = $1`, [ids.a])
      );
      assert.equal(rows.length, 1);
    });

    await run('B4.5 — profesor NO ve la tabla base student_health_info', async () => {
      const { rows } = await withCtx({ uid: ids.professor, role: 'profesor' }, (c) =>
        c.query(`SELECT profile_id FROM student_health_info WHERE profile_id = $1`, [ids.a])
      );
      assert.equal(rows.length, 0);
    });

    await run('B4.5 — profesor SÍ ve la vista student_health_professor_view (solo 3 columnas)', async () => {
      const { rows } = await withCtx({ uid: ids.professor, role: 'profesor' }, (c) =>
        c.query(`SELECT * FROM student_health_professor_view`)
      );
      // La vista expone filas de todos los alumnos con health (A y B en el seed).
      assert.ok(rows.length >= 2, `se esperaban >=2 filas, hay ${rows.length}`);
      // Y solo 3 columnas: profile_id, injuries, conditions.
      const keys = Object.keys(rows[0]).sort();
      assert.deepEqual(keys, ['conditions', 'injuries', 'profile_id']);
      // Y NO expone columnas sensibles.
      assert.equal(rows[0].medication, undefined);
      assert.equal(rows[0].allergies, undefined);
      assert.equal(rows[0].emergency_contact_name, undefined);
      assert.equal(rows[0].emergency_contact_phone, undefined);
    });

    await run('B4.5 — alumno NO puede UPDATE en user_agreements (REVOKE)', async () => {
      await expectDenied(
        withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
          c.query(`UPDATE user_agreements SET version='9.9' WHERE profile_id=$1`, [ids.a])
        )
      );
    });

    await run('B4.5 — alumno NO puede DELETE en user_agreements (REVOKE)', async () => {
      await expectDenied(
        withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
          c.query(`DELETE FROM user_agreements WHERE profile_id=$1`, [ids.a])
        )
      );
    });

    await run('B4.5 — alumno NO ve los agreements de B', async () => {
      // B no tiene agreements en el seed, así que insertamos uno con service_role
      // para tener algo que A no debería ver.
      await withServiceCommit((c) =>
        c.query(
          `INSERT INTO user_agreements (id, profile_id, type, version)
           VALUES ($1, $2, 'waiver', '1.0')`,
          [crypto.randomUUID(), ids.b]
        )
      );
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM user_agreements WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 0);
    });
  } finally {
    await cleanup(ids);
    await closePools();
  }

  console.log(`\n${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closePools().catch(() => {});
  process.exit(1);
});
