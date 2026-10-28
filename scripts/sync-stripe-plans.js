// Crea Product + Price en Stripe para los planes de pago sin stripe_price_id (B10). Idempotente: re-ejecutable.
import 'dotenv/config';
import { servicePool, closePools } from '../src/config/database.js';
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
} finally {
  await closePools();
}
