import { getDb } from '../db';

export type ActivityLogInput = {
  user_id?: number | null;
  action: string;
  entity?: string | null;
  entity_id?: number | null;
  details?: string | null;
};

export type ActivityLogFilter = {
  search?: string;
  action?: string;
  entity?: string;
  user_id?: number | null;
  date_from?: string;
  date_to?: string;
  limit?: number;
};

export function createActivityLog(input: ActivityLogInput) {
  const db = getDb();

  return db
    .prepare(
      `
      INSERT INTO activity_logs (
        user_id,
        action,
        entity,
        entity_id,
        details
      )
      VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(
      input.user_id ?? null,
      input.action,
      input.entity ?? null,
      input.entity_id ?? null,
      input.details ?? null
    );
}

export function safeCreateActivityLog(input: ActivityLogInput) {
  try {
    return createActivityLog(input);
  } catch (error) {
    console.error('Failed to create activity log:', error);
    return null;
  }
}

export function listActivityLogs(input?: ActivityLogFilter) {
  const db = getDb();

  const where: string[] = [];
  const params: any[] = [];

  const limit = Math.min(Math.max(Number(input?.limit || 300), 1), 1000);

  if (input?.date_from) {
    where.push(`datetime(al.created_at, 'localtime') >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(al.created_at, 'localtime') <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  if (input?.action && input.action !== 'all') {
    where.push(`al.action = ?`);
    params.push(input.action);
  }

  if (input?.entity && input.entity !== 'all') {
    where.push(`al.entity = ?`);
    params.push(input.entity);
  }

  if (input?.user_id) {
    where.push(`al.user_id = ?`);
    params.push(Number(input.user_id));
  }

  if (input?.search?.trim()) {
    const q = `%${input.search.trim()}%`;

    where.push(`
      (
        al.action LIKE ?
        OR al.entity LIKE ?
        OR al.details LIKE ?
        OR u.name LIKE ?
        OR u.username LIKE ?
      )
    `);

    params.push(q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db
    .prepare(
      `
      SELECT
        al.*,
        u.name AS user_name,
        u.username AS username
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereSql}
      ORDER BY al.id DESC
      LIMIT ?
      `
    )
    .all(...params, limit);
}