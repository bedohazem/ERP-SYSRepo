import { getDb } from '../db';
import {
  hasPositivePreciseAmount,
  normalizePreciseZero,
  preciseAdd,
  preciseSubtract,
  preciseSum,
} from '../../../shared/money';

type Db = ReturnType<typeof getDb>;

type CreditRow = {
  id: number;
  amount: number;
  allocated_amount: number;
};

function getAvailableCreditRows(db: Db, supplierId: number): CreditRow[] {
  return db
    .prepare(
      `
    SELECT
      c.id,
      c.amount,
      IFNULL((
        SELECT SUM(a.amount)
        FROM supplier_account_credit_allocations a
        WHERE a.credit_id = c.id
          AND a.cancelled_at IS NULL
      ), 0) AS allocated_amount
    FROM supplier_account_credits c
    WHERE c.supplier_id = ?
      AND c.cancelled_at IS NULL
    ORDER BY c.id ASC
  `,
    )
    .all(supplierId) as CreditRow[];
}

export function getSupplierAccountAvailableCredit(
  db: Db,
  supplierId: number,
): number {
  if (supplierId > 0) {
    return normalizePreciseZero(
      preciseSum(
        getAvailableCreditRows(db, supplierId).map((row) =>
          Math.max(0, preciseSubtract(row.amount, row.allocated_amount)),
        ),
      ),
    );
  }

  const suppliers = db
    .prepare(
      `
    SELECT id
    FROM suppliers
    WHERE is_active = 1
  `,
    )
    .all() as Array<{ id: number }>;

  return normalizePreciseZero(
    preciseSum(
      suppliers.map((supplier) =>
        getSupplierAccountAvailableCredit(db, supplier.id),
      ),
    ),
  );
}

export function getSupplierAccountCreditAllocatedToPurchase(
  db: Db,
  purchaseId: number,
): number {
  const row = db
    .prepare(
      `
    SELECT IFNULL(SUM(amount), 0) AS amount
    FROM supplier_account_credit_allocations
    WHERE purchase_id = ?
      AND cancelled_at IS NULL
  `,
    )
    .get(purchaseId) as { amount: number };

  return normalizePreciseZero(row.amount);
}

export function allocateSupplierAccountCreditToPurchase(
  db: Db,
  input: {
    supplier_id: number;
    purchase_id: number;
    amount: number;
  },
): number {
  let remaining = normalizePreciseZero(input.amount);

  if (!hasPositivePreciseAmount(remaining)) return 0;

  const purchase = db
    .prepare(
      `
    SELECT id
    FROM purchase_invoices
    WHERE id = ?
      AND supplier_id = ?
      AND IFNULL(status, 'active') != 'cancelled'
    LIMIT 1
  `,
    )
    .get(input.purchase_id, input.supplier_id);

  if (!purchase) {
    throw new Error('فاتورة الشراء لا تتبع المورد المحدد');
  }

  const insert = db.prepare(`
    INSERT INTO supplier_account_credit_allocations (
      credit_id,
      purchase_id,
      amount
    )
    VALUES (?, ?, ?)
  `);

  let allocatedTotal = 0;

  for (const row of getAvailableCreditRows(db, input.supplier_id)) {
    if (!hasPositivePreciseAmount(remaining)) break;

    const available = normalizePreciseZero(
      Math.max(0, preciseSubtract(row.amount, row.allocated_amount)),
    );

    if (!hasPositivePreciseAmount(available)) continue;

    const allocation = normalizePreciseZero(Math.min(remaining, available));

    insert.run(row.id, input.purchase_id, allocation);

    allocatedTotal = preciseAdd(allocatedTotal, allocation);
    remaining = normalizePreciseZero(preciseSubtract(remaining, allocation));
  }

  if (hasPositivePreciseAmount(remaining)) {
    throw new Error('الرصيد الدائن المتاح غير كافٍ لتسوية الفاتورة');
  }

  return normalizePreciseZero(allocatedTotal);
}

export function releaseSupplierAccountCreditAllocations(
  db: Db,
  purchaseId: number,
): number {
  const allocated = getSupplierAccountCreditAllocatedToPurchase(db, purchaseId);

  db.prepare(
    `
    UPDATE supplier_account_credit_allocations
    SET cancelled_at = CURRENT_TIMESTAMP
    WHERE purchase_id = ?
      AND cancelled_at IS NULL
  `,
  ).run(purchaseId);

  return allocated;
}
