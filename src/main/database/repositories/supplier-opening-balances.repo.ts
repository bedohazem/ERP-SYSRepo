import { getDb } from '../db';
import { PRECISE_MONEY_EPSILON, roundFinancial } from '../../../shared/money';

export type SupplierOpeningBalanceInput = {
  supplier_id: number;
  direction: 'payable' | 'receivable';
  amount: number;
  notes: string;
  actor_id?: number | null;
};

export function createSupplierOpeningBalance(
  input: SupplierOpeningBalanceInput,
) {
  const supplierId = input?.supplier_id;
  const amount = input?.amount;
  const direction = input?.direction;
  const notes = input?.notes?.trim();

  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    throw new Error('رقم المورد غير صحيح');
  }

  if (direction !== 'payable' && direction !== 'receivable') {
    throw new Error('نوع الرصيد الافتتاحي غير صحيح');
  }

  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    roundFinancial(amount) <= 0 ||
    Math.abs(amount - roundFinancial(amount)) > PRECISE_MONEY_EPSILON
  ) {
    throw new Error('مبلغ الرصيد الافتتاحي غير صحيح');
  }

  if (!notes || notes.length > 2000) {
    throw new Error('سبب الرصيد الافتتاحي مطلوب');
  }

  const actorId = input.actor_id ?? null;

  if (actorId !== null && (!Number.isSafeInteger(actorId) || actorId <= 0)) {
    throw new Error('المستخدم غير صحيح');
  }

  const db = getDb();

  return db.transaction(() => {
    const supplier = db
      .prepare(
        `
        SELECT
          id,
          is_active,
          balance,
          total_purchased
        FROM suppliers
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(supplierId) as
      | {
          id: number;
          is_active: number;
          balance: number;
          total_purchased: number;
        }
      | undefined;

    if (!supplier || supplier.is_active !== 1) {
      throw new Error('المورد غير موجود أو غير نشط');
    }

    const activity = db
      .prepare(
        `
        SELECT
          (
            (SELECT COUNT(*)
             FROM purchase_invoices
             WHERE supplier_id = ?)
            +
            (SELECT COUNT(*)
             FROM purchase_returns
             WHERE supplier_id = ?)
            +
            (SELECT COUNT(*)
             FROM supplier_payments
             WHERE supplier_id = ?)
            +
            (SELECT COUNT(*)
             FROM supplier_account_credits
             WHERE supplier_id = ?)
          ) AS activity_count
      `,
      )
      .get(supplierId, supplierId, supplierId, supplierId) as {
      activity_count: number;
    };

    if (
      activity.activity_count > 0 ||
      Math.abs(Number(supplier.balance || 0)) > PRECISE_MONEY_EPSILON ||
      Math.abs(Number(supplier.total_purchased || 0)) > PRECISE_MONEY_EPSILON
    ) {
      throw new Error(
        'الرصيد الافتتاحي متاح فقط للمورد الذي لم تُسجّل عليه معاملات مالية',
      );
    }

    let recordId: number;

    if (direction === 'payable') {
      // مبلغ مستحق للمورد من حسابات قديمة.
      // لا توجد أصناف أو حركة مخزون أو نقدية.
      const result = db
        .prepare(
          `
          INSERT INTO purchase_invoices (
            supplier_id,
            total_amount,
            exact_total_amount,
            sub_total,
            paid_amount,
            remaining_amount,
            payment_status,
            payment_method,
            notes,
            status,
            business_date
          )
          VALUES (
            ?, ?, ?, ?,
            0, ?,
            'unpaid',
            'opening_balance',
            ?,
            'opening_balance',
            date('now', 'localtime')
          )
        `,
        )
        .run(supplierId, amount, amount, amount, amount, notes);

      recordId = Number(result.lastInsertRowid);
    } else {
      // مبلغ لصالحنا عند المورد.
      // مصدر رصيد مستقل، وليس مرتجع شراء وهمي.
      const result = db
        .prepare(
          `
          INSERT INTO supplier_account_credits (
            supplier_id,
            source_type,
            amount,
            notes,
            created_by,
            business_date
          )
          VALUES (
            ?,
            'opening_credit',
            ?,
            ?,
            ?,
            date('now', 'localtime')
          )
        `,
        )
        .run(supplierId, amount, notes, actorId);

      recordId = Number(result.lastInsertRowid);
    }

    const openingBalance = direction === 'payable' ? amount : -amount;

    // المورد لا يملك أي حركات سابقة.
    // لذلك الرصيد المبدئي مشتق من المستند المنشأ أعلاه.
    // في الخطوة القادمة سنربط إعادة الحساب
    // بجميع مصادر الأرصدة والتخصيصات.
    db.prepare(
      `
      UPDATE suppliers
      SET
        balance = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(openingBalance, supplierId);

    return {
      id: recordId,
      supplier_id: supplierId,
      direction,
      amount,
      balance: openingBalance,
    };
  })();
}
