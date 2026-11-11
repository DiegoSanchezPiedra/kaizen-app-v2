// B20: `npm run test` lanza en serie (comparten la BD local) todos los `test:*` de package.json y acaba con un resumen;
// sale con 1 si alguno falla. Los que llaman al sandbox de Stripe (red y la cuenta compartida) quedan fuera salvo con
// `npm run test -- --stripe`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STRIPE = ['test:catalog', 'test:billing', 'test:webhook', 'test:events', 'test:dunning', 'test:e2e-b30'];
const withStripe = process.argv.includes('--stripe');
const all = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts).filter((n) => n.startsWith('test:'));
const skipped = withStripe ? [] : all.filter((n) => STRIPE.includes(n));

const results = all.filter((n) => !skipped.includes(n)).map((name) => {
  console.log(`\n=== ${name} ===`);
  const start = Date.now();
  const { status } = spawnSync('npm', ['run', '--silent', name], { stdio: 'inherit' });
  return { name, ok: status === 0, secs: ((Date.now() - start) / 1000).toFixed(1) };
});

console.log('\n=== Resumen ===');
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name} (${r.secs} s)`);
if (skipped.length) console.log(`Fuera (Stripe; con --stripe entran): ${skipped.join(', ')}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
