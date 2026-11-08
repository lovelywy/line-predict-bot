import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;
let pool;

export function createDatabase(databaseUrl) {
  if (pool) return pool;

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslOption(databaseUrl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error', error);
  });

  return pool;
}

function sslOption(url) {
  const mode = process.env.DATABASE_SSL;
  if (mode === 'false') return undefined;
  if (mode === 'true' || /sslmode=require/.test(url) || /\.render\.com/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export async function migrate() {
  const sql = await readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8');
  await getDatabase().query(sql);
  console.log('Database schema applied');
}

export function getDatabase() {
  if (!pool) throw new Error('Database has not been initialized');
  return pool;
}

export async function query(text, params = []) {
  return getDatabase().query(text, params);
}

export async function withTransaction(work, options = {}) {
  const client = await getDatabase().connect();
  const isolation = options.isolation ?? 'READ COMMITTED';

  try {
    await client.query('BEGIN');
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  if (!pool) return;
  const closingPool = pool;
  pool = undefined;
  await closingPool.end();
}
