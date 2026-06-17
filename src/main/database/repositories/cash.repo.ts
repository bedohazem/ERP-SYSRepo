import { getDb } from '../db';
import { createActivityLog } from './activity.repo';

export type CashMovementInput = {
  type:
    | 'sale'
    | 'sale_return'
    | 'purchase_return'
    | 'customer_payment'
    | 'supplier_payment'
    | 'liability_payment'
    | 'expense'
    | 'withdraw'
    | 'deposit'
    | 'transfer';
    

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

export type CashAccountKey =
  | 'store_cash'
  | 'owner_cash'
  | 'owner_bank'
  | 'owner_vodafone'
  | 'fawry_machine';

export type CashTransferInput = {
  from_account: string;
  to_account: string;
  amount: number;
  notes?: string | null;
  created_by?: number | null;
};

export function resolveCashAccount(value?: string | null): CashAccountKey {
  switch (value) {
    case 'store_cash':
    case 'owner_cash':
    case 'owner_bank':
    case 'owner_vodafone':
    case 'fawry_machine':
      return value;

    case 'cash':
      return 'store_cash';

    case 'card':
      return 'fawry_machine';

    case 'wallet':
      return 'owner_vodafone';

    case 'bank':
    case 'bank_transfer':
      return 'owner_bank';

    default:
      return 'store_cash';
  }
}

function normalizeLegacyCashMovementAccounts() {
  const db = getDb();

  db.prepare(`
    UPDATE cash_movements
    SET payment_method = CASE
      WHEN payment_method IS NULL OR TRIM(payment_method) = '' THEN 'store_cash'
      WHEN payment_method = 'cash' THEN 'store_cash'
      WHEN payment_method = 'card' THEN 'fawry_machine'
      WHEN payment_method = 'wallet' THEN 'owner_vodafone'
      WHEN payment_method IN ('bank', 'bank_transfer') THEN 'owner_bank'
      ELSE payment_method
    END
    WHERE payment_method IS NULL
       OR TRIM(payment_method) = ''
       OR payment_method IN ('cash', 'card', 'wallet', 'bank', 'bank_transfer')
  `).run();
}


function getAccountBalance(account: string) {
  const db = getDb();
  normalizeLegacyCashMovementAccounts();
  const safeAccount = resolveCashAccount(account);

  const row = db
    .prepare(`
      SELECT
        IFNULL(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_movements
      WHERE payment_method = ?
    `)
    .get(safeAccount) as { total_in: number; total_out: number } | undefined;

  return Number(row?.total_in || 0) - Number(row?.total_out || 0);
}

function getAccountLabel(account: CashAccountKey) {
  switch (account) {
    case 'store_cash':
      return 'كاش درج المحل';
    case 'owner_cash':
      return 'كاش مع المالك';
    case 'owner_bank':
      return 'حساب بنك / فيزا المالك';
    case 'owner_vodafone':
      return 'فودافون كاش المالك';
    case 'fawry_machine':
      return 'ماكينة فوري';
    default:
      return account;
  }
}

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
    params.push(resolveCashAccount(input.payment_method));
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

  const amount = Number(input.amount || 0);
  const type = String(input.type || '').trim();
  const direction = input.direction;
  const account = resolveCashAccount(input.payment_method || 'store_cash');

  if (!type) {
    throw new Error('نوع حركة الخزنة مطلوب');
  }

  if (direction !== 'in' && direction !== 'out') {
    throw new Error('اتجاه حركة الخزنة غير صحيح');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ حركة الخزنة غير صحيح');
  }

  if (direction === 'out') {
    const currentBalance = getAccountBalance(account);

    if (amount > currentBalance) {
      throw new Error(
        `لا يمكن إتمام العملية: رصيد ${getAccountLabel(account)} غير كافٍ. الرصيد الحالي ${currentBalance.toFixed(2)} ج.م والمطلوب ${amount.toFixed(2)} ج.م`
      );
    }
  }

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
      type,
      amount,
      direction,
      account,
      input.reference_id ?? null,
      input.reference_type ?? null,
      input.notes ?? null,
      input.created_by ?? null
    );

  const movementId = Number(result.lastInsertRowid);

  createActivityLog({
    user_id: input.created_by ?? null,
    action: direction === 'in' ? 'cash_in' : 'cash_out',
    entity: 'cash_movements',
    entity_id: movementId,
    details: JSON.stringify({
      type,
      amount,
      direction,
      payment_method: account,
      notes: input.notes ?? null
    })
  });

  return result;
}

export function getCashSummary(input?: CashFilterInput) {
  const db = getDb();
  normalizeLegacyCashMovementAccounts();
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
  normalizeLegacyCashMovementAccounts();
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

export function createCashTransfer(input: CashTransferInput) {
  const db = getDb();
  normalizeLegacyCashMovementAccounts();

  const amount = Number(input.amount || 0);
  const fromAccount = resolveCashAccount(input.from_account);
  const toAccount = resolveCashAccount(input.to_account);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ التحويل غير صحيح');
  }

  if (fromAccount === toAccount) {
    throw new Error('لا يمكن التحويل لنفس الحساب');
  }

  const fromBalance = getAccountBalance(fromAccount);

  if (amount > fromBalance) {
    throw new Error('المبلغ المسحوب أكبر من رصيد الحساب');
  }

  const tx = db.transaction(() => {
    const outResult = createCashMovement({
      type: 'transfer',
      direction: 'out',
      amount,
      payment_method: fromAccount,
      reference_id: null,
      reference_type: 'cash_transfer',
      notes: input.notes || `تحويل من ${fromAccount} إلى ${toAccount}`,
      created_by: input.created_by ?? null
    });

    const inResult = createCashMovement({
      type: 'transfer',
      direction: 'in',
      amount,
      payment_method: toAccount,
      reference_id: Number(outResult.lastInsertRowid || 0),
      reference_type: 'cash_transfer',
      notes: input.notes || `تحويل من ${fromAccount} إلى ${toAccount}`,
      created_by: input.created_by ?? null
    });

    return {
      ok: true,
      from_account: fromAccount,
      to_account: toAccount,
      amount,
      out_id: Number(outResult.lastInsertRowid || 0),
      in_id: Number(inResult.lastInsertRowid || 0)
    };
  });

  return tx();
}