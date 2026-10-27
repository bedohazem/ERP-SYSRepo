import { getDb } from '../db';
import {
  getSupplierAgingSummary,
  getSupplierDueSummary,
} from './suppliers.repo';
import { createCashMovement, resolveCashAccount } from './cash.repo';
import {
  allocateMoneyValueByQuantity,
  roundFinancial,
  allocatePreciseTotalAcrossWeights,
  hasPositivePreciseAmount,
  normalizePreciseZero,
  PRECISE_MONEY_EPSILON,
  preservePrecision,
  resolveWholeMoneySettlement,
  roundMoney,
  truncateForDisplay,
  preciseAdd,
  preciseDivide,
  preciseMultiply,
  preciseSubtract,
  preciseSum,
  isEffectivelyZero,
  allocateTruncatedMoneyAcrossWeights,
  truncateMoney,
} from '../../../shared/money';
import {
  getOpenCashShift,
  resolveFinancialOperationShift,
} from './cash-shifts.repo';
import { resolveFinancialBusinessDate } from '../financial-business-date';
import { getShiftBusinessDate } from '../shift-business-date';
import { issueStockAtCost, receiveStockAtCost } from '../inventory-cost';

function getCurrentBusinessDate(db: ReturnType<typeof getDb>) {
  const row = db
    .prepare(
      `
      SELECT
        date('now', 'localtime')
          AS business_date
      `,
    )
    .get() as {
    business_date: string;
  };

  return String(row?.business_date || '');
}

function calculatePurchaseDueDate(
  db: ReturnType<typeof getDb>,
  businessDate: string,
  creditDays: number | null,
) {
  if (creditDays === null) {
    return null;
  }

  const days = Number(creditDays);

  if (!Number.isInteger(days) || days < 0) {
    throw new Error('مدة ائتمان المورد غير صحيحة');
  }

  const row = db
    .prepare(
      `
      SELECT
        date(
          ?,
          printf(
            '+%d days',
            ?
          )
        ) AS due_date
      `,
    )
    .get(businessDate, days) as
    | {
        due_date: string | null;
      }
    | undefined;

  const dueDate = String(row?.due_date || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('تعذر حساب تاريخ استحقاق فاتورة الشراء');
  }

  return dueDate;
}

type PurchaseItemInput = {
  variant_id: number;
  quantity: number;
  unit_cost: number;
};

export type CreatePurchaseInput = {
  actor_id?: number | null;
  supplier_id: number;
  paid_amount?: number;
  sub_total?: number;
  discount_type?: 'amount' | 'percent' | string;
  discount_input?: number;
  discount_value?: number;
  settle_full_balance?: boolean;
  payment_method?: string;
  notes?: string | null;
  items: PurchaseItemInput[];
};

export type CancelPurchaseInput = {
  purchase_id: number;
  reason?: string;
  actor_id?: number | null;
};

export type CreatePurchaseReturnInput = {
  purchase_id: number;
  notes?: string | null;
  refund_payment_method?: string | null;
  refund_mode?: 'cash' | 'credit' | string;
  cash_refund_amount?: number;
  settle_cash_refund?: boolean;
  actor_id?: number | null;
  items: Array<{
    purchase_item_id?: number;
    variant_id?: number;
    quantity: number;
  }>;
};

export type UpdatePurchaseInput = {
  purchase_id: number;
  actor_id: number;
  reason?: string | null;

  supplier_id: number;

  paid_amount?: number;
  settle_full_balance?: boolean;
  sub_total?: number;

  discount_type?: 'amount' | 'percent' | string;
  discount_input?: number;
  discount_value?: number;

  payment_method?: string;
  notes?: string | null;

  items: PurchaseItemInput[];
};

export type CancelPurchaseReturnInput = {
  return_id: number;
  reason?: string | null;
  actor_id?: number | null;
};

export type UpdatePurchaseReturnInput = {
  return_id: number;
  reason?: string | null;
  actor_id?: number | null;

  notes?: string | null;

  refund_payment_method?: string | null;
  refund_mode?: 'cash' | 'credit' | string;
  cash_refund_amount?: number;

  settle_cash_refund?: boolean;
  items: Array<{
    purchase_item_id?: number;
    variant_id?: number;
    quantity: number;
  }>;
};

function getCurrentVariantStock(
  db: ReturnType<typeof getDb>,
  variantId: number,
) {
  const row = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(
          CASE
            WHEN type = 'in' THEN quantity
            WHEN type = 'out' THEN -quantity
            ELSE 0
          END
        ), 0) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `,
    )
    .get(Number(variantId)) as { stock: number } | undefined;

  return Number(row?.stock || 0);
}

function getReturnedQuantityForPurchaseItem(
  db: ReturnType<typeof getDb>,
  purchaseItemId: number,
) {
  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(pri.quantity), 0) AS quantity
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pri.purchase_item_id = ?
        AND pr.cancelled_at IS NULL
    `,
    )
    .get(Number(purchaseItemId)) as { quantity: number } | undefined;

  return Number(row?.quantity || 0);
}

function normalizePaymentStatus(
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number,
) {
  const total = normalizePreciseZero(totalAmount);

  const paid = normalizePreciseZero(paidAmount);

  const remaining = normalizePreciseZero(remainingAmount);

  if (!hasPositivePreciseAmount(remaining)) {
    return 'paid';
  }

  if (hasPositivePreciseAmount(paid) && paid < total) {
    return 'partial';
  }

  return 'unpaid';
}

function samePreciseAmount(left: unknown, right: unknown): boolean {
  return isEffectivelyZero(preciseSubtract(left, right));
}

function exceedsPreciseAmount(left: unknown, right: unknown): boolean {
  return preciseSubtract(left, right) > PRECISE_MONEY_EPSILON;
}

function resolveStoredPurchaseInitialCashAmount(purchase: {
  total_amount?: number | null;
  exact_total_amount?: number | null;
  paid_amount?: number | null;
  rounding_adjustment?: number | null;
}) {
  const paidAmount = preservePrecision(Number(purchase.paid_amount || 0));

  if (!hasPositivePreciseAmount(paidAmount)) {
    return 0;
  }

  const totalAmount = preservePrecision(Number(purchase.total_amount || 0));

  const exactTotalAmount = preservePrecision(
    Number(purchase.exact_total_amount ?? purchase.total_amount ?? 0),
  );

  const roundingAdjustment = preservePrecision(
    Number(purchase.rounding_adjustment || 0),
  );

  const legacyRoundedInvoice =
    Math.abs(preciseSubtract(totalAmount, exactTotalAmount)) > 0.0001;

  if (legacyRoundedInvoice) {
    return paidAmount;
  }

  return normalizePreciseZero(
    Math.max(0, preciseAdd(paidAmount, roundingAdjustment)),
  );
}

function calculateSupplierNetBalance(
  db: ReturnType<typeof getDb>,
  supplierId: number,
) {
  const row = db
    .prepare(
      `
      SELECT
        IFNULL(
          (
            SELECT SUM(
              CASE
                WHEN
                  IFNULL(
                    pi.status,
                    'active'
                  ) != 'cancelled'

                  AND
                  pi.remaining_amount > ${PRECISE_MONEY_EPSILON}

                THEN pi.remaining_amount

                ELSE 0
              END
            )

            FROM purchase_invoices pi

            WHERE pi.supplier_id = ?
          ),
          0
        ) AS open_debt,

        IFNULL(
          (
            SELECT SUM(
              CASE
                WHEN pr.cancelled_at IS NULL

                THEN MAX(
                  0,
                  IFNULL(
                    pr.credit_amount,
                    0
                  )
                )

                ELSE 0
              END
            )

            FROM purchase_returns pr

            WHERE pr.supplier_id = ?
          ),
          0
        ) AS supplier_credit
      `,
    )
    .get(supplierId, supplierId) as {
    open_debt: number;
    supplier_credit: number;
  };

  return normalizePreciseZero(
    preciseSubtract(
      Number(row?.open_debt || 0),
      Number(row?.supplier_credit || 0),
    ),
  );
}

function rebuildSupplierBalance(
  db: ReturnType<typeof getDb>,
  supplierId: number,
) {
  const balance = calculateSupplierNetBalance(db, supplierId);

  db.prepare(
    `
    UPDATE suppliers

    SET
      balance = ?,

      updated_at =
        CURRENT_TIMESTAMP

    WHERE id = ?
    `,
  ).run(balance, supplierId);

  return balance;
}

function preparePurchaseItemInput(
  item: PurchaseItemInput,
  productName: string,
) {
  const quantity = Number(item.quantity || 0);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`كمية غير صحيحة للصنف ${productName}`);
  }

  /*
   * سعر الوحدة الخام كما أدخله المستخدم.
   *
   * ممنوع تقريب السعر هنا.
   */
  const unitCost = Number(item.unit_cost);

  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    throw new Error(`سعر شراء غير صحيح للصنف ${productName}`);
  }

  const rawLineTotal = truncateMoney(preciseMultiply(quantity, unitCost));

  if (!Number.isFinite(rawLineTotal) || rawLineTotal <= 0) {
    throw new Error(`إجمالي شراء غير صحيح للصنف ${productName}`);
  }

  return {
    quantity,
    unitCost,
    rawLineTotal,
  };
}

/*
 * التكلفة الفعلية للوحدة بعد أي خصم.
 *
 * purchase_items.unit_cost
 * = السعر الأصلي الذي أدخله المستخدم.
 *
 * purchase_items.line_total
 * = القيمة المحاسبية النهائية للبند.
 *
 * لذلك تكلفة المخزون الفعلية للوحدة
 * تشتق من:
 *
 * line_total ÷ quantity
 */
function getEffectivePurchaseUnitCost(item: {
  quantity?: number | null;
  line_total?: number | null;
  unit_cost?: number | null;
}) {
  const quantity = Number(item.quantity ?? 0);

  const hasLineTotal =
    item.line_total !== null && item.line_total !== undefined;

  if (hasLineTotal) {
    const lineTotal = Number(item.line_total);

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(lineTotal) ||
      lineTotal < 0
    ) {
      throw new Error('تكلفة شراء الصنف غير صحيحة');
    }

    return preciseDivide(lineTotal, quantity);
  }

  const unitCost = Number(item.unit_cost ?? 0);

  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('تكلفة شراء الصنف غير صحيحة');
  }

  return unitCost;
}

function getPurchaseBuyPriceFromSnapshot(item: { unit_cost?: number | null }) {
  const unitCost = Number(item.unit_cost ?? 0);

  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('سعر شراء الصنف غير صحيح');
  }

  return preservePrecision(unitCost);
}

function resolvePurchaseInvoiceDiscount(
  subTotalInput: number,
  discountTypeInput: unknown,
  discountInputValue: unknown,
) {
  const subTotal = truncateMoney(Math.max(0, Number(subTotalInput || 0)));

  const discountType = discountTypeInput === 'percent' ? 'percent' : 'amount';

  const rawDiscountInput = Number(discountInputValue ?? 0);

  if (!Number.isFinite(rawDiscountInput) || rawDiscountInput < 0) {
    throw new Error('قيمة خصم فاتورة الشراء غير صحيحة');
  }

  if (discountType === 'percent' && rawDiscountInput > 100) {
    throw new Error('نسبة خصم فاتورة الشراء لا يمكن أن تتجاوز 100%');
  }

  const discountInput =
    discountType === 'percent'
      ? preservePrecision(rawDiscountInput)
      : preservePrecision(rawDiscountInput);

  const calculatedDiscount =
    discountType === 'percent'
      ? preciseMultiply(subTotal, preciseDivide(discountInput, 100))
      : discountInput;

  const discountValue = truncateMoney(
    Math.min(subTotal, Math.max(0, calculatedDiscount)),
  );

  return {
    discountType,
    discountInput,
    discountValue,
  };
}

function applyPurchaseInvoiceDiscount<
  T extends {
    quantity: number;
    unitCost: number;
    rawLineTotal: number;
  },
>(items: T[], discountValueInput: number) {
  const grossLineTotals = items.map((item) => truncateMoney(item.rawLineTotal));

  const subTotal = preciseSum(grossLineTotals);

  const discountValue = truncateMoney(
    Math.min(subTotal, Math.max(0, Number(discountValueInput || 0))),
  );

  const lineDiscounts = allocateTruncatedMoneyAcrossWeights(
    discountValue,
    grossLineTotals,
  );

  return items.map((item, index) => {
    const grossLineTotal = truncateMoney(grossLineTotals[index] || 0);

    const lineDiscount = truncateMoney(lineDiscounts[index] || 0);

    const lineTotal = truncateMoney(
      Math.max(0, preciseSubtract(grossLineTotal, lineDiscount)),
    );
    const effectiveUnitCost =
      discountValue > 0 && item.quantity > 0
        ? preciseDivide(lineTotal, item.quantity)
        : item.unitCost;

    return {
      ...item,

      grossLineTotal,

      lineDiscount,

      lineTotal,

      effectiveUnitCost,
    };
  });
}

export function createPurchaseInvoice(input: CreatePurchaseInput) {
  const db = getDb();

  const supplierId = Number(input.supplier_id);

  const rawPaidAmountInput = Number(input.paid_amount ?? 0);

  if (!Number.isFinite(rawPaidAmountInput) || rawPaidAmountInput < 0) {
    throw new Error('المبلغ المدفوع غير صحيح');
  }

  const cashAmountInput = roundMoney(rawPaidAmountInput);

  const actorId = Number(input.actor_id || 0);

  const paymentMethod = resolveCashAccount(input.payment_method || 'cash');

  const openShift =
    cashAmountInput > 0
      ? resolveFinancialOperationShift(
          actorId,
          [paymentMethod],
          'لا يمكن دفع فاتورة شراء من درج المحل بدون شفت مفتوح',
        )
      : null;

  const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

  if (!supplierId) {
    throw new Error('اختار المورد');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في فاتورة الشراء');
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any;

    if (!supplier) {
      throw new Error('المورد غير موجود');
    }

    const getVariant = db.prepare(`
      SELECT
        v.id,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        p.name AS product_name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
      LIMIT 1
    `);

    const seenVariantIds = new Set<number>();

    const basePreparedItems = input.items.map((item) => {
      const variantId = Number(item.variant_id);

      if (!variantId || seenVariantIds.has(variantId)) {
        throw new Error('يوجد صنف مكرر أو غير صحيح داخل فاتورة الشراء');
      }

      seenVariantIds.add(variantId);

      const variant = getVariant.get(variantId) as any;

      if (!variant) {
        throw new Error('الصنف غير موجود');
      }

      const pricing = preparePurchaseItemInput(item, variant.product_name);

      return {
        variant,

        ...pricing,
      };
    });

    const subTotal = preciseSum(
      basePreparedItems.map((item) => item.rawLineTotal),
    );

    const { discountType, discountInput, discountValue } =
      resolvePurchaseInvoiceDiscount(
        subTotal,
        input.discount_type,
        input.discount_input,
      );

    const preparedItems = applyPurchaseInvoiceDiscount(
      basePreparedItems,
      discountValue,
    );

    const exactTotalAmount = preciseSum(
      preparedItems.map((item) => item.lineTotal),
    );

    const totalAmount = exactTotalAmount;

    const settleFullBalance = Boolean(input.settle_full_balance);

    let paidAmount = 0;

    let remainingAmount = totalAmount;

    let roundingAdjustment = 0;

    /*
     * المبلغ الخارج فعليًا
     * دائمًا جنيه صحيح.
     */
    const cashPaidAmount = cashAmountInput;

    if (settleFullBalance) {
      const settlement = resolveWholeMoneySettlement(
        cashPaidAmount,
        totalAmount,
      );

      /*
       * لو المستحق أقل من 50 قرش،
       * أقرب جنيه ممكن يكون صفر.
       * ولا يتم السماح بده إلا
       * مع اختيار التسوية صراحة.
       */
      const zeroCashSettlement =
        cashPaidAmount === 0 && roundMoney(totalAmount) === 0;

      if (!settlement.isFullSettlement && !zeroCashSettlement) {
        throw new Error(
          `لتسوية كامل الفاتورة يجب أن يكون المبلغ المدفوع ${roundMoney(
            totalAmount,
          )} ج.م`,
        );
      }

      /*
       * محاسبيًا نقفل الدين كله.
       */
      paidAmount = totalAmount;

      remainingAmount = 0;

      roundingAdjustment = preciseSubtract(cashPaidAmount, totalAmount);
    } else {
      if (exceedsPreciseAmount(cashPaidAmount, totalAmount)) {
        throw new Error(
          'المبلغ المدفوع أكبر من المستحق؛ فعّل تسوية كامل الفاتورة إذا كنت تريد إقفال فرق القروش',
        );
      }

      paidAmount = preservePrecision(Math.min(cashPaidAmount, totalAmount));

      remainingAmount = normalizePreciseZero(
        Math.max(0, preciseSubtract(totalAmount, paidAmount)),
      );

      roundingAdjustment = 0;
    }

    const paymentStatus = normalizePaymentStatus(
      totalAmount,
      paidAmount,
      remainingAmount,
    );

    const dueDate = hasPositivePreciseAmount(remainingAmount)
      ? calculatePurchaseDueDate(
          db,
          businessDate,
          supplier.credit_days == null ? null : Number(supplier.credit_days),
        )
      : null;

    const purchaseResult = db
      .prepare(
        `
        INSERT INTO purchase_invoices (
          supplier_id,

          total_amount,
          exact_total_amount,
          rounding_adjustment,
          settle_full_balance,

          sub_total,
          discount_type,
          discount_input,
          discount_value,

          paid_amount,
          remaining_amount,
          payment_status,

          payment_method,
          notes,

          status,
          business_date,
          shift_id
        )

        VALUES (
          ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          'active',
          ?, ?
        )
        `,
      )
      .run(
        supplierId,

        totalAmount,
        exactTotalAmount,
        roundingAdjustment,
        settleFullBalance ? 1 : 0,

        subTotal,
        discountType,
        discountInput,
        discountValue,

        paidAmount,
        remainingAmount,
        paymentStatus,

        paymentMethod,
        input.notes?.trim() || null,

        businessDate,
        openShift?.id ?? null,
      );

    const purchaseId = Number(purchaseResult.lastInsertRowid);

    db.prepare(
      `
      UPDATE purchase_invoices

      SET due_date = ?

      WHERE id = ?
      `,
    ).run(dueDate, purchaseId);

    const insertItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        previous_buy_price,
        line_total
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    const updateVariantCost = db.prepare(`
      UPDATE product_variants
      SET buy_price = ?
      WHERE id = ?
    `);

    for (const item of preparedItems) {
      insertItem.run(
        purchaseId,
        item.variant.id,
        item.variant.product_name,
        item.variant.barcode ?? null,
        item.variant.size ?? null,
        item.variant.color ?? null,
        item.quantity,

        /*
         * نحفظ السعر الأصلي كما أدخله المستخدم.
         */
        item.unitCost,

        Number(item.variant.buy_price || 0),
        item.lineTotal,
      );

      receiveStockAtCost(db, {
        variant_id: Number(item.variant.id),

        quantity: item.quantity,

        unit_cost: item.effectiveUnitCost,
        cost_value: item.lineTotal,
        created_by: actorId || null,
        reference_id: purchaseId,

        reference_type: 'purchase',

        notes: `دخول مخزون من فاتورة شراء رقم ${purchaseId}`,
      });

      updateVariantCost.run(item.unitCost, item.variant.id);
    }

    db.prepare(
      `
      UPDATE suppliers

      SET
        total_purchased =
            IFNULL(
              total_purchased,
              0
            ) + ?,
 
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(totalAmount, supplierId);

    /*
     * الرصيد لا يعتمد على القيمة
     * المخزنة القديمة في suppliers.balance.
     *
     * مصدر الحقيقة:
     * الفواتير المفتوحة
     * -
     * الأرصدة الدائنة النشطة.
     */
    rebuildSupplierBalance(db, supplierId);

    if (paidAmount > 0) {
      /*
       * حتى لو الكاش الفعلي = صفر،
       * نحتاج تسجيل التسوية المحاسبية
       * على الفاتورة.
       *
       * مثال:
       * إجمالي الفاتورة = 0.40
       * تسوية كاملة لأقرب جنيه = 0
       */
      db.prepare(
        `
    INSERT INTO supplier_payments (
      supplier_id,
      purchase_id,
      amount,
      payment_method,
      notes
    )
    VALUES (?, ?, ?, ?, ?)
  `,
      ).run(
        supplierId,
        purchaseId,
        paidAmount,
        paymentMethod,
        `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}`,
      );

      /*
       * حركة مالية فعلية تسجل فقط
       * لو خرج كاش حقيقي.
       */
      if (cashPaidAmount > 0) {
        createCashMovement({
          type: 'supplier_payment',
          direction: 'out',

          amount: cashPaidAmount,

          payment_method: paymentMethod,

          reference_id: purchaseId,
          reference_type: 'purchase_invoice',

          notes: `دفع فاتورة شراء رقم ${purchaseId}`,

          created_by: actorId,
          business_date: businessDate,
          shift_id: openShift?.id ?? null,
        });
      }
    }

    return {
      purchaseId,
      total_amount: totalAmount,
      exact_total_amount: exactTotalAmount,
      rounding_adjustment: roundingAdjustment,
      paid_amount: paidAmount,
      cash_amount: cashPaidAmount,
      settle_full_balance: settleFullBalance,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus,
      due_date: dueDate,
      shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

function getPreviousBuyPriceForPurchaseEdit(
  db: ReturnType<typeof getDb>,
  variantIdInput: number,
  purchaseIdInput: number,
  oldPreviousBuyPrice?: number | null,
) {
  const variantId = Number(variantIdInput);
  const purchaseId = Number(purchaseIdInput);

  if (oldPreviousBuyPrice !== null && oldPreviousBuyPrice !== undefined) {
    const oldValue = Number(oldPreviousBuyPrice);

    if (Number.isFinite(oldValue) && oldValue >= 0) {
      return oldValue;
    }
  }

  const previousActivePurchase = db
    .prepare(
      `
      SELECT
        pii.quantity,
        pii.unit_cost,
        pii.line_total,
        pi.discount_value

      FROM purchase_items pii

      JOIN purchase_invoices pi
        ON pi.id = pii.purchase_id

      WHERE
        pii.variant_id = ?
        AND pii.purchase_id < ?

        AND IFNULL(
          pi.status,
          'active'
        ) <> 'cancelled'

      ORDER BY
        pii.purchase_id DESC,
        pii.id DESC

      LIMIT 1
      `,
    )
    .get(variantId, purchaseId) as
    | {
        quantity: number;
        unit_cost: number;
        line_total: number;
        discount_value: number;
      }
    | undefined;

  if (previousActivePurchase) {
    return getPurchaseBuyPriceFromSnapshot(previousActivePurchase);
  }

  /*
   * لو الصنف بيتضاف لفاتورة قديمة
   * ويوجد شراء أحدث منه، Snapshot
   * أول فاتورة أحدث يعبر عن السعر
   * الذي كان موجودًا قبلها.
   */
  const nextPurchaseSnapshot = db
    .prepare(
      `
      SELECT
        pii.previous_buy_price

      FROM purchase_items pii

      WHERE
        pii.variant_id = ?
        AND pii.purchase_id > ?
        AND pii.previous_buy_price IS NOT NULL

      ORDER BY
        pii.purchase_id ASC,
        pii.id ASC

      LIMIT 1
      `,
    )
    .get(variantId, purchaseId) as
    | {
        previous_buy_price: number;
      }
    | undefined;

  if (nextPurchaseSnapshot) {
    const value = Number(nextPurchaseSnapshot.previous_buy_price);

    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  const variant = db
    .prepare(
      `
      SELECT buy_price

      FROM product_variants

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(variantId) as
    | {
        buy_price: number;
      }
    | undefined;

  const value = Number(variant?.buy_price);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error('تعذر تحديد سعر الشراء السابق للصنف');
  }

  return value;
}

function recalculateVariantBuyPrice(
  db: ReturnType<typeof getDb>,
  variantIdInput: number,
  fallbackPreviousBuyPrice?: number | null,
) {
  const variantId = Number(variantIdInput);

  if (!variantId) {
    throw new Error('رقم الصنف غير صحيح');
  }

  const latestActivePurchase = db
    .prepare(
      `
      SELECT
        pii.quantity,
        pii.unit_cost,
        pii.line_total,
        pi.discount_value

      FROM purchase_items pii

      JOIN purchase_invoices pi
        ON pi.id = pii.purchase_id

      WHERE pii.variant_id = ?

        AND IFNULL(
          pi.status,
          'active'
        ) <> 'cancelled'

      ORDER BY
        pi.id DESC,
        pii.id DESC

      LIMIT 1
      `,
    )
    .get(variantId) as
    | {
        quantity: number;
        unit_cost: number;
        line_total: number;
        discount_value: number;
      }
    | undefined;

  let nextBuyPrice: number | null = null;

  if (latestActivePurchase) {
    nextBuyPrice = getPurchaseBuyPriceFromSnapshot(latestActivePurchase);
  } else if (
    fallbackPreviousBuyPrice !== null &&
    fallbackPreviousBuyPrice !== undefined &&
    Number.isFinite(Number(fallbackPreviousBuyPrice))
  ) {
    nextBuyPrice = Number(fallbackPreviousBuyPrice);
  } else {
    const firstPurchase = db
      .prepare(
        `
        SELECT
          previous_buy_price

        FROM purchase_items

        WHERE variant_id = ?

        ORDER BY
          purchase_id ASC,
          id ASC

        LIMIT 1
        `,
      )
      .get(variantId) as
      | {
          previous_buy_price: number | null;
        }
      | undefined;

    if (
      firstPurchase?.previous_buy_price === null ||
      firstPurchase?.previous_buy_price === undefined
    ) {
      throw new Error(
        'تعذر استرجاع سعر الشراء السابق لهذا الصنف لأن الفاتورة قديمة ولا تحتوي على سجل للتكلفة السابقة',
      );
    }

    nextBuyPrice = Number(firstPurchase.previous_buy_price);
  }

  if (!Number.isFinite(nextBuyPrice) || Number(nextBuyPrice) < 0) {
    throw new Error('سعر الشراء السابق للصنف غير صحيح');
  }

  db.prepare(
    `
    UPDATE product_variants

    SET buy_price = ?

    WHERE id = ?
    `,
  ).run(Number(nextBuyPrice), variantId);
}

export function updatePurchaseInvoice(input: UpdatePurchaseInput) {
  const db = getDb();

  const purchaseId = Number(input.purchase_id || 0);

  const actorId = Number(input.actor_id || 0);

  const reason = String(input.reason || '').trim();

  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح');
  }

  if (!actorId) {
    throw new Error('المستخدم غير صحيح');
  }

  if (!reason) {
    throw new Error('اكتب سبب تعديل فاتورة الشراء');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في فاتورة الشراء');
  }

  const tx = db.transaction(() => {
    const purchase = db
      .prepare(
        `
        SELECT
          pi.*,

          IFNULL(
            pi.status,
            'active'
          ) AS safe_status

        FROM purchase_invoices pi

        WHERE pi.id = ?

        LIMIT 1
        `,
      )
      .get(purchaseId) as any;

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة');
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('لا يمكن تعديل فاتورة شراء ملغاة');
    }

    if (purchase.safe_status === 'opening_balance') {
      throw new Error('الرصيد الافتتاحي لا يتم تعديله كفاتورة شراء');
    }

    /*
     * أي تاريخ مرتجعات يمنع تعديل
     * أصل الفاتورة، حتى لو المرتجع
     * تم إلغاؤه لاحقًا.
     */
    const returnHistory = db
      .prepare(
        `
        SELECT COUNT(*) AS count

        FROM purchase_returns

        WHERE purchase_id = ?
        `,
      )
      .get(purchaseId) as {
      count: number;
    };

    if (Number(returnHistory?.count || 0) > 0) {
      throw new Error('لا يمكن تعديل فاتورة لها سجل مرتجعات شراء سابق');
    }

    /*
     * دفعة وقت إنشاء الفاتورة نفسها
     * مسموح بتعديلها مع الفاتورة.
     *
     * أي دفعة لاحقة أو Batch تاريخي
     * يمنع تعديل أصل الفاتورة.
     */
    const laterPayments = db
      .prepare(
        `
        SELECT COUNT(*) AS count

        FROM supplier_payments sp

        WHERE
          sp.purchase_id = ?

          AND NOT (
            sp.batch_id IS NULL

            AND IFNULL(
              sp.notes,
              ''
            ) LIKE ?
          )
        `,
      )
      .get(purchaseId, `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}%`) as {
      count: number;
    };

    if (Number(laterPayments?.count || 0) > 0) {
      throw new Error(
        'لا يمكن تعديل فاتورة الشراء لأنها تحتوي على سجل دفعات مورد لاحقة',
      );
    }

    const businessDateRow = db
      .prepare(
        `
        SELECT
          COALESCE(
            NULLIF(?, ''),
            date(?, 'localtime'),
            date('now', 'localtime')
          ) AS business_date
        `,
      )
      .get(purchase.business_date, purchase.created_at) as {
      business_date: string;
    };

    const businessDate = String(
      businessDateRow?.business_date || getCurrentBusinessDate(db),
    );

    const closedDay = db
      .prepare(
        `
        SELECT id

        FROM cash_day_closings

        WHERE business_date = ?

        LIMIT 1
        `,
      )
      .get(businessDate);

    if (closedDay) {
      throw new Error(
        `لا يمكن تعديل الفاتورة لأن يوم ${businessDate} تم تقفيله`,
      );
    }

    const originalShiftId = Number(purchase.shift_id || 0);

    if (originalShiftId > 0) {
      const currentShift = getOpenCashShift();

      if (!currentShift || Number(currentShift.id) !== originalShiftId) {
        throw new Error('لا يمكن تعديل فاتورة شراء من شفت تم إغلاقه');
      }
    }

    const oldSupplierId = Number(purchase.supplier_id);

    const nextSupplierId = Number(input.supplier_id);

    if (!nextSupplierId) {
      throw new Error('اختار المورد');
    }

    const nextSupplier = db
      .prepare(
        `
        SELECT *

        FROM suppliers

        WHERE id = ?

        LIMIT 1
        `,
      )
      .get(nextSupplierId) as any;

    if (!nextSupplier) {
      throw new Error('المورد غير موجود');
    }

    if (
      nextSupplierId !== oldSupplierId &&
      Number(nextSupplier.is_active) !== 1
    ) {
      throw new Error('لا يمكن نقل الفاتورة إلى مورد غير مفعل');
    }

    const oldItems = db
      .prepare(
        `
        SELECT *

        FROM purchase_items

        WHERE purchase_id = ?

        ORDER BY id ASC
        `,
      )
      .all(purchaseId) as any[];

    if (oldItems.length === 0) {
      throw new Error('لا توجد أصناف داخل فاتورة الشراء');
    }

    const oldItemByVariant = new Map<number, any>();

    const oldItemsByVariant = new Map<number, any[]>();

    for (const item of oldItems) {
      const variantId = Number(item.variant_id);

      if (!oldItemByVariant.has(variantId)) {
        oldItemByVariant.set(variantId, item);
      }

      const variantItems = oldItemsByVariant.get(variantId) ?? [];

      variantItems.push(item);

      oldItemsByVariant.set(variantId, variantItems);
    }

    const seenVariants = new Set<number>();

    const getVariant = db.prepare(
      `
      SELECT
        v.id,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,

        p.name
          AS product_name

      FROM product_variants v

      JOIN products p
        ON p.id = v.product_id

      WHERE v.id = ?

      LIMIT 1
      `,
    );

    const basePreparedItems = input.items.map((rawItem) => {
      const variantId = Number(rawItem.variant_id);

      if (!variantId || seenVariants.has(variantId)) {
        throw new Error('يوجد صنف مكرر أو غير صحيح داخل الفاتورة');
      }

      seenVariants.add(variantId);

      const variant = getVariant.get(variantId) as any;

      if (!variant) {
        throw new Error('الصنف غير موجود');
      }

      const pricing = preparePurchaseItemInput(rawItem, variant.product_name);
      const oldItem = oldItemByVariant.get(variantId);

      return {
        variant,

        ...pricing,

        previousBuyPrice: getPreviousBuyPriceForPurchaseEdit(
          db,
          variantId,
          purchaseId,
          oldItem?.previous_buy_price,
        ),
      };
    });

    const subTotal = preciseSum(
      basePreparedItems.map((item) => item.rawLineTotal),
    );

    const { discountType, discountInput, discountValue } =
      resolvePurchaseInvoiceDiscount(
        subTotal,
        input.discount_type,
        input.discount_input,
      );

    const preparedItems = applyPurchaseInvoiceDiscount(
      basePreparedItems,
      discountValue,
    );

    const exactTotalAmount = preciseSum(
      preparedItems.map((item) => item.lineTotal),
    );

    const totalAmount = preservePrecision(exactTotalAmount);

    const rawPaidAmount = Number(input.paid_amount || 0);

    if (!Number.isFinite(rawPaidAmount) || rawPaidAmount < 0) {
      throw new Error('المبلغ المدفوع غير صحيح');
    }

    /*
     * أي دفع فعلي عندنا
     * بالجنيه الصحيح.
     */
    const cashPaidAmount = roundMoney(rawPaidAmount);

    const settleFullBalance = Boolean(input.settle_full_balance);

    let paidAmount = 0;

    let remainingAmount = totalAmount;

    let roundingAdjustment = 0;

    if (settleFullBalance) {
      const settlement = resolveWholeMoneySettlement(
        cashPaidAmount,
        totalAmount,
      );

      const zeroCashSettlement =
        cashPaidAmount === 0 && roundMoney(totalAmount) === 0;

      if (!settlement.isFullSettlement && !zeroCashSettlement) {
        throw new Error(
          `لتسوية كامل الفاتورة يجب أن يكون المبلغ المدفوع ${roundMoney(
            totalAmount,
          )} ج.م`,
        );
      }

      paidAmount = totalAmount;

      remainingAmount = 0;

      roundingAdjustment = preciseSubtract(cashPaidAmount, totalAmount);
    } else {
      if (exceedsPreciseAmount(cashPaidAmount, totalAmount)) {
        throw new Error(
          'المبلغ المدفوع أكبر من المستحق؛ فعّل تسوية كامل الفاتورة إذا كنت تريد إقفال فرق القروش',
        );
      }

      paidAmount = preservePrecision(Math.min(cashPaidAmount, totalAmount));

      remainingAmount = normalizePreciseZero(
        Math.max(0, preciseSubtract(totalAmount, paidAmount)),
      );

      roundingAdjustment = 0;
    }

    const paymentStatus = normalizePaymentStatus(
      totalAmount,
      paidAmount,
      remainingAmount,
    );

    const oldPaidAmount = preservePrecision(Number(purchase.paid_amount || 0));

    const oldRemainingAmount = normalizePreciseZero(
      Number(purchase.remaining_amount || 0),
    );

    const oldCashAmount = resolveStoredPurchaseInitialCashAmount(purchase);

    const preserveDueDate =
      hasPositivePreciseAmount(oldRemainingAmount) &&
      oldSupplierId === nextSupplierId;

    let dueDate: string | null = null;

    if (preserveDueDate) {
      const storedDueDate = String(purchase.due_date || '').trim();

      if (storedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(storedDueDate)) {
        throw new Error('تاريخ استحقاق فاتورة الشراء المحفوظ غير صحيح');
      }

      dueDate = storedDueDate || null;
    } else if (hasPositivePreciseAmount(remainingAmount)) {
      dueDate = calculatePurchaseDueDate(
        db,
        businessDate,
        nextSupplier.credit_days == null
          ? null
          : Number(nextSupplier.credit_days),
      );
    }

    const oldTotalAmount = preservePrecision(
      Number(purchase.total_amount || 0),
    );

    const oldPaymentMethod = resolveCashAccount(
      purchase.payment_method || 'cash',
    );

    const newPaymentMethod = resolveCashAccount(
      input.payment_method || purchase.payment_method || 'cash',
    );

    const oldFinancialShift =
      oldCashAmount > 0
        ? resolveFinancialOperationShift(
            actorId,
            [oldPaymentMethod],
            'لا يمكن تعديل فاتورة شراء تمس درج المحل بدون شفت مفتوح',
          )
        : null;

    const newFinancialShift =
      cashPaidAmount > 0
        ? resolveFinancialOperationShift(
            actorId,
            [newPaymentMethod],
            'لا يمكن تعديل فاتورة شراء تمس درج المحل بدون شفت مفتوح',
          )
        : null;

    const nextShiftId =
      originalShiftId > 0 ? originalShiftId : (newFinancialShift?.id ?? null);

    const oldInitialPayment = db
      .prepare(
        `
        SELECT
          id,
          created_at

        FROM supplier_payments

        WHERE
          purchase_id = ?
          AND batch_id IS NULL

          AND IFNULL(
            notes,
            ''
          ) LIKE ?

        ORDER BY id ASC

        LIMIT 1
        `,
      )
      .get(purchaseId, `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}%`) as
      | {
          id: number;
          created_at: string;
        }
      | undefined;

    const oldQuantityByVariant = new Map<number, number>();

    const oldFallbackByVariant = new Map<number, number | null>();

    for (const item of oldItems) {
      const variantId = Number(item.variant_id);

      oldQuantityByVariant.set(
        variantId,

        Number(oldQuantityByVariant.get(variantId) || 0) +
          Number(item.quantity || 0),
      );

      if (!oldFallbackByVariant.has(variantId)) {
        oldFallbackByVariant.set(variantId, item.previous_buy_price ?? null);
      }
    }

    const newQuantityByVariant = new Map<number, number>();

    for (const item of preparedItems) {
      newQuantityByVariant.set(Number(item.variant.id), Number(item.quantity));
    }

    const affectedVariantIds = Array.from(
      new Set([...oldQuantityByVariant.keys(), ...newQuantityByVariant.keys()]),
    );

    const preparedItemByVariant = new Map<
      number,
      (typeof preparedItems)[number]
    >();

    for (const item of preparedItems) {
      preparedItemByVariant.set(Number(item.variant.id), item);
    }

    /*
     * عكس دفعة إنشاء الفاتورة القديمة.
     * الحركة الأصلية تظل محفوظة.
     */
    if (oldCashAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',

        direction: 'in',

        amount: oldCashAmount,

        payment_method: oldPaymentMethod,

        reference_id: purchaseId,

        reference_type: 'purchase_edit_reversal',

        notes: `عكس دفعة فاتورة شراء #${purchaseId} قبل التعديل`,

        created_by: actorId,

        business_date: businessDate,

        shift_id: oldFinancialShift?.id ?? null,
      });
    }

    /*
     * نصحح أثر المخزون كعملية عكس + تطبيق.
     *
     * المبيعات السابقة تظل محتفظة
     * بـ Cost Snapshot الخاص بها.
     */
    for (const variantId of affectedVariantIds) {
      const oldVariantItems = oldItemsByVariant.get(variantId) ?? [];

      const newItem = preparedItemByVariant.get(variantId);

      const oldQuantity = oldVariantItems.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0,
      );

      const oldCostValue = preciseSum(
        oldVariantItems.map((item) => Number(item.line_total || 0)),
      );

      const newQuantity = Number(newItem?.quantity || 0);

      const newUnitCost = Number(newItem?.effectiveUnitCost || 0);

      const newCostValue = preservePrecision(Number(newItem?.lineTotal || 0));

      const sameQuantity = Math.abs(oldQuantity - newQuantity) <= 0.0001;

      const sameCostValue = samePreciseAmount(oldCostValue, newCostValue);

      if (
        oldVariantItems.length > 0 &&
        newItem &&
        sameQuantity &&
        sameCostValue
      ) {
        continue;
      }

      /*
       * ندخل الصورة الجديدة الأول
       * ثم نعكس كل السطور القديمة.
       *
       * مهم للفواتير القديمة التي
       * كان ممكن تحتوي نفس الصنف
       * في أكثر من سطر.
       */
      if (newItem) {
        receiveStockAtCost(db, {
          variant_id: variantId,

          quantity: newQuantity,

          unit_cost: newUnitCost,
          cost_value: newCostValue,
          created_by: actorId || null,
          reference_id: purchaseId,

          reference_type: 'purchase_edit',

          notes: `تطبيق تكلفة الصنف بعد تعديل فاتورة شراء #${purchaseId}`,
        });
      }

      for (const oldItem of oldVariantItems) {
        issueStockAtCost(db, {
          variant_id: variantId,

          quantity: Number(oldItem.quantity || 0),

          unit_cost: getEffectivePurchaseUnitCost(oldItem),
          cost_value: Number(oldItem.line_total || 0),
          created_by: actorId || null,
          reference_id: purchaseId,

          reference_type: 'purchase_edit_reversal',

          notes: `عكس تكلفة الصنف قبل تعديل فاتورة شراء #${purchaseId}`,
        });
      }
    }
    /*
     * نشيل الأثر المالي القديم
     * من المورد القديم.
     */
    db.prepare(
      `
      UPDATE suppliers

      SET
        total_purchased =
          MAX(
              IFNULL(
                total_purchased,
                0
              ) - ?,
            0
          ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(oldTotalAmount, oldSupplierId);

    db.prepare(
      `
      DELETE FROM supplier_payments

      WHERE
        purchase_id = ?
        AND batch_id IS NULL

        AND IFNULL(
          notes,
          ''
        ) LIKE ?
      `,
    ).run(purchaseId, `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}%`);

    db.prepare(
      `
      DELETE FROM purchase_items

      WHERE purchase_id = ?
      `,
    ).run(purchaseId);

    db.prepare(
      `
      UPDATE purchase_invoices

      SET
        supplier_id = ?,

        total_amount = ?,

        exact_total_amount = ?,

        rounding_adjustment = ?,
        settle_full_balance = ?,
        sub_total = ?,

        discount_type = ?,
        discount_input = ?,
        discount_value = ?,

        paid_amount = ?,
        remaining_amount = ?,
        payment_status = ?,

        payment_method = ?,
        notes = ?,

        business_date = ?,
        shift_id = ?

      WHERE id = ?
      `,
    ).run(
      nextSupplierId,

      totalAmount,
      exactTotalAmount,
      roundingAdjustment,
      settleFullBalance ? 1 : 0,
      subTotal,

      discountType,
      discountInput,
      discountValue,

      paidAmount,
      remainingAmount,
      paymentStatus,

      newPaymentMethod,
      input.notes?.trim() || null,

      businessDate,
      nextShiftId,

      purchaseId,
    );

    db.prepare(
      `
      UPDATE purchase_invoices

      SET due_date = ?

      WHERE id = ?
      `,
    ).run(dueDate, purchaseId);

    const insertItem = db.prepare(
      `
        INSERT INTO purchase_items (
          purchase_id,
          variant_id,

          product_name,
          barcode,
          size,
          color,

          quantity,
          unit_cost,
          previous_buy_price,

          line_total
        )

        VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
        `,
    );

    for (const item of preparedItems) {
      insertItem.run(
        purchaseId,

        Number(item.variant.id),

        item.variant.product_name,
        item.variant.barcode ?? null,
        item.variant.size ?? null,
        item.variant.color ?? null,

        item.quantity,
        item.unitCost,
        item.previousBuyPrice,

        item.lineTotal,
      );
    }

    /*
     * تطبيق الفاتورة الجديدة
     * على المورد المختار.
     */
    db.prepare(
      `
      UPDATE suppliers

      SET
        total_purchased =

            IFNULL(
              total_purchased,
              0
            ) + ?,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(totalAmount, nextSupplierId);

    if (oldSupplierId !== nextSupplierId) {
      rebuildSupplierBalance(db, oldSupplierId);
    }

    const supplierBalance = rebuildSupplierBalance(db, nextSupplierId);

    if (paidAmount > 0) {
      db.prepare(
        `
        INSERT INTO supplier_payments (
          supplier_id,
          purchase_id,
          amount,
          payment_method,
          notes,
          created_at
        )

        VALUES (
          ?, ?, ?, ?, ?,
          COALESCE(
            ?,
            CURRENT_TIMESTAMP
          )
        )
        `,
      ).run(
        nextSupplierId,
        purchaseId,
        paidAmount,
        newPaymentMethod,

        `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}`,

        oldInitialPayment?.created_at ?? purchase.created_at ?? null,
      );
      if (cashPaidAmount > 0) {
        createCashMovement({
          type: 'supplier_payment',

          direction: 'out',

          amount: cashPaidAmount,

          payment_method: newPaymentMethod,

          reference_id: purchaseId,

          reference_type: 'purchase_invoice',

          notes: `دفع فاتورة شراء رقم ${purchaseId} بعد التعديل`,

          created_by: actorId,

          business_date: businessDate,

          shift_id: newFinancialShift?.id ?? null,
        });
      }
    }

    /*
     * Last Purchase Cost
     * يتحدد بعد الصورة الجديدة
     * للفواتير.
     */
    for (const variantId of affectedVariantIds) {
      recalculateVariantBuyPrice(
        db,

        variantId,

        oldFallbackByVariant.get(variantId),
      );
    }

    return {
      ok: true,

      purchase_id: purchaseId,

      supplier_id: nextSupplierId,

      previous_supplier_id: oldSupplierId,

      total_amount: totalAmount,
      exact_total_amount: exactTotalAmount,

      rounding_adjustment: roundingAdjustment,
      paid_amount: paidAmount,

      cash_amount: cashPaidAmount,

      settle_full_balance: settleFullBalance,
      remaining_amount: remainingAmount,

      payment_status: paymentStatus,
      due_date: dueDate,
      items_count: preparedItems.length,

      shift_id: nextShiftId,

      edited: true,
    };
  });

  return tx();
}

export function cancelPurchaseInvoice(input: CancelPurchaseInput) {
  const db = getDb();
  const purchaseId = Number(input.purchase_id);
  const actorId = Number(input.actor_id || 0);
  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح');
  }

  const tx = db.transaction(() => {
    const purchase = db
      .prepare(
        `
        SELECT
          pi.*,
          IFNULL(pi.status, 'active') AS safe_status
        FROM purchase_invoices pi
        WHERE pi.id = ?
        LIMIT 1
      `,
      )
      .get(purchaseId) as any;

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة');
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('فاتورة الشراء ملغاة بالفعل');
    }

    if (purchase.safe_status === 'opening_balance') {
      throw new Error('الرصيد الافتتاحي لا يتم إلغاؤه كفاتورة شراء');
    }

    const returnsCountRow = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM purchase_returns
        WHERE purchase_id = ?
          AND cancelled_at IS NULL
      `,
      )
      .get(purchaseId) as { count: number };

    if (Number(returnsCountRow?.count || 0) > 0) {
      throw new Error('لا يمكن إلغاء فاتورة تم عمل مرتجع عليها');
    }

    const laterPaymentRow = db
      .prepare(
        `
        SELECT COUNT(*) AS count

        FROM supplier_payments sp

        LEFT JOIN supplier_payment_batches b
          ON b.id = sp.batch_id

        WHERE sp.purchase_id = ?

          AND (
            (
              sp.batch_id IS NOT NULL
              AND b.cancelled_at IS NULL
            )

            OR (
              sp.batch_id IS NULL
              AND IFNULL(sp.notes, '') NOT LIKE
                'دفعة عند إنشاء فاتورة شراء رقم %'
            )
          )
        `,
      )
      .get(purchaseId) as {
      count: number;
    };

    if (Number(laterPaymentRow?.count || 0) > 0) {
      throw new Error(
        'لا يمكن إلغاء فاتورة الشراء لأنها تحتوي على دفعة مورد لاحقة',
      );
    }

    const items = db
      .prepare(
        `
        SELECT *
        FROM purchase_items
        WHERE purchase_id = ?
        ORDER BY id ASC
      `,
      )
      .all(purchaseId) as any[];

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل فاتورة الشراء');
    }

    for (const item of items) {
      const currentStock = getCurrentVariantStock(db, Number(item.variant_id));
      const quantity = Number(item.quantity || 0);

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن إلغاء الفاتورة لأن مخزون الصنف "${item.product_name}" أقل من كمية الفاتورة`,
        );
      }
    }

    for (const item of items) {
      issueStockAtCost(db, {
        variant_id: Number(item.variant_id),

        quantity: Number(item.quantity || 0),

        unit_cost: getEffectivePurchaseUnitCost(item),
        cost_value: Number(item.line_total || 0),
        created_by: actorId || null,
        reference_id: purchaseId,

        reference_type: 'purchase_cancel',

        notes: `خروج مخزون بسبب إلغاء فاتورة شراء رقم ${purchaseId}`,
      });
    }

    const totalAmount = preservePrecision(Number(purchase.total_amount || 0));

    const paidAmount = preservePrecision(Number(purchase.paid_amount || 0));

    const cashPaidAmount = resolveStoredPurchaseInitialCashAmount(purchase);

    const paymentMethod = resolveCashAccount(purchase.payment_method || 'cash');

    const openShift =
      cashPaidAmount > 0
        ? resolveFinancialOperationShift(
            actorId,
            [paymentMethod],
            'لا يمكن إلغاء فاتورة شراء وإرجاع كاش للدرج بدون شفت مفتوح',
          )
        : null;

    const cancellationBusinessDate = resolveFinancialBusinessDate(
      openShift?.id ?? null,
    );

    const remainingAmount = preservePrecision(
      Number(purchase.remaining_amount || 0),
    );

    db.prepare(
      `
      UPDATE purchase_invoices
      SET
        status = 'cancelled',
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancelled_shift_id = ?,
        cancel_reason = ?,
        payment_status = 'cancelled',
        remaining_amount = 0
      WHERE id = ?
    `,
    ).run(
      actorId,
      openShift?.id ?? null,
      input.reason?.trim() || null,
      purchaseId,
    );

    const affectedVariantIds = Array.from(
      new Set(items.map((item) => Number(item.variant_id))),
    );

    for (const variantId of affectedVariantIds) {
      recalculateVariantBuyPrice(db, variantId);
    }

    db.prepare(
      `
      UPDATE suppliers

      SET
        total_purchased =
          MAX(
              IFNULL(
                total_purchased,
                0
              ) - ?,
            0
          ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(totalAmount, Number(purchase.supplier_id));

    const supplierBalance = rebuildSupplierBalance(
      db,
      Number(purchase.supplier_id),
    );

    if (cashPaidAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',
        direction: 'in',

        amount: cashPaidAmount,

        payment_method: paymentMethod,

        reference_id: purchaseId,

        reference_type: 'purchase_cancel',

        notes: `عكس دفعة فاتورة شراء ملغاة رقم ${purchaseId}`,

        created_by: actorId,

        business_date: cancellationBusinessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    return {
      ok: true,
      purchase_id: purchaseId,
      supplier_id: Number(purchase.supplier_id),
      reversed_total: totalAmount,
      reversed_paid: paidAmount,
      reversed_cash: cashPaidAmount,
      supplier_balance: supplierBalance,
      reversed_remaining: remainingAmount,
      items_count: items.length,
      cancelled_shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

export function createPurchaseReturn(input: CreatePurchaseReturnInput) {
  const db = getDb();
  const purchaseId = Number(input.purchase_id);

  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في المرتجع');
  }

  const tx = db.transaction(() => {
    const purchase = db
      .prepare(
        `
        SELECT
          pi.*,
          IFNULL(pi.status, 'active') AS safe_status
        FROM purchase_invoices pi
        WHERE pi.id = ?
        LIMIT 1
      `,
      )
      .get(purchaseId) as any;

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة');
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('لا يمكن عمل مرتجع على فاتورة ملغاة');
    }

    if (purchase.safe_status === 'opening_balance') {
      throw new Error('لا يمكن عمل مرتجع على رصيد افتتاحي');
    }

    const seenPurchaseItemIds = new Set<number>();
    const preparedItems = input.items.map((rawItem) => {
      const quantity = Number(rawItem.quantity || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('كمية المرتجع غير صحيحة');
      }

      let purchaseItem: any;

      if (rawItem.purchase_item_id) {
        purchaseItem = db
          .prepare(
            `
            SELECT *
            FROM purchase_items
            WHERE id = ?
              AND purchase_id = ?
            LIMIT 1
          `,
          )
          .get(Number(rawItem.purchase_item_id), purchaseId);
      } else if (rawItem.variant_id) {
        purchaseItem = db
          .prepare(
            `
            SELECT *
            FROM purchase_items
            WHERE variant_id = ?
              AND purchase_id = ?
            LIMIT 1
          `,
          )
          .get(Number(rawItem.variant_id), purchaseId);
      }

      if (!purchaseItem) {
        throw new Error('الصنف غير موجود داخل فاتورة الشراء');
      }

      const purchaseItemId = Number(purchaseItem.id);

      if (seenPurchaseItemIds.has(purchaseItemId)) {
        throw new Error(
          `الصنف "${purchaseItem.product_name}" مكرر داخل المرتجع`,
        );
      }

      seenPurchaseItemIds.add(purchaseItemId);

      const alreadyReturned = getReturnedQuantityForPurchaseItem(
        db,
        Number(purchaseItem.id),
      );

      const originalQuantity = Number(purchaseItem.quantity || 0);
      const availableToReturn = Math.max(0, originalQuantity - alreadyReturned);

      if (quantity > availableToReturn) {
        throw new Error(
          `كمية المرتجع للصنف "${purchaseItem.product_name}" أكبر من الكمية المتاحة للمرتجع`,
        );
      }

      const currentStock = getCurrentVariantStock(
        db,
        Number(purchaseItem.variant_id),
      );

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن عمل مرتجع للصنف "${purchaseItem.product_name}" لأن المخزون الحالي غير كافٍ`,
        );
      }

      if (!Number.isFinite(originalQuantity) || originalQuantity <= 0) {
        throw new Error(
          `كمية الشراء الأصلية للصنف "${purchaseItem.product_name}" غير صحيحة`,
        );
      }

      const originalLineTotal =
        purchaseItem.line_total == null
          ? truncateMoney(
              preciseMultiply(
                originalQuantity,
                Number(purchaseItem.unit_cost || 0),
              ),
            )
          : truncateMoney(purchaseItem.line_total);

      const previousReturnedValueRow = db
        .prepare(
          `
    SELECT
      IFNULL(
        SUM(pri.line_total),
        0
      ) AS returned_value
    FROM purchase_return_items pri
    JOIN purchase_returns pr
      ON pr.id = pri.return_id
    WHERE
      pri.purchase_item_id = ?
      AND pr.cancelled_at IS NULL
  `,
        )
        .get(purchaseItemId) as
        | {
            returned_value: number;
          }
        | undefined;

      const alreadyReturnedValue = truncateMoney(
        previousReturnedValueRow?.returned_value || 0,
      );

      const cumulativeReturnedQuantity = alreadyReturned + quantity;

      const cumulativeReturnedValue =
        cumulativeReturnedQuantity >= originalQuantity - 0.000001
          ? originalLineTotal
          : allocateMoneyValueByQuantity(
              originalLineTotal,
              cumulativeReturnedQuantity,
              originalQuantity,
            );

      const lineTotal = truncateMoney(
        Math.max(
          0,
          preciseSubtract(cumulativeReturnedValue, alreadyReturnedValue),
        ),
      );

      const unitCost = roundFinancial(preciseDivide(lineTotal, quantity));

      return {
        purchaseItem,

        quantity,

        unitCost,

        lineTotal,
      };
    });

    const exactReturnAmount = preciseSum(
      preparedItems.map((item) => Number(item.lineTotal || 0)),
    );

    if (exactReturnAmount <= 0) {
      throw new Error('قيمة المرتجع غير صحيحة');
    }

    /*
     * القيمة الدقيقة الأصلية
     * للفاتورة قبل التقريب.
     */
    const originalExactTotal = preservePrecision(
      Number(purchase.exact_total_amount ?? purchase.total_amount ?? 0),
    );

    /*
     * نحسب قيمة المرتجعات
     * الفعالة السابقة بدقتها،
     * وليس بقيمة التسوية المقربة.
     */
    const previousReturnsRow = db
      .prepare(
        `
    SELECT
      IFNULL(
        SUM(
          COALESCE(
            exact_total_amount,
            total_amount,
            0
          )
        ),
        0
      ) AS exact_returned

    FROM purchase_returns

    WHERE
      purchase_id = ?

      AND cancelled_at
        IS NULL
    `,
      )
      .get(purchaseId) as
      | {
          exact_returned: number;
        }
      | undefined;

    const previousExactReturned = preservePrecision(
      previousReturnsRow?.exact_returned || 0,
    );

    const exactBeforeReturn = normalizePreciseZero(
      Math.max(0, preciseSubtract(originalExactTotal, previousExactReturned)),
    );

    if (exceedsPreciseAmount(exactReturnAmount, exactBeforeReturn)) {
      throw new Error('قيمة المرتجع أكبر من القيمة المتبقية في فاتورة الشراء');
    }

    const totalAmount = exactReturnAmount;

    const oldRemaining = normalizePreciseZero(
      Number(purchase.remaining_amount || 0),
    );

    const debtReductionAmount = normalizePreciseZero(
      Math.min(totalAmount, oldRemaining),
    );

    const refundableAmount = normalizePreciseZero(
      Math.max(0, preciseSubtract(totalAmount, debtReductionAmount)),
    );

    const refundMode = input.refund_mode === 'credit' ? 'credit' : 'cash';

    const settleCashRefund =
      refundMode === 'cash' && Boolean(input.settle_cash_refund);

    let cashRefundAmount = 0;

    let creditAmount = 0;

    let roundingAdjustment = 0;

    if (refundMode === 'credit') {
      /*
       * لا يوجد كاش.
       * كامل الجزء المستحق لنا
       * يظل رصيدًا دائنًا.
       */
      creditAmount = refundableAmount;
    } else if (refundableAmount > 0) {
      /*
       * بدون تسوية صريحة:
       * الافتراضي هو أكبر جنيه صحيح
       * لا يتجاوز حقنا المحاسبي.
       *
       * مثال:
       * 155.83 -> نستلم 155
       * ويتبقى 0.83 رصيد دائن.
       */
      const defaultCashRefund = Math.floor(refundableAmount + 0.000001);

      const rawCashRefund = Number(
        input.cash_refund_amount ?? defaultCashRefund,
      );

      if (!Number.isFinite(rawCashRefund) || rawCashRefund < 0) {
        throw new Error('المبلغ المستلم من المورد غير صحيح');
      }

      /*
       * أي حركة مالية فعلية مع المورد
       * تكون بالجنيه الصحيح.
       */
      cashRefundAmount = roundMoney(rawCashRefund);

      if (settleCashRefund) {
        const expectedCash = roundMoney(refundableAmount);

        if (Math.abs(cashRefundAmount - expectedCash) > 0.001) {
          throw new Error(
            `لتسوية كامل رد المورد يجب أن يكون المبلغ النقدي ${expectedCash} ج.م`,
          );
        }

        /*
         * التسوية الصريحة:
         * نقفل الحق المحاسبي بالكامل.
         */
        creditAmount = 0;

        roundingAdjustment = preciseSubtract(
          cashRefundAmount,
          refundableAmount,
        );
      } else {
        /*
         * بدون تسوية:
         * ممنوع نستلم أكثر من
         * المستحق المحاسبي.
         */
        if (exceedsPreciseAmount(cashRefundAmount, refundableAmount)) {
          throw new Error(
            'المبلغ المستلم أكبر من المستحق؛ فعّل تسوية كامل رد المورد إذا كنت تريد تقريب المبلغ',
          );
        }

        creditAmount = normalizePreciseZero(
          Math.max(0, preciseSubtract(refundableAmount, cashRefundAmount)),
        );

        roundingAdjustment = 0;
      }
    }

    const refundPaymentMethod =
      input.refund_payment_method?.trim() ||
      purchase.payment_method ||
      'store_cash';

    const actorId = Number(input.actor_id || 0);

    const resolvedRefundAccount = resolveCashAccount(refundPaymentMethod);

    const openShift =
      refundMode === 'cash' && cashRefundAmount > 0
        ? resolveFinancialOperationShift(
            actorId,

            [resolvedRefundAccount],

            'لا يمكن استلام كاش مرتجع شراء في درج المحل بدون شفت مفتوح',
          )
        : null;

    const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

    const returnResult = db
      .prepare(
        `
        INSERT INTO purchase_returns (
          purchase_id,
          supplier_id,

          total_amount,
          exact_total_amount,
          rounding_adjustment,

          debt_reduction_amount,

          cash_refund_amount,

          credit_amount,

          settle_cash_refund,

          refund_payment_method,

          refund_mode,

          notes,

          created_by,

          business_date,

          shift_id
        )

        VALUES (
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
        `,
      )
      .run(
        purchaseId,

        Number(purchase.supplier_id),

        totalAmount,

        exactReturnAmount,

        roundingAdjustment,

        debtReductionAmount,

        cashRefundAmount,

        creditAmount,

        settleCashRefund ? 1 : 0,

        refundMode === 'cash' ? refundPaymentMethod : null,

        refundMode,

        input.notes?.trim() || null,

        input.actor_id ?? null,

        businessDate,

        openShift?.id ?? null,
      );

    const returnId = Number(returnResult.lastInsertRowid);

    const insertReturnItem = db.prepare(`
      INSERT INTO purchase_return_items (
        return_id,
        purchase_item_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of preparedItems) {
      insertReturnItem.run(
        returnId,
        Number(item.purchaseItem.id),
        Number(item.purchaseItem.variant_id),
        item.purchaseItem.product_name,
        item.purchaseItem.barcode ?? null,
        item.purchaseItem.size ?? null,
        item.purchaseItem.color ?? null,
        item.quantity,
        item.unitCost,
        item.lineTotal,
      );

      issueStockAtCost(db, {
        variant_id: Number(item.purchaseItem.variant_id),

        quantity: item.quantity,

        unit_cost: item.unitCost,

        /*
         * line_total هو قيمة التكلفة الحقيقية
         * للكمية المرتجعة، وليس
         * quantity × unit_cost المقرب.
         */
        cost_value: item.lineTotal,

        created_by: actorId || null,

        reference_id: returnId,

        reference_type: 'purchase_return',

        notes: `خروج مخزون بسبب مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`,
      });
    }

    const oldPaid = preservePrecision(Number(purchase.paid_amount || 0));

    const oldTotal = preservePrecision(Number(purchase.total_amount || 0));

    const newRemaining = normalizePreciseZero(
      Math.max(0, preciseSubtract(oldRemaining, debtReductionAmount)),
    );

    const newPaymentStatus = normalizePaymentStatus(
      oldTotal,

      oldPaid,

      newRemaining,
    );

    db.prepare(
      `
      UPDATE purchase_invoices
      SET
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `,
    ).run(newRemaining, newPaymentStatus, purchaseId);

    /*
     * صافي المشتريات ينخفض
     * بقيمة المرتجع الدقيقة.
     */
    db.prepare(
      `
      UPDATE suppliers

      SET
        total_purchased =
          MAX(

              IFNULL(
                total_purchased,
                0
              ) - ?,
            0
          ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(
      totalAmount,

      Number(purchase.supplier_id),
    );

    /*
     * الرصيد نفسه لا نحسبه يدويًا.
     *
     * = ديون الفواتير المفتوحة
     * - الرصيد الدائن الناتج
     *   عن المرتجعات.
     */
    const supplierBalance = rebuildSupplierBalance(
      db,

      Number(purchase.supplier_id),
    );

    if (refundMode === 'cash' && cashRefundAmount > 0) {
      createCashMovement({
        type: 'purchase_return',
        direction: 'in',

        amount: cashRefundAmount,

        payment_method: resolvedRefundAccount,

        reference_id: returnId,

        reference_type: 'purchase_return',

        notes: `استلام فرق مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`,

        created_by: actorId,

        business_date: businessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    return {
      ok: true,

      return_id: returnId,

      purchase_id: purchaseId,

      supplier_id: Number(purchase.supplier_id),

      /*
       * قيمة المرتجع المحاسبية.
       */
      total_amount: totalAmount,

      exact_total_amount: exactReturnAmount,

      /*
       * cash - قيمة الحق
       * الذي تم تسويته نقديًا.
       */
      rounding_adjustment: roundingAdjustment,

      /*
       * الذي خفض الدين القديم.
       */
      debt_reduction_amount: debtReductionAmount,

      /*
       * الكاش الحقيقي الداخل.
       */
      cash_refund_amount: cashRefundAmount,

      /*
       * حق متبقٍ لنا عند المورد.
       */
      credit_amount: creditAmount,

      settle_cash_refund: settleCashRefund,

      supplier_balance: supplierBalance,

      refund_mode: refundMode,

      refund_payment_method: refundMode === 'cash' ? refundPaymentMethod : null,

      items_count: preparedItems.length,

      shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

function getPurchaseReturnMutationContext(returnIdInput: number) {
  const db = getDb();

  const returnId = Number(returnIdInput || 0);

  if (!returnId) {
    throw new Error('رقم مرتجع الشراء غير صحيح');
  }

  const purchaseReturn = db
    .prepare(
      `
      SELECT
        pr.*,

        pi.total_amount
          AS purchase_total_amount,

        pi.paid_amount
          AS purchase_paid_amount,

        pi.remaining_amount
          AS purchase_remaining_amount,

        IFNULL(
          pi.status,
          'active'
        ) AS purchase_status,

        pi.payment_method
          AS purchase_payment_method

      FROM purchase_returns pr

      JOIN purchase_invoices pi
        ON pi.id =
           pr.purchase_id

      WHERE pr.id = ?

      LIMIT 1
      `,
    )
    .get(returnId) as any;

  if (!purchaseReturn) {
    throw new Error('مرتجع الشراء غير موجود');
  }

  if (purchaseReturn.cancelled_at) {
    throw new Error('مرتجع الشراء ملغي بالفعل');
  }

  if (purchaseReturn.purchase_status === 'cancelled') {
    throw new Error(
      'لا يمكن تعديل أو إلغاء المرتجع لأن فاتورة الشراء الأصلية ملغاة',
    );
  }

  const latestActiveReturn = db
    .prepare(
      `
      SELECT id

      FROM purchase_returns

      WHERE
        purchase_id = ?
        AND cancelled_at IS NULL

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get(Number(purchaseReturn.purchase_id)) as
    | {
        id: number;
      }
    | undefined;

  if (Number(latestActiveReturn?.id || 0) !== returnId) {
    throw new Error(
      'يجب تعديل أو إلغاء آخر مرتجع شراء فعال على الفاتورة أولًا',
    );
  }

  const items = db
    .prepare(
      `
      SELECT *

      FROM purchase_return_items

      WHERE return_id = ?

      ORDER BY id ASC
      `,
    )
    .all(returnId) as any[];

  if (items.length === 0) {
    throw new Error('لا توجد أصناف داخل مرتجع الشراء');
  }

  return {
    db,
    purchaseReturn,
    items,
  };
}

export function cancelPurchaseReturn(input: CancelPurchaseReturnInput) {
  const returnId = Number(input.return_id || 0);

  const actorId = Number(input.actor_id || 0);

  if (!actorId) {
    throw new Error('المستخدم غير صحيح');
  }

  const { db, purchaseReturn, items } =
    getPurchaseReturnMutationContext(returnId);

  /*
   * القيمة المحاسبية للمرتجع
   * تظل بالقروش.
   */
  const totalAmount = preservePrecision(
    Number(
      purchaseReturn.exact_total_amount ?? purchaseReturn.total_amount ?? 0,
    ),
  );

  const debtReductionAmount = preservePrecision(
    Number(purchaseReturn.debt_reduction_amount || 0),
  );

  const cashRefundAmount = preservePrecision(
    Number(purchaseReturn.cash_refund_amount || 0),
  );

  const creditAmount = preservePrecision(
    Number(purchaseReturn.credit_amount || 0),
  );

  const roundingAdjustment = preservePrecision(
    Number(purchaseReturn.rounding_adjustment || 0),
  );

  const refundMode =
    purchaseReturn.refund_mode === 'credit' ? 'credit' : 'cash';

  const refundAccount = resolveCashAccount(
    purchaseReturn.refund_payment_method ||
      purchaseReturn.purchase_payment_method ||
      'store_cash',
  );

  const openShift =
    cashRefundAmount > 0
      ? resolveFinancialOperationShift(
          actorId,

          [refundAccount],

          'لا يمكن إلغاء مرتجع شراء يؤثر على درج المحل بدون شفت مفتوح',
        )
      : null;

  const cancellationBusinessDate = resolveFinancialBusinessDate(
    openShift?.id ?? null,
  );

  const reason = String(input.reason || '').trim() || 'إلغاء مرتجع شراء';

  const tx = db.transaction(() => {
    /*
     * المرتجع أخرج بضاعة.
     * الإلغاء يعيد نفس الكمية
     * ونفس قيمة التكلفة التاريخية.
     */
    for (const item of items) {
      receiveStockAtCost(db, {
        variant_id: Number(item.variant_id),

        quantity: Number(item.quantity || 0),

        unit_cost: preservePrecision(Number(item.unit_cost || 0)),

        cost_value: preservePrecision(Number(item.line_total || 0)),

        created_by: actorId,

        reference_id: returnId,

        reference_type: 'purchase_return_cancel',

        notes: `عكس مخزون مرتجع شراء ملغي #${returnId}`,
      });
    }

    /*
     * لو استلمنا كاش من المورد
     * وقت المرتجع، نرجع له
     * نفس الكاش الحقيقي فقط.
     */
    if (cashRefundAmount > 0) {
      createCashMovement({
        type: 'purchase_return',

        direction: 'out',

        amount: cashRefundAmount,

        payment_method: refundAccount,

        reference_id: returnId,

        reference_type: 'purchase_return_cancel',

        notes: `عكس مرتجع شراء ملغي #${returnId}`,

        created_by: actorId,

        business_date: cancellationBusinessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    /*
     * نعيد الجزء الذي كان
     * قد خفّض مديونية الفاتورة.
     */
    const purchaseTotal = preservePrecision(
      Number(purchaseReturn.purchase_total_amount || 0),
    );

    const purchasePaid = preservePrecision(
      Number(purchaseReturn.purchase_paid_amount || 0),
    );

    const currentRemaining = preservePrecision(
      Number(purchaseReturn.purchase_remaining_amount || 0),
    );

    const maxRemaining = normalizePreciseZero(
      Math.max(0, preciseSubtract(purchaseTotal, purchasePaid)),
    );

    const newRemaining = normalizePreciseZero(
      Math.min(maxRemaining, preciseAdd(currentRemaining, debtReductionAmount)),
    );

    const newPaymentStatus = normalizePaymentStatus(
      purchaseTotal,

      purchasePaid,

      newRemaining,
    );

    db.prepare(
      `
        UPDATE purchase_invoices

        SET
          remaining_amount = ?,

          payment_status = ?

        WHERE id = ?
        `,
    ).run(
      newRemaining,

      newPaymentStatus,

      Number(purchaseReturn.purchase_id),
    );

    /*
     * أولًا نعلّم المرتجع ملغي.
     *
     * مهم جدًا:
     * rebuildSupplierBalance
     * بعدها لن يحسب الرصيد
     * الدائن الخاص بهذا المرتجع.
     */
    db.prepare(
      `
        UPDATE purchase_returns

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancelled_shift_id = ?,

          cancel_reason = ?

        WHERE id = ?
        `,
    ).run(
      actorId,

      openShift?.id ?? null,

      reason,

      returnId,
    );

    /*
     * إجمالي مشتريات المورد
     * يرجع بالقيمة الدقيقة.
     */
    db.prepare(
      `
        UPDATE suppliers

        SET
          total_purchased =
              IFNULL(
                total_purchased,
                0
              ) + ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
    ).run(
      totalAmount,

      Number(purchaseReturn.supplier_id),
    );

    /*
     * إعادة بناء الرصيد بعد
     * إلغاء المرتجع:
     *
     * ديون الفواتير
     * -
     * الأرصدة الدائنة النشطة.
     */
    const supplierBalance = rebuildSupplierBalance(
      db,

      Number(purchaseReturn.supplier_id),
    );

    return {
      ok: true,

      return_id: returnId,

      purchase_id: Number(purchaseReturn.purchase_id),

      supplier_id: Number(purchaseReturn.supplier_id),

      restored_total: totalAmount,

      restored_debt: debtReductionAmount,

      /*
       * الرصيد الدائن الذي
       * تم إلغاؤه.
       */
      reversed_credit: creditAmount,

      /*
       * الكاش الحقيقي الذي
       * خرج عند الإلغاء.
       */
      reversed_cash: cashRefundAmount,

      /*
       * فرق التسوية الذي لم
       * يعد فعالًا بعد الإلغاء.
       */
      reversed_rounding_adjustment: roundingAdjustment,

      supplier_balance: supplierBalance,

      items_count: items.length,

      cancelled_shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

export function updatePurchaseReturn(input: UpdatePurchaseReturnInput) {
  const db = getDb();

  const returnId = Number(input.return_id || 0);

  const actorId = Number(input.actor_id || 0);

  const reason = String(input.reason || '').trim();

  if (!returnId) {
    throw new Error('رقم مرتجع الشراء غير صحيح');
  }

  if (!actorId) {
    throw new Error('المستخدم غير صحيح');
  }

  if (!reason) {
    throw new Error('اكتب سبب تعديل مرتجع الشراء');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في المرتجع المعدل');
  }

  const existing = getPurchaseReturn(returnId) as any;

  if (existing.return?.cancelled_at) {
    throw new Error('مرتجع الشراء ملغي بالفعل');
  }

  const purchaseId = Number(existing.return?.purchase_id || 0);

  const tx = db.transaction(() => {
    const cancelled = cancelPurchaseReturn({
      return_id: returnId,

      reason: `تم تعديل مرتجع الشراء: ${reason}`,

      actor_id: actorId,
    });

    const created = createPurchaseReturn({
      purchase_id: purchaseId,

      notes: input.notes ?? null,

      refund_payment_method: input.refund_payment_method,

      refund_mode: input.refund_mode,

      cash_refund_amount: input.cash_refund_amount,

      settle_cash_refund: input.settle_cash_refund,

      actor_id: actorId,

      items: input.items,
    });

    db.prepare(
      `
      UPDATE purchase_returns

      SET replacement_return_id = ?

      WHERE id = ?
      `,
    ).run(created.return_id, returnId);

    return {
      ...created,

      replaced_return_id: returnId,

      cancellation_shift_id: cancelled.cancelled_shift_id ?? null,

      edited: true,
    };
  });

  return tx();
}

export function listPurchaseInvoices(input?: {
  search?: string;
  payment_filter?: 'all' | 'paid' | 'unpaid';
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const paymentFilter = input?.payment_filter ?? 'all';
  const dateFrom = input?.date_from?.trim() || '';
  const dateTo = input?.date_to?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [
    `
    IFNULL(
      pi.status,
      'active'
    ) <> 'opening_balance'
    `,
  ];
  const params: any[] = [];

  if (dateFrom) {
    where.push(`
    COALESCE(
      NULLIF(pi.business_date, ''),
      date(pi.created_at, 'localtime')
    ) >= ?
  `);

    params.push(dateFrom);
  }

  if (dateTo) {
    where.push(`
    COALESCE(
      NULLIF(pi.business_date, ''),
      date(pi.created_at, 'localtime')
    ) <= ?
  `);

    params.push(dateTo);
  }
  const invoiceNumberMatch = search.match(/^#\s*(\d+)$/);

  if (invoiceNumberMatch) {
    where.push(`pi.id = ?`);

    params.push(Number(invoiceNumberMatch[1]));
  } else if (search) {
    where.push(`
    (
      CAST(pi.id AS TEXT) LIKE ?
      OR s.name LIKE ?
      OR IFNULL(s.phone, '') LIKE ?
    )
  `);

    const q = `%${search}%`;
    params.push(q, q, q);
  }

  if (paymentFilter === 'paid') {
    where.push(`
    (
      IFNULL(pi.status, 'active') <> 'cancelled'

      AND IFNULL(
        pi.remaining_amount,
        0
      ) <= ${PRECISE_MONEY_EPSILON}
    )
  `);
  } else if (paymentFilter === 'unpaid') {
    where.push(`
    (
      IFNULL(pi.status, 'active') <> 'cancelled'

      AND IFNULL(
        pi.remaining_amount,
        0
      ) > ${PRECISE_MONEY_EPSILON}
    )
  `);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        pi.*,

        COALESCE(
          NULLIF(
            pi.exact_total_amount,
            0
          ),
          pi.total_amount,
          0
        ) AS effective_exact_total_amount,

            IFNULL(
              pi.rounding_adjustment,
              0
          ) AS effective_rounding_adjustment,

          COALESCE(
            NULLIF(
              pi.exact_total_amount,
              0
            ),
            pi.total_amount,
            0
        ) AS settlement_total_amount,

        IFNULL(
          pi.status,
          'active'
        ) AS status,

        s.name AS supplier_name,
        s.phone AS supplier_phone,
        COUNT(pii.id) AS items_count,
        IFNULL((
          SELECT SUM(pr.total_amount)
          FROM purchase_returns pr
          WHERE pr.purchase_id = pi.id
            AND pr.cancelled_at IS NULL
        ), 0) AS returned_amount
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      LEFT JOIN purchase_items pii ON pii.purchase_id = pi.id
      ${whereSql}
      GROUP BY pi.id
      ORDER BY pi.id DESC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
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

export function listPurchaseReturns(input?: {
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const dateFrom = input?.date_from?.trim() || '';
  const dateTo = input?.date_to?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [];
  const params: any[] = [];

  if (dateFrom) {
    where.push(`
      COALESCE(
        NULLIF(pr.business_date, ''),
        date(pr.created_at, 'localtime')
      ) >= ?
    `);

    params.push(dateFrom);
  }

  if (dateTo) {
    where.push(`
      COALESCE(
        NULLIF(pr.business_date, ''),
        date(pr.created_at, 'localtime')
      ) <= ?
    `);

    params.push(dateTo);
  }

  if (search) {
    where.push(`
      (
        CAST(pr.id AS TEXT) LIKE ?
        OR CAST(pr.purchase_id AS TEXT) LIKE ?
        OR s.name LIKE ?
        OR IFNULL(s.phone, '') LIKE ?
      )
    `);

    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        pr.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        COUNT(pri.id) AS items_count,

        CASE
          WHEN
            pr.cancelled_at IS NULL

            AND pr.id = (
              SELECT latest_return.id

              FROM purchase_returns latest_return

              WHERE
                latest_return.purchase_id = pr.purchase_id
                AND latest_return.cancelled_at IS NULL

              ORDER BY latest_return.id DESC

              LIMIT 1
            )

          THEN 1
          ELSE 0
        END AS is_latest_active_return
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
      LEFT JOIN purchase_return_items pri ON pri.return_id = pr.id
      ${whereSql}
      GROUP BY pr.id
      ORDER BY pr.id DESC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
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

export function getPurchaseInvoice(purchaseId: number) {
  const db = getDb();

  const purchase = db
    .prepare(
      `
      SELECT
        pi.*,

        COALESCE(
          NULLIF(
            pi.exact_total_amount,
            0
          ),
          pi.total_amount,
          0
        ) AS effective_exact_total_amount,

            IFNULL(
              pi.rounding_adjustment,
              0
          ) AS effective_rounding_adjustment,

          COALESCE(
            NULLIF(
              pi.exact_total_amount,
              0
            ),
            pi.total_amount,
            0
        ) AS settlement_total_amount,

        IFNULL(
          pi.status,
          'active'
        ) AS status,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        IFNULL((
          SELECT SUM(pr.total_amount)
          FROM purchase_returns pr
          WHERE pr.purchase_id = pi.id
            AND pr.cancelled_at IS NULL
        ), 0) AS returned_amount
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      WHERE pi.id = ?
      LIMIT 1
    `,
    )
    .get(Number(purchaseId));

  if (!purchase) {
    throw new Error('فاتورة الشراء غير موجودة');
  }

  const items = db
    .prepare(
      `
      SELECT
        pii.*,
        pv.buy_price AS current_buy_price,
        pv.sell_price AS sell_price,

        IFNULL((
          SELECT SUM(
            CASE
              WHEN sm.type = 'in'
              THEN sm.quantity

              WHEN sm.type = 'out'
              THEN -sm.quantity

              ELSE 0
            END
          )

          FROM stock_movements sm

          WHERE sm.variant_id = pii.variant_id
        ), 0) AS stock,
        IFNULL((
          SELECT SUM(pri.quantity)
          FROM purchase_return_items pri
          JOIN purchase_returns pr ON pr.id = pri.return_id
          WHERE pri.purchase_item_id = pii.id
            AND pr.cancelled_at IS NULL
        ), 0) AS returned_quantity,

        IFNULL((
          SELECT SUM(pri.line_total)

          FROM purchase_return_items pri

          JOIN purchase_returns pr
            ON pr.id = pri.return_id

          WHERE pri.purchase_item_id = pii.id
            AND pr.cancelled_at IS NULL
        ), 0) AS returned_value,

        MAX(
          pii.quantity - IFNULL((
            SELECT SUM(pri.quantity)
            FROM purchase_return_items pri
            JOIN purchase_returns pr ON pr.id = pri.return_id
            WHERE pri.purchase_item_id = pii.id
              AND pr.cancelled_at IS NULL
          ), 0),
          0
        ) AS returnable_quantity
      FROM purchase_items pii
      LEFT JOIN product_variants pv
        ON pv.id = pii.variant_id
      WHERE pii.purchase_id = ?
      ORDER BY pii.id ASC
    `,
    )
    .all(Number(purchaseId));

  const payments = db
    .prepare(
      `
      SELECT
        sp.*,

        b.cancelled_at AS batch_cancelled_at,
        b.cancel_reason AS batch_cancel_reason,
        b.replacement_batch_id

      FROM supplier_payments sp

      LEFT JOIN supplier_payment_batches b
        ON b.id = sp.batch_id

      WHERE sp.purchase_id = ?

      ORDER BY sp.id ASC
    `,
    )
    .all(Number(purchaseId));

  const returns = db
    .prepare(
      `
      SELECT *
      FROM purchase_returns
      WHERE purchase_id = ?
      ORDER BY id DESC
    `,
    )
    .all(Number(purchaseId));

  return {
    purchase,
    items,
    payments,
    returns,
  };
}

export function getPurchaseReturn(returnId: number) {
  const db = getDb();

  const purchaseReturn = db
    .prepare(
      `
      SELECT
        pr.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        pi.id AS purchase_number,
        pi.created_at AS purchase_created_at
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
      JOIN purchase_invoices pi ON pi.id = pr.purchase_id
      WHERE pr.id = ?
      LIMIT 1
    `,
    )
    .get(Number(returnId));

  if (!purchaseReturn) {
    throw new Error('مرتجع الشراء غير موجود');
  }

  const items = db
    .prepare(
      `
      SELECT *
      FROM purchase_return_items
      WHERE return_id = ?
      ORDER BY id ASC
    `,
    )
    .all(Number(returnId));

  return {
    return: purchaseReturn,
    items,
  };
}

export function recordSupplierPayment(input: {
  supplier_id: number;

  purchase_id?: number | null;

  /*
   * الكاش الحقيقي الخارج.
   */
  amount: number;

  /*
   * true =
   * المستخدم اختار صراحة
   * تسوية كامل الرصيد.
   */
  settle_full_balance?: boolean;

  payment_method?: string;

  notes?: string | null;

  actor_id?: number | null;
}) {
  const db = getDb();

  const supplierId = Number(input.supplier_id);

  const purchaseId = input.purchase_id ? Number(input.purchase_id) : null;

  const rawCashAmount = Number(input.amount ?? 0);

  if (!Number.isFinite(rawCashAmount) || rawCashAmount < 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  const cashAmount = roundMoney(rawCashAmount);

  const settleFullBalance = Boolean(input.settle_full_balance);

  /*
   * صفر مسموح فقط في تسوية
   * رصيد أقل من نصف جنيه.
   */
  if (!settleFullBalance && cashAmount <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  const actorId = Number(input.actor_id || 0);

  const paymentMethod = resolveCashAccount(input.payment_method || 'cash');

  const openShift =
    cashAmount > 0
      ? resolveFinancialOperationShift(
          actorId,

          [paymentMethod],

          'لا يمكن تسجيل دفعة مورد من درج المحل بدون شفت مفتوح',
        )
      : null;

  if (!supplierId) {
    throw new Error('Supplier ID is required');
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(
        `
        SELECT *

        FROM suppliers

        WHERE id = ?
          AND is_active = 1

        LIMIT 1
        `,
      )
      .get(supplierId) as any;

    if (!supplier) {
      throw new Error('المورد غير موجود');
    }

    /*
     * مصدر حقيقة مديونية المورد:
     * الفواتير المفتوحة نفسها،
     * وليس suppliers.balance
     * لأنه قد يحتوي بيانات قديمة
     * من سياسة التقريب السابقة.
     */
    const openPurchases = db
      .prepare(
        `
        SELECT *

        FROM purchase_invoices

        WHERE supplier_id = ?

          AND remaining_amount > ${PRECISE_MONEY_EPSILON}

          AND IFNULL(
            status,
            'active'
          ) != 'cancelled'

        ORDER BY id ASC
        `,
      )
      .all(supplierId) as any[];

    if (openPurchases.length === 0) {
      throw new Error('لا توجد مديونية مفتوحة على المورد');
    }

    let targetPurchases = openPurchases;

    if (purchaseId) {
      const purchase = openPurchases.find(
        (row) => Number(row.id) === purchaseId,
      );

      if (!purchase) {
        throw new Error('فاتورة الشراء غير موجودة أو مدفوعة بالكامل');
      }

      targetPurchases = [purchase];
    }

    const targetInvoiceOutstanding = preciseSum(
      targetPurchases.map((purchase) => Number(purchase.remaining_amount || 0)),
    );

    const supplierNetPayable = normalizePreciseZero(
      Math.max(0, calculateSupplierNetBalance(db, supplierId)),
    );

    const targetOutstanding = normalizePreciseZero(
      Math.min(targetInvoiceOutstanding, supplierNetPayable),
    );

    if (!hasPositivePreciseAmount(targetOutstanding)) {
      throw new Error('لا يوجد صافي مستحق للمورد بعد احتساب الرصيد الدائن');
    }

    let accountingAmount = 0;

    let roundingAdjustment = 0;

    if (settleFullBalance) {
      const settlement = resolveWholeMoneySettlement(
        cashAmount,
        targetOutstanding,
      );

      /*
       * رصيد أقل من 0.50:
       * أقرب جنيه = صفر.
       * نسمح بإقفاله كتسوية صريحة.
       */
      const zeroCashSettlement =
        cashAmount === 0 && roundMoney(targetOutstanding) === 0;

      if (!settlement.isFullSettlement && !zeroCashSettlement) {
        throw new Error(
          `لتسوية كامل الرصيد يجب أن يكون المبلغ النقدي ${roundMoney(
            targetOutstanding,
          )} ج.م`,
        );
      }

      accountingAmount = targetOutstanding;
      roundingAdjustment = preciseSubtract(cashAmount, accountingAmount);
    } else {
      if (exceedsPreciseAmount(cashAmount, targetOutstanding)) {
        throw new Error('قيمة الدفع أكبر من المديونية المحددة');
      }

      accountingAmount = preservePrecision(cashAmount);
    }

    if (!hasPositivePreciseAmount(accountingAmount)) {
      throw new Error('قيمة التسوية المحاسبية غير صحيحة');
    }

    const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

    const batchResult = db
      .prepare(
        `
        INSERT INTO supplier_payment_batches (
          supplier_id,

          purchase_id,

          amount,

          cash_amount,

          rounding_adjustment,

          settle_full_balance,

          payment_method,

          notes,

          created_by,

          business_date,

          shift_id
        )

        VALUES (
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        `,
      )
      .run(
        supplierId,

        purchaseId,

        accountingAmount,

        cashAmount,

        roundingAdjustment,

        settleFullBalance ? 1 : 0,

        paymentMethod,

        input.notes?.trim() || null,

        input.actor_id ?? null,

        businessDate,

        openShift?.id ?? null,
      );

    const paymentBatchId = Number(batchResult.lastInsertRowid);

    const insertPayment = db.prepare(
      `
        INSERT INTO supplier_payments (
          supplier_id,

          purchase_id,

          batch_id,

          amount,

          payment_method,

          notes
        )

        VALUES (
          ?, ?, ?, ?, ?, ?
        )
        `,
    );

    const updatePurchase = db.prepare(
      `
        UPDATE purchase_invoices

        SET
          paid_amount = ?,

          remaining_amount = ?,

          payment_status = ?

        WHERE id = ?
        `,
    );

    let remainingPayment = accountingAmount;

    let totalPaid = 0;

    const allocations: Array<{
      purchase_id: number | null;
      amount: number;
    }> = [];

    for (const purchase of targetPurchases) {
      if (!hasPositivePreciseAmount(remainingPayment)) {
        break;
      }

      const purchaseRemaining = normalizePreciseZero(
        Number(purchase.remaining_amount || 0),
      );

      if (!hasPositivePreciseAmount(purchaseRemaining)) {
        continue;
      }

      const payNow = normalizePreciseZero(
        Math.min(remainingPayment, purchaseRemaining),
      );

      if (!hasPositivePreciseAmount(payNow)) {
        continue;
      }

      const newPaid = normalizePreciseZero(
        preciseAdd(Number(purchase.paid_amount || 0), payNow),
      );

      const newRemaining = normalizePreciseZero(
        Math.max(0, preciseSubtract(purchaseRemaining, payNow)),
      );

      const newStatus = normalizePaymentStatus(
        Number(purchase.total_amount || 0),

        newPaid,

        newRemaining,
      );

      updatePurchase.run(
        newPaid,

        newRemaining,

        newStatus,

        Number(purchase.id),
      );

      insertPayment.run(
        supplierId,

        Number(purchase.id),

        paymentBatchId,

        payNow,

        paymentMethod,

        input.notes?.trim() ||
          (purchaseId
            ? `دفعة على فاتورة شراء رقم ${purchase.id}`
            : `دفعة عامة موزعة على فاتورة شراء رقم ${purchase.id}`),
      );

      totalPaid = preciseAdd(totalPaid, payNow);

      remainingPayment = normalizePreciseZero(
        preciseSubtract(remainingPayment, payNow),
      );

      allocations.push({
        purchase_id: Number(purchase.id),

        amount: payNow,
      });
    }

    if (hasPositivePreciseAmount(remainingPayment)) {
      throw new Error('تعذر توزيع كامل قيمة الدفعة على فواتير المورد');
    }

    if (!samePreciseAmount(totalPaid, accountingAmount)) {
      throw new Error('قيمة توزيعات دفعة المورد غير متطابقة');
    }

    const supplierBalance = rebuildSupplierBalance(db, supplierId);

    db.prepare(
      `
      UPDATE suppliers

      SET
        balance = ?,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(
      supplierBalance,

      supplierId,
    );

    /*
     * الخزنة تتأثر بالكاش الحقيقي فقط.
     */
    if (cashAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',

        direction: 'out',

        amount: cashAmount,

        payment_method: paymentMethod,

        reference_id: paymentBatchId,

        reference_type: 'supplier_payment',

        notes: input.notes?.trim() || 'دفعة للمورد',

        created_by: input.actor_id ?? null,

        business_date: businessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    return {
      ok: true,

      supplier_id: supplierId,

      payment_batch_id: paymentBatchId,

      /*
       * المسدد من الدين.
       */
      paid_amount: totalPaid,

      /*
       * الخارج الحقيقي
       * من الحساب المالي.
       */
      cash_amount: cashAmount,

      /*
       * موجب = دفعنا زيادة
       * سالب = دفعنا أقل.
       */
      rounding_adjustment: roundingAdjustment,

      settle_full_balance: settleFullBalance,

      remaining_supplier_balance: supplierBalance,

      allocations,

      shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

function getSupplierPaymentBatchMutationContext(batchId: number) {
  const db = getDb();

  if (!batchId) {
    throw new Error('رقم دفعة المورد غير صحيح');
  }

  const batch = db
    .prepare(
      `
      SELECT
        b.*,

        COALESCE(
          NULLIF(b.business_date, ''),
          date(b.created_at, 'localtime')
        ) AS accounting_date

      FROM supplier_payment_batches b

      WHERE b.id = ?

      LIMIT 1
      `,
    )
    .get(batchId) as any;

  if (!batch) {
    throw new Error('دفعة المورد غير موجودة');
  }

  if (batch.cancelled_at) {
    throw new Error('دفعة المورد ملغاة بالفعل');
  }

  const latestBatch = db
    .prepare(
      `
      SELECT id

      FROM supplier_payment_batches

      WHERE supplier_id = ?
        AND cancelled_at IS NULL

      ORDER BY
        datetime(created_at) DESC,
        id DESC

      LIMIT 1
      `,
    )
    .get(Number(batch.supplier_id)) as
    | {
        id: number;
      }
    | undefined;

  if (Number(latestBatch?.id || 0) !== batchId) {
    throw new Error('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد');
  }

  const allocations = db
    .prepare(
      `
      SELECT
        sp.id,
        sp.purchase_id,
        sp.amount,

        pi.total_amount,
        pi.paid_amount,
        pi.remaining_amount,
        IFNULL(
          pi.status,
          'active'
        ) AS purchase_status

      FROM supplier_payments sp

      JOIN purchase_invoices pi
        ON pi.id = sp.purchase_id

      WHERE sp.batch_id = ?

      ORDER BY sp.id ASC
      `,
    )
    .all(batchId) as any[];

  if (allocations.length === 0) {
    throw new Error('لا توجد توزيعات مرتبطة بدفعة المورد');
  }

  const latestAllocationId = Math.max(
    ...allocations.map((allocation) => Number(allocation.id || 0)),
  );

  const newerPayment = db
    .prepare(
      `
    SELECT sp.id

    FROM supplier_payments sp

    LEFT JOIN supplier_payment_batches b
      ON b.id = sp.batch_id

    WHERE sp.supplier_id = ?

      AND sp.id > ?

      AND (
        sp.batch_id IS NULL
        OR b.cancelled_at IS NULL
      )

    LIMIT 1
    `,
    )
    .get(Number(batch.supplier_id), latestAllocationId);

  if (newerPayment) {
    throw new Error('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد');
  }

  if (
    allocations.some((allocation) => allocation.purchase_status === 'cancelled')
  ) {
    throw new Error(
      'لا يمكن تعديل أو إلغاء الدفعة لأن إحدى فواتير الشراء المرتبطة بها ملغاة',
    );
  }

  const laterReturn = db
    .prepare(
      `
      SELECT pr.id

      FROM purchase_returns pr

      WHERE pr.purchase_id IN (
        SELECT purchase_id

        FROM supplier_payments

        WHERE batch_id = ?
      )

        AND datetime(pr.created_at) >=
            datetime(?)

      LIMIT 1
      `,
    )
    .get(batchId, batch.created_at);

  if (laterReturn) {
    throw new Error(
      'لا يمكن تعديل أو إلغاء الدفعة لوجود مرتجع شراء أحدث مرتبط بها',
    );
  }

  const allocationTotal = preciseSum(
    allocations.map((allocation) => Number(allocation.amount || 0)),
  );

  const batchAmount = preservePrecision(Number(batch.amount || 0));

  if (Math.abs(allocationTotal - batchAmount) > 0.001) {
    throw new Error('بيانات دفعة المورد غير متطابقة');
  }

  const batchCashAmount = preservePrecision(
    Number(batch.cash_amount ?? batch.amount ?? 0),
  );

  const batchRoundingAdjustment =
    batch.rounding_adjustment == null
      ? preciseSubtract(batchCashAmount, batchAmount)
      : preservePrecision(Number(batch.rounding_adjustment));

  const expectedRoundingAdjustment = preciseSubtract(
    batchCashAmount,
    batchAmount,
  );

  if (Math.abs(batchRoundingAdjustment - expectedRoundingAdjustment) > 0.001) {
    throw new Error('فرق تسوية دفعة المورد غير متطابق');
  }

  const cashMovement = db
    .prepare(
      `
      SELECT *

      FROM cash_movements

      WHERE type =
        'supplier_payment'

        AND direction = 'out'

        AND reference_type =
          'supplier_payment'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get(batchId) as any;

  if (batchCashAmount > 0) {
    if (!cashMovement) {
      throw new Error('حركة حساب الدفع الخاصة بدفعة المورد غير موجودة');
    }

    if (cashMovement.cancelled_at) {
      throw new Error('حركة حساب الدفع الخاصة بالدفعة ملغاة بالفعل');
    }

    if (
      Math.abs(
        preciseSubtract(
          preservePrecision(Number(cashMovement.amount || 0)),
          batchCashAmount,
        ),
      ) > 0.001
    ) {
      throw new Error(
        'قيمة حركة حساب الدفع لا تطابق الكاش الفعلي لدفعة المورد',
      );
    }
  } else if (
    cashMovement &&
    Math.abs(Number(cashMovement.amount || 0)) > 0.001
  ) {
    throw new Error(
      'دفعة المورد المسواة بدون كاش مرتبطة بحركة مالية غير صحيحة',
    );
  }

  return {
    db,

    batch,

    allocations,

    /*
     * الدين المحاسبي الذي تم إقفاله.
     */
    allocationTotal,

    /*
     * الكاش الذي خرج بالفعل.
     */
    batchCashAmount,

    /*
     * cash - accounting.
     */
    batchRoundingAdjustment,

    cashMovement,
  };
}

export function getSupplierPaymentBatchAccess(
  batchId: number,
  actorId?: number | null,
) {
  const context = getSupplierPaymentBatchMutationContext(Number(batchId));

  const batch = context.batch;

  const row = context.db
    .prepare(
      `
      SELECT
        CASE
          WHEN ? = ?
            AND datetime(?)
              BETWEEN datetime(
                'now',
                '-24 hours'
              )
              AND datetime('now')
          THEN 0

          ELSE 1
        END AS requires_admin_password
      `,
    )
    .get(
      Number(batch.created_by || 0),
      Number(actorId || 0),
      batch.created_at,
    ) as {
    requires_admin_password: number;
  };

  return {
    batch_id: Number(batch.id),

    supplier_id: Number(batch.supplier_id),

    created_by: batch.created_by == null ? null : Number(batch.created_by),

    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  };
}

export function cancelSupplierPaymentBatch(input: {
  batch_id: number;

  reason?: string | null;

  actor_id?: number | null;
}) {
  const batchId = Number(input.batch_id || 0);

  const context = getSupplierPaymentBatchMutationContext(batchId);

  const {
    db,

    batch,

    allocations,

    allocationTotal,

    batchCashAmount,

    batchRoundingAdjustment,

    cashMovement,
  } = context;

  const actorId = Number(input.actor_id || 0);

  const paymentMethod = resolveCashAccount(
    cashMovement?.payment_method || batch.payment_method || 'cash',
  );

  /*
   * لو التسوية تمت بدون خروج كاش
   * أصلًا، مفيش داعي نطلب شفت.
   */
  const openShift =
    batchCashAmount > 0
      ? resolveFinancialOperationShift(
          actorId,

          [paymentMethod],

          'لا يمكن إلغاء دفعة مورد تؤثر على درج المحل بدون شفت مفتوح',
        )
      : null;

  const cancellationBusinessDate = resolveFinancialBusinessDate(
    openShift?.id ?? null,
  );

  const reason = String(input.reason || '').trim() || 'إلغاء دفعة مورد';

  const tx = db.transaction(() => {
    /*
     * نرجع المبلغ المحاسبي
     * لكل فاتورة بالقرش.
     */
    for (const allocation of allocations) {
      const amount = preservePrecision(Number(allocation.amount || 0));

      const nextPaid = normalizePreciseZero(
        Math.max(
          0,
          preciseSubtract(Number(allocation.paid_amount || 0), amount),
        ),
      );

      const nextRemaining = normalizePreciseZero(
        Math.min(
          Number(allocation.total_amount || 0),

          Math.max(
            0,
            preciseAdd(Number(allocation.remaining_amount || 0), amount),
          ),
        ),
      );

      const nextStatus = normalizePaymentStatus(
        Number(allocation.total_amount || 0),

        nextPaid,

        nextRemaining,
      );

      db.prepare(
        `
          UPDATE purchase_invoices

          SET
            paid_amount = ?,

            remaining_amount = ?,

            payment_status = ?

          WHERE id = ?
          `,
      ).run(
        nextPaid,

        nextRemaining,

        nextStatus,

        Number(allocation.purchase_id),
      );
    }

    const supplierBalance = rebuildSupplierBalance(
      db,
      Number(batch.supplier_id),
    );

    db.prepare(
      `
        UPDATE supplier_payment_batches

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancelled_shift_id = ?,

          cancel_reason = ?

        WHERE id = ?
        `,
    ).run(
      actorId,

      openShift?.id ?? null,

      reason,

      batchId,
    );

    /*
     * نعكس الكاش الحقيقي فقط.
     *
     * مثال:
     * الدين المقفول = 100.15
     * الكاش = 100
     *
     * نرجع للخزنة 100 فقط.
     */
    if (batchCashAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',

        direction: 'in',

        amount: batchCashAmount,

        payment_method: paymentMethod,

        reference_id: batchId,

        reference_type: 'supplier_payment_cancel',

        notes: `عكس دفعة مورد ملغاة #${batchId}`,

        created_by: actorId,

        business_date: cancellationBusinessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    return {
      success: true,

      batch_id: batchId,

      supplier_id: Number(batch.supplier_id),

      /*
       * الدين الذي أعيد.
       */
      cancelled_amount: allocationTotal,

      /*
       * الكاش الذي عاد للحساب.
       */
      cancelled_cash_amount: batchCashAmount,

      /*
       * فرق التسوية الذي تم إلغاؤه.
       */
      cancelled_rounding_adjustment: batchRoundingAdjustment,

      remaining_supplier_balance: supplierBalance,

      cancelled_shift_id: openShift?.id ?? null,

      allocations: allocations.map((allocation) => ({
        purchase_id: Number(allocation.purchase_id),

        amount: preservePrecision(Number(allocation.amount || 0)),
      })),
    };
  });

  return tx();
}

export function updateSupplierPaymentBatch(input: {
  batch_id: number;

  /*
   * الكاش الحقيقي الجديد.
   */
  amount: number;

  settle_full_balance?: boolean;

  payment_method?: string;

  notes?: string | null;

  actor_id?: number | null;
}) {
  const batchId = Number(input.batch_id || 0);

  if (!batchId) {
    throw new Error('رقم دفعة المورد غير صحيح');
  }

  const rawCashAmount = Number(input.amount ?? 0);

  if (!Number.isFinite(rawCashAmount) || rawCashAmount < 0) {
    throw new Error('مبلغ الدفعة المعدل غير صحيح');
  }

  const cashAmount = roundMoney(rawCashAmount);

  const settleFullBalance = Boolean(input.settle_full_balance);

  if (!settleFullBalance && cashAmount <= 0) {
    throw new Error('مبلغ الدفعة المعدل غير صحيح');
  }

  const context = getSupplierPaymentBatchMutationContext(batchId);

  const {
    db,

    batch,

    allocations,

    allocationTotal: oldAccountingAmount,

    batchCashAmount: oldCashAmount,

    cashMovement,
  } = context;

  const supplierId = Number(batch.supplier_id);

  const specificPurchaseId = Number(batch.purchase_id || 0);

  const oldPaymentMethod = resolveCashAccount(
    cashMovement?.payment_method || batch.payment_method || 'cash',
  );

  const newPaymentMethod = resolveCashAccount(
    input.payment_method || batch.payment_method || 'cash',
  );

  const actorId = Number(input.actor_id || 0);

  /*
   * نحتاج شفت فقط لو فيه
   * كاش قديم سيتم عكسه
   * أو كاش جديد سيتم دفعه.
   */
  const openShift =
    oldCashAmount > 0 || cashAmount > 0
      ? resolveFinancialOperationShift(
          actorId,

          Array.from(new Set([oldPaymentMethod, newPaymentMethod])),

          'لا يمكن تعديل دفعة مورد تؤثر على درج المحل بدون شفت مفتوح',
        )
      : null;

  const correctionBusinessDate = resolveFinancialBusinessDate(
    openShift?.id ?? null,
  );

  const newNotes =
    input.notes === undefined
      ? (batch.notes ?? null)
      : input.notes?.trim() || null;

  const tx = db.transaction(() => {
    for (const allocation of allocations) {
      const amount = preservePrecision(Number(allocation.amount || 0));

      const nextPaid = normalizePreciseZero(
        Math.max(
          0,
          preciseSubtract(Number(allocation.paid_amount || 0), amount),
        ),
      );

      const nextRemaining = normalizePreciseZero(
        Math.min(
          Number(allocation.total_amount || 0),

          Math.max(
            0,
            preciseAdd(Number(allocation.remaining_amount || 0), amount),
          ),
        ),
      );

      const nextStatus = normalizePaymentStatus(
        Number(allocation.total_amount || 0),

        nextPaid,

        nextRemaining,
      );

      db.prepare(
        `
          UPDATE purchase_invoices

          SET
            paid_amount = ?,

            remaining_amount = ?,

            payment_status = ?

          WHERE id = ?
          `,
      ).run(
        nextPaid,

        nextRemaining,

        nextStatus,

        Number(allocation.purchase_id),
      );
    }

    /*
     * بعد عكس القديمة،
     * نحدد الفواتير التي يمكن
     * أن تستقبل الدفعة الجديدة.
     */
    let targetPurchases = db
      .prepare(
        `
            SELECT *

            FROM purchase_invoices

            WHERE supplier_id = ?

              AND remaining_amount > ${PRECISE_MONEY_EPSILON}

              AND IFNULL(
                status,
                'active'
              ) != 'cancelled'

            ORDER BY id ASC
            `,
      )
      .all(supplierId) as any[];

    if (specificPurchaseId) {
      const targetPurchase = targetPurchases.find(
        (purchase) => Number(purchase.id) === specificPurchaseId,
      );

      if (!targetPurchase) {
        throw new Error('فاتورة الشراء المرتبطة بالدفعة غير موجودة');
      }

      targetPurchases = [targetPurchase];
    }

    const targetInvoiceOutstanding = preciseSum(
      targetPurchases.map((purchase) => Number(purchase.remaining_amount || 0)),
    );

    const supplierNetPayable = preservePrecision(
      Math.max(
        0,

        calculateSupplierNetBalance(db, supplierId),
      ),
    );

    const targetOutstanding = normalizePreciseZero(
      Math.min(targetInvoiceOutstanding, supplierNetPayable),
    );

    if (!hasPositivePreciseAmount(targetOutstanding)) {
      throw new Error('لا يوجد صافي مستحق للمورد بعد احتساب الرصيد الدائن');
    }

    let accountingAmount = 0;

    let roundingAdjustment = 0;

    if (settleFullBalance) {
      const settlement = resolveWholeMoneySettlement(
        cashAmount,
        targetOutstanding,
      );

      const zeroCashSettlement =
        cashAmount === 0 && roundMoney(targetOutstanding) === 0;

      if (!settlement.isFullSettlement && !zeroCashSettlement) {
        throw new Error(
          `لتسوية كامل الرصيد يجب أن يكون المبلغ النقدي ${roundMoney(
            targetOutstanding,
          )} ج.م`,
        );
      }

      accountingAmount = targetOutstanding;

      roundingAdjustment = preciseSubtract(cashAmount, accountingAmount);
    } else {
      if (exceedsPreciseAmount(cashAmount, targetOutstanding)) {
        throw new Error(
          `مبلغ الدفعة المعدل أكبر من المديونية المتاحة وهي ${truncateForDisplay(
            targetOutstanding,
          )} ج.م`,
        );
      }

      accountingAmount = preservePrecision(cashAmount);
    }

    if (!hasPositivePreciseAmount(accountingAmount)) {
      throw new Error('قيمة التسوية المحاسبية غير صحيحة');
    }

    /*
     * إنشاء Batch جديد بدل تعديل
     * القديم حفاظًا على Audit Trail.
     */
    const newBatchResult = db
      .prepare(
        `
            INSERT INTO supplier_payment_batches (
              supplier_id,

              purchase_id,

              amount,

              cash_amount,

              rounding_adjustment,

              settle_full_balance,

              payment_method,

              notes,

              created_by,

              business_date,

              shift_id,

              created_at
            )

            VALUES (
              ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?
            )
            `,
      )
      .run(
        supplierId,

        batch.purchase_id ?? null,

        accountingAmount,

        cashAmount,

        roundingAdjustment,

        settleFullBalance ? 1 : 0,

        newPaymentMethod,

        newNotes,

        batch.created_by ?? null,

        correctionBusinessDate,

        openShift?.id ?? null,

        batch.created_at,
      );

    const newBatchId = Number(newBatchResult.lastInsertRowid);

    /*
     * القديمة أصبحت مستبدلة.
     */
    db.prepare(
      `
        UPDATE supplier_payment_batches

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancelled_shift_id = ?,

          cancel_reason =
            'تم تعديل دفعة المورد',

          replacement_batch_id = ?

        WHERE id = ?
        `,
    ).run(
      actorId,

      openShift?.id ?? null,

      newBatchId,

      batchId,
    );

    /*
     * نعكس الكاش الحقيقي
     * للدفعة القديمة فقط.
     */
    if (oldCashAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',

        direction: 'in',

        amount: oldCashAmount,

        payment_method: oldPaymentMethod,

        reference_id: batchId,

        reference_type: 'supplier_payment_update_reverse',

        notes: `عكس دفعة مورد قديمة بسبب التعديل #${batchId}`,

        created_by: actorId,

        business_date: correctionBusinessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    const insertPayment = db.prepare(
      `
          INSERT INTO supplier_payments (
            supplier_id,

            purchase_id,

            batch_id,

            amount,

            payment_method,

            notes
          )

          VALUES (
            ?, ?, ?, ?, ?, ?
          )
          `,
    );

    const updatePurchase = db.prepare(
      `
          UPDATE purchase_invoices

          SET
            paid_amount = ?,

            remaining_amount = ?,

            payment_status = ?

          WHERE id = ?
          `,
    );

    let remainingPayment = accountingAmount;

    let totalPaid = 0;

    const newAllocations: Array<{
      purchase_id: number;

      amount: number;
    }> = [];

    for (const purchase of targetPurchases) {
      if (!hasPositivePreciseAmount(remainingPayment)) {
        break;
      }

      const purchaseRemaining = normalizePreciseZero(
        Number(purchase.remaining_amount || 0),
      );

      if (!hasPositivePreciseAmount(purchaseRemaining)) {
        continue;
      }

      const payNow = normalizePreciseZero(
        Math.min(remainingPayment, purchaseRemaining),
      );

      if (!hasPositivePreciseAmount(payNow)) {
        continue;
      }

      const newPaid = normalizePreciseZero(
        preciseAdd(Number(purchase.paid_amount || 0), payNow),
      );

      const newRemaining = normalizePreciseZero(
        Math.max(0, preciseSubtract(purchaseRemaining, payNow)),
      );

      const newStatus = normalizePaymentStatus(
        Number(purchase.total_amount || 0),

        newPaid,

        newRemaining,
      );

      updatePurchase.run(
        newPaid,

        newRemaining,

        newStatus,

        Number(purchase.id),
      );

      insertPayment.run(
        supplierId,

        Number(purchase.id),

        newBatchId,

        payNow,

        newPaymentMethod,

        newNotes ||
          (specificPurchaseId
            ? `دفعة مورد معدلة على فاتورة شراء رقم ${purchase.id}`
            : `دفعة مورد معدلة موزعة على فاتورة شراء رقم ${purchase.id}`),
      );

      totalPaid = preciseAdd(totalPaid, payNow);

      remainingPayment = normalizePreciseZero(
        preciseSubtract(remainingPayment, payNow),
      );

      newAllocations.push({
        purchase_id: Number(purchase.id),

        amount: payNow,
      });
    }

    if (hasPositivePreciseAmount(remainingPayment)) {
      throw new Error('تعذر توزيع كامل مبلغ الدفعة المعدلة');
    }

    if (!samePreciseAmount(totalPaid, accountingAmount)) {
      throw new Error('قيمة توزيعات دفعة المورد المعدلة غير متطابقة');
    }

    const supplierBalance = rebuildSupplierBalance(db, supplierId);

    db.prepare(
      `
        UPDATE suppliers

        SET
          balance = ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
    ).run(
      supplierBalance,

      supplierId,
    );

    /*
     * تسجيل الكاش الجديد
     * الفعلي فقط.
     */
    if (cashAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',

        direction: 'out',

        amount: cashAmount,

        payment_method: newPaymentMethod,

        reference_id: newBatchId,

        reference_type: 'supplier_payment',

        notes: newNotes || 'دفعة مورد معدلة',

        created_by: actorId,

        business_date: correctionBusinessDate,

        shift_id: openShift?.id ?? null,
      });
    }

    return {
      success: true,

      replaced_batch_id: batchId,

      batch_id: newBatchId,

      supplier_id: supplierId,

      /*
       * قيم محاسبية.
       */
      old_amount: oldAccountingAmount,

      new_amount: totalPaid,

      /*
       * الكاش الحقيقي.
       */
      old_cash_amount: oldCashAmount,

      new_cash_amount: cashAmount,

      new_rounding_adjustment: roundingAdjustment,

      settle_full_balance: settleFullBalance,

      remaining_supplier_balance: supplierBalance,

      payment_method: newPaymentMethod,

      allocations: newAllocations,

      shift_id: openShift?.id ?? null,
    };
  });

  return tx();
}

export function getSupplierStatement(
  supplierId: number,
  actorId?: number | null,
) {
  const db = getDb();
  const id = Number(supplierId);

  if (!id) {
    throw new Error('Supplier ID is required');
  }

  const supplier = db
    .prepare(
      `
      SELECT *

      FROM suppliers

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(id) as any;

  if (!supplier) {
    throw new Error('المورد غير موجود');
  }

  const purchases = db
    .prepare(
      `
      SELECT *

      FROM purchase_invoices

      WHERE supplier_id = ?

        AND IFNULL(
          status,
          'active'
        ) != 'cancelled'

      ORDER BY
        created_at DESC,
        id DESC
      `,
    )
    .all(id) as any[];

  const payments = db
    .prepare(
      `
      SELECT
        sp.*,

        b.purchase_id
          AS batch_purchase_id,

        b.amount
          AS batch_amount,

        b.cash_amount
          AS batch_cash_amount,

        b.rounding_adjustment
          AS batch_rounding_adjustment,

        b.settle_full_balance
          AS batch_settle_full_balance,

        b.payment_method
          AS batch_payment_method,

        b.notes
          AS batch_notes,

        b.created_by
          AS batch_created_by,

        b.created_at
          AS batch_created_at,

        b.cancelled_at
          AS batch_cancelled_at,

        b.cancelled_by
          AS batch_cancelled_by,

        b.cancel_reason
          AS batch_cancel_reason,

        b.replacement_batch_id,

        CASE
          WHEN b.id IS NULL
          THEN 0

          WHEN b.created_by = ?

            AND datetime(
              b.created_at
            )
            BETWEEN datetime(
              'now',
              '-24 hours'
            )
            AND datetime('now')

          THEN 0

          ELSE 1
        END
          AS batch_requires_admin_password,

        CASE
          WHEN b.id IS NOT NULL
            AND b.cancelled_at IS NULL

            AND NOT EXISTS (
              SELECT 1

              FROM supplier_payments newer

              LEFT JOIN
                supplier_payment_batches
                newer_batch
                ON newer_batch.id =
                   newer.batch_id

              WHERE newer.supplier_id =
                    sp.supplier_id

                AND newer.id > (
                  SELECT IFNULL(
                    MAX(current_sp.id),
                    0
                  )

                  FROM supplier_payments
                    current_sp

                  WHERE
                    current_sp.batch_id =
                    b.id
                )

                AND (
                  newer.batch_id IS NULL

                  OR
                  newer_batch.cancelled_at
                    IS NULL
                )
            )

            AND NOT EXISTS (
              SELECT 1

              FROM purchase_returns newer_return

              WHERE newer_return.purchase_id IN (
                SELECT current_payment.purchase_id

                FROM supplier_payments current_payment

                WHERE current_payment.batch_id = b.id
              )

                AND datetime(newer_return.created_at) >=
                    datetime(b.created_at)
            )

          THEN 1

          ELSE 0
        END
          AS batch_is_latest_mutable

      FROM supplier_payments sp

      LEFT JOIN
        supplier_payment_batches b
        ON b.id = sp.batch_id

      LEFT JOIN
        purchase_invoices pi
        ON pi.id = sp.purchase_id

      WHERE sp.supplier_id = ?

        AND (
          sp.purchase_id IS NULL

          OR IFNULL(
            pi.status,
            'active'
          ) != 'cancelled'
        )

      ORDER BY
        sp.created_at DESC,
        sp.id DESC
      `,
    )
    .all(Number(actorId || 0), id) as any[];

  const returns = db
    .prepare(
      `
      SELECT *

      FROM purchase_returns

      WHERE supplier_id = ?

      ORDER BY
        created_at DESC,
        id DESC
      `,
    )
    .all(id) as any[];

  const batchPayments = new Map<number, any[]>();

  const standalonePayments: any[] = [];

  for (const payment of payments) {
    const batchId = Number(payment.batch_id || 0);

    if (!batchId) {
      standalonePayments.push(payment);

      continue;
    }

    const current = batchPayments.get(batchId) || [];

    current.push(payment);

    batchPayments.set(batchId, current);
  }

  const batchPaymentEntries = Array.from(batchPayments.entries()).map(
    ([batchId, rows]) => {
      const first = rows[0];

      const cancelled = Boolean(first.batch_cancelled_at);

      const replaced = Boolean(first.replacement_batch_id);

      const batchPurchaseId = Number(first.batch_purchase_id || 0);

      const allocations = rows.map((row) => ({
        purchase_id: Number(row.purchase_id),

        amount: preservePrecision(row.amount),
      }));

      const totalAmount =
        first.batch_amount != null
          ? preservePrecision(Number(first.batch_amount))
          : preciseSum(allocations.map((item) => item.amount));

      const cashAmount = preservePrecision(
        Number(first.batch_cash_amount ?? totalAmount),
      );

      const roundingAdjustment =
        first.batch_rounding_adjustment != null
          ? preservePrecision(Number(first.batch_rounding_adjustment))
          : preciseSubtract(cashAmount, totalAmount);

      const allocationsText = allocations
        .map((item) => `#${item.purchase_id}: ${item.amount} ج.م`)
        .join('، ');

      return {
        id: `payment-batch-${batchId}`,

        type: 'payment',

        title: replaced
          ? 'دفعة مورد - تم تعديلها'
          : cancelled
            ? 'دفعة مورد - ملغاة'
            : batchPurchaseId
              ? `دفعة مورد على فاتورة #${batchPurchaseId}`
              : 'دفعة مورد',

        debit: 0,

        credit: cancelled ? 0 : totalAmount,
        /*
         * credit =
         * مقدار الدين المحاسبي المسدد.
         */
        cash_amount: cashAmount,

        rounding_adjustment: roundingAdjustment,

        settle_full_balance: Boolean(first.batch_settle_full_balance),
        purchase_id: batchPurchaseId || null,

        batch_id: batchId,

        batch_created_by:
          first.batch_created_by == null
            ? null
            : Number(first.batch_created_by),

        requires_admin_password: Boolean(first.batch_requires_admin_password),

        is_latest_mutable_batch: Boolean(first.batch_is_latest_mutable),

        replacement_batch_id: first.replacement_batch_id ?? null,

        allocations,

        allocations_text: allocationsText,

        payment_method: first.batch_payment_method || first.payment_method,

        notes: cancelled
          ? first.batch_cancel_reason || 'دفعة ملغاة'
          : first.batch_notes || first.notes,

        cancelled_at: first.batch_cancelled_at ?? null,

        created_at: first.batch_created_at || first.created_at,
      };
    },
  );

  const standalonePaymentEntries = standalonePayments.map((payment) => {
    const initialPayment = String(payment.notes || '').startsWith(
      'دفعة عند إنشاء فاتورة شراء رقم ',
    );

    return {
      id: `payment-${payment.id}`,

      type: 'payment',

      title: initialPayment
        ? payment.purchase_id
          ? `دفعة وقت إنشاء فاتورة #${payment.purchase_id}`
          : 'دفعة وقت إنشاء فاتورة'
        : payment.purchase_id
          ? `دفعة على فاتورة #${payment.purchase_id}`
          : 'دفعة مورد',

      debit: 0,

      credit: Number(payment.amount || 0),

      purchase_id: payment.purchase_id,

      batch_id: null,

      payment_method: payment.payment_method,

      notes: payment.notes,

      cancelled_at: null,

      created_at: payment.created_at,
    };
  });

  const paymentEntries = [...batchPaymentEntries, ...standalonePaymentEntries];

  const entries = [
    ...purchases.map((purchase) => ({
      id: `purchase-${purchase.id}`,

      type: 'purchase',

      title:
        purchase.status === 'opening_balance'
          ? `رصيد افتتاحي مستحق #${purchase.id}`
          : `فاتورة شراء #${purchase.id}`,

      debit: Number(purchase.total_amount || 0),

      credit: 0,

      purchase_id: purchase.id,

      payment_status: purchase.payment_status,
      due_date: purchase.due_date ?? null,
      notes: purchase.notes,

      created_at: purchase.created_at,
    })),

    ...returns.map((purchaseReturn) => {
      const cancelled = Boolean(purchaseReturn.cancelled_at);

      const replaced = Boolean(purchaseReturn.replacement_return_id);

      const supplierAccountCredit = preciseAdd(
        Number(purchaseReturn.debt_reduction_amount || 0),
        Number(purchaseReturn.credit_amount || 0),
      );

      return {
        id: `purchase-return-${purchaseReturn.id}`,

        type: 'purchase_return',

        title: replaced
          ? `مرتجع شراء #${purchaseReturn.id} - تم تعديله`
          : cancelled
            ? `مرتجع شراء #${purchaseReturn.id} - ملغي`
            : `مرتجع شراء #${purchaseReturn.id} على فاتورة #${purchaseReturn.purchase_id}`,

        debit: 0,

        credit: cancelled ? 0 : supplierAccountCredit,

        purchase_id: purchaseReturn.purchase_id,

        return_id: purchaseReturn.id,
        cash_amount: cancelled
          ? 0
          : preservePrecision(Number(purchaseReturn.cash_refund_amount || 0)),

        rounding_adjustment: cancelled
          ? 0
          : preservePrecision(Number(purchaseReturn.rounding_adjustment || 0)),

        settle_cash_refund: Boolean(purchaseReturn.settle_cash_refund),

        payment_method: purchaseReturn.refund_payment_method || null,
        replacement_return_id: purchaseReturn.replacement_return_id ?? null,

        cancelled_at: purchaseReturn.cancelled_at ?? null,

        notes: cancelled
          ? purchaseReturn.cancel_reason ||
            purchaseReturn.notes ||
            'مرتجع شراء ملغي'
          : purchaseReturn.notes,

        created_at: purchaseReturn.created_at,
      };
    }),

    ...paymentEntries,
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const totalPaid = preciseSum(
    payments
      .filter((payment) => !(payment.batch_id && payment.batch_cancelled_at))
      .map((payment) => Number(payment.amount || 0)),
  );

  const aging = getSupplierAgingSummary(id);

  const due = getSupplierDueSummary(id);

  return {
    supplier,
    purchases,
    payments,
    returns,
    entries,

    summary: {
      total_purchased: Number(supplier.total_purchased || 0),

      total_paid: totalPaid,

      total_returns: preciseSum(
        returns
          .filter((purchaseReturn) => !purchaseReturn.cancelled_at)
          .map((purchaseReturn) => Number(purchaseReturn.total_amount || 0)),
      ),

      balance: Number(supplier.balance || 0),

      open_purchases: purchases.filter(
        (purchase) => Number(purchase.remaining_amount || 0) > 0,
      ).length,

      aging,
      due,
    },
  };
}
