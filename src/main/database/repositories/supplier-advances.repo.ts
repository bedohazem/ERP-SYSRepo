import { getDb } from '../db';

import {
  PRECISE_MONEY_EPSILON,
  roundFinancial,
  preciseSubtract,
} from '../../../shared/money';

import { createCashMovement, resolveCashAccount } from './cash.repo';

import { resolveFinancialOperationShift } from './cash-shifts.repo';
import { resolveFinancialBusinessDate } from '../financial-business-date';

import {
  applyAvailableSupplierCreditToOpenPurchases,
  rebuildSupplierBalance,
} from './purchases.repo';

type AdvanceInput = {
  supplier_id: number;
  amount: number;
  payment_method: string;
  notes?: string | null;
  actor_id: number;
};

function validateMoney(value: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    roundFinancial(value) <= 0 ||
    Math.abs(value - roundFinancial(value)) > PRECISE_MONEY_EPSILON
  ) {
    throw new Error('مبلغ الدفعة المقدمة غير صحيح');
  }

  return roundFinancial(value);
}

export function createSupplierAdvancePayment(input: AdvanceInput) {
  const supplierId = input.supplier_id;
  const actorId = input.actor_id;
  const amount = validateMoney(input.amount);

  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    throw new Error('رقم المورد غير صحيح');
  }

  const paymentMethod = resolveCashAccount(input.payment_method);

  const openShift = resolveFinancialOperationShift(
    actorId,
    [paymentMethod],
    'لا يمكن دفع مقدم من درج المحل بدون شفت مفتوح',
  );

  const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

  const notes = input.notes?.trim() || null;
  const db = getDb();

  return db.transaction(() => {
    const supplier = db
      .prepare(
        `
        SELECT id, name
        FROM suppliers
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
      `,
      )
      .get(supplierId) as
      | {
          id: number;
          name: string;
        }
      | undefined;

    if (!supplier) {
      throw new Error('المورد غير موجود أو غير نشط');
    }

    const result = db
      .prepare(
        `
      INSERT INTO supplier_account_credits (
        supplier_id,
        source_type,
        amount,
        payment_method,
        notes,
        created_by,
        business_date,
        shift_id
      )
      VALUES (
        ?,
        'advance_payment',
        ?, ?, ?, ?, ?, ?
      )
    `,
      )
      .run(
        supplierId,
        amount,
        paymentMethod,
        notes,
        actorId,
        businessDate,
        openShift?.id ?? null,
      );

    const advanceId = Number(result.lastInsertRowid);

    // حركة نقدية واحدة فقط بالمبلغ الفعلي.
    createCashMovement({
      type: 'supplier_payment',
      direction: 'out',
      amount,
      payment_method: paymentMethod,
      reference_id: advanceId,
      reference_type: 'supplier_advance',
      notes: `دفعة مقدمة للمورد: ${supplier.name}${notes ? ` - ${notes}` : ''}`,
      created_by: actorId,
      business_date: businessDate,
      shift_id: openShift?.id ?? null,
    });

    // لو فيه فواتير مفتوحة، نوزع عليها الرصيد.

    applyAvailableSupplierCreditToOpenPurchases(db, supplierId);

    const allocationRow = db
      .prepare(
        `
        SELECT
          IFNULL(SUM(amount), 0) AS allocated
        FROM supplier_account_credit_allocations
        WHERE credit_id = ?
          AND cancelled_at IS NULL
      `,
      )
      .get(advanceId) as { allocated: number };

    // المستخدم من الدفعة الجديدة فقط،
    // وليس مجموع الأرصدة القديمة والجديدة.
    const allocated = Number(allocationRow.allocated || 0);

    const supplierBalance = rebuildSupplierBalance(db, supplierId);

    const remainingCredit = Math.max(0, preciseSubtract(amount, allocated));

    return {
      id: advanceId,
      supplier_id: supplierId,
      amount,
      allocated,
      remaining_credit: Math.max(0, remainingCredit),
      supplier_balance: supplierBalance,
      payment_method: paymentMethod,
      shift_id: openShift?.id ?? null,
    };
  })();
}

export function cancelSupplierAdvancePayment(input: {
  advance_id: number;
  reason: string;
  actor_id: number;
}) {
  const advanceId = input.advance_id;
  const actorId = input.actor_id;
  const reason = input.reason?.trim();

  if (!Number.isSafeInteger(advanceId) || advanceId <= 0) {
    throw new Error('رقم الدفعة المقدمة غير صحيح');
  }

  if (!reason || reason.length > 500) {
    throw new Error('سبب إلغاء الدفعة المقدمة مطلوب');
  }

  const db = getDb();

  return db.transaction(() => {
    const advance = db
      .prepare(
        `
      SELECT
        c.*,
        IFNULL((
          SELECT SUM(a.amount)
          FROM supplier_account_credit_allocations a
          WHERE a.credit_id = c.id
            AND a.cancelled_at IS NULL
        ), 0) AS allocated_amount
      FROM supplier_account_credits c
      WHERE c.id = ?
        AND c.source_type = 'advance_payment'
      LIMIT 1
    `,
      )
      .get(advanceId) as
      | {
          id: number;
          supplier_id: number;
          amount: number;
          payment_method: string;
          allocated_amount: number;
          cancelled_at: string | null;
        }
      | undefined;

    if (!advance) {
      throw new Error('الدفعة المقدمة غير موجودة');
    }

    if (advance.cancelled_at) {
      throw new Error('الدفعة المقدمة ملغاة بالفعل');
    }

    if (advance.allocated_amount > PRECISE_MONEY_EPSILON) {
      throw new Error(
        'لا يمكن إلغاء الدفعة المقدمة لأن رصيدها مستخدم في فواتير شراء',
      );
    }

    const originalMovement = db
      .prepare(
        `
      SELECT id, amount
      FROM cash_movements
      WHERE reference_type = 'supplier_advance'
        AND reference_id = ?
        AND direction = 'out'
        AND cancelled_at IS NULL
      LIMIT 1
    `,
      )
      .get(advanceId) as { id: number; amount: number } | undefined;

    if (
      !originalMovement ||
      Math.abs(originalMovement.amount - advance.amount) > PRECISE_MONEY_EPSILON
    ) {
      throw new Error('حركة الدفعة المقدمة الأصلية غير متطابقة');
    }

    const paymentMethod = resolveCashAccount(advance.payment_method);

    const openShift = resolveFinancialOperationShift(
      actorId,
      [paymentMethod],
      'لا يمكن إرجاع دفعة إلى درج المحل بدون شفت مفتوح',
    );

    const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

    db.prepare(
      `
      UPDATE supplier_account_credits
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?
      WHERE id = ?
        AND cancelled_at IS NULL
    `,
    ).run(actorId, reason, advanceId);

    // لا نمسح حركة الصرف القديمة.
    // نسجل حركة عكسية فعلية، فيصبح الأثر النقدي صفرًا.
    createCashMovement({
      type: 'supplier_payment',
      direction: 'in',
      amount: advance.amount,
      payment_method: paymentMethod,
      reference_id: advanceId,
      reference_type: 'supplier_advance_cancel',
      notes: `إلغاء دفعة مقدمة #${advanceId}: ${reason}`,
      created_by: actorId,
      business_date: businessDate,
      shift_id: openShift?.id ?? null,
    });

    const supplierBalance = rebuildSupplierBalance(db, advance.supplier_id);

    return {
      ok: true,
      advance_id: advanceId,
      supplier_id: advance.supplier_id,
      cancelled_amount: advance.amount,
      supplier_balance: supplierBalance,
      shift_id: openShift?.id ?? null,
    };
  })();
}
