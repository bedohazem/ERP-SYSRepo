import { getDb } from '../db'
import { createCashMovement } from './cash.repo'

function roundMoney(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100
}

export type CreatePurchaseInput = {
  supplier_id: number
  paid_amount?: number
  sub_total?: number
  discount_type?: 'amount' | 'percent' | string
  discount_input?: number
  discount_value?: number
  payment_method?: string
  notes?: string | null
  items: Array<{
    variant_id: number
    quantity: number
    unit_cost: number
  }>
}

export type CancelPurchaseInput = {
  purchase_id: number
  reason?: string
  actor_id?: number | null
}

export type CreatePurchaseReturnInput = {
  purchase_id: number
  notes?: string | null
  refund_payment_method?: string | null
  refund_mode?: 'cash' | 'credit' | string
  actor_id?: number | null
  items: Array<{
    purchase_item_id?: number
    variant_id?: number
    quantity: number
  }>
}

function ensurePurchaseReturnSchema() {
  const db = getDb()

  function safeRun(sql: string) {
    try {
      db.prepare(sql).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (!message.includes('duplicate column name')) {
        throw error
      }
    }
  }

  safeRun(
    `ALTER TABLE purchase_invoices ADD COLUMN status TEXT DEFAULT 'active'`,
  )
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancelled_at TEXT`)
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancelled_by INTEGER`)
  safeRun(`ALTER TABLE purchase_invoices ADD COLUMN cancel_reason TEXT`)

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `,
  ).run()

  safeRun(
    `ALTER TABLE purchase_returns ADD COLUMN debt_reduction_amount REAL DEFAULT 0`,
  )
  safeRun(
    `ALTER TABLE purchase_returns ADD COLUMN cash_refund_amount REAL DEFAULT 0`,
  )
  safeRun(`ALTER TABLE purchase_returns ADD COLUMN refund_payment_method TEXT`)
  safeRun(
    `ALTER TABLE purchase_returns ADD COLUMN refund_mode TEXT DEFAULT 'cash'`,
  )

  db.prepare(
    `
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
  `,
  ).run()

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id
    ON purchase_returns (purchase_id)
  `,
  ).run()

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id
    ON purchase_return_items (return_id)
  `,
  ).run()

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item_id
    ON purchase_return_items (purchase_item_id)
  `,
  ).run()
}

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
    .get(Number(variantId)) as { stock: number } | undefined

  return Number(row?.stock || 0)
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
    `,
    )
    .get(Number(purchaseItemId)) as { quantity: number } | undefined

  return Number(row?.quantity || 0)
}

function normalizePaymentStatus(
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number,
) {
  if (remainingAmount <= 0) return 'paid'
  if (paidAmount > 0 && paidAmount < totalAmount) return 'partial'
  return 'unpaid'
}

export function createPurchaseInvoice(input: CreatePurchaseInput) {
  ensurePurchaseReturnSchema()

  const db = getDb()

  const supplierId = Number(input.supplier_id)
  const paidAmountInput = Number(input.paid_amount || 0)

  if (!supplierId) {
    throw new Error('اختار المورد')
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في فاتورة الشراء')
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any

    if (!supplier) {
      throw new Error('المورد غير موجود')
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
    `)

    const preparedItems = input.items.map((item) => {
      const variant = getVariant.get(Number(item.variant_id)) as any

      if (!variant) {
        throw new Error('الصنف غير موجود')
      }

      const quantity = Number(item.quantity || 0)
      const unitCost = Number(item.unit_cost || 0)

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`كمية غير صحيحة للصنف ${variant.product_name}`)
      }

      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new Error(`سعر شراء غير صحيح للصنف ${variant.product_name}`)
      }

      return {
        variant,
        quantity,
        unitCost,
        lineTotal: roundMoney(quantity * unitCost),
      }
    })

    const itemsTotal = roundMoney(
      preparedItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
    )

    const discountValueInput = Number(input.discount_value || 0)

    const rawDiscountValue = Number.isFinite(discountValueInput)
      ? Math.max(0, discountValueInput)
      : 0

    const subTotalInput = Number(input.sub_total || 0)

    const subTotal =
      Number.isFinite(subTotalInput) && subTotalInput > 0
        ? roundMoney(subTotalInput)
        : roundMoney(itemsTotal + rawDiscountValue)

    const discountValue = roundMoney(Math.min(subTotal, rawDiscountValue))

    const totalAmount = roundMoney(Math.max(0, subTotal - discountValue))

    const discountInput = Number(input.discount_input || 0)

    const discountType =
      input.discount_type === 'percent' ? 'percent' : 'amount'

    const paidAmount = roundMoney(
      Math.min(Math.max(paidAmountInput, 0), totalAmount),
    )

    const remainingAmount = roundMoney(Math.max(0, totalAmount - paidAmount))

    const paymentStatus =
      remainingAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

    const purchaseResult = db
      .prepare(
        `
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
      `,
      )
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
        input.notes?.trim() || null,
      )

    const purchaseId = Number(purchaseResult.lastInsertRowid)

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
    `)

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
    `)

    const updateVariantCost = db.prepare(`
      UPDATE product_variants
      SET buy_price = ?
      WHERE id = ?
    `)

    for (const item of preparedItems) {
      insertItem.run(
        purchaseId,
        item.variant.id,
        item.variant.product_name,
        item.variant.barcode ?? null,
        item.variant.size ?? null,
        item.variant.color ?? null,
        item.quantity,
        item.unitCost,
        item.lineTotal,
      )

      insertStockMovement.run(
        item.variant.id,
        item.quantity,
        purchaseId,
        `دخول مخزون من فاتورة شراء رقم ${purchaseId}`,
      )

      updateVariantCost.run(item.unitCost, item.variant.id)
    }

    db.prepare(
      `
      UPDATE suppliers
      SET
        total_purchased = ROUND(IFNULL(total_purchased, 0) + ?, 2),
        balance = ROUND(IFNULL(balance, 0) + ?, 2),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(totalAmount, remainingAmount, supplierId)

    if (paidAmount > 0) {
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
        input.payment_method || 'cash',
        `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}`,
      )

      createCashMovement({
        type: 'supplier_payment',
        direction: 'out',
        amount: paidAmount,
        payment_method: input.payment_method || 'cash',
        reference_id: purchaseId,
        reference_type: 'purchase_invoice',
        notes: `دفع فاتورة شراء رقم ${purchaseId}`,
        created_by: (input as any).actor_id ?? null,
      })
    }

    return {
      purchaseId,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus,
    }
  })

  return tx()
}

export function cancelPurchaseInvoice(input: CancelPurchaseInput) {
  ensurePurchaseReturnSchema()

  const db = getDb()
  const purchaseId = Number(input.purchase_id)

  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح')
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
      .get(purchaseId) as any

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة')
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('فاتورة الشراء ملغاة بالفعل')
    }

    const returnsCountRow = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM purchase_returns
        WHERE purchase_id = ?
      `,
      )
      .get(purchaseId) as { count: number }

    if (Number(returnsCountRow?.count || 0) > 0) {
      throw new Error('لا يمكن إلغاء فاتورة تم عمل مرتجع عليها')
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
      count: number
    }

    if (Number(laterPaymentRow?.count || 0) > 0) {
      throw new Error(
        'لا يمكن إلغاء فاتورة الشراء لأنها تحتوي على دفعة مورد لاحقة',
      )
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
      .all(purchaseId) as any[]

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل فاتورة الشراء')
    }

    for (const item of items) {
      const currentStock = getCurrentVariantStock(db, Number(item.variant_id))
      const quantity = Number(item.quantity || 0)

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن إلغاء الفاتورة لأن مخزون الصنف "${item.product_name}" أقل من كمية الفاتورة`,
        )
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
    `)

    for (const item of items) {
      insertStockMovement.run(
        Number(item.variant_id),
        Number(item.quantity || 0),
        purchaseId,
        `خروج مخزون بسبب إلغاء فاتورة شراء رقم ${purchaseId}`,
      )
    }

    const totalAmount = Number(purchase.total_amount || 0)
    const paidAmount = Number(purchase.paid_amount || 0)
    const remainingAmount = Number(purchase.remaining_amount || 0)

    db.prepare(
      `
      UPDATE purchase_invoices
      SET
        status = 'cancelled',
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?,
        payment_status = 'cancelled',
        remaining_amount = 0
      WHERE id = ?
    `,
    ).run(input.actor_id ?? null, input.reason?.trim() || null, purchaseId)

    db.prepare(
      `
      UPDATE suppliers
      SET
        total_purchased = MAX(total_purchased - ?, 0),
        balance = MAX(balance - ?, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(totalAmount, remainingAmount, Number(purchase.supplier_id))

    if (paidAmount > 0) {
      createCashMovement({
        type: 'supplier_payment',
        direction: 'in',
        amount: paidAmount,
        payment_method: purchase.payment_method || 'cash',
        reference_id: purchaseId,
        reference_type: 'purchase_cancel',
        notes: `عكس دفعة فاتورة شراء ملغاة رقم ${purchaseId}`,
        created_by: input.actor_id ?? null,
      })

      db.prepare(
        `
        DELETE FROM supplier_payments
        WHERE purchase_id = ?
          AND batch_id IS NULL
      `,
      ).run(purchaseId)
    }

    return {
      ok: true,
      purchase_id: purchaseId,
      supplier_id: Number(purchase.supplier_id),
      reversed_total: totalAmount,
      reversed_paid: paidAmount,
      reversed_remaining: remainingAmount,
      items_count: items.length,
    }
  })

  return tx()
}

export function createPurchaseReturn(input: CreatePurchaseReturnInput) {
  ensurePurchaseReturnSchema()

  const db = getDb()
  const purchaseId = Number(input.purchase_id)

  if (!purchaseId) {
    throw new Error('رقم فاتورة الشراء غير صحيح')
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في المرتجع')
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
      .get(purchaseId) as any

    if (!purchase) {
      throw new Error('فاتورة الشراء غير موجودة')
    }

    if (purchase.safe_status === 'cancelled') {
      throw new Error('لا يمكن عمل مرتجع على فاتورة ملغاة')
    }

    const preparedItems = input.items.map((rawItem) => {
      const quantity = Number(rawItem.quantity || 0)

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('كمية المرتجع غير صحيحة')
      }

      let purchaseItem: any

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
          .get(Number(rawItem.purchase_item_id), purchaseId)
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
          .get(Number(rawItem.variant_id), purchaseId)
      }

      if (!purchaseItem) {
        throw new Error('الصنف غير موجود داخل فاتورة الشراء')
      }

      const alreadyReturned = getReturnedQuantityForPurchaseItem(
        db,
        Number(purchaseItem.id),
      )

      const originalQuantity = Number(purchaseItem.quantity || 0)
      const availableToReturn = Math.max(0, originalQuantity - alreadyReturned)

      if (quantity > availableToReturn) {
        throw new Error(
          `كمية المرتجع للصنف "${purchaseItem.product_name}" أكبر من الكمية المتاحة للمرتجع`,
        )
      }

      const currentStock = getCurrentVariantStock(
        db,
        Number(purchaseItem.variant_id),
      )

      if (currentStock < quantity) {
        throw new Error(
          `لا يمكن عمل مرتجع للصنف "${purchaseItem.product_name}" لأن المخزون الحالي غير كافٍ`,
        )
      }

      const unitCost = Number(purchaseItem.unit_cost || 0)

      return {
        purchaseItem,
        quantity,
        unitCost,
        lineTotal: roundMoney(quantity * unitCost),
      }
    })

    const totalAmount = roundMoney(
      preparedItems.reduce((sum, item) => sum + item.lineTotal, 0),
    )

    if (totalAmount <= 0) {
      throw new Error('قيمة المرتجع غير صحيحة')
    }

    const oldRemaining = roundMoney(Number(purchase.remaining_amount || 0))

    const debtReductionAmount = roundMoney(Math.min(totalAmount, oldRemaining))

    const cashRefundAmount = roundMoney(
      Math.max(0, totalAmount - debtReductionAmount),
    )
    const refundMode = input.refund_mode === 'credit' ? 'credit' : 'cash'
    const refundPaymentMethod =
      input.refund_payment_method?.trim() ||
      purchase.payment_method ||
      'store_cash'
    const supplierBalanceReduction = roundMoney(
      debtReductionAmount + (refundMode === 'credit' ? cashRefundAmount : 0),
    )

    const returnResult = db
      .prepare(
        `
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
      `,
      )
      .run(
        purchaseId,
        Number(purchase.supplier_id),
        totalAmount,
        debtReductionAmount,
        refundMode === 'cash' ? cashRefundAmount : 0,
        refundMode === 'cash' ? refundPaymentMethod : null,
        refundMode,
        input.notes?.trim() || null,
        input.actor_id ?? null,
      )

    const returnId = Number(returnResult.lastInsertRowid)

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
    `)

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
    `)

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
      )

      insertStockMovement.run(
        Number(item.purchaseItem.variant_id),
        item.quantity,
        returnId,
        `خروج مخزون بسبب مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`,
      )
    }

    const oldPaid = roundMoney(Number(purchase.paid_amount || 0))

    const oldTotal = roundMoney(Number(purchase.total_amount || 0))

    const newRemaining = roundMoney(
      Math.max(0, oldRemaining - debtReductionAmount),
    )
    const newPaymentStatus = normalizePaymentStatus(
      oldTotal,
      oldPaid,
      newRemaining,
    )

    db.prepare(
      `
      UPDATE purchase_invoices
      SET
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `,
    ).run(newRemaining, newPaymentStatus, purchaseId)

    db.prepare(
      `
      UPDATE suppliers
      SET
        total_purchased = MAX(
          ROUND(IFNULL(total_purchased, 0) - ?, 2),
          0
        ),
        balance = ROUND(
          IFNULL(balance, 0) - ?,
          2
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(totalAmount, supplierBalanceReduction, Number(purchase.supplier_id))

    if (refundMode === 'cash' && cashRefundAmount > 0) {
      createCashMovement({
        type: 'purchase_return',
        direction: 'in',
        amount: cashRefundAmount,
        payment_method: refundPaymentMethod,
        reference_id: returnId,
        reference_type: 'purchase_return',
        notes: `استلام فرق مرتجع شراء رقم ${returnId} من فاتورة ${purchaseId}`,
        created_by: input.actor_id ?? null,
      })
    }

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
      items_count: preparedItems.length,
    }
  })

  return tx()
}

export function listPurchaseInvoices(input?: {
  search?: string
  limit?: number
  offset?: number
}) {
  ensurePurchaseReturnSchema()

  const db = getDb()

  const search = input?.search?.trim() || ''
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300)
  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (search) {
    where.push(`
      (
        CAST(pi.id AS TEXT) LIKE ?
        OR s.name LIKE ?
        OR IFNULL(s.phone, '') LIKE ?
      )
    `)

    const q = `%${search}%`
    params.push(q, q, q)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
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
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}

export function listPurchaseReturns(input?: {
  search?: string
  limit?: number
  offset?: number
}) {
  ensurePurchaseReturnSchema()

  const db = getDb()

  const search = input?.search?.trim() || ''
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300)
  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (search) {
    where.push(`
      (
        CAST(pr.id AS TEXT) LIKE ?
        OR CAST(pr.purchase_id AS TEXT) LIKE ?
        OR s.name LIKE ?
        OR IFNULL(s.phone, '') LIKE ?
      )
    `)

    const q = `%${search}%`
    params.push(q, q, q, q)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
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
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM purchase_returns pr
      JOIN suppliers s ON s.id = pr.supplier_id
      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}

export function getPurchaseInvoice(purchaseId: number) {
  ensurePurchaseReturnSchema()

  const db = getDb()

  const purchase = db
    .prepare(
      `
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
    `,
    )
    .get(Number(purchaseId))

  if (!purchase) {
    throw new Error('فاتورة الشراء غير موجودة')
  }

  const items = db
    .prepare(
      `
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
    `,
    )
    .all(Number(purchaseId))

  const payments = db
    .prepare(
      `
      SELECT *
      FROM supplier_payments
      WHERE purchase_id = ?
      ORDER BY id ASC
    `,
    )
    .all(Number(purchaseId))

  const returns = db
    .prepare(
      `
      SELECT *
      FROM purchase_returns
      WHERE purchase_id = ?
      ORDER BY id DESC
    `,
    )
    .all(Number(purchaseId))

  return {
    purchase,
    items,
    payments,
    returns,
  }
}

export function getPurchaseReturn(returnId: number) {
  ensurePurchaseReturnSchema()

  const db = getDb()

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
    .get(Number(returnId))

  if (!purchaseReturn) {
    throw new Error('مرتجع الشراء غير موجود')
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
    .all(Number(returnId))

  return {
    return: purchaseReturn,
    items,
  }
}

export function recordSupplierPayment(input: {
  supplier_id: number
  purchase_id?: number | null
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}) {
  ensurePurchaseReturnSchema()

  const db = getDb()

  const supplierId = Number(input.supplier_id)
  const purchaseId = input.purchase_id ? Number(input.purchase_id) : null
  const amountInput = roundMoney(Number(input.amount || 0))

  if (!supplierId) {
    throw new Error('Supplier ID is required')
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح')
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any

    if (!supplier) {
      throw new Error('المورد غير موجود')
    }

    const supplierBalance = roundMoney(Number(supplier.balance || 0))

    if (supplierBalance <= 0) {
      throw new Error('لا يوجد رصيد مستحق على المورد')
    }

    if (amountInput > supplierBalance) {
      throw new Error('قيمة الدفع أكبر من رصيد المورد')
    }

    const businessDateRow = db
      .prepare(
        `
    SELECT date('now', 'localtime') AS business_date
    `,
      )
      .get() as {
      business_date: string
    }

    const businessDate = String(businessDateRow?.business_date || '')

    const batchResult = db
      .prepare(
        `
    INSERT INTO supplier_payment_batches (
      supplier_id,
      purchase_id,
      amount,
      payment_method,
      notes,
      created_by,
      business_date
    )
    VALUES (?, ?, 0, ?, ?, ?, ?)
    `,
      )
      .run(
        supplierId,
        purchaseId,
        input.payment_method || 'cash',
        input.notes?.trim() || null,
        input.actor_id ?? null,
        businessDate,
      )

    const paymentBatchId = Number(batchResult.lastInsertRowid)

    const insertPayment = db.prepare(`
      INSERT INTO supplier_payments (
        supplier_id,
        purchase_id,
        batch_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const updatePurchase = db.prepare(`
      UPDATE purchase_invoices
      SET
        paid_amount = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `)

    let totalPaid = 0
    const allocations: Array<{
      purchase_id: number | null
      amount: number
    }> = []

    if (purchaseId) {
      const purchase = db
        .prepare(
          `
          SELECT *
          FROM purchase_invoices
          WHERE id = ?
            AND supplier_id = ?
            AND IFNULL(status, 'active') != 'cancelled'
          LIMIT 1
        `,
        )
        .get(purchaseId, supplierId) as any

      if (!purchase) {
        throw new Error('فاتورة الشراء غير موجودة أو ملغاة')
      }

      const remaining = roundMoney(Number(purchase.remaining_amount || 0))

      if (remaining <= 0) {
        throw new Error('الفاتورة مدفوعة بالكامل بالفعل')
      }

      const finalAmount = roundMoney(Math.min(amountInput, remaining))

      const newPaid = roundMoney(
        Number(purchase.paid_amount || 0) + finalAmount,
      )

      const newRemaining = roundMoney(Math.max(0, remaining - finalAmount))

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

      updatePurchase.run(newPaid, newRemaining, newStatus, purchaseId)

      insertPayment.run(
        supplierId,
        purchaseId,
        paymentBatchId,
        finalAmount,
        input.payment_method || 'cash',
        input.notes?.trim() || `دفعة على فاتورة شراء رقم ${purchaseId}`,
      )

      totalPaid = finalAmount
      allocations.push({
        purchase_id: purchaseId,
        amount: finalAmount,
      })
    } else {
      let remainingPayment = roundMoney(Math.min(amountInput, supplierBalance))

      const openPurchases = db
        .prepare(
          `
          SELECT *
          FROM purchase_invoices
          WHERE supplier_id = ?
            AND remaining_amount > 0
            AND IFNULL(status, 'active') != 'cancelled'
          ORDER BY id ASC
        `,
        )
        .all(supplierId) as any[]

      if (openPurchases.length === 0) {
        throw new Error('لا توجد فواتير مفتوحة لهذا المورد')
      }

      for (const purchase of openPurchases) {
        if (remainingPayment <= 0) break

        const purchaseRemaining = roundMoney(
          Number(purchase.remaining_amount || 0),
        )

        const payNow = roundMoney(Math.min(remainingPayment, purchaseRemaining))

        const newPaid = roundMoney(Number(purchase.paid_amount || 0) + payNow)

        const newRemaining = roundMoney(Math.max(0, purchaseRemaining - payNow))

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

        updatePurchase.run(newPaid, newRemaining, newStatus, purchase.id)

        insertPayment.run(
          supplierId,
          purchase.id,
          paymentBatchId,
          payNow,
          input.payment_method || 'cash',
          input.notes?.trim() ||
            `دفعة عامة موزعة على فاتورة شراء رقم ${purchase.id}`,
        )

        totalPaid = roundMoney(totalPaid + payNow)

        remainingPayment = roundMoney(remainingPayment - payNow)

        allocations.push({
          purchase_id: purchase.id,
          amount: payNow,
        })
      }
    }

    if (totalPaid <= 0) {
      throw new Error('لم يتم تسجيل أي دفعة')
    }

    db.prepare(
      `
  UPDATE supplier_payment_batches
  SET amount = ?
  WHERE id = ?
  `,
    ).run(totalPaid, paymentBatchId)

    db.prepare(
      `
      UPDATE suppliers
      SET
        balance = MAX(
          ROUND(IFNULL(balance, 0) - ?, 2),
          0
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(totalPaid, supplierId)

    createCashMovement({
      type: 'supplier_payment',
      direction: 'out',

      amount: totalPaid,

      payment_method: input.payment_method || 'cash',

      reference_id: paymentBatchId,
      reference_type: 'supplier_payment',

      notes: input.notes?.trim() || 'دفعة للمورد',

      created_by: input.actor_id ?? null,

      business_date: businessDate,
    })

    return {
      ok: true,

      supplier_id: supplierId,

      payment_batch_id: paymentBatchId,

      paid_amount: totalPaid,

      allocations,
    }
  })

  return tx()
}

function getSupplierPaymentBatchMutationContext(batchId: number) {
  const db = getDb()

  if (!batchId) {
    throw new Error('رقم دفعة المورد غير صحيح')
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
    .get(batchId) as any

  if (!batch) {
    throw new Error('دفعة المورد غير موجودة')
  }

  if (batch.cancelled_at) {
    throw new Error('دفعة المورد ملغاة بالفعل')
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
        id: number
      }
    | undefined

  if (Number(latestBatch?.id || 0) !== batchId) {
    throw new Error('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد')
  }

  const accountingDate = String(batch.accounting_date || '')

  if (accountingDate) {
    const closing = db
      .prepare(
        `
        SELECT id

        FROM cash_day_closings

        WHERE business_date = ?

        LIMIT 1
        `,
      )
      .get(accountingDate)

    if (closing) {
      throw new Error(
        `لا يمكن تعديل أو إلغاء الدفعة لأن يوم ${accountingDate} تم تقفيله`,
      )
    }
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
    .all(batchId) as any[]

  if (allocations.length === 0) {
    throw new Error('لا توجد توزيعات مرتبطة بدفعة المورد')
  }

  const latestAllocationId = Math.max(
    ...allocations.map((allocation) => Number(allocation.id || 0)),
  )

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
    .get(Number(batch.supplier_id), latestAllocationId)

  if (newerPayment) {
    throw new Error('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد')
  }

  if (
    allocations.some((allocation) => allocation.purchase_status === 'cancelled')
  ) {
    throw new Error(
      'لا يمكن تعديل أو إلغاء الدفعة لأن إحدى فواتير الشراء المرتبطة بها ملغاة',
    )
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
    .get(batchId, batch.created_at)

  if (laterReturn) {
    throw new Error(
      'لا يمكن تعديل أو إلغاء الدفعة لوجود مرتجع شراء أحدث مرتبط بها',
    )
  }

  const allocationTotal = roundMoney(
    allocations.reduce(
      (sum, allocation) => sum + Number(allocation.amount || 0),
      0,
    ),
  )

  if (Math.abs(allocationTotal - Number(batch.amount || 0)) > 0.01) {
    throw new Error('بيانات دفعة المورد غير متطابقة')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT *

      FROM cash_movements

      WHERE type = 'supplier_payment'
        AND direction = 'out'
        AND reference_type =
            'supplier_payment'
        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get(batchId) as any

  if (!cashMovement) {
    throw new Error('حركة حساب الدفع الخاصة بدفعة المورد غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة حساب الدفع الخاصة بالدفعة ملغاة بالفعل')
  }

  if (
    Math.abs(roundMoney(Number(cashMovement.amount || 0)) - allocationTotal) >
    0.01
  ) {
    throw new Error('قيمة حركة حساب الدفع لا تطابق قيمة دفعة المورد')
  }

  return {
    db,
    batch,
    accountingDate,
    allocations,
    allocationTotal,
    cashMovement,
  }
}

export function getSupplierPaymentBatchAccess(
  batchId: number,
  actorId?: number | null,
) {
  const context = getSupplierPaymentBatchMutationContext(Number(batchId))

  const batch = context.batch

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
    requires_admin_password: number
  }

  return {
    batch_id: Number(batch.id),

    supplier_id: Number(batch.supplier_id),

    created_by: batch.created_by == null ? null : Number(batch.created_by),

    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  }
}

export function cancelSupplierPaymentBatch(input: {
  batch_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  ensurePurchaseReturnSchema()

  const batchId = Number(input.batch_id || 0)

  const context = getSupplierPaymentBatchMutationContext(batchId)

  const { db, batch, allocations, allocationTotal, cashMovement } = context

  const reason = String(input.reason || '').trim() || 'إلغاء دفعة مورد'

  const tx = db.transaction(() => {
    for (const allocation of allocations) {
      const amount = roundMoney(Number(allocation.amount || 0))

      const nextPaid = roundMoney(
        Math.max(0, Number(allocation.paid_amount || 0) - amount),
      )

      const nextRemaining = roundMoney(
        Math.min(
          Number(allocation.total_amount || 0),

          Math.max(0, Number(allocation.remaining_amount || 0) + amount),
        ),
      )

      const nextStatus = normalizePaymentStatus(
        Number(allocation.total_amount || 0),
        nextPaid,
        nextRemaining,
      )

      db.prepare(
        `
        UPDATE purchase_invoices

        SET
          paid_amount = ?,
          remaining_amount = ?,
          payment_status = ?

        WHERE id = ?
        `,
      ).run(nextPaid, nextRemaining, nextStatus, Number(allocation.purchase_id))
    }

    db.prepare(
      `
      UPDATE suppliers

      SET
        balance = ROUND(
          IFNULL(balance, 0) + ?,
          2
        ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(allocationTotal, Number(batch.supplier_id))

    db.prepare(
      `
      UPDATE supplier_payment_batches

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, batchId)

    db.prepare(
      `
      UPDATE cash_movements

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, Number(cashMovement.id))

    return {
      success: true,

      batch_id: batchId,

      supplier_id: Number(batch.supplier_id),

      cancelled_amount: allocationTotal,

      allocations: allocations.map((allocation) => ({
        purchase_id: Number(allocation.purchase_id),

        amount: Number(allocation.amount || 0),
      })),
    }
  })

  return tx()
}

export function updateSupplierPaymentBatch(input: {
  batch_id: number
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}) {
  ensurePurchaseReturnSchema()

  const batchId = Number(input.batch_id || 0)

  const amountInput = roundMoney(Number(input.amount || 0))

  if (!batchId) {
    throw new Error('رقم دفعة المورد غير صحيح')
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة المعدل غير صحيح')
  }

  const context = getSupplierPaymentBatchMutationContext(batchId)

  const {
    db,
    batch,
    accountingDate,
    allocations,
    allocationTotal: oldTotal,
    cashMovement,
  } = context

  const supplier = db
    .prepare(
      `
      SELECT *

      FROM suppliers

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(Number(batch.supplier_id)) as any

  if (!supplier) {
    throw new Error('المورد غير موجود')
  }

  const specificPurchaseId = Number(batch.purchase_id || 0)

  const availableAfterReverse = roundMoney(
    Number(supplier.balance || 0) + oldTotal,
  )

  let availableForNewPayment = availableAfterReverse

  if (specificPurchaseId) {
    const targetPurchase = allocations.find(
      (allocation) => Number(allocation.purchase_id) === specificPurchaseId,
    )

    if (!targetPurchase) {
      throw new Error('فاتورة الشراء المرتبطة بالدفعة غير موجودة')
    }

    const oldAllocationOnPurchase = roundMoney(
      allocations.reduce(
        (sum, allocation) =>
          Number(allocation.purchase_id) === specificPurchaseId
            ? sum + Number(allocation.amount || 0)
            : sum,
        0,
      ),
    )

    availableForNewPayment = roundMoney(
      Math.min(
        availableAfterReverse,

        Number(targetPurchase.remaining_amount || 0) + oldAllocationOnPurchase,
      ),
    )
  }

  if (amountInput > availableForNewPayment + 0.0001) {
    throw new Error(
      `مبلغ الدفعة المعدل أكبر من المديونية المتاحة وهي ${availableForNewPayment.toFixed(2)} ج.م`,
    )
  }

  const newPaymentMethod =
    String(input.payment_method || batch.payment_method || 'cash').trim() ||
    'cash'

  const newNotes =
    input.notes === undefined
      ? (batch.notes ?? null)
      : input.notes?.trim() || null

  const originalCreatedBy =
    batch.created_by == null
      ? (input.actor_id ?? null)
      : Number(batch.created_by)

  const tx = db.transaction(() => {
    // عكس تأثير الدفعة القديمة
    for (const allocation of allocations) {
      const amount = roundMoney(Number(allocation.amount || 0))

      const nextPaid = roundMoney(
        Math.max(
          0,

          Number(allocation.paid_amount || 0) - amount,
        ),
      )

      const nextRemaining = roundMoney(
        Math.min(
          Number(allocation.total_amount || 0),

          Math.max(
            0,

            Number(allocation.remaining_amount || 0) + amount,
          ),
        ),
      )

      const nextStatus = normalizePaymentStatus(
        Number(allocation.total_amount || 0),
        nextPaid,
        nextRemaining,
      )

      db.prepare(
        `
        UPDATE purchase_invoices

        SET
          paid_amount = ?,
          remaining_amount = ?,
          payment_status = ?

        WHERE id = ?
        `,
      ).run(nextPaid, nextRemaining, nextStatus, Number(allocation.purchase_id))
    }

    // إعادة مديونية الدفعة القديمة
    db.prepare(
      `
      UPDATE suppliers

      SET
        balance = ROUND(
          IFNULL(balance, 0) + ?,
          2
        ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(oldTotal, Number(batch.supplier_id))

    // إنشاء Batch بديل
    const newBatchResult = db
      .prepare(
        `
        INSERT INTO supplier_payment_batches (
          supplier_id,
          purchase_id,
          amount,
          payment_method,
          notes,
          created_by,
          business_date,
          created_at
        )

        VALUES (?, ?, 0, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        Number(batch.supplier_id),

        batch.purchase_id ?? null,

        newPaymentMethod,

        newNotes,

        originalCreatedBy,

        accountingDate || null,

        batch.created_at,
      )

    const newBatchId = Number(newBatchResult.lastInsertRowid)

    // القديمة أصبحت مستبدلة
    db.prepare(
      `
      UPDATE supplier_payment_batches

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason =
          'تم تعديل دفعة المورد',

        replacement_batch_id = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, newBatchId, batchId)

    // إلغاء حركة الدفع القديمة
    db.prepare(
      `
      UPDATE cash_movements

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason =
          'تم تعديل دفعة المورد'

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, Number(cashMovement.id))

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

        VALUES (?, ?, ?, ?, ?, ?)
        `,
    )

    const updatePurchase = db.prepare(
      `
        UPDATE purchase_invoices

        SET
          paid_amount = ?,
          remaining_amount = ?,
          payment_status = ?

        WHERE id = ?
        `,
    )

    let totalPaid = 0

    const newAllocations: Array<{
      purchase_id: number
      amount: number
    }> = []

    if (specificPurchaseId) {
      const purchase = db
        .prepare(
          `
          SELECT *

          FROM purchase_invoices

          WHERE id = ?
            AND supplier_id = ?
            AND IFNULL(
              status,
              'active'
            ) != 'cancelled'

          LIMIT 1
          `,
        )
        .get(specificPurchaseId, Number(batch.supplier_id)) as any

      if (!purchase) {
        throw new Error('فاتورة الشراء المرتبطة بالدفعة غير موجودة')
      }

      const remaining = roundMoney(Number(purchase.remaining_amount || 0))

      if (amountInput > remaining + 0.0001) {
        throw new Error('مبلغ الدفعة المعدل أكبر من المتبقي على فاتورة الشراء')
      }

      const newPaid = roundMoney(
        Number(purchase.paid_amount || 0) + amountInput,
      )

      const newRemaining = roundMoney(Math.max(0, remaining - amountInput))

      const newStatus = normalizePaymentStatus(
        Number(purchase.total_amount || 0),
        newPaid,
        newRemaining,
      )

      updatePurchase.run(newPaid, newRemaining, newStatus, specificPurchaseId)

      insertPayment.run(
        Number(batch.supplier_id),

        specificPurchaseId,

        newBatchId,

        amountInput,

        newPaymentMethod,

        newNotes || `دفعة مورد معدلة على فاتورة شراء رقم ${specificPurchaseId}`,
      )

      totalPaid = amountInput

      newAllocations.push({
        purchase_id: specificPurchaseId,

        amount: amountInput,
      })
    } else {
      let remainingPayment = amountInput

      const openPurchases = db
        .prepare(
          `
          SELECT *

          FROM purchase_invoices

          WHERE supplier_id = ?

            AND remaining_amount > 0

            AND IFNULL(
              status,
              'active'
            ) != 'cancelled'

          ORDER BY id ASC
          `,
        )
        .all(Number(batch.supplier_id)) as any[]

      for (const purchase of openPurchases) {
        if (remainingPayment <= 0.0001) {
          break
        }

        const purchaseRemaining = roundMoney(
          Number(purchase.remaining_amount || 0),
        )

        const payNow = roundMoney(Math.min(remainingPayment, purchaseRemaining))

        if (payNow <= 0) {
          continue
        }

        const newPaid = roundMoney(Number(purchase.paid_amount || 0) + payNow)

        const newRemaining = roundMoney(Math.max(0, purchaseRemaining - payNow))

        const newStatus = normalizePaymentStatus(
          Number(purchase.total_amount || 0),
          newPaid,
          newRemaining,
        )

        updatePurchase.run(
          newPaid,
          newRemaining,
          newStatus,
          Number(purchase.id),
        )

        insertPayment.run(
          Number(batch.supplier_id),

          Number(purchase.id),

          newBatchId,

          payNow,

          newPaymentMethod,

          newNotes ||
            `دفعة مورد معدلة موزعة على فاتورة شراء رقم ${purchase.id}`,
        )

        totalPaid = roundMoney(totalPaid + payNow)

        remainingPayment = roundMoney(remainingPayment - payNow)

        newAllocations.push({
          purchase_id: Number(purchase.id),

          amount: payNow,
        })
      }

      if (remainingPayment > 0.0001) {
        throw new Error('تعذر توزيع كامل مبلغ الدفعة المعدلة')
      }
    }

    if (Math.abs(totalPaid - amountInput) > 0.01) {
      throw new Error('تعذر تسجيل مبلغ دفعة المورد المعدل بالكامل')
    }

    db.prepare(
      `
      UPDATE supplier_payment_batches

      SET amount = ?

      WHERE id = ?
      `,
    ).run(totalPaid, newBatchId)

    db.prepare(
      `
      UPDATE suppliers

      SET
        balance = MAX(
          ROUND(
            IFNULL(balance, 0) - ?,
            2
          ),
          0
        ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(totalPaid, Number(batch.supplier_id))

    /*
      حركة الدفع الجديدة.
      لو الحساب الجديد رصيده غير كافٍ،
      createCashMovement هترمي Error
      وكل الـtransaction هتتراجع.
    */
    createCashMovement({
      type: 'supplier_payment',

      direction: 'out',

      amount: totalPaid,

      payment_method: newPaymentMethod,

      reference_id: newBatchId,

      reference_type: 'supplier_payment',

      notes: newNotes || 'دفعة مورد معدلة',

      created_by: originalCreatedBy,

      business_date: accountingDate || null,
    })

    return {
      success: true,

      replaced_batch_id: batchId,

      batch_id: newBatchId,

      supplier_id: Number(batch.supplier_id),

      old_amount: oldTotal,

      new_amount: totalPaid,

      payment_method: newPaymentMethod,

      allocations: newAllocations,
    }
  })

  return tx()
}

export function getSupplierStatement(
  supplierId: number,
  actorId?: number | null,
) {
  ensurePurchaseReturnSchema()

  const db = getDb()
  const id = Number(supplierId)

  if (!id) {
    throw new Error('Supplier ID is required')
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
    .get(id) as any

  if (!supplier) {
    throw new Error('المورد غير موجود')
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
    .all(id) as any[]

  const payments = db
    .prepare(
      `
      SELECT
        sp.*,

        b.purchase_id
          AS batch_purchase_id,

        b.amount
          AS batch_amount,

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
    .all(Number(actorId || 0), id) as any[]

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
    .all(id) as any[]

  const batchPayments = new Map<number, any[]>()

  const standalonePayments: any[] = []

  for (const payment of payments) {
    const batchId = Number(payment.batch_id || 0)

    if (!batchId) {
      standalonePayments.push(payment)

      continue
    }

    const current = batchPayments.get(batchId) || []

    current.push(payment)

    batchPayments.set(batchId, current)
  }

  const batchPaymentEntries = Array.from(batchPayments.entries()).map(
    ([batchId, rows]) => {
      const first = rows[0]

      const cancelled = Boolean(first.batch_cancelled_at)

      const replaced = Boolean(first.replacement_batch_id)

      const batchPurchaseId = Number(first.batch_purchase_id || 0)

      const allocations = rows.map((row) => ({
        purchase_id: Number(row.purchase_id),

        amount: Number(row.amount || 0),
      }))

      const totalAmount =
        Number(first.batch_amount || 0) ||
        allocations.reduce((sum, item) => sum + item.amount, 0)

      const allocationsText = allocations
        .map((item) => `#${item.purchase_id}: ${item.amount.toFixed(2)} ج.م`)
        .join('، ')

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
      }
    },
  )

  const standalonePaymentEntries = standalonePayments.map((payment) => {
    const initialPayment = String(payment.notes || '').startsWith(
      'دفعة عند إنشاء فاتورة شراء رقم ',
    )

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
    }
  })

  const paymentEntries = [...batchPaymentEntries, ...standalonePaymentEntries]

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

      created_at: purchase.created_at,
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

      created_at: purchaseReturn.created_at,
    })),

    ...paymentEntries,
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const totalPaid = roundMoney(
    payments.reduce((sum, payment) => {
      if (payment.batch_id && payment.batch_cancelled_at) {
        return sum
      }

      return sum + Number(payment.amount || 0)
    }, 0),
  )

  return {
    supplier,
    purchases,
    payments,
    returns,
    entries,

    summary: {
      total_purchased: Number(supplier.total_purchased || 0),

      total_paid: totalPaid,

      total_returns: returns.reduce(
        (sum, purchaseReturn) => sum + Number(purchaseReturn.total_amount || 0),
        0,
      ),

      balance: Number(supplier.balance || 0),

      open_purchases: purchases.filter(
        (purchase) => Number(purchase.remaining_amount || 0) > 0,
      ).length,
    },
  }
}
