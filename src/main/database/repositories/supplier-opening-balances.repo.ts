import { getDb } from '../db';
import { PRECISE_MONEY_EPSILON, roundFinancial } from '../../../shared/money';
import { rebuildSupplierBalance } from './purchases.repo';

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

export function changeSupplierOpeningBalance(input: {
  opening_id: number;
  direction: 'payable' | 'receivable';
  mode: 'edit' | 'cancel';
  amount?: number;
  notes?: string | null;
  reason: string;
  actor_id: number;
}) {
  const id = Number(input.opening_id);
  const actorId = Number(input.actor_id);
  const reason = String(input.reason || '').trim();

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('رقم الرصيد الافتتاحي غير صحيح');
  }

  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new Error('المستخدم غير صحيح');
  }

  if (!reason || reason.length > 500) {
    throw new Error('سبب تعديل أو إلغاء الرصيد الافتتاحي مطلوب');
  }

  const editing = input.mode === 'edit';

  if (input.mode !== 'edit' && input.mode !== 'cancel') {
    throw new Error('نوع العملية غير صحيح');
  }

  const amount = Number(input.amount);

  if (
    editing &&
    (!Number.isFinite(amount) ||
      amount <= 0 ||
      roundFinancial(amount) <= 0 ||
      Math.abs(amount - roundFinancial(amount)) > PRECISE_MONEY_EPSILON)
  ) {
    throw new Error('المبلغ الجديد غير صحيح');
  }

  const db = getDb();

  return db.transaction(() => {
    let supplierId = 0;
    let previousAmount = 0;

    if (input.direction === 'payable') {
      const row = db
        .prepare(
          `
        SELECT
          id, supplier_id, total_amount,
          paid_amount, remaining_amount, notes
        FROM purchase_invoices
        WHERE id = ?
          AND status = 'opening_balance'
        LIMIT 1
      `,
        )
        .get(id) as
        | {
            id: number;
            supplier_id: number;
            total_amount: number;
            paid_amount: number;
            remaining_amount: number;
            notes: string | null;
          }
        | undefined;

      if (!row) {
        throw new Error('الرصيد الافتتاحي المستحق غير موجود أو ملغي');
      }

      supplierId = row.supplier_id;
      previousAmount = row.total_amount;

      const dependent = db
        .prepare(
          `
        SELECT
          (SELECT COUNT(*) FROM supplier_payments
           WHERE purchase_id = ?) +
          (SELECT COUNT(*) FROM purchase_returns
           WHERE purchase_id = ?) +
          (SELECT COUNT(*) FROM supplier_credit_allocations
           WHERE purchase_id = ? AND cancelled_at IS NULL) +
          (SELECT COUNT(*) FROM supplier_account_credit_allocations
           WHERE purchase_id = ? AND cancelled_at IS NULL)
          AS count
      `,
        )
        .get(id, id, id, id) as { count: number };

      if (
        dependent.count > 0 ||
        Math.abs(Number(row.paid_amount || 0)) > PRECISE_MONEY_EPSILON ||
        Math.abs(
          Number(row.remaining_amount || 0) - Number(row.total_amount || 0),
        ) > PRECISE_MONEY_EPSILON
      ) {
        throw new Error(
          'لا يمكن تعديل أو إلغاء الرصيد الافتتاحي بعد استخدامه في دفعات أو تسويات',
        );
      }

      if (editing) {
        db.prepare(
          `
          UPDATE purchase_invoices
          SET
            total_amount = ?,
            exact_total_amount = ?,
            sub_total = ?,
            remaining_amount = ?,
            notes = ?
          WHERE id = ?
        `,
        ).run(
          amount,
          amount,
          amount,
          amount,
          input.notes?.trim() || row.notes,
          id,
        );
      } else {
        db.prepare(
          `
          UPDATE purchase_invoices
          SET
            status = 'cancelled',
            payment_status = 'cancelled',
            remaining_amount = 0,
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = ?,
            cancel_reason = ?
          WHERE id = ?
        `,
        ).run(actorId, reason, id);
      }
    } else if (input.direction === 'receivable') {
      const row = db
        .prepare(
          `
        SELECT id, supplier_id, amount, notes
        FROM supplier_account_credits
        WHERE id = ?
          AND source_type = 'opening_credit'
          AND cancelled_at IS NULL
        LIMIT 1
      `,
        )
        .get(id) as
        | {
            id: number;
            supplier_id: number;
            amount: number;
            notes: string | null;
          }
        | undefined;

      if (!row) {
        throw new Error('الرصيد الافتتاحي الدائن غير موجود أو ملغي');
      }

      supplierId = row.supplier_id;
      previousAmount = row.amount;

      const allocated = db
        .prepare(
          `
        SELECT IFNULL(SUM(amount), 0) AS amount
        FROM supplier_account_credit_allocations
        WHERE credit_id = ?
          AND cancelled_at IS NULL
      `,
        )
        .get(id) as { amount: number };

      if (Number(allocated.amount || 0) > PRECISE_MONEY_EPSILON) {
        throw new Error(
          'لا يمكن تعديل أو إلغاء رصيد افتتاحي مستخدم في فواتير شراء',
        );
      }

      if (editing) {
        db.prepare(
          `
          UPDATE supplier_account_credits
          SET amount = ?, notes = ?
          WHERE id = ?
        `,
        ).run(amount, input.notes?.trim() || row.notes, id);
      } else {
        db.prepare(
          `
          UPDATE supplier_account_credits
          SET
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = ?,
            cancel_reason = ?
          WHERE id = ?
        `,
        ).run(actorId, reason, id);
      }
    } else {
      throw new Error('نوع الرصيد الافتتاحي غير صحيح');
    }

    const balance = rebuildSupplierBalance(db, supplierId);

    return {
      success: true,
      opening_id: id,
      supplier_id: supplierId,
      direction: input.direction,
      mode: input.mode,
      old_amount: previousAmount,
      new_amount: editing ? roundFinancial(amount) : 0,
      reason,
      balance,
    };
  })();
}
