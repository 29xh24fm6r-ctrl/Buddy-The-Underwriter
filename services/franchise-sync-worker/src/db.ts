import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    let connectionString = process.env.BUDDY_DB_URL;
    if (!connectionString) {
      throw new Error('BUDDY_DB_URL is required');
    }

    // Strip sslmode from connection string — we control SSL explicitly.
    // Supabase pooler URLs include sslmode=require which pg v8 treats as
    // verify-full, causing "self-signed certificate in certificate chain".
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/gi, (_m, offset) =>
      offset === connectionString!.indexOf('?') ? '?' : ''
    ).replace(/\?$/, '').replace(/\?&/, '?');

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
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
