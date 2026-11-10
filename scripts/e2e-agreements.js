// B20: E2E de los documentos legales de B4.5/B4.5.1 por HTTP, con la app entera en proceso (scripts/lib/app-server.js) y
// una BD efímera (npm run test:e2e-agreements): el admin sube y publica los dos documentos; un alumno sin firmar
// topa con requireCompleteProfile (403 profile_incomplete); firma y ya pasa. Igual para un menor y su tutor.
// Detrás de la guarda se llama a POST /billing/checkout con un plan gratis: 409 plan_not_purchasable, antes de Stripe.
import assert from 'node:assert/strict';
import { servicePool, closePools } from '../src/config/database.js';
import { hashPassword } from '../src/services/password.js';
import { AGREEMENT_TYPES } from '../src/config/agreements.js';
import { deleteFile } from '../src/services/storage.js';
import { startApp } from './lib/app-server.js';

const password = 'e2e-agreements-password-1234';
const hash = await hashPassword(password);
const mkUser = async (name, role) => {
  const { rows: [{ id }] } = await servicePool.query(
    `WITH p AS (INSERT INTO profiles (id, display_name) VALUES (gen_random_uuid(), $1) RETURNING id),
          c AS (INSERT INTO auth_credentials (profile_id, email, password_hash, email_verified)
                SELECT id, $1 || '@test.local', $2, true FROM p),
          r AS (INSERT INTO user_roles (user_id, role) SELECT id, $3 FROM p)
     SELECT id FROM p`, [name, hash, role]);
  return id;
};
const { rows: [{ id: planId }] } = await servicePool.query(
  `INSERT INTO plans (name, price_cents) VALUES ('E2E gratis', 0) RETURNING id`);
for (const n of ['admin', 'alumno', 'tutor']) await mkUser(`e2e-${n}`, n);

const { http, close } = await startApp();
const realError = console.error;
console.error = () => {}; // el errorHandler registra cada 4xx esperado
const files = [];
const login = async (n) => (await http('POST', '/auth/login', { body: { email: `e2e-${n}@test.local`, password } })).body.token;
const status = (r) => [r.status, r.body?.code];
const checkout = (token, profile_id) => http('POST', '/billing/checkout', { token, body: { plan_id: planId, profile_id } });
const health = (token, profile_id) => http('POST', '/me/health', {
  token, body: { emergency_contact_name: 'Ana', emergency_contact_phone: '600000000', profile_id } });
const missing = async (token, id) => (await http('GET', `/me/profile-status${id ? `?profile_id=${id}` : ''}`, { token })).body.missing ?? [];
const signAll = async (token, versions, profile_id) => {
  for (const type of AGREEMENT_TYPES) {
    const r = await http('POST', '/me/agreements', { token, body: { type, version: versions[type], profile_id } });
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.body)}`);
  }
};

try {
  const [admin, alumno, tutor] = await Promise.all(['admin', 'alumno', 'tutor'].map(login));
  let r0;

  // 1. El admin sube y publica (raw application/pdf); un alumno no sube.
  const upload = (token, type, version) => http('POST', `/admin/agreements/documents?type=${type}&version=${version}`, {
    token, type: 'application/pdf', body: Buffer.from(`%PDF-1.4 e2e ${type} ${version}`) });
  assert.equal((await upload(alumno, 'data_protection', '9.1')).status, 403);
  const versions = {};
  for (const type of AGREEMENT_TYPES) {
    let r = await upload(admin, type, '9.1');
    assert.equal(r.status, 201);
    files.push(`${r.body.document.id}.pdf`);
    // Borrador: aún no hay documento vigente.
    assert.deepEqual(status(await http('GET', `/agreements/${type}/current`, { token: alumno })), [404, 'no_current_document']);
    r = await http('POST', `/admin/agreements/documents/${r.body.document.id}/publish`, { token: admin, body: {} });
    assert.equal(r.status, 200);
    versions[type] = r.body.document.version;
    assert.equal((await http('GET', `/agreements/${type}/current`, { token: alumno })).status, 200);
  }

  // B28: un campo retirado o desconocido en el checkout → 400, no se ignora.
  r0 = await http('POST', '/billing/checkout', { token: alumno, body: { plan_id: planId, insurance: true } });
  assert.deepEqual([...status(r0), r0.body.field], [400, 'invalid_field', 'insurance']);

  // 2. Sin firmar: la guarda bloquea con lo que falta. Con el contacto de emergencia sigue faltando lo legal.
  let r = await checkout(alumno);
  assert.deepEqual(status(r), [403, 'profile_incomplete']);
  assert.ok(r.body.missing.includes('data_protection') && r.body.missing.includes('rights_of_image'));
  assert.equal((await health(alumno)).status, 200);
  assert.deepEqual((await missing(alumno)).sort(), ['data_protection', 'rights_of_image']);
  assert.deepEqual(status(await checkout(alumno)), [403, 'profile_incomplete']);

  // 3. Firma con la versión vigente: una versión vieja no vale y firmar dos veces da 409. Ya pasa la guarda.
  assert.equal((await http('POST', '/me/agreements', {
    token: alumno, body: { type: 'data_protection', version: '1.0' } })).status, 400);
  await signAll(alumno, versions);
  assert.equal((await http('POST', '/me/agreements', {
    token: alumno, body: { type: 'rights_of_image', version: versions.rights_of_image } })).status, 409);
  assert.deepEqual(await missing(alumno), []);
  assert.deepEqual(status(await checkout(alumno)), [409, 'plan_not_purchasable']);

  // 4. Un documento nuevo publicado invalida lo firmado: otra vez bloqueado hasta firmar la versión nueva.
  r = await upload(admin, 'data_protection', '9.2');
  files.push(`${r.body.document.id}.pdf`);
  await http('POST', `/admin/agreements/documents/${r.body.document.id}/publish`, { token: admin, body: {} });
  r = await checkout(alumno);
  assert.deepEqual([r.status, r.body.code, r.body.missing], [403, 'profile_incomplete', ['data_protection']]);
  assert.equal((await http('POST', '/me/agreements', { token: alumno, body: { type: 'data_protection', version: '9.2' } })).status, 200);
  assert.deepEqual(status(await checkout(alumno)), [409, 'plan_not_purchasable']);
  versions.data_protection = '9.2';

  // 5. Menor y tutor: el tutor firma por el hijo; la guarda exige completos al hijo y al tutor (D15).
  r = await http('POST', '/me/children', { token: tutor, body: { display_name: 'E2E hijo', birth_date: '2018-01-01' } });
  assert.equal(r.status, 201);
  const child = r.body.child.id;
  assert.deepEqual(status(await checkout(tutor, child)), [403, 'profile_incomplete']);
  assert.equal((await health(tutor, child)).status, 200);
  await signAll(tutor, versions, child);
  assert.deepEqual(await missing(tutor, child), []);
  // El tutor, por su parte, aún debe firmar lo suyo.
  r = await checkout(tutor, child);
  assert.deepEqual(status(r), [403, 'profile_incomplete']);
  assert.ok(r.body.missing.length > 0);
  await signAll(tutor, versions);
  assert.deepEqual(await missing(tutor), []);
  assert.deepEqual(status(await checkout(tutor, child)), [409, 'plan_not_purchasable']);

  console.log('OK   E2E agreements: subir → publicar → bloqueo 403 profile_incomplete → firmar → pasa; versión nueva reabre; menor con tutor');
} catch (e) {
  realError('FAIL E2E agreements\n', e);
  process.exitCode = 1;
} finally {
  await Promise.all(files.map(deleteFile));
  await close();
  await closePools();
}
