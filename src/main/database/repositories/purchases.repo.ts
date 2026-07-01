import { getDb } from '../db';
import { createCashMovement } from './cash.repo';
import { enqueueSyncOperation } from './sync.repo';

export type CreatePurchaseInput = {
  supplier_id: number;
  paid_amount?: number;
  sub_total?: number;
  discount_type?: 'amount' | 'percent' | string;
  discount_input?: number;
  discount_value?: number;
  payment_method?: string;
  notes?: string | null;
  items: Array<{
    variant_id: number;
    quantity: number;
    unit_cost: number;
  }>;
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
  actor_id?: number | null;
  items: Array<{
    purchase_item_id?: number;
    variant_id?: number;
    quantity: number;
  }>;
};

function ensurePurchaseReturnSchema() {
  const db = getDb();

  function safeRun(sql: string) {
    try {
      db.prepare(sql).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes('duplicate column name')) {
        throw error;
      }
    }
  }

  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN status TEXT DEFAULT 'active'`);
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancelled_at TEXT`);
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancelled_by INTEGER`);
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancel_reason TEXT`);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  safeRun(`ALTER TABLE purchase_returns ADD COLUMN debt_reduction_amount REAL DEFAULT 0`);
  safeRun(`ALTER TABLE purchase_returns ADD COLUMN cash_refund_amount REAL DEFAULT 0`);
  safeRun(`ALTER TABLE purchase_returns ADD COLUMN refund_payment_method TEXT`);
  safeRun(`ALTER TABLE purchase_returns ADD COLUMN refund_mode TEXT DEFAULT 'cash'`);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      purchase_item_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      barcode TEXT,
      size TEXT,
      color TEXT,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id
    ON purchase_returns (purchase_id)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id
    ON purchase_return_items (return_id)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item_id
    ON purchase_return_items (purchase_item_id)
  `).run();
}

function getCurrentVariantStock(db: ReturnType<typeof getDb>, variantId: number) {
  const row = db
    .prepare(`
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
    `)
    .get(Number(variantId)) as { stock: number } | undefined;

  return Number(row?.stock || 0);
}

function getReturnedQuantityForPurchaseItem(
  db: ReturnType<typeof getDb>,
  purchaseItemId: number
) {
  const row = db
    .prepare(`
      SELECT IFNULL(SUM(pri.quantity), 0) AS quantity
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      WHERE pri.purchase_item_id = ?
    `)
    .get(Number(purchaseItemId)) as { quantity: number } | undefined;

  return Number(row?.quantity || 0);
}

function normalizePaymentStatus(totalAmount: number, paidAmount: number, remainingAmount: number) {
  if (remainingAmount <= 0) return 'paid';
  if (paidAmount > 0 && paidAmount < totalAmount) return 'partial';
  return 'unpaid';
}

export function createPurchaseInvoice(input: CreatePurchaseInput) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const supplierId = Number(input.supplier_id);
  const paidAmountInput = Number(input.paid_amount || 0);

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

    const preparedItems = input.items.map((item) => {
      const variant = getVariant.get(Number(item.variant_id)) as any;

      if (!variant) {
        throw new Error('الصنف غير موجود');
      }

      const quantity = Number(item.quantity || 0);
      const unitCost = Number(item.unit_cost || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`كمية غير صحيحة للصنف ${variant.product_name}`);
      }

      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new Error(`سعر شراء غير صحيح للصنف ${variant.product_name}`);
      }

      return {
        variant,
        quantity,
        unitCost,
        lineTotal: quantity * unitCost
      };
    });

    const totalAmount = preparedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discountValueInput = Number(input.discount_value || 0);
    const discountValue = Number.isFinite(discountValueInput)
      ? Math.max(0, discountValueInput)
      : 0;

    const subTotalInput = Number(input.sub_total || 0);
    const subTotal =
      Number.isFinite(subTotalInput) && subTotalInput > 0
        ? subTotalInput
        : totalAmount + discountValue;

    const discountInput = Number(input.discount_input || 0);
    const discountType = input.discount_type === 'percent' ? 'percent' : 'amount';
    const paidAmount = Math.min(Math.max(paidAmountInput, 0), totalAmount);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    const paymentStatus =
      remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    const purchaseResult = db
      .prepare(`
        INSERT INTO purchase_invoices (
          supplier_id,
          total_amount,
          sub_total,
          discount_type,
          discount_input,
          discount_value,
          paid_amount,
          remaining_amount,
          payment_status,
          payment_method,
          notes,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `)
      .run(
        supplierId,
        totalAmount,
        subTotal,
        discountType,
        discountInput,
        discountValue,
        paidAmount,
        remainingAmount,
        paymentStatus,
        input.payment_method || 'cash',
        input.notes?.trim() || null
      );

    const purchaseId = Number(purchaseResult.lastInsertRowid);

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
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStockMovement = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'in', ?, ?, 'purchase', ?)
    `);

    const updateVariantCost = db.prepare(`
      UPDATE product_variants
      SET buy_price = ?
      WHERE id = ?
    `);

    const syncItems: Array<{
      purchase_item_id: number;
      variant_id: number;
      product_name: string;
      barcode: string | null;
      size: string | null;
      color: string | null;
      quantity: number;
      unit_cost: number;
      line_total: number;
    }> = [];

    for (const item of preparedItems) {
      const purchaseItemResult = insertItem.run(
        purchaseId,
        item.variant.id,
        item.variant.product_name,
        item.variant.barcode ?? null,
        item.variant.size ?? null,
        item.variant.color ?? null,
        item.quantity,
        item.unitCost,
        item.lineTotal
      );

      syncItems.push({
        purchase_item_id: Number(purchaseItemResult.lastInsertRowid),
        variant_id: Number(item.variant.id),
        product_name: item.variant.product_name,
        barcode: item.variant.barcode ?? null,
        size: item.variant.size ?? null,
        color: item.variant.color ?? null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        line_total: item.lineTotal
      });

      insertStockMovement.run(
        item.variant.id,
        item.quantity,
        purchaseId,
        `دخول مخزون من فاتورة شراء رقم ${purchaseId}`
      );

      updateVariantCost.run(item.unitCost, item.variant.id);
    }

    db.prepare(`
      UPDATE suppliers
      SET
        total_purchased = total_purchased + ?,
        balance = balance + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalAmount, remainingAmount, supplierId);
    
    let supplierPaymentId: number | null = null;

    if (paidAmount > 0) {
      const supplierPaymentResult = db.prepare(`
        INSERT INTO supplier_payments (
          supplier_id,
          purchase_id,
          amount,
          payment_method,
          notes
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        supplierId,
        purchaseId,
        paidAmount,
        input.payment_method || 'cash',
        `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}`
      );

      supplierPaymentId = Number(supplierPaymentResult.lastInsertRowid);

      createCashMovement({
        type: 'supplier_payment',
        direction: 'out',
        amount: paidAmount,
        payment_method: input.payment_method || 'cash',
        reference_id: purchaseId,
        reference_type: 'purchase_invoice',
        notes: `دفع فاتورة شراء رقم ${purchaseId}`,
        created_by: (input as any).actor_id ?? null
      });
    }

    const savedPurchase = db
      .prepare(`SELECT * FROM purchase_invoices WHERE id = ? LIMIT 1`)
      .get(purchaseId);

    const savedSupplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`)
      .get(supplierId);

    const savedPayment = supplierPaymentId
      ? db
          .prepare(`SELECT * FROM supplier_payments WHERE id = ? LIMIT 1`)
          .get(supplierPaymentId)
      : null;

    enqueueSyncOperation({
      type: 'purchase.created',
      entity: 'purchase_invoices',
      entity_id: purchaseId,
      payload: {
        purchase: savedPurchase,
        supplier: savedSupplier,
        items: syncItems,
        supplier_payment: savedPayment,
        cash:
          paidAmount > 0
            ? {
                direction: 'out',
                amount: paidAmount,
                payment_method: input.payment_method || 'cash',
                reference_type: 'purchase_invoice',
                reference_id: purchaseId
              }
            : null,
        stock_movements: syncItems.map((item) => ({
          variant_id: item.variant_id,
          type: 'in',
          quantity: item.quantity,
          reference_id: purchaseId,
          reference_type: 'purchase'
        })),
        cost_updates: syncItems.map((item) => ({
          variant_id: item.variant_id,
          buy_price: item.unit_cost
        }))
      }
    });

    return {
      purchaseId,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus
    };
  });

  return tx();
}

export function cancelPurchaseInvoice(input: CancelPurchaseInput) {
  ensurePurchaseReturnSchema();

  const db = getDb();
  const purchaseId = Number(input.purchase_id);

  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح');
  }

  const tx = db.transaction(() => {
    const purchase = db
      .prepare(`
        SELECT
          pi.*,
          IFNULL(pi.status, 'active') AS safe_status
        FROM purchase_invoices pi
        WHERE pi.id = ?
        LIMIT 1
      `)
      .get(purchaseId) as any;

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة');
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('فاتورة الشراء ملغاة بالفعل');
    }

    const returnsCountRow = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM purchase_returns
        WHERE purchase_id = ?
      `)
      .get(purchaseId) as { count: number };

    if (Number(returnsCountRow?.count || 0) > 0) {
      throw new Error('لا يمكن إلغاء فاتورة تم عمل مرتجع عليها');
    }

    const items = db
      .prepare(`
        SELECT *
        FROM purchase_items
        WHERE purchase_id = ?
        ORDER BY id ASC
      `)
      .all(purchaseId) as any[];

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل فاتورة الشراء');
    }

    for (const item of items) {
      const currentStock = getCurrentVariantStock(db, Number(item.variant_id));
      const quantity = Number(item.quantity || 0);

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن إلغاء الفاتورة لأن مخزون الصنف "${item.product_name}" أقل من كمية الفاتورة`
        );
      }
    }

    const insertStockMovement = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'out', ?, ?, 'purchase_cancel', ?)
    `);

    for (const item of items) {
      insertStockMovement.run(
        Number(item.variant_id),
        Number(item.quantity || 0),
        purchaseId,
        `خروج مخزون بسبب إلغاء فاتورة شراء رقم ${purchaseId}`
      );
    }

    const totalAmount = Number(purchase.total_amount || 0);
    const paidAmount = Number(purchase.paid_amount || 0);
    const remainingAmount = Number(purchase.remaining_amount || 0);

    db.prepare(`
      UPDATE purchase_invoices
      SET
        status = 'cancelled',
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?,
        payment_status = 'cancelled',
        remaining_amount = 0
      WHERE id = ?
    `).run(
      input.actor_id ?? null,
      input.reason?.trim() || null,
      purchaseId
    );

    db.prepare(`
      UPDATE suppliers
      SET
        total_purchased = MAX(total_purchased - ?, 0),
        balance = MAX(balance - ?, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalAmount, remainingAmount, Number(purchase.supplier_id));

    if (paidAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',
        direction: 'in',
        amount: paidAmount,
        payment_method: purchase.payment_method || 'cash',
        reference_id: purchaseId,
        reference_type: 'purchase_cancel',
        notes: `عكس دفعة فاتورة شراء ملغاة رقم ${purchaseId}`,
        created_by: input.actor_id ?? null
      });

      db.prepare(`
        DELETE FROM supplier_payments
        WHERE purchase_id = ?
      `).run(purchaseId);
    }

    return {
      ok: true,
      purchase_id: purchaseId,
      supplier_id: Number(purchase.supplier_id),
      reversed_total: totalAmount,
      reversed_paid: paidAmount,
      reversed_remaining: remainingAmount,
      items_count: items.length
    };
  });

  return tx();
}

export function createPurchaseReturn(input: CreatePurchaseReturnInput) {
  ensurePurchaseReturnSchema();

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
      .prepare(`
        SELECT
          pi.*,
          IFNULL(pi.status, 'active') AS safe_status
        FROM purchase_invoices pi
        WHERE pi.id = ?
        LIMIT 1
      `)
      .get(purchaseId) as any;

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة');
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('لا يمكن عمل مرتجع على فاتورة ملغاة');
    }

    const preparedItems = input.items.map((rawItem) => {
      const quantity = Number(rawItem.quantity || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('كمية المرتجع غير صحيحة');
      }

      let purchaseItem: any;

      if (rawItem.purchase_item_id) {
        purchaseItem = db
          .prepare(`
            SELECT *
            FROM purchase_items
            WHERE id = ?
              AND purchase_id = ?
            LIMIT 1
          `)
          .get(Number(rawItem.purchase_item_id), purchaseId);
      } else if (rawItem.variant_id) {
        purchaseItem = db
          .prepare(`
            SELECT *
            FROM purchase_items
            WHERE variant_id = ?
              AND purchase_id = ?
            LIMIT 1
          `)
          .get(Number(rawItem.variant_id), purchaseId);
      }

      if (!purchaseItem) {
        throw new Error('الصنف غير موجود داخل فاتورة الشراء');
      }

      const alreadyReturned = getReturnedQuantityForPurchaseItem(
        db,
        Number(purchaseItem.id)
      );

      const originalQuantity = Number(purchaseItem.quantity || 0);
      const availableToReturn = Math.max(0, originalQuantity - alreadyReturned);

      if (quantity > availableToReturn) {
        throw new Error(
          `كمية المرتجع للصنف "${purchaseItem.product_name}" أكبر من الكمية المتاحة للمرتجع`
        );
      }

      const currentStock = getCurrentVariantStock(db, Number(purchaseItem.variant_id));

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن عمل مرتجع للصنف "${purchaseItem.product_name}" لأن المخزون الحالي غير كافٍ`
        );
      }

      const unitCost = Number(purchaseItem.unit_cost || 0);

      return {
        purchaseItem,
        quantity,
        unitCost,
        lineTotal: quantity * unitCost
      };
    });

    const totalAmount = preparedItems.reduce((sum, item) => sum + item.lineTotal, 0);

    if (totalAmount <= 0) {
      throw new Error('قيمة المرتجع غير صحيحة');
    }

    const oldRemaining = Number(purchase.remaining_amount || 0);
    const debtReductionAmount = Math.min(totalAmount, oldRemaining);
    const cashRefundAmount = Math.max(0, totalAmount - debtReductionAmount);
    const refundMode = input.refund_mode === 'credit' ? 'credit' : 'cash';
    const refundPaymentMethod = input.refund_payment_method?.trim() || purchase.payment_method || 'store_cash';
    const supplierBalanceReduction = debtReductionAmount + (refundMode === 'credit' ? cashRefundAmount : 0);

    const returnResult = db
      .prepare(`
        INSERT INTO purchase_returns (
          purchase_id,
          supplier_id,
          total_amount,
          debt_reduction_amount,
          cash_refund_amount,
          refund_payment_method,
          refund_mode,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        purchaseId,
        Number(purchase.supplier_id),
        totalAmount,
        debtReductionAmount,
        refundMode === 'cash' ? cashRefundAmount : 0,
        refundMode === 'cash' ? refundPaymentMethod : null,
        refundMode,
        input.notes?.trim() || null,
        input.actor_id ?? null
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

    const insertStockMovement = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'out', ?, ?, 'purchase_return', ?)
    `);

    const syncReturnItems: Array<{
      return_item_id: number;
      purchase_item_id: number;
      variant_id: number;
      product_name: string;
      barcode: string | null;
      size: string | null;
      color: string | null;
      quantity: number;
      unit_cost: number;
      line_total: number;
    }> = [];

    for (const item of preparedItems) {
      const returnItemResult = insertReturnItem.run(
        returnId,
        Number(item.purchaseItem.id),
        Number(item.purchaseItem.variant_id),
        item.purchaseItem.product_name,
        item.purchaseItem.barcode ?? null,
        item.purchaseItem.size ?? null,
        item.purchaseItem.color ?? null,
        item.quantity,
        item.unitCost,
        item.lineTotal
      );

      syncReturnItems.push({
        return_item_id: Number(returnItemResult.lastInsertRowid),
        purchase_item_id: Number(item.purchaseItem.id),
        variant_id: Number(item.purchaseItem.variant_id),
        product_name: item.purchaseItem.product_name,
        barcode: item.purchaseItem.barcode ?? null,
        size: item.purchaseItem.size ?? null,
        color: item.purchaseItem.color ?? null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        line_total: item.lineTotal
      });

      insertStockMovement.run(
        Number(item.purchaseItem.variant_id),
        item.quantity,
        returnId,
        `خروج مخزون بسبب مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`
      );
    }

    const oldPaid = Number(purchase.paid_amount || 0);
    const oldTotal = Number(purchase.total_amount || 0);
    const newRemaining = Math.max(0, oldRemaining - debtReductionAmount);
    const newPaymentStatus = normalizePaymentStatus(oldTotal, oldPaid, newRemaining);

    db.prepare(`
      UPDATE purchase_invoices
      SET
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `).run(newRemaining, newPaymentStatus, purchaseId);

    db.prepare(`
      UPDATE suppliers
      SET
        total_purchased = MAX(total_purchased - ?, 0),
        balance = balance - ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalAmount, supplierBalanceReduction, Number(purchase.supplier_id));

    if (refundMode === 'cash' && cashRefundAmount > 0) {
      createCashMovement({
        type: 'purchase_return',
        direction: 'in',
        amount: cashRefundAmount,
        payment_method: refundPaymentMethod,
        reference_id: returnId,
        reference_type: 'purchase_return',
        notes: `استلام فرق مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`,
        created_by: input.actor_id ?? null
      });
    }

    const savedReturn = db
      .prepare(`SELECT * FROM purchase_returns WHERE id = ? LIMIT 1`)
      .get(returnId);

    const savedPurchase = db
      .prepare(`SELECT * FROM purchase_invoices WHERE id = ? LIMIT 1`)
      .get(purchaseId);

    const savedSupplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`)
      .get(Number(purchase.supplier_id));

    enqueueSyncOperation({
      type: 'purchase_return.created',
      entity: 'purchase_returns',
      entity_id: returnId,
      payload: {
        purchase_return: savedReturn,
        purchase: savedPurchase,
        supplier: savedSupplier,
        items: syncReturnItems,
        debt_reduction: {
          supplier_id: Number(purchase.supplier_id),
          purchase_id: purchaseId,
          amount: debtReductionAmount
        },
        supplier_balance_reduction: supplierBalanceReduction,
        cash_refund:
          refundMode === 'cash' && cashRefundAmount > 0
            ? {
                direction: 'in',
                amount: cashRefundAmount,
                payment_method: refundPaymentMethod,
                reference_type: 'purchase_return',
                reference_id: returnId
              }
            : null,
        credit_refund:
          refundMode === 'credit' && cashRefundAmount > 0
            ? {
                supplier_id: Number(purchase.supplier_id),
                amount: cashRefundAmount,
                note: 'تم خصم قيمة المرتجع من رصيد المورد بدل استلام كاش'
              }
            : null,
        stock_movements: syncReturnItems.map((item) => ({
          variant_id: item.variant_id,
          type: 'out',
          quantity: item.quantity,
          reference_id: returnId,
          reference_type: 'purchase_return'
        }))
      }
    });

    return {
      ok: true,
      return_id: returnId,
      purchase_id: purchaseId,
      supplier_id: Number(purchase.supplier_id),
      total_amount: totalAmount,
      debt_reduction_amount: debtReductionAmount,
      cash_refund_amount: refundMode === 'cash' ? cashRefundAmount : 0,
      refund_mode: refundMode,
      refund_payment_method: refundMode === 'cash' ? refundPaymentMethod : null,
      items_count: preparedItems.length
    };
  });

  return tx();
}

export function listPurchaseInvoices(input?: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const search = input?.search?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
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

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        pi.*,
        IFNULL(pi.status, 'active') AS status,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        COUNT(pii.id) AS items_count,
        IFNULL((
          SELECT SUM(pr.total_amount)
          FROM purchase_returns pr
          WHERE pr.purchase_id = pi.id
        ), 0) AS returned_amount
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      LEFT JOIN purchase_items pii ON pii.purchase_id = pi.id
      ${whereSql}
      GROUP BY pi.id
      ORDER BY pi.id DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      ${whereSql}
    `)
    .get(...params) as { total: number };

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset
  };
}

export function listPurchaseReturns(input?: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const search = input?.search?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [];
  const params: any[] = [];

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
    .prepare(`
      SELECT
        pr.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        COUNT(pri.id) AS items_count
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
      LEFT JOIN purchase_return_items pri ON pri.return_id = pr.id
      ${whereSql}
      GROUP BY pr.id
      ORDER BY pr.id DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
      ${whereSql}
    `)
    .get(...params) as { total: number };

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset
  };
}

export function getPurchaseInvoice(purchaseId: number) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const purchase = db
    .prepare(`
      SELECT
        pi.*,
        IFNULL(pi.status, 'active') AS status,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        IFNULL((
          SELECT SUM(pr.total_amount)
          FROM purchase_returns pr
          WHERE pr.purchase_id = pi.id
        ), 0) AS returned_amount
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      WHERE pi.id = ?
      LIMIT 1
    `)
    .get(Number(purchaseId));

  if (!purchase) {
    throw new Error('فاتورة الشراء غير موجودة');
  }

  const items = db
    .prepare(`
      SELECT
        pii.*,
        IFNULL((
          SELECT SUM(pri.quantity)
          FROM purchase_return_items pri
          JOIN purchase_returns pr ON pr.id = pri.return_id
          WHERE pri.purchase_item_id = pii.id
        ), 0) AS returned_quantity,
        MAX(
          pii.quantity - IFNULL((
            SELECT SUM(pri.quantity)
            FROM purchase_return_items pri
            JOIN purchase_returns pr ON pr.id = pri.return_id
            WHERE pri.purchase_item_id = pii.id
          ), 0),
          0
        ) AS returnable_quantity
      FROM purchase_items pii
      WHERE pii.purchase_id = ?
      ORDER BY pii.id ASC
    `)
    .all(Number(purchaseId));

  const payments = db
    .prepare(`
      SELECT *
      FROM supplier_payments
      WHERE purchase_id = ?
      ORDER BY id ASC
    `)
    .all(Number(purchaseId));

  const returns = db
    .prepare(`
      SELECT *
      FROM purchase_returns
      WHERE purchase_id = ?
      ORDER BY id DESC
    `)
    .all(Number(purchaseId));

  return {
    purchase,
    items,
    payments,
    returns
  };
}

export function getPurchaseReturn(returnId: number) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const purchaseReturn = db
    .prepare(`
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
    `)
    .get(Number(returnId));

  if (!purchaseReturn) {
    throw new Error('مرتجع الشراء غير موجود');
  }

  const items = db
    .prepare(`
      SELECT *
      FROM purchase_return_items
      WHERE return_id = ?
      ORDER BY id ASC
    `)
    .all(Number(returnId));

  return {
    return: purchaseReturn,
    items
  };
}

export function recordSupplierPayment(input: {
  supplier_id: number;
  purchase_id?: number | null;
  amount: number;
  payment_method?: string;
  notes?: string | null;
}) {
  ensurePurchaseReturnSchema();

  const db = getDb();

  const supplierId = Number(input.supplier_id);
  const purchaseId = input.purchase_id ? Number(input.purchase_id) : null;
  const amountInput = Number(input.amount || 0);

  if (!supplierId) {
    throw new Error('Supplier ID is required');
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any;

    if (!supplier) {
      throw new Error('المورد غير موجود');
    }

    const supplierBalance = Number(supplier.balance || 0);

    if (supplierBalance <= 0) {
      throw new Error('لا يوجد رصيد مستحق على المورد');
    }

    if (amountInput > supplierBalance) {
      throw new Error('قيمة الدفع أكبر من رصيد المورد');
    }

    const insertPayment = db.prepare(`
      INSERT INTO supplier_payments (
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    const updatePurchase = db.prepare(`
      UPDATE purchase_invoices
      SET
        paid_amount = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `);

    let totalPaid = 0;
    const allocations: Array<{
      purchase_id: number | null;
      amount: number;
      payment_id?: number;
    }> = [];

    const syncPayments: Array<{
      payment_id: number;
      purchase_id: number | null;
      amount: number;
      payment_method: string;
      notes: string | null;
    }> = [];

    if (purchaseId) {
      const purchase = db
        .prepare(`
          SELECT *
          FROM purchase_invoices
          WHERE id = ?
            AND supplier_id = ?
            AND IFNULL(status, 'active') != 'cancelled'
          LIMIT 1
        `)
        .get(purchaseId, supplierId) as any;

      if (!purchase) {
        throw new Error('فاتورة الشراء غير موجودة أو ملغاة');
      }

      const remaining = Number(purchase.remaining_amount || 0);

      if (remaining <= 0) {
        throw new Error('الفاتورة مدفوعة بالكامل بالفعل');
      }

      const finalAmount = Math.min(amountInput, remaining);

      const newPaid = Number(purchase.paid_amount || 0) + finalAmount;

      const newRemaining = Math.max(0, remaining - finalAmount);

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

      updatePurchase.run(newPaid, newRemaining, newStatus, purchaseId);

      const paymentMethod = input.payment_method || 'cash';
      const paymentNotes = input.notes?.trim() || `دفعة على فاتورة شراء رقم ${purchaseId}`;

      const paymentResult = insertPayment.run(
        supplierId,
        purchaseId,
        finalAmount,
        paymentMethod,
        paymentNotes
      );

      const paymentId = Number(paymentResult.lastInsertRowid);

      syncPayments.push({
        payment_id: paymentId,
        purchase_id: purchaseId,
        amount: finalAmount,
        payment_method: paymentMethod,
        notes: paymentNotes
      });

      totalPaid = finalAmount;
      allocations.push({
        purchase_id: purchaseId,
        amount: finalAmount,
        payment_id: paymentId
      });
    } else {
      let remainingPayment = Math.min(amountInput, supplierBalance);

      const openPurchases = db
        .prepare(`
          SELECT *
          FROM purchase_invoices
          WHERE supplier_id = ?
            AND remaining_amount > 0
            AND IFNULL(status, 'active') != 'cancelled'
          ORDER BY id ASC
        `)
        .all(supplierId) as any[];

      if (openPurchases.length === 0) {
        throw new Error('لا توجد فواتير مفتوحة لهذا المورد');
      }

      for (const purchase of openPurchases) {
        if (remainingPayment <= 0) break;

        const purchaseRemaining = Number(purchase.remaining_amount || 0);
        const payNow = Math.min(remainingPayment, purchaseRemaining);

        const newPaid = Number(purchase.paid_amount || 0) + payNow;

        const newRemaining = Math.max(0, purchaseRemaining - payNow);

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

        updatePurchase.run(newPaid, newRemaining, newStatus, purchase.id);

        const paymentMethod = input.payment_method || 'cash';
        const paymentNotes =
          input.notes?.trim() || `دفعة عامة موزعة على فاتورة شراء رقم ${purchase.id}`;

        const paymentResult = insertPayment.run(
          supplierId,
          purchase.id,
          payNow,
          paymentMethod,
          paymentNotes
        );

        const paymentId = Number(paymentResult.lastInsertRowid);

        syncPayments.push({
          payment_id: paymentId,
          purchase_id: Number(purchase.id),
          amount: payNow,
          payment_method: paymentMethod,
          notes: paymentNotes
        });

        totalPaid += payNow;
        remainingPayment -= payNow;

        allocations.push({
          purchase_id: purchase.id,
          amount: payNow,
          payment_id: paymentId
        });
      }
    }

    if (totalPaid <= 0) {
      throw new Error('لم يتم تسجيل أي دفعة');
    }

    db.prepare(`
      UPDATE suppliers
      SET
        balance = balance - ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalPaid, supplierId);

    createCashMovement({
      type: 'supplier_payment',
      direction: 'out',
      amount: totalPaid,
      payment_method: input.payment_method || 'cash',
      reference_id: purchaseId,
      reference_type: 'supplier_payment',
      notes: input.notes?.trim() || 'دفعة للمورد',
      created_by: (input as any).actor_id ?? null
    });

    const getPaymentForSync = db.prepare(`
      SELECT *
      FROM supplier_payments
      WHERE id = ?
      LIMIT 1
    `);

    const getPurchaseForSync = db.prepare(`
      SELECT *
      FROM purchase_invoices
      WHERE id = ?
      LIMIT 1
    `);

    const savedSupplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`)
      .get(supplierId);

    const savedPayments = syncPayments.map((payment) =>
      getPaymentForSync.get(payment.payment_id)
    );

    const affectedPurchases = allocations
      .filter((allocation) => allocation.purchase_id)
      .map((allocation) => getPurchaseForSync.get(allocation.purchase_id))
      .filter(Boolean);

    enqueueSyncOperation({
      type: 'supplier_payment.created',
      entity: 'supplier_payments',
      entity_id: syncPayments.map((payment) => payment.payment_id).join(','),
      payload: {
        supplier: savedSupplier,
        payments: savedPayments,
        allocations,
        affected_purchases: affectedPurchases,
        cash: {
          direction: 'out',
          amount: totalPaid,
          payment_method: input.payment_method || 'cash',
          reference_type: 'supplier_payment',
          reference_id: purchaseId
        }
      }
    });

    return {
      ok: true,
      supplier_id: supplierId,
      paid_amount: totalPaid,
      allocations
    };
  });

  return tx();
}

export function getSupplierStatement(supplierId: number) {
  ensurePurchaseReturnSchema();

  const db = getDb();
  const id = Number(supplierId);

  if (!id) {
    throw new Error('Supplier ID is required');
  }

  const supplier = db
    .prepare(`
      SELECT *
      FROM suppliers
      WHERE id = ?
      LIMIT 1
    `)
    .get(id) as any;

  if (!supplier) {
    throw new Error('المورد غير موجود');
  }

  const purchases = db
    .prepare(`
      SELECT *
      FROM purchase_invoices
      WHERE supplier_id = ?
        AND IFNULL(status, 'active') != 'cancelled'
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const payments = db
    .prepare(`
      SELECT sp.*
      FROM supplier_payments sp
      LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_id
      WHERE sp.supplier_id = ?
        AND (
          sp.purchase_id IS NULL
          OR IFNULL(pi.status, 'active') != 'cancelled'
        )
      ORDER BY sp.created_at DESC, sp.id DESC
    `)
    .all(id) as any[];

  const returns = db
    .prepare(`
      SELECT *
      FROM purchase_returns
      WHERE supplier_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const entries = [
    ...purchases.map((purchase) => ({
      id: `purchase-${purchase.id}`,
      type: 'purchase',
      title: `فاتورة شراء #${purchase.id}`,
      debit: Number(purchase.total_amount || 0),
      credit: 0,
      purchase_id: purchase.id,
      payment_status: purchase.payment_status,
      notes: purchase.notes,
      created_at: purchase.created_at
    })),

    ...returns.map((purchaseReturn) => ({
      id: `purchase-return-${purchaseReturn.id}`,
      type: 'purchase_return',
      title: `مرتجع شراء #${purchaseReturn.id} على فاتورة #${purchaseReturn.purchase_id}`,
      debit: 0,
      credit: Number(purchaseReturn.total_amount || 0),
      purchase_id: purchaseReturn.purchase_id,
      return_id: purchaseReturn.id,
      notes: purchaseReturn.notes,
      created_at: purchaseReturn.created_at
    })),

    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      title: payment.purchase_id
        ? `دفعة على فاتورة #${payment.purchase_id}`
        : 'دفعة مورد',
      debit: 0,
      credit: Number(payment.amount || 0),
      purchase_id: payment.purchase_id,
      payment_method: payment.payment_method,
      notes: payment.notes,
      created_at: payment.created_at
    }))
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return {
    supplier,
    purchases,
    payments,
    returns,
    entries,
    summary: {
      total_purchased: Number(supplier.total_purchased || 0),
      total_paid: payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      total_returns: returns.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
      balance: Number(supplier.balance || 0),
      open_purchases: purchases.filter((p) => Number(p.remaining_amount || 0) > 0).length
    }
  };
}