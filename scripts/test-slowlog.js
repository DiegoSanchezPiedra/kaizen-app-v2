// scripts/test-slowlog.js — el registro de peticiones lentas de src/middleware/slowLog.js, sin servidor ni base.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { slowLog } from '../src/middleware/slowLog.js';

const lines = [];
const log = console.log;
console.log = (...a) => lines.push(a.join(' '));
const hit = async (url, ms) => {
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  let nexted = false;
  slowLog({ method: 'GET', originalUrl: url }, res, () => { nexted = true; });
  assert.ok(nexted, 'deja pasar la petición');
  await sleep(ms);
  res.emit('finish');
};
await hit('/rapida', 0);
await hit('/lenta?token=secreto', 550);
console.log = log;

assert.equal(lines.length, 1, `solo la lenta: ${JSON.stringify(lines)}`);
assert.match(lines[0], /^\[slow\] GET \/lenta → 200, \d+ ms$/);
assert.ok(!lines[0].includes('secreto'), 'sin query string');
console.log('todo OK');
