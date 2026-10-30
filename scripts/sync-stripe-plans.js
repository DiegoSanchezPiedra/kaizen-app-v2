// Crea Product + Price en Stripe para los planes de pago sin stripe_price_id (B10) y pone STRIPE_STATEMENT_DESCRIPTOR
// en los Products ya creados de los planes y del seguro (B11). Idempotente: re-ejecutable.
import 'dotenv/config';
import { servicePool, closePools } from '../src/config/database.js';
import { stripe, STRIPE_STATEMENT_DESCRIPTOR } from '../src/config/stripe.js';
import { syncPlanToStripe } from '../src/services/catalog.js';

try {
  const { rows } = await servicePool.query(
    `SELECT id, name, price_cents, is_active FROM plans WHERE stripe_price_id IS NULL AND price_cents > 0`);
  for (const plan of rows) {
    const client = await servicePool.connect();
    try {
      await client.query('BEGIN');
      await syncPlanToStripe(client, plan, null);
      await client.query('COMMIT');
      console.log(`OK   ${plan.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      process.exitCode = 1;
      console.error(`FAIL ${plan.name}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  console.log(`planes sin Price: ${rows.length}`);

  if (STRIPE_STATEMENT_DESCRIPTOR) {
    const { rows: prices } = await servicePool.query(
      `SELECT stripe_price_id AS price FROM plans WHERE stripe_price_id IS NOT NULL
       UNION SELECT value #>> '{}' FROM academy_settings WHERE key = 'insurance_stripe_price_adult'`);
    const products = new Set();
    for (const { price } of prices) products.add((await stripe.prices.retrieve(price)).product);
    let changed = 0;
    for (const id of products) {
      if ((await stripe.products.retrieve(id)).statement_descriptor === STRIPE_STATEMENT_DESCRIPTOR) continue;
      await stripe.products.update(id, { statement_descriptor: STRIPE_STATEMENT_DESCRIPTOR });
      changed++;
    }
    console.log(`descriptor «${STRIPE_STATEMENT_DESCRIPTOR}»: ${changed} de ${products.size} productos actualizados`);
  }
} finally {
  await closePools();
}
