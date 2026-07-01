import pg from 'pg';
import type { QueryResultRow } from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: any[] = []
) {
  const result = await pool.query<T>(sql, params);
  return result;
}

export async function checkDatabaseConnection() {
  const result = await query<{ now: string }>('SELECT NOW() AS now');
  return result.rows[0];
}