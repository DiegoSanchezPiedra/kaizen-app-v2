// B28 (un solo uso, antes de la migración 057): cancela en Stripe los seguros vivos (metadata.kind = 'insurance') y
// archiva los Products «Seguro» y sus Prices. Solo sandbox: aborta con una clave que no sea de test.
// dotenv -e .env -- node scripts/drop-insurance-stripe.js
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key)) {
  console.error('ABORT: STRIPE_SECRET_KEY no es de test (sk_test_ / rk_test_)');
  process.exit(1);
}
const { stripe } = await import('../src/config/stripe.js');

const isInsurance = (x) => x.metadata?.kind === 'insurance';
let subs = 0, prices = 0, products = 0;
for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
  if (!isInsurance(s) || ['canceled', 'incomplete_expired'].includes(s.status)) continue;
  await stripe.subscriptions.cancel(s.id);
  subs++;
}
for await (const p of stripe.products.list({ limit: 100 })) {
  if (!isInsurance(p)) continue;
  for await (const pr of stripe.prices.list({ product: p.id, active: true, limit: 100 })) {
    await stripe.prices.update(pr.id, { active: false });
    prices++;
  }
  if (p.active) {
    await stripe.products.update(p.id, { active: false });
    products++;
  }
}
console.log(`seguros cancelados: ${subs}; prices archivados: ${prices}; products archivados: ${products}`);
