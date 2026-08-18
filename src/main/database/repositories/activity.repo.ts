import { getDb } from '../db'

export type ActivityLogInput = {
  user_id?: number | null
  action: string
  entity?: string | null
  entity_id?: number | null
  details?: string | null
}

export type ActivityLogFilter = {
  search?: string
  action?: string
  entity?: string
  user_id?: number | null
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export function createActivityLog(input: ActivityLogInput) {
  const db = getDb()

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
      `,
    )
    .run(
      input.user_id ?? null,
      input.action,
      input.entity ?? null,
      input.entity_id ?? null,
      input.details ?? null,
    )
}

export function safeCreateActivityLog(input: ActivityLogInput) {
  try {
    return createActivityLog(input)
  } catch (error) {
    console.error('Failed to create activity log:', error)
    return null
  }
}

export function listActivityLogs(input?: ActivityLogFilter) {
  const db = getDb()

  const where: string[] = []
  const params: any[] = []

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  if (input?.date_from) {
    where.push(`datetime(al.created_at, 'localtime') >= datetime(?)`)
    params.push(`${input.date_from} 00:00:00`)
  }

  if (input?.date_to) {
    where.push(`datetime(al.created_at, 'localtime') <= datetime(?)`)
    params.push(`${input.date_to} 23:59:59`)
  }

  if (input?.action && input.action !== 'all') {
    where.push(`al.action = ?`)
    params.push(input.action)
  }

  if (input?.entity && input.entity !== 'all') {
    where.push(`al.entity = ?`)
    params.push(input.entity)
  }

  if (input?.user_id) {
    where.push(`al.user_id = ?`)
    params.push(Number(input.user_id))
  }

  if (input?.search?.trim()) {
    const q = `%${input.search.trim()}%`

    where.push(`
      (
        al.action LIKE ?
        OR al.entity LIKE ?
        OR al.details LIKE ?
        OR u.name LIKE ?
        OR u.username LIKE ?
      )
    `)

    params.push(q, q, q, q, q)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
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
    OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}
