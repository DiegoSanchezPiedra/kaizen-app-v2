// scripts/test-client-errors.js — POST /client-errors: el fallo que el móvil enseña como «Algo ha fallado» deja una línea en
// el log de la API (sin servidor ni base).
import assert from 'node:assert/strict';
import { clientErrorLine } from '../src/routes/client-errors.js';

const line = JSON.parse(clientErrorLine({
  where: 'api', code: 'internal_error', status: 500, message: 'boom', version: '2026-11-21T10:00',
  url: '/professor', standalone: true, extra: 'fuera',
}, 'Mozilla/5.0 (iPhone)'));
assert.equal(line.where, 'api');
assert.equal(line.code, 'internal_error');
assert.equal(line.status, 500);
assert.equal(line.standalone, true);
assert.equal(line.ua, 'Mozilla/5.0 (iPhone)');
assert.equal(line.extra, undefined, 'solo los campos conocidos');

const long = JSON.parse(clientErrorLine({ message: 'x'.repeat(5000), stack: 'y'.repeat(5000) }, undefined));
assert.equal(long.message.length, 500, 'el texto se recorta');
assert.equal(long.stack.length, 2000, 'la pila se recorta');

const junk = JSON.parse(clientErrorLine({ status: '500', code: { a: 1 }, standalone: 'sí' }, undefined));
assert.equal(junk.status, undefined, 'tipos que no son los suyos fuera');
assert.equal(junk.code, undefined);
assert.equal(junk.standalone, undefined);
assert.doesNotThrow(() => clientErrorLine(null, undefined), 'sin cuerpo no revienta');
console.log('todo OK');
