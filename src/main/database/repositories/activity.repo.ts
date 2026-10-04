import { getDb } from '../db';

export const CRITICAL_AUDIT_ERROR_MESSAGE =
  'تعذر تسجيل سجل المراجعة. لم يتم تطبيق أي تغييرات.';

export type ActivityLogInput = {
  user_id?: number | null;

  approved_by?: number | null;

  action: string;

  entity?: string | null;

  entity_id?: number | null;

  details?: string | null;
};

export type ActivityLogFilter = {
  search?: string;
  action?: string;
  actions?: string[];
  entity?: string;
  entities?: string[];
  user_id?: number | null;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

export type CashDrawerNoSaleStatusFilter = 'all' | 'success' | 'failed';

export type CashDrawerNoSaleFilter = {
  shift_id?: number | null;

  user_id?: number | null;

  status?: CashDrawerNoSaleStatusFilter;

  date_from?: string | null;

  date_to?: string | null;

  limit?: number;

  offset?: number;
};

export type CashDrawerNoSaleRow = {
  id: number;

  action: 'cash_drawer_opened' | 'cash_drawer_open_failed';

  status: 'success' | 'failed';

  shift_id: number;

  shift_opened_by: number | null;

  shift_opened_by_name: string | null;

  user_id: number | null;

  user_name: string | null;

  username: string | null;

  reason: string;

  printer_name: string;

  error: string | null;

  created_at: string;
};

export function createActivityLog(input: ActivityLogInput) {
  const db = getDb();

  return db
    .prepare(
      `
      INSERT INTO activity_logs (
        user_id,
        approved_by,
        action,
        entity,
        entity_id,
        details
      )

      VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.user_id ?? null,

      input.approved_by ?? null,

      input.action,

      input.entity ?? null,

      input.entity_id ?? null,

      input.details ?? null,
    );
}

export function createCriticalActivityLog(input: ActivityLogInput) {
  try {
    return createActivityLog(input);
  } catch (error) {
    console.error('Failed to create critical activity log:', error);

    throw new Error(CRITICAL_AUDIT_ERROR_MESSAGE);
  }
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

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);

  const offset = Math.max(Number(input?.offset || 0), 0);

  if (input?.date_from) {
    where.push(`datetime(al.created_at, 'localtime') >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(al.created_at, 'localtime') <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  const selectedActions = Array.from(
    new Set(
      Array.isArray(input?.actions)
        ? input.actions
            .map((value) => String(value || '').trim())
            .filter((value) => Boolean(value) && value !== 'all')
        : [],
    ),
  );

  if (selectedActions.length > 0) {
    const placeholders = selectedActions.map(() => '?').join(', ');

    where.push(`al.action IN (${placeholders})`);

    params.push(...selectedActions);
  } else if (input?.action && input.action !== 'all') {
    where.push(`al.action = ?`);
    params.push(input.action);
  }

  const selectedEntities = Array.from(
    new Set(
      Array.isArray(input?.entities)
        ? input.entities
            .map((value) => String(value || '').trim())
            .filter((value) => Boolean(value) && value !== 'all')
        : [],
    ),
  );

  if (selectedEntities.length > 0) {
    const placeholders = selectedEntities.map(() => '?').join(', ');

    where.push(`al.entity IN (${placeholders})`);

    params.push(...selectedEntities);
  } else if (input?.entity && input.entity !== 'all') {
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
        OR approver.name LIKE ?
        OR approver.username LIKE ?
      )
    `);

    params.push(q, q, q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
    SELECT
      al.*,

      u.name AS user_name,
      u.username AS username,

      approver.name
        AS approved_by_name,

      approver.username
        AS approved_by_username

    FROM activity_logs al

    LEFT JOIN users u
      ON u.id = al.user_id

    LEFT JOIN users approver
      ON approver.id =
        al.approved_by

    ${whereSql}
    ORDER BY al.id DESC
    LIMIT ?
    OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id

    LEFT JOIN users approver
      ON approver.id =
        al.approved_by

    ${whereSql}
    `,
    )
    .get(...params) as { total: number };

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  };
}

function parseCashDrawerActivityDetails(
  value?: string | null,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // سجل قديم أو تفاصيل غير JSON.
  }

  return {};
}

export function listCashDrawerNoSaleEvents(input?: CashDrawerNoSaleFilter) {
  const db = getDb();

  const baseWhere: string[] = [
    `al.entity = 'cash_shifts'`,
    `al.action IN (
      'cash_drawer_opened',
      'cash_drawer_open_failed'
    )`,
  ];

  const baseParams: any[] = [];

  const shiftId = Number(input?.shift_id || 0);

  if (Number.isInteger(shiftId) && shiftId > 0) {
    baseWhere.push(`al.entity_id = ?`);

    baseParams.push(shiftId);
  }

  const userId = Number(input?.user_id || 0);

  if (Number.isInteger(userId) && userId > 0) {
    baseWhere.push(`al.user_id = ?`);

    baseParams.push(userId);
  }

  if (input?.date_from) {
    baseWhere.push(`
      datetime(
        al.created_at,
        'localtime'
      ) >= datetime(?)
    `);

    baseParams.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    baseWhere.push(`
      datetime(
        al.created_at,
        'localtime'
      ) <= datetime(?)
    `);

    baseParams.push(`${input.date_to} 23:59:59`);
  }

  const rowWhere = [...baseWhere];

  const rowParams = [...baseParams];

  const status =
    input?.status === 'success' || input?.status === 'failed'
      ? input.status
      : 'all';

  if (status === 'success') {
    rowWhere.push(`al.action = 'cash_drawer_opened'`);
  }

  if (status === 'failed') {
    rowWhere.push(`al.action = 'cash_drawer_open_failed'`);
  }

  const rawLimit = Number(input?.limit ?? 50);

  const rawOffset = Number(input?.offset ?? 0);

  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1),
    200,
  );

  const offset = Math.max(
    Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0,
    0,
  );

  const rowWhereSql = `WHERE ${rowWhere.join(' AND ')}`;

  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  const rawRows = db
    .prepare(
      `
      SELECT
        al.id,
        al.action,
        al.entity_id
          AS shift_id,
        al.details,
        al.created_at,

        al.user_id,

        actor.name
          AS user_name,

        actor.username,

        cs.opened_by
          AS shift_opened_by,

        opener.name
          AS shift_opened_by_name

      FROM activity_logs al

      LEFT JOIN users actor
        ON actor.id = al.user_id

      LEFT JOIN cash_shifts cs
        ON cs.id = al.entity_id

      LEFT JOIN users opener
        ON opener.id = cs.opened_by

      ${rowWhereSql}

      ORDER BY al.id DESC

      LIMIT ?

      OFFSET ?
      `,
    )
    .all(...rowParams, limit, offset) as Array<{
    id: number;

    action: string;

    shift_id: number;

    details: string | null;

    created_at: string;

    user_id: number | null;

    user_name: string | null;

    username: string | null;

    shift_opened_by: number | null;

    shift_opened_by_name: string | null;
  }>;

  const totalRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total

      FROM activity_logs al

      ${rowWhereSql}
      `,
    )
    .get(...rowParams) as {
    total: number;
  };

  const summaryRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,

        SUM(
          CASE
            WHEN al.action =
              'cash_drawer_opened'
            THEN 1
            ELSE 0
          END
        ) AS success_count,

        SUM(
          CASE
            WHEN al.action =
              'cash_drawer_open_failed'
            THEN 1
            ELSE 0
          END
        ) AS failed_count

      FROM activity_logs al

      ${baseWhereSql}
      `,
    )
    .get(...baseParams) as {
    total: number;

    success_count: number | null;

    failed_count: number | null;
  };

  const rows: CashDrawerNoSaleRow[] = rawRows.map((row) => {
    const details = parseCashDrawerActivityDetails(row.details);

    return {
      id: Number(row.id),

      action:
        row.action === 'cash_drawer_open_failed'
          ? 'cash_drawer_open_failed'
          : 'cash_drawer_opened',

      status: row.action === 'cash_drawer_open_failed' ? 'failed' : 'success',

      shift_id: Number(row.shift_id),

      shift_opened_by:
        row.shift_opened_by === null ? null : Number(row.shift_opened_by),

      shift_opened_by_name: row.shift_opened_by_name ?? null,

      user_id: row.user_id === null ? null : Number(row.user_id),

      user_name: row.user_name ?? null,

      username: row.username ?? null,

      reason: String(details.reason || 'manual'),

      printer_name: String(details.printer_name || ''),

      error: details.error ? String(details.error) : null,

      created_at: row.created_at,
    };
  });

  return {
    rows,

    total: Number(totalRow?.total || 0),

    success_count: Number(summaryRow?.success_count || 0),

    failed_count: Number(summaryRow?.failed_count || 0),

    limit,

    offset,
  };
}
