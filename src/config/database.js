// src/config/database.js
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

function buildPool(name, connectionString, max = 10) {
  if (!connectionString) {
    throw new Error(`[db:${name}] Falta la variable de conexión (DATABASE_URL_*).`);
  }

  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: `kaizen-${name}`,
  });

  // Nunca dejar que un error de pool mate el proceso
  pool.on('error', (err) => {
    console.error(`[db:${name}] Error inesperado en pool:`, err.message);
  });

  // Log de diagnóstico sin filtrar credenciales
  try {
    const u = new URL(connectionString);
    console.log(`[db:${name}] pool listo → ${u.hostname}:${u.port}${u.pathname} (user=${u.username})`);
  } catch {
    console.warn(`[db:${name}] pool listo (no se pudo parsear URL para log)`);
  }

  return pool;
}

export const appPool = buildPool('app', process.env.DATABASE_URL_APP, 10);
export const servicePool = buildPool('service', process.env.DATABASE_URL_SERVICE, 5);

export async function pingPool(pool) {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    return { ok: rows[0]?.ok === 1 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


export async function pingAll() {
  const [app, service] = await Promise.all([
    pingPool(appPool),
    pingPool(servicePool),
  ]);
  return { app, service };
}

export async function closePools() {
  await Promise.allSettled([appPool.end(), servicePool.end()]);
}