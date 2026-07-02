import 'dotenv/config';
import pg from 'pg';
import type { QueryResultRow } from 'pg';

const { Pool } = pg;

const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL غير موجود. تأكد من وجود ملف cloud-server/.env وفيه DATABASE_URL صحيح'
  );
}

export const pool = new Pool({
  connectionString: databaseUrl
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