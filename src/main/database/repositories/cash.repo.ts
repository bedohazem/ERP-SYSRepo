import { getDb } from '../db';
import { createActivityLog } from './activity.repo';

export type CashMovementInput = {
  type:
    | 'sale'
    | 'sale_return'
    | 'customer_payment'
    | 'supplier_payment'
    | 'liability_payment'
    | 'expense'
    | 'withdraw'
    | 'deposit';
    

  direction: 'in' | 'out';

  amount: number;

  payment_method?: string;

  reference_id?: number | null;
  reference_type?: string | null;

  notes?: string | null;

  created_by?: number | null;
};

export type CashFilterInput = {
  date_from?: string;
  date_to?: string;
  type?: string;
  direction?: 'all' | 'in' | 'out';
  payment_method?: string;
  search?: string;
};

function buildCashWhere(input?: CashFilterInput) {
  const where: string[] = [];
  const params: any[] = [];

  if (input?.date_from) {
    where.push(`datetime(cm.created_at, 'localtime') >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(cm.created_at, 'localtime') <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  if (input?.type && input.type !== 'all') {
    where.push(`cm.type = ?`);
    params.push(input.type);
  }

  if (input?.direction && input.direction !== 'all') {
    where.push(`cm.direction = ?`);
    params.push(input.direction);
  }

  if (input?.payment_method && input.payment_method !== 'all') {
    where.push(`cm.payment_method = ?`);
    params.push(input.payment_method);
  }

  if (input?.search?.trim()) {
    where.push(`(
      cm.notes LIKE ?
      OR cm.type LIKE ?
      OR cm.payment_method LIKE ?
      OR u.name LIKE ?
      OR u.username LIKE ?
    )`);

    const search = `%${input.search.trim()}%`;
    params.push(search, search, search, search, search);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

export function createCashMovement(input: CashMovementInput) {
  const db = getDb();

  const result = db
    .prepare(`
      INSERT INTO cash_movements (
        type,
        amount,
        direction,
        payment_method,
        reference_id,
        reference_type,
        notes,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.type,
      Number(input.amount || 0),
      input.direction,
      input.payment_method || 'cash',
      input.reference_id ?? null,
      input.reference_type ?? null,
      input.notes ?? null,
      input.created_by ?? null
    );

  const movementId = Number(result.lastInsertRowid);

  createActivityLog({
    user_id: input.created_by ?? null,
    action: input.direction === 'in' ? 'cash_in' : 'cash_out',
    entity: 'cash_movements',
    entity_id: movementId,
    details: JSON.stringify({
      type: input.type,
      amount: Number(input.amount || 0),
      direction: input.direction,
      payment_method: input.payment_method || 'cash',
      notes: input.notes ?? null
    })
  });

  return result;
}

export function getCashSummary(input?: CashFilterInput) {
  const db = getDb();
  const { whereSql, params } = buildCashWhere(input);

  const row = db
    .prepare(`
      SELECT
        IFNULL(SUM(CASE WHEN cm.direction = 'in' THEN cm.amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN cm.direction = 'out' THEN cm.amount ELSE 0 END), 0) AS total_out,
        COUNT(*) AS movements_count
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
    `)
    .get(...params) as {
    total_in: number;
    total_out: number;
    movements_count: number;
  };

  return {
    total_in: Number(row.total_in || 0),
    total_out: Number(row.total_out || 0),
    balance: Number(row.total_in || 0) - Number(row.total_out || 0),
    movements_count: Number(row.movements_count || 0)
  };
}

export function listCashMovements(input?: CashFilterInput) {
  const db = getDb();
  const { whereSql, params } = buildCashWhere(input);

  return db
    .prepare(`
      SELECT
        cm.*,
        u.name AS created_by_name
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
      ORDER BY cm.id DESC
      LIMIT 500
    `)
    .all(...params);
}