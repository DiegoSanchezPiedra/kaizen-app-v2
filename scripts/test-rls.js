import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
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
  const tutor = crypto.randomUUID();
  const child = crypto.randomUUID();

  await withServiceCommit(async (c) => {
    // B20: B sin fecha de nacimiento (alta con Google); el resto, con la suya.
    await c.query(
      `INSERT INTO profiles (id, display_name, is_public, birth_date) VALUES
         ($1,'alumnoA',false,$8),($2,'alumnoB',false,NULL),($3,'publico',true,$8),
         ($4,'profe',false,$8),($5,'admin',false,$8),($6,'tutor',false,$8),($7,'hijo',false,$9)`,
      [a, b, pub, professor, admin, tutor, child, yearsAgo(30), yearsAgo(10)]
    );
    await c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [tutor, child]);
    // B20 (B9): A tiene el doble factor activado.
    await c.query(`INSERT INTO user_mfa (id, user_id, totp_secret_encrypted, recovery_codes_encrypted, mfa_enabled)
                   VALUES ($1, $2, 'x', 'x', true)`, [crypto.randomUUID(), a]);
    await c.query(
      `INSERT INTO auth_credentials (profile_id, email, password_hash) VALUES
         ($1,$2,'x'),($3,$4,'x')`,
      [a, `a-${a}@t.test`, b, `b-${b}@t.test`]
    );
    await c.query(
      `INSERT INTO user_roles (user_id, role) VALUES
         ($1,'alumno'),($2,'alumno'),($3,'alumno'),($4,'profesor'),($5,'admin'),($6,'tutor'),($7,'alumno')`,
      [a, b, pub, professor, admin, tutor, child]
    );
    await c.query(
      `INSERT INTO student_health_info
         (profile_id, injuries, conditions, emergency_contact_name, emergency_contact_phone)
       VALUES
         ($1, 'lesion A', 'cond A', 'Ana', '+34600000000'),
         ($2, 'lesion B', 'cond B', NULL, NULL)`,
      [a, b]
    );

    // B4.5 — agreements: A firma los 2 en v1.0; B no firma ninguno.
    await c.query(
      `INSERT INTO user_agreements (id, profile_id, signed_by, type, version) VALUES
         ($1, $2, $2, 'data_protection', '1.0'),
         ($3, $2, $2, 'rights_of_image', '1.0')`,
      [crypto.randomUUID(), a, crypto.randomUUID()]
    );
  });

  return { a, b, pub, professor, admin, tutor, child };
}

const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);
const AVATAR = `${'a'.repeat(64)}.jpg`;
// B20: columnas de profiles que solo escribe el sistema (servicePool) o nadie (heredadas sin uso).
const SYSTEM_COLUMNS = {
  stripe_customer_id: `'cus_hack'`, id: 'gen_random_uuid()', created_at: 'now()', phone: `'600000000'`, avatar_url: `'x'`,
};

// ---------------------------------------------------------------------------
// cleanup con COMMIT (idempotente)
// ---------------------------------------------------------------------------
async function cleanup(ids) {
  const arr = Object.values(ids);
  await withServiceCommit(async (c) => {
    await c.query(`DELETE FROM invoices WHERE student_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM subscriptions WHERE student_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM user_agreements WHERE profile_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM student_health_info WHERE profile_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [arr]);
    await c.query(`DELETE FROM user_mfa WHERE user_id = ANY($1::uuid[])`, [arr]);
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

    // B13 (ADR 0010): lo público se lee por la vista public_profiles, no por profiles.
    await run('alumno A NO ve en profiles un perfil público ajeno', async () => {
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = $1`, [ids.pub])
      );
      assert.equal(rows.length, 0);
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

    // B13: solo los alumnos con reserva en sus sesiones (casos con reservas en test:profiles).
    await run('profesor solo ve perfiles de alumnos de sus sesiones (A no ha reservado ninguna)', async () => {
      const { rows } = await withCtx({ uid: ids.professor, role: 'profesor' }, (c) =>
        c.query(`SELECT id FROM profiles WHERE id = ANY($1::uuid[])`, [[ids.a, ids.professor]])
      );
      assert.deepEqual(rows.map((r) => r.id), [ids.professor]);
    });

    await run('admin ve auth_credentials de cualquiera', async () => {
      const { rows } = await withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
        c.query(`SELECT profile_id FROM auth_credentials WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 1);
    });

    // 027: nadie inserta en audit_log por SQL; se anota con write_audit(), firmado con el actor de la sesión.
    await run('nadie (ni el admin) puede INSERT directo en audit_log', async () => {
      for (const ctx of [{ uid: ids.admin, role: 'admin' }, { uid: ids.a, role: 'alumno' }]) {
        await expectDenied(withCtx(ctx, (c) => c.query(
          `INSERT INTO audit_log (id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,'test','profiles',$3)`,
          [crypto.randomUUID(), ctx.uid, String(ids.a)])));
      }
    });

    await run('write_audit: el admin anota con su actor; nadie firma como otro', async () => {
      const rows = await withCtx({ uid: ids.admin, role: 'admin' }, async (c) => {
        await c.query(`SELECT write_audit($1, 'test.rls', 'profiles', $2, '{}')`, [ids.admin, String(ids.a)]);
        return (await c.query(`SELECT actor_id FROM audit_log WHERE action = 'test.rls' AND resource_id = $1`, [String(ids.a)])).rows;
      });
      assert.deepEqual(rows.map((r) => r.actor_id), [ids.admin]);
      await expectDenied(withCtx({ uid: ids.admin, role: 'admin' }, (c) =>
        c.query(`SELECT write_audit($1, 'test.rls', 'profiles', $2, '{}')`, [ids.a, String(ids.a)])));
    });

    await run('write_audit: un alumno solo anota sus cambios de plan', async () => {
      await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT write_audit($1, 'subscription.downgrade_cancel', 'subscription', 'x', '{}')`, [ids.a]));
      await expectDenied(withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT write_audit($1, 'profile.role_change', 'profile', $2, '{}')`, [ids.a, String(ids.a)])));
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

    // B20: profiles_update_self_or_admin dejaba cambiar por SQL cualquier columna propia.
    const alumno = { uid: ids.a, role: 'alumno' };
    const tutor = { uid: ids.tutor, role: 'tutor' };
    const profesor = { uid: ids.professor, role: 'profesor' };
    const admin = { uid: ids.admin, role: 'admin' };
    const update = (ctx, id, set) => withCtx(ctx, (c) => c.query(`UPDATE profiles SET ${set} WHERE id = $1`, [id]));

    await run('B20 — alumno, tutor y profesor no cambian las columnas del sistema (stripe_customer_id…) de su perfil', async () => {
      for (const ctx of [alumno, tutor, profesor]) {
        for (const [col, value] of Object.entries(SYSTEM_COLUMNS)) {
          await expectDenied(update(ctx, ctx.uid, `${col} = ${value}`));
        }
      }
    });

    await run('B20 — el tutor no cambia las columnas del sistema de su hijo', async () => {
      for (const [col, value] of Object.entries(SYSTEM_COLUMNS)) {
        await expectDenied(update(tutor, ids.child, `${col} = ${value}`));
      }
    });

    await run('B20 — el admin tampoco cambia stripe_customer_id (solo el servicePool)', async () => {
      await expectDenied(update(admin, ids.b, `stripe_customer_id = 'cus_hack'`));
    });

    await run('B20 — alumno, tutor y profesor no cambian su fecha de nacimiento ya puesta', async () => {
      for (const ctx of [alumno, tutor, profesor]) {
        await expectDenied(update(ctx, ctx.uid, `birth_date = '${yearsAgo(10)}'`));
        await expectDenied(update(ctx, ctx.uid, `birth_date = '${yearsAgo(50)}'`));
        await expectDenied(update(ctx, ctx.uid, `birth_date = NULL`));
      }
    });

    await run('B20 — sin fecha (alta con Google) se pone una vez, de adulto', async () => {
      const r = await update({ uid: ids.b, role: 'alumno' }, ids.b, `birth_date = '${yearsAgo(25)}'`);
      assert.equal(r.rowCount, 1);
      await expectDenied(update({ uid: ids.b, role: 'alumno' }, ids.b, `birth_date = '${yearsAgo(10)}'`));
    });

    await run('B20 — cada uno cambia lo que la API le deja editar', async () => {
      // PATCH /me (birth_date en el SET aunque no cambie), PATCH /me/profile y la foto.
      for (const ctx of [alumno, tutor, profesor]) {
        const r = await update(ctx, ctx.uid, `display_name = 'x', birth_date = COALESCE(NULL, birth_date), bio = 'b',
          social_links = '{"web": "https://example.com"}', visible_fields = '{"bio": true}', is_public = false,
          avatar = '${AVATAR}'`);
        assert.equal(r.rowCount, 1, ctx.role);
      }
      // PATCH /me/children/:id y la foto del hijo.
      const r = await update(tutor, ids.child, `display_name = 'y', birth_date = '${yearsAgo(8)}', avatar = '${AVATAR}'`);
      assert.equal(r.rowCount, 1);
    });

    await run('B20 — el admin despublica, quita la foto y corrige la fecha de nacimiento de otro', async () => {
      const r = await update(admin, ids.pub, `is_public = false, avatar = NULL, birth_date = '${yearsAgo(31)}'`);
      assert.equal(r.rowCount, 1);
    });

    // B20 (B2): el admin no edita el contenido de un perfil ajeno (CONTEXT: despublica y quita la foto).
    await run('B20 — el admin no edita el contenido del perfil de otro, ni lo publica, ni le pone una foto', async () => {
      for (const set of [`display_name = 'x'`, `bio = 'x'`, `social_links = '{}'`, `visible_fields = '{"bio": true}'`,
        'is_public = true', `avatar = '${AVATAR}'`]) {
        await expectDenied(update(admin, ids.b, set));
      }
    });

    // B20 (B4): al registrarse (createUser, con un id nuevo) solo se insertan id, nombre y una fecha vacía o de adulto.
    await run('B20 — el registro solo inserta id, display_name y una fecha de adulto (o ninguna)', async () => {
      const insert = (cols, vals) => {
        const uid = crypto.randomUUID();
        return withCtx({ uid, role: 'alumno' }, (c) => c.query(`INSERT INTO profiles (id, ${cols}) VALUES ($1, ${vals})`, [uid]));
      };
      for (const [cols, vals] of [['stripe_customer_id', `'cus_hack'`], ['is_public', 'true'], ['bio', `'x'`],
        ['birth_date', `'${yearsAgo(10)}'`]]) {
        await expectDenied(insert(cols, vals));
      }
      assert.equal((await insert('display_name, birth_date', `'x', '${yearsAgo(30)}'`)).rowCount, 1);
      assert.equal((await insert('display_name, birth_date', `'x', NULL`)).rowCount, 1);
    });

    // B20 (B5): de su hijo, el tutor edita nombre, fecha y foto; no su bio ni sus redes. B32: su visibilidad, sí.
    await run('B20 — el tutor no edita bio ni redes de su hijo', async () => {
      for (const set of [`bio = 'x'`, `social_links = '{}'`]) {
        await expectDenied(update(tutor, ids.child, set));
      }
    });

    // B20 (M1): una tabla temporal tapa la real dentro de las funciones SECURITY DEFINER (search_path sin pg_temp al final).
    await run('B20 — app_user no crea tablas temporales (no puede tapar las de las funciones SECURITY DEFINER)', async () => {
      await expectDenied(withCtx(alumno, (c) => c.query(`CREATE TEMP TABLE guardianships (tutor_id uuid, minor_id uuid)`)));
    });

    // B20 (M2): lo que crea migrator ya no da nada a app_user por defecto; cada migración da sus permisos.
    await run('B20 — una tabla nueva de migrator no da nada a app_user (ni su secuencia)', async () => {
      const m = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await m.connect();
      try {
        await m.query('BEGIN');
        await m.query('CREATE TABLE b20_m2_probe (id serial)');
        const { rows: [r] } = await m.query(
          `SELECT has_table_privilege('app_user', 'b20_m2_probe', 'SELECT, INSERT, UPDATE, DELETE') AS tbl,
                  has_sequence_privilege('app_user', 'b20_m2_probe_id_seq', 'SELECT, USAGE') AS seq`);
        assert.deepEqual(r, { tbl: false, seq: false });
      } finally {
        await m.query('ROLLBACK').catch(() => {});
        await m.end();
      }
    });

    // B20 (M3): el pago en efectivo está reservado; hasta su bloque, solo el servicePool toca cash_payments.
    await run('B20 — app_user (ni el admin) no lee ni escribe cash_payments', async () => {
      await expectDenied(withCtx(admin, (c) => c.query(`SELECT 1 FROM cash_payments`)));
      await expectDenied(withCtx(admin, (c) => c.query(`DELETE FROM cash_payments`)));
    });

    // B20 (M4): con SQL arbitrario se marcaría como aplicada una migración de seguridad o se borraría el historial.
    await run('B20 — app_user no toca pgmigrations ni su secuencia', async () => {
      await expectDenied(withCtx(admin, (c) => c.query(`SELECT 1 FROM pgmigrations`)));
      await expectDenied(withCtx(admin, (c) => c.query(`DELETE FROM pgmigrations WHERE false`)));
      await expectDenied(withCtx(admin, (c) => c.query(`SELECT last_value FROM pgmigrations_id_seq`)));
    });

    // B20 (M5): auth_credentials_update_self_or_admin dejaba cambiar por SQL cualquier columna de la fila.
    const updateCreds = (ctx, id, set) =>
      withCtx(ctx, (c) => c.query(`UPDATE auth_credentials SET ${set} WHERE profile_id = $1`, [id]));
    await run('B20 — nadie cambia con app_user email, email_verified ni google_sub (tampoco el admin)', async () => {
      for (const set of [`email = 'x@t.test'`, 'email_verified = true', `google_sub = 'g-hack'`, 'profile_id = profile_id',
        'created_at = now()', 'updated_at = now()']) {
        await expectDenied(updateCreds(alumno, ids.a, set));
        await expectDenied(updateCreds(admin, ids.a, set));
      }
    });

    await run('B20 — cada uno cambia su contraseña (password_hash y credentials_changed_at)', async () => {
      const r = await updateCreds(alumno, ids.a, `password_hash = 'y', credentials_changed_at = now()`);
      assert.equal(r.rowCount, 1);
    });

    // B20 (B6): toda tabla con RLS en ENABLE y FORCE; pgmigrations no (FORCE se la aplicaría a migrator, M4).
    await run('B20 — toda tabla de public tiene RLS en ENABLE y FORCE (salvo pgmigrations)', async () => {
      const { rows } = await servicePool.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'pgmigrations'
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity) ORDER BY 1`);
      assert.deepEqual(rows.map((r) => r.relname), []);
    });

    // B20 (B8): las firmas apuntan a tipo y versión; un documento publicado no se cambia, solo se retira.
    await run('B20 — un documento publicado solo se retira (ni el admin cambia versión, checksum, ruta ni lo despublica)', async () => {
      await withCtx(admin, async (c) => {
        const codeOf = async (sql, params) => {
          await c.query('SAVEPOINT s');
          try { await c.query(sql, params); return null; } catch (e) { return e.code; } finally { await c.query('ROLLBACK TO SAVEPOINT s'); }
        };
        const id = crypto.randomUUID();
        // Como publishDocument: se retira el vigente y se publica el nuevo (todo se deshace al final).
        await c.query(`UPDATE agreement_documents SET retired_at = now()
                        WHERE type = 'data_protection' AND published_at IS NOT NULL AND retired_at IS NULL`);
        await c.query(`INSERT INTO agreement_documents (id, type, version, storage_path, checksum, published_at, published_by)
                       VALUES ($1, 'data_protection', $2, 'x.pdf', 'x', now(), $3)`, [id, `9.${Date.now()}`, ids.admin]);
        for (const set of [`version = '0.1'`, `checksum = 'y'`, `storage_path = 'y.pdf'`, 'published_at = NULL', 'published_by = NULL']) {
          assert.equal(await codeOf(`UPDATE agreement_documents SET ${set} WHERE id = $1`, [id]), '42501', set);
        }
        await c.query(`UPDATE agreement_documents SET retired_at = now() WHERE id = $1`, [id]);
        assert.equal(await codeOf(`UPDATE agreement_documents SET retired_at = NULL WHERE id = $1`, [id]), '42501');
      });
    });

    // B20 (B3): el rol admin solo lo da un admin con el doble factor activado; una fila admin no se cambia ni se borra.
    await run('B20 — el rol admin solo lo da un admin con doble factor; nadie quita el de un admin por SQL', async () => {
      await expectDenied(withCtx(admin, (c) => c.query(`UPDATE user_roles SET role = 'admin' WHERE user_id = $1`, [ids.b])));
      await withCtx(admin, async (c) => {
        await c.query(`INSERT INTO user_mfa (id, user_id, totp_secret_encrypted, recovery_codes_encrypted, mfa_enabled)
                       VALUES ($1, $2, 'x', 'x', true)`, [crypto.randomUUID(), ids.admin]);
        assert.equal((await c.query(`UPDATE user_roles SET role = 'admin' WHERE user_id = $1`, [ids.b])).rowCount, 1);
        assert.equal((await c.query(`UPDATE user_roles SET role = 'alumno' WHERE user_id = $1`, [ids.b])).rowCount, 0);
        assert.equal((await c.query(`DELETE FROM user_roles WHERE user_id = $1`, [ids.b])).rowCount, 0);
      });
    });

    // B20 (B9): nadie lee password_hash con app_user (has_password y own_password_hash() en su lugar).
    await run('B20 — nadie lee password_hash con app_user; cada uno el suyo por own_password_hash()', async () => {
      const hash = `SELECT password_hash FROM auth_credentials WHERE profile_id = $1`;
      await expectDenied(withCtx(admin, (c) => c.query(hash, [ids.a])));
      await expectDenied(withCtx(alumno, (c) => c.query(hash, [ids.a])));
      const { rows: [r] } = await withCtx(admin, (c) =>
        c.query(`SELECT has_password FROM auth_credentials WHERE profile_id = $1`, [ids.a]));
      assert.equal(r.has_password, true);
      const { rows: [h] } = await withCtx(alumno, (c) => c.query(`SELECT own_password_hash() AS h`));
      assert.equal(h.h, 'x');
    });

    // B20 (B9): el doble factor (secreto cifrado y códigos de recuperación) solo lo ve y lo toca su dueño.
    await run('B20 — el doble factor de cada uno solo lo ve y lo toca él (tampoco el admin)', async () => {
      const n = (ctx, sql) => withCtx(ctx, async (c) => (await c.query(sql, [ids.a])).rowCount);
      assert.equal(await n(alumno, `SELECT 1 FROM user_mfa WHERE user_id = $1`), 1);
      assert.deepEqual([await n(admin, `SELECT 1 FROM user_mfa WHERE user_id = $1`),
        await n(admin, `UPDATE user_mfa SET mfa_enabled = false WHERE user_id = $1`),
        await n(admin, `DELETE FROM user_mfa WHERE user_id = $1`)], [0, 0, 0]);
    });

    // B20 (B1): de otro perfil solo se pregunta lo que se ve (él, su tutor, el admin).
    await run('B20 — app_user no llama a profile_missing ni discipline_changes_used; visible_* solo de quien ve', async () => {
      for (const sql of ['SELECT profile_missing($1)', 'SELECT discipline_changes_used($1)']) {
        await expectDenied(withCtx(admin, (c) => c.query(sql, [ids.a])));
      }
      const v = (ctx, id) => withCtx(ctx, async (c) => (await c.query(
        `SELECT visible_profile_missing($1) IS NOT NULL AS m,
                visible_discipline_changes_used(gen_random_uuid()) IS NULL AS no_sub`, [id])).rows[0]);
      const all = { m: true, no_sub: true };
      assert.deepEqual(await v(alumno, ids.a), all);
      assert.deepEqual(await v(admin, ids.a), all);
      assert.deepEqual(await v(tutor, ids.child), all);
      assert.deepEqual(await v({ uid: ids.b, role: 'alumno' }, ids.a), { ...all, m: false });
      assert.deepEqual(await v(profesor, ids.a), { ...all, m: false });
    });

    // B20 (riesgo de M2): sin privilegios por defecto, una migración que olvide su GRANT dejaría la tabla sin acceso.
    // Toda tabla o vista da algo a app_user, salvo las que solo usa el servicePool (añadir aquí las nuevas que lo sean).
    const SERVICE_ONLY = ['cash_payments', 'medal_views', 'password_resets', 'pgmigrations', 'webhook_events'];
    await run('B20 — toda tabla o vista da permisos a app_user, salvo las solo del servicePool', async () => {
      const { rows } = await servicePool.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
            AND NOT has_table_privilege('app_user', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
            AND NOT has_any_column_privilege('app_user', c.oid, 'SELECT, INSERT, UPDATE') ORDER BY 1`);
      assert.deepEqual(rows.map((r) => r.relname), SERVICE_ONLY);
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

    // B8: la vista se sustituyó por professor_session_health (scripts/test-attendance.js).
    await run('B8 — la vista student_health_professor_view ya no existe', async () => {
      await assert.rejects(
        withCtx({ uid: ids.professor, role: 'profesor' }, (c) => c.query(`SELECT * FROM student_health_professor_view`)),
        /does not exist/
      );
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
          `INSERT INTO user_agreements (id, profile_id, signed_by, type, version)
           VALUES ($1, $2, $2, 'data_protection', '1.0')`,
          [crypto.randomUUID(), ids.b]
        )
      );
      const { rows } = await withCtx({ uid: ids.a, role: 'alumno' }, (c) =>
        c.query(`SELECT id FROM user_agreements WHERE profile_id = $1`, [ids.b])
      );
      assert.equal(rows.length, 0);
    });

    // B32: el hijo con acceso propio actúa con su token. Lee lo suyo (perfil, credenciales, reservas) y nada de su
    // hermano ni de sus tutores; tampoco su salud, sus cobros ni sus firmas, aunque sean suyos.
    await run('B32 — el menor como actor: ni salud, cobros, suscripción ni firmas (suyos o del hermano), ni hermano ni tutores', async () => {
      const sib = crypto.randomUUID();
      const plan = (await withServiceCommit(async (c) => {
        await c.query(`INSERT INTO profiles (id, display_name, birth_date) VALUES ($1, 'hermano', $2)`, [sib, yearsAgo(15)]);
        await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`, [sib]);
        await c.query(`INSERT INTO guardianships (tutor_id, minor_id) VALUES ($1, $2)`, [ids.tutor, sib]);
        await c.query(`INSERT INTO auth_credentials (profile_id, username, password_hash) VALUES ($1, $2, 'x'), ($3, $4, 'x')`,
          [ids.child, `hijo-${ids.child.slice(0, 8)}`, sib, `hermano-${sib.slice(0, 8)}`]);
        await c.query(`INSERT INTO student_health_info (profile_id, allergies) VALUES ($1, 'x'), ($2, 'y')`, [ids.child, sib]);
        await c.query(`INSERT INTO user_agreements (id, profile_id, signed_by, type, version) VALUES
          (gen_random_uuid(), $1, $3, 'data_protection', '1.0'), (gen_random_uuid(), $2, $3, 'data_protection', '1.0')`,
        [ids.child, sib, ids.tutor]);
        return (await c.query(`INSERT INTO plans (name, price_cents) VALUES ('B32-rls', 1000) RETURNING id`)).rows[0].id;
      }));
      ids.sib = sib;
      await withServiceCommit(async (c) => {
        for (const who of [ids.child, sib]) {
          const { rows: [s] } = await c.query(`INSERT INTO subscriptions (student_id, payer_id, plan_id, status, stripe_subscription_id)
            VALUES ($1, $2, $3, 'active', 'sub_' || gen_random_uuid()) RETURNING id`, [who, ids.tutor, plan]);
          await c.query(`INSERT INTO invoices (student_id, payer_id, stripe_invoice_id, subscription_id)
            VALUES ($1, $2, 'in_' || gen_random_uuid(), $3)`, [who, ids.tutor, s.id]);
        }
      });
      await withCtx({ uid: ids.child, role: 'alumno' }, async (c) => {
        const count = async (sql) => (await c.query(sql, [ids.child, sib, ids.tutor])).rowCount;
        assert.equal(await count(`SELECT 1 FROM student_health_info WHERE profile_id IN ($1, $2) AND $3::uuid IS NOT NULL`), 0, 'salud');
        assert.equal(await count(`SELECT 1 FROM invoices WHERE student_id IN ($1, $2) OR payer_id = $3`), 0, 'recibos');
        assert.equal(await count(`SELECT 1 FROM subscriptions WHERE student_id IN ($1, $2) OR payer_id = $3`), 0, 'suscripciones');
        assert.equal(await count(`SELECT 1 FROM user_agreements WHERE profile_id IN ($1, $2) OR signed_by = $3`), 0, 'firmas');
        assert.equal(await count(`SELECT 1 FROM profiles WHERE id IN ($2, $3) AND $1::uuid IS NOT NULL`), 0, 'hermano y tutor');
        assert.equal(await count(`SELECT 1 FROM profiles WHERE id = $1 AND $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`), 1, 'el suyo');
        assert.equal(await count(`SELECT 1 FROM auth_credentials WHERE profile_id IN ($2, $3) AND $1::uuid IS NOT NULL`), 0, 'credenciales ajenas');
        assert.equal(await count(`SELECT 1 FROM auth_credentials WHERE profile_id = $1 AND $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`), 1);
        await expectDenied(c.query(`INSERT INTO student_health_info (profile_id, allergies) VALUES ($1, 'z')
          ON CONFLICT (profile_id) DO UPDATE SET allergies = 'z'`, [ids.child]));
      });
      await withCtx({ uid: ids.child, role: 'alumno' }, async (c) => {
        await expectDenied(c.query(`UPDATE profiles SET display_name = 'otro' WHERE id = $1`, [ids.child]));
      });
      await withCtx({ uid: ids.child, role: 'alumno' }, async (c) => {
        await expectDenied(c.query(`UPDATE profiles SET is_public = true WHERE id = $1`, [ids.child])); // < 14
      });
      await withCtx({ uid: sib, role: 'alumno' }, async (c) => { // desde los 14, su visibilidad sí
        assert.equal((await c.query(`UPDATE profiles SET is_public = true, visible_fields = '{"ranking": true}' WHERE id = $1`, [sib])).rowCount, 1);
      });
      // El tutor sí lo ve todo de los dos y lee su usuario (no la contraseña).
      await withCtx({ uid: ids.tutor, role: 'tutor' }, async (c) => {
        const { rows } = await c.query(`SELECT username, can_book FROM auth_credentials WHERE profile_id IN ($1, $2)`, [ids.child, sib]);
        assert.equal(rows.length, 2);
        assert.equal((await c.query(`SELECT 1 FROM student_health_info WHERE profile_id IN ($1, $2)`, [ids.child, sib])).rowCount, 2);
        assert.equal((await c.query(`SELECT 1 FROM invoices WHERE student_id IN ($1, $2)`, [ids.child, sib])).rowCount, 2);
      });
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
