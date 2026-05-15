import { getDb } from '../db';

export type CashMovementInput = {
  type:
    | 'sale'
    | 'sale_return'
    | 'customer_payment'
    | 'supplier_payment'
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

export function createCashMovement(input: CashMovementInput) {
  const db = getDb();

  return db
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
}

export function getCashSummary() {
  const db = getDb();

  const row = db
    .prepare(`
      SELECT
        IFNULL(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_movements
    `)
    .get() as {
    total_in: number;
    total_out: number;
  };

  return {
    total_in: Number(row.total_in || 0),
    total_out: Number(row.total_out || 0),
    balance: Number(row.total_in || 0) - Number(row.total_out || 0)
  };
}

export function listCashMovements() {
  const db = getDb();

  return db
    .prepare(`
      SELECT
        cm.*,
        u.name AS created_by_name
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ORDER BY cm.id DESC
    `)
    .all();
}