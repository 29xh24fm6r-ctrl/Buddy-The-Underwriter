import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.BUDDY_DB_URL;
    if (!connectionString) {
      throw new Error('BUDDY_DB_URL is required');
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.BUDDY_DB_CA_BUNDLE
        ? { ca: process.env.BUDDY_DB_CA_BUNDLE }
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function shutdown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
