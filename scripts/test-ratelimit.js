// scripts/test-ratelimit.js — el limitador de src/middleware/rateLimit.js (B20), sin servidor ni base.
import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';

let t = 0;
const limit = rateLimit({ name: 'test', max: 3, windowMs: 1000, now: () => t });
const hit = (ip) => {
  const headers = {};
  let err;
  limit({ ip }, { set: (k, v) => { headers[k] = v; } }, (e) => { err = e; });
  return { err, headers };
};

for (let i = 0; i < 3; i++) assert.equal(hit('1.1.1.1').err, undefined, `petición ${i + 1} dentro del límite`);
const over = hit('1.1.1.1');
assert.equal(over.err.status, 429);
assert.equal(over.err.code, 'rate_limited');
assert.equal(over.headers['Retry-After'], '1');
assert.equal(hit('2.2.2.2').err, undefined, 'cada IP lleva su cuenta');
t = 999;
assert.equal(hit('1.1.1.1').err?.status, 429, 'sigue bloqueada hasta el final de la ventana');
t = 1000;
assert.equal(hit('1.1.1.1').err, undefined, 'ventana nueva: vuelve a contar');
console.log('todo OK');
