import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'
import { calculateActivePromotionForSale } from './promotions.repo'
export type CreateSaleLineInput = {
  variant_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  quantity: number
  unit_price: number
}

type CreateSaleInput = {
  user_id: number
  customer_id?: number | null
  business_date?: string | null
  promotion_id?: number | null
  sub_total: number
  discount_value: number
  grand_total: number
  change_amount: number
  payment_method: string
  notes?: string | null

  loyalty_points_redeemed?: number
  loyalty_discount_value?: number
  paid?: number
  remaining_amount?: number
  payment_status?: string

  items: Array<{
    variant_id: number
    product_name: string
    barcode?: string | null
    size?: string | null
    color?: string | null
    quantity: number
    unit_price: number
  }>
}

function getSetting(key: string, fallback: string) {
  const db = getDb()

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined

  return row?.value ?? fallback
}

function getLoyaltySettingsForSale() {
  return {
    enabled: getSetting('loyalty_enabled', 'true') === 'true',
    earnAmount: Number(getSetting('loyalty_earn_amount', '100')),
    earnPoints: Number(getSetting('loyalty_earn_points', '1')),
    pointValue: Number(getSetting('loyalty_point_value', '1')),
    minRedeemPoints: Number(getSetting('loyalty_min_redeem_points', '1')),
  }
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getRelativeLocalDateKey(days: number) {
  const date = new Date()

  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)

  return getLocalDateKey(date)
}

function resolveSaleBusinessDate(value?: string | null) {
  const requestedDate = value?.trim() || ''
  const today = getRelativeLocalDateKey(0)

  if (!requestedDate) {
    return today
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error('تاريخ الفاتورة غير صحيح')
  }

  const allowedDates = new Set([
    getRelativeLocalDateKey(-1),
    today,
    getRelativeLocalDateKey(1),
  ])

  if (!allowedDates.has(requestedDate)) {
    throw new Error('مسموح بتاريخ الفاتورة: أمس أو اليوم أو غدًا فقط')
  }

  return requestedDate
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

export function createSale(input: CreateSaleInput) {
  const db = getDb()

  if (!input.user_id) {
    throw new Error('User ID is required')
  }

  if (!input.items?.length) {
    throw new Error('Sale items are required')
  }

  const loyalty = getLoyaltySettingsForSale()
  const businessDate = resolveSaleBusinessDate(input.business_date)

  const customerId = input.customer_id ? Number(input.customer_id) : null
  const requestedRedeemPoints = Number(input.loyalty_points_redeemed || 0)

  const tx = db.transaction(() => {
    const promotionResult = calculateActivePromotionForSale(input.items)

    const expectedPromotionId = input.promotion_id
      ? Number(input.promotion_id)
      : null

    const activePromotionId = promotionResult.promotion?.id
      ? Number(promotionResult.promotion.id)
      : null

    if (expectedPromotionId !== activePromotionId) {
      throw new Error('العرض الفعال اتغير، افتح شاشة الدفع مرة أخرى')
    }

    const subTotal = roundMoney(
      input.items.reduce((total, item) => {
        const qty = Math.max(0, Number(item.quantity || 0))

        const price = Math.max(0, Number(item.unit_price || 0))

        return total + qty * price
      }, 0),
    )

    const promotionDiscount = Math.min(
      subTotal,
      Math.max(0, Number(promotionResult.promotion_discount_value || 0)),
    )

    const totalAfterPromotion = Math.max(0, subTotal - promotionDiscount)

    const normalDiscount = Math.min(
      totalAfterPromotion,

      Math.max(0, Number(input.discount_value || 0)),
    )

    const totalAfterNormalDiscount = Math.max(
      0,
      totalAfterPromotion - normalDiscount,
    )

    let redeemPoints = 0
    let loyaltyDiscountValue = 0

    if (loyalty.enabled && customerId && requestedRedeemPoints > 0) {
      const customer = db
        .prepare(
          `
        SELECT points_balance
        FROM customers
        WHERE id = ?
        LIMIT 1
        `,
        )
        .get(customerId) as
        | {
            points_balance: number
          }
        | undefined

      if (!customer) {
        throw new Error('العميل غير موجود')
      }

      if (requestedRedeemPoints < loyalty.minRedeemPoints) {
        throw new Error(`أقل عدد نقاط للاستخدام هو ${loyalty.minRedeemPoints}`)
      }

      if (requestedRedeemPoints > Number(customer.points_balance || 0)) {
        throw new Error('رصيد نقاط العميل غير كافي')
      }

      const maxRedeemByTotal =
        loyalty.pointValue > 0
          ? Math.floor(totalAfterNormalDiscount / loyalty.pointValue)
          : 0

      redeemPoints = Math.min(requestedRedeemPoints, maxRedeemByTotal)

      loyaltyDiscountValue = redeemPoints * loyalty.pointValue
    }

    const grandTotal = Math.max(
      0,
      totalAfterNormalDiscount - loyaltyDiscountValue,
    )

    const paidAmount = Math.min(
      Math.max(Number(input.paid ?? grandTotal), 0),
      grandTotal,
    )

    const remainingAmount = Math.max(0, grandTotal - paidAmount)

    const paymentStatus =
      remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

    if (remainingAmount > 0 && !customerId) {
      throw new Error('لا يمكن البيع آجل بدون اختيار عميل')
    }

    const earnedPoints =
      loyalty.enabled && customerId
        ? Math.floor(grandTotal / loyalty.earnAmount) * loyalty.earnPoints
        : 0

    const saleResult = db
      .prepare(
        `
        INSERT INTO sales (
          type,
          customer_id,
          user_id,
          business_date,
          sub_total,
          discount_value,

          promotion_id,
          promotion_name,
          promotion_discount_value,

          grand_total,
          paid,
          remaining_amount,
          payment_status, 
          change_amount,
          payment_method,
          notes,
          loyalty_points_earned,
          loyalty_points_redeemed,
          loyalty_discount_value
        )
        VALUES (
          'sale',
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
      )
      .run(
        customerId,
        input.user_id,
        businessDate,
        subTotal,
        normalDiscount,

        promotionDiscount > 0 ? activePromotionId : null,

        promotionDiscount > 0
          ? String(promotionResult.promotion?.name || '')
          : null,

        promotionDiscount,

        grandTotal,
        paidAmount,
        remainingAmount,
        paymentStatus,
        Number(input.change_amount || 0),
        input.payment_method || 'cash',
        input.notes ?? null,
        earnedPoints,
        redeemPoints,
        loyaltyDiscountValue,
      )

    const saleId = Number(saleResult.lastInsertRowid)

    if (paidAmount > 0) {
      createCashMovement({
        type: 'sale',
        direction: 'in',
        amount: paidAmount,
        payment_method: input.payment_method || 'cash',
        reference_id: saleId,
        reference_type: 'sale',
        notes: `تحصيل فاتورة بيع رقم ${saleId}`,
        created_by: input.user_id,
        business_date: businessDate,
      })
    }

    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        unit_price,
        promotion_discount_value,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const updateStock = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'out', ?, ?, 'sale', ?)
    `)

    const getVariantCost = db.prepare(`
      SELECT buy_price
      FROM product_variants
      WHERE id = ?
      LIMIT 1
    `)

    const getCurrentStock = db.prepare(`
      SELECT IFNULL(SUM(
        CASE
          WHEN type = 'in' THEN quantity
          WHEN type = 'out' THEN -quantity
          ELSE 0
        END
      ), 0) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `)

    for (const [itemIndex, item] of input.items.entries()) {
      const qty = Number(item.quantity || 0)

      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`كمية غير صحيحة للصنف ${item.product_name}`)
      }
      const price = Number(item.unit_price || 0)
      const lineTotal = qty * price

      const variant = getVariantCost.get(item.variant_id) as
        | { buy_price: number }
        | undefined

      // const getCurrentStock = db.prepare(`
      //   SELECT IFNULL(SUM(
      //     CASE
      //       WHEN type = 'in' THEN quantity
      //       WHEN type = 'out' THEN -quantity
      //       ELSE 0
      //     END
      //   ), 0) AS stock
      //   FROM stock_movements
      //   WHERE variant_id = ?
      // `);

      const stockRow = getCurrentStock.get(item.variant_id) as { stock: number }
      const availableStock = Number(stockRow?.stock || 0)

      if (qty > availableStock) {
        throw new Error(
          `المخزون غير كافي للصنف ${item.product_name}. المتاح: ${availableStock}`,
        )
      }

      const itemPromotionDiscount = Math.max(
        0,
        Number(promotionResult.item_discounts[itemIndex] || 0),
      )

      const itemFreeQty = Math.min(
        qty,
        Math.max(
          0,
          Number(promotionResult.item_free_quantities[itemIndex] || 0),
        ),
      )

      const isBuyXGetY = promotionResult.promotion?.type === 'buy_x_get_y'

      if (isBuyXGetY && itemFreeQty > 0) {
        const paidQty = qty - itemFreeQty

        if (paidQty > 0) {
          insertItem.run(
            saleId,
            item.variant_id,
            item.product_name,
            item.barcode ?? null,
            item.size ?? null,
            item.color ?? null,
            paidQty,
            Number(variant?.buy_price || 0),
            price,
            0,
            roundMoney(paidQty * price),
          )
        }

        const giftLineTotal = roundMoney(itemFreeQty * price)

        insertItem.run(
          saleId,
          item.variant_id,
          item.product_name,
          item.barcode ?? null,
          item.size ?? null,
          item.color ?? null,
          itemFreeQty,
          Number(variant?.buy_price || 0),
          price,
          giftLineTotal,
          giftLineTotal,
        )
      } else {
        insertItem.run(
          saleId,
          item.variant_id,
          item.product_name,
          item.barcode ?? null,
          item.size ?? null,
          item.color ?? null,
          qty,
          Number(variant?.buy_price || 0),
          price,
          itemPromotionDiscount,
          lineTotal,
        )
      }

      updateStock.run(item.variant_id, qty, saleId, `بيع فاتورة رقم ${saleId}`)
    }

    if (customerId) {
      db.prepare(
        `
    UPDATE customers
    SET
      total_spent =
        IFNULL(total_spent, 0) + ?,
      balance =
        IFNULL(balance, 0) + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(grandTotal, remainingAmount, customerId)
    }

    if (customerId && loyalty.enabled) {
      db.prepare(
        `
    UPDATE customers
    SET
      points_balance =
        IFNULL(points_balance, 0) + ? - ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(earnedPoints, redeemPoints, customerId)

      if (earnedPoints > 0) {
        db.prepare(
          `
      INSERT INTO loyalty_transactions (
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes
      )
      VALUES (?, ?, 'earn', ?, ?, ?)
      `,
        ).run(
          customerId,
          saleId,
          earnedPoints,
          grandTotal,
          `اكتساب نقاط من فاتورة رقم ${saleId}`,
        )
      }

      if (redeemPoints > 0) {
        db.prepare(
          `
      INSERT INTO loyalty_transactions (
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes
      )
      VALUES (?, ?, 'redeem', ?, ?, ?)
      `,
        ).run(
          customerId,
          saleId,
          -redeemPoints,
          loyaltyDiscountValue,
          `استخدام نقاط في فاتورة رقم ${saleId}`,
        )
      }
    }

    return {
      saleId,
      loyalty_points_earned: earnedPoints,
      loyalty_points_redeemed: redeemPoints,
      loyalty_discount_value: loyaltyDiscountValue,
      promotion_id: promotionDiscount > 0 ? activePromotionId : null,

      promotion_name:
        promotionDiscount > 0
          ? (promotionResult.promotion?.name ?? null)
          : null,

      promotion_discount_value: promotionDiscount,
      grand_total: grandTotal,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus,
    }
  })

  return tx()
}

export function getSaleReceipt(saleId: number) {
  const db = getDb()

  const sale = db
    .prepare(
      `
      SELECT
        s.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        u.name AS cashier_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
      LIMIT 1
    `,
    )
    .get(saleId)

  if (!sale) {
    throw new Error('الفاتورة غير موجودة')
  }

  const items = db
    .prepare(
      `
    SELECT
      si.id,
      si.sale_id,
      si.variant_id,
      si.product_name,
      si.barcode,
      si.size,
      si.color,
      si.quantity,
      si.unit_price,
      IFNULL(
        si.promotion_discount_value,
        0
      ) AS promotion_discount_value,
      si.line_total,
      IFNULL((
        SELECT SUM(sri.quantity)
        FROM sale_returns sr
        JOIN sale_return_items sri ON sri.return_id = sr.id
        WHERE sr.original_sale_id = si.sale_id
          AND sr.cancelled_at IS NULL
          AND sri.original_sale_item_id = si.id
      ), 0) AS returned_quantity
    FROM sale_items si
    WHERE si.sale_id = ?
    ORDER BY si.id ASC
  `,
    )
    .all(saleId)

  const loyalty = db
    .prepare(
      `
      SELECT
        id,
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes,
        created_at
      FROM loyalty_transactions
      WHERE sale_id = ?
      ORDER BY id ASC
    `,
    )
    .all(saleId)

  return {
    sale,
    items,
    loyalty,
  }
}

export function listSales(input?: {
  search?: string

  payment_filter?: 'all' | 'paid' | 'unpaid'

  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
  actor_id?: number | null
}) {
  const db = getDb()

  const search = input?.search?.trim() || ''
  const paymentFilter = input?.payment_filter ?? 'all'
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)
  const offset = Math.max(Number(input?.offset || 0), 0)
  const actorId = Number(input?.actor_id || 0)
  const where: string[] = [`s.type = 'sale'`]
  const params: any[] = []

  const invoiceNumberMatch = search.match(/^#\s*(\d+)$/)

  if (invoiceNumberMatch) {
    where.push(`s.id = ?`)

    params.push(Number(invoiceNumberMatch[1]))
  } else if (search) {
    where.push(`
    (
      CAST(s.id AS TEXT) LIKE ?
      OR c.name LIKE ?
      OR c.phone LIKE ?
      OR u.name LIKE ?
    )
  `)

    const q = `%${search}%`
    params.push(q, q, q, q)
  }

  if (paymentFilter === 'paid') {
    where.push(`
    (
      s.cancelled_at IS NULL
      AND ROUND(
        IFNULL(
          s.remaining_amount,
          0
        ),
        2
      ) <= 0
    )
  `)
  } else if (paymentFilter === 'unpaid') {
    where.push(`
    (
      s.cancelled_at IS NULL
      AND ROUND(
        IFNULL(
          s.remaining_amount,
          0
        ),
        2
      ) > 0
    )
  `)
  }

  if (input?.date_from) {
    where.push(`
      COALESCE(
        NULLIF(s.business_date, ''),
        date(s.created_at, 'localtime')
      ) >= ?
    `)

    params.push(input.date_from)
  }

  if (input?.date_to) {
    where.push(`
      COALESCE(
        NULLIF(s.business_date, ''),
        date(s.created_at, 'localtime')
      ) <= ?
    `)

    params.push(input.date_to)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        s.id,
        s.customer_id,
        s.user_id,
        s.business_date,
        s.sub_total,
        s.discount_value,
        s.grand_total,
        s.paid,
        s.change_amount,
        s.remaining_amount,
        s.payment_status,
        s.payment_method,
        s.notes,
        s.loyalty_points_earned,
        s.loyalty_points_redeemed,
        s.loyalty_discount_value,
        s.created_at,
        s.cancelled_at,
        s.cancelled_by,
        s.cancel_reason,

        CASE
          WHEN s.user_id = ?
            AND datetime(s.created_at)
              BETWEEN datetime('now', '-24 hours')
              AND datetime('now')
          THEN 0
          ELSE 1
        END AS requires_admin_password,
        c.name AS customer_name,
        c.phone AS customer_phone,
        u.name AS cashier_name,
        COUNT(si.id) AS items_count,

        IFNULL(SUM(si.quantity), 0) AS total_quantity,

        IFNULL((
          SELECT SUM(sri.quantity)
          FROM sale_returns sr
          JOIN sale_return_items sri ON sri.return_id = sr.id
          WHERE sr.original_sale_id = s.id
           AND sr.cancelled_at IS NULL
        ), 0) AS returned_quantity,

        IFNULL((
          SELECT COUNT(*)
          FROM sale_returns sr
          WHERE sr.original_sale_id = s.id
            AND sr.cancelled_at IS NULL
        ), 0) AS return_count,

        IFNULL((
          SELECT SUM(sr.refund_amount)
          FROM sale_returns sr
          WHERE sr.original_sale_id = s.id
            AND sr.cancelled_at IS NULL
        ), 0) AS total_return_amount

      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN sale_items si ON si.sale_id = s.id
      ${whereSql}
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(actorId, ...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: totalRow.total,
    limit,
    offset,
  }
}

export function createSaleReturn(input: {
  original_sale_id: number
  user_id: number
  reason?: string | null
  refund_payment_method?: string | null
  items: Array<{
    sale_item_id: number
    variant_id: number
    quantity: number
  }>
}) {
  const db = getDb()

  const originalSaleId = Number(input.original_sale_id)
  const userId = Number(input.user_id)
  const reason = input.reason?.trim() || null

  if (!originalSaleId) {
    throw new Error('رقم الفاتورة الأصلية مطلوب')
  }

  if (!userId) {
    throw new Error('المستخدم مطلوب')
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف للمرتجع')
  }

  const tx = db.transaction(() => {
    const originalSale = db
      .prepare(
        `
        SELECT *
        FROM sales
        WHERE id = ?
          AND IFNULL(type, 'sale') = 'sale'
        LIMIT 1
      `,
      )
      .get(originalSaleId) as any

    if (!originalSale) {
      throw new Error('الفاتورة الأصلية غير موجودة')
    }
    if (originalSale.cancelled_at) {
      throw new Error('لا يمكن عمل مرتجع على فاتورة ملغاة')
    }

    const rawRefundPaymentMethod =
      input.refund_payment_method?.trim() ||
      originalSale.payment_method ||
      'store_cash'
    const refundPaymentMethod = resolveCashAccount(rawRefundPaymentMethod)

    const getOriginalItem = db.prepare(`
      SELECT *
      FROM sale_items
      WHERE id = ?
        AND sale_id = ?
      LIMIT 1
    `)

    const getAlreadyReturnedQty = db.prepare(`
      SELECT
        IFNULL(
          SUM(sri.quantity),
          0
        ) AS returned_qty,

        IFNULL(
          SUM(
            sri.promotion_discount_value
          ),
          0
        ) AS returned_promotion_discount

      FROM sale_returns sr

      JOIN sale_return_items sri
        ON sri.return_id = sr.id

      WHERE
        sr.original_sale_id = ?

        AND sr.cancelled_at
          IS NULL

        AND
          sri.original_sale_item_id
          = ?
    `)

    let returnSubTotal = 0
    let returnPromotionDiscount = 0
    const preparedItems = input.items
      .map((item) => {
        const originalItem = getOriginalItem.get(
          item.sale_item_id,
          originalSaleId,
        ) as any

        if (!originalItem) {
          throw new Error('صنف المرتجع غير موجود في الفاتورة الأصلية')
        }

        if (
          Number(originalItem.promotion_buy_qty || 0) > 0 &&
          Number(originalItem.promotion_free_qty || 0) > 0 &&
          Number(originalItem.promotion_discount_value || 0) > 0
        ) {
          throw new Error(
            'لا يمكن عمل مرتجع لصنف ضمن عرض اشتري وخد. استخدم الاستبدال.',
          )
        }

        const requestedQty = Number(item.quantity || 0)

        if (requestedQty <= 0) {
          return null
        }

        const alreadyReturned = getAlreadyReturnedQty.get(
          originalSaleId,
          originalItem.id,
        ) as {
          returned_qty: number
          returned_promotion_discount: number
        }

        const maxReturnable =
          Number(originalItem.quantity || 0) -
          Number(alreadyReturned?.returned_qty || 0)

        if (requestedQty > maxReturnable) {
          throw new Error(
            `الكمية المطلوبة أكبر من المتاح للمرتجع للصنف: ${originalItem.product_name}`,
          )
        }

        const unitPrice = Number(originalItem.unit_price || 0)
        const lineTotal = requestedQty * unitPrice

        returnSubTotal += lineTotal

        const originalQty = Number(originalItem.quantity || 0)

        const originalItemPromotion = Math.max(
          0,
          Number(originalItem.promotion_discount_value || 0),
        )

        const cumulativeReturnedQty =
          Number(alreadyReturned?.returned_qty || 0) + requestedQty

        const targetReturnedPromotion =
          originalQty > 0
            ? roundMoney(
                originalItemPromotion *
                  Math.min(cumulativeReturnedQty / originalQty, 1),
              )
            : 0

        const itemPromotionDiscount = Math.max(
          0,
          roundMoney(
            targetReturnedPromotion -
              Number(alreadyReturned?.returned_promotion_discount || 0),
          ),
        )

        returnPromotionDiscount += itemPromotionDiscount

        return {
          originalItem,
          quantity: requestedQty,
          unitPrice,
          lineTotal,
          promotionDiscount: itemPromotionDiscount,
        }
      })
      .filter(Boolean) as Array<{
      originalItem: any
      quantity: number
      unitPrice: number
      lineTotal: number
      promotionDiscount: number
    }>

    if (preparedItems.length === 0) {
      throw new Error('لا توجد كميات صالحة للمرتجع')
    }

    const originalSubTotal = Number(originalSale.sub_total || 0)

    const originalPromotionDiscount = Math.max(
      0,
      Number(originalSale.promotion_discount_value || 0),
    )

    const originalAfterPromotion = Math.max(
      0,
      originalSubTotal - originalPromotionDiscount,
    )

    const returnAfterPromotion = Math.max(
      0,
      returnSubTotal - returnPromotionDiscount,
    )

    const originalEarnedPoints = Math.max(
      0,
      Number(originalSale.loyalty_points_earned || 0),
    )

    const alreadyReturnedSubTotalRow = db
      .prepare(
        `
        SELECT IFNULL(SUM(sub_total), 0) AS returned_sub_total
        FROM sale_returns
        WHERE original_sale_id = ?
          AND cancelled_at IS NULL
      `,
      )
      .get(originalSaleId) as { returned_sub_total: number } | undefined

    const alreadyReversedPointsRow = db
      .prepare(
        `
        SELECT IFNULL(SUM(loyalty_points_reversed), 0) AS reversed_points
        FROM sale_returns
        WHERE original_sale_id = ?
          AND cancelled_at IS NULL
      `,
      )
      .get(originalSaleId) as { reversed_points: number } | undefined

    const alreadyReturnedSubTotal = Number(
      alreadyReturnedSubTotalRow?.returned_sub_total || 0,
    )

    const alreadyReversedPoints = Number(
      alreadyReversedPointsRow?.reversed_points || 0,
    )

    const previousReturns = db
      .prepare(
        `
      SELECT
        IFNULL(
          SUM(
            sub_total -
            IFNULL(
              promotion_discount_value,
              0
            )
          ),
          0
        ) AS returned_after_promotion,

        IFNULL(
          SUM(
            MAX(
              0,
              sub_total
              - refund_amount
              - IFNULL(
                  loyalty_discount_value,
                  0
                )
              - IFNULL(
                  promotion_discount_value,
                  0
                )
            )
          ),
          0
        ) AS returned_normal_discount,

        IFNULL(
          SUM(
            refund_amount +
            IFNULL(
              loyalty_discount_value,
              0
            )
          ),
          0
        ) AS returned_before_loyalty,

        IFNULL(
          SUM(
            loyalty_discount_value
          ),
          0
        ) AS returned_loyalty_discount,

        IFNULL(
          SUM(
            refund_amount
          ),
          0
        ) AS returned_value

      FROM sale_returns

      WHERE
        original_sale_id = ?

        AND cancelled_at
          IS NULL
      `,
      )
      .get(originalSaleId) as any

    const originalNormalDiscount = Math.max(
      0,
      Number(originalSale.discount_value || 0),
    )

    const cumulativeAfterPromotion =
      Number(previousReturns?.returned_after_promotion || 0) +
      returnAfterPromotion

    const targetNormalDiscount =
      originalAfterPromotion > 0
        ? roundMoney(
            originalNormalDiscount *
              Math.min(cumulativeAfterPromotion / originalAfterPromotion, 1),
          )
        : 0

    const saleDiscountPart = Math.max(
      0,
      roundMoney(
        targetNormalDiscount -
          Number(previousReturns?.returned_normal_discount || 0),
      ),
    )

    const currentBeforeLoyalty = Math.max(
      0,
      returnAfterPromotion - saleDiscountPart,
    )

    const originalBeforeLoyalty = Math.max(
      0,
      originalAfterPromotion - originalNormalDiscount,
    )

    const originalLoyaltyDiscount = Math.max(
      0,
      Number(originalSale.loyalty_discount_value || 0),
    )

    const cumulativeBeforeLoyalty =
      Number(previousReturns?.returned_before_loyalty || 0) +
      currentBeforeLoyalty

    const targetLoyaltyDiscount =
      originalBeforeLoyalty > 0
        ? roundMoney(
            originalLoyaltyDiscount *
              Math.min(cumulativeBeforeLoyalty / originalBeforeLoyalty, 1),
          )
        : 0

    const loyaltyDiscountPart = Math.max(
      0,
      roundMoney(
        targetLoyaltyDiscount -
          Number(previousReturns?.returned_loyalty_discount || 0),
      ),
    )

    const returnValue = Math.max(
      0,
      roundMoney(
        returnSubTotal -
          returnPromotionDiscount -
          saleDiscountPart -
          loyaltyDiscountPart,
      ),
    )

    const originalGrandTotal = Math.max(
      0,
      Number(originalSale.grand_total || 0),
    )

    const cumulativeReturnRatio =
      originalGrandTotal > 0
        ? Math.min(
            (Number(previousReturns?.returned_value || 0) + returnValue) /
              originalGrandTotal,
            1,
          )
        : 0

    const targetTotalReversedPoints = Math.floor(
      originalEarnedPoints * cumulativeReturnRatio,
    )

    const loyaltyPointsToReverse = Math.max(
      0,
      Math.min(
        originalEarnedPoints - alreadyReversedPoints,

        targetTotalReversedPoints - alreadyReversedPoints,
      ),
    )

    const originalRemainingAmount = Math.max(
      0,
      Number(originalSale.remaining_amount || 0),
    )

    const debtReductionAmount = originalSale.customer_id
      ? Math.min(returnValue, originalRemainingAmount)
      : 0

    const cashRefundAmount = Math.max(0, returnValue - debtReductionAmount)

    const returnResult = db
      .prepare(
        `
        INSERT INTO sale_returns (
          original_sale_id,
          customer_id,
          user_id,
          sub_total,
          promotion_discount_value,
          loyalty_discount_value,
          refund_amount,
          debt_reduction_amount,
          cash_refund_amount,
          payment_method,
          reason,
          notes,
          loyalty_points_reversed
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        originalSaleId,
        originalSale.customer_id ?? null,
        userId,
        returnSubTotal,
        returnPromotionDiscount,
        loyaltyDiscountPart,
        returnValue,
        debtReductionAmount,
        cashRefundAmount,
        refundPaymentMethod,
        reason,
        `مرتجع من فاتورة رقم ${originalSaleId}`,
        loyaltyPointsToReverse,
      )

    const returnId = Number(returnResult.lastInsertRowid)

    if (cashRefundAmount > 0) {
      createCashMovement({
        type: 'sale_return',
        direction: 'out',
        amount: cashRefundAmount,
        payment_method: refundPaymentMethod,
        reference_id: returnId,
        reference_type: 'sale_return',
        notes: `مرتجع RET-${String(returnId).padStart(5, '0')} من فاتورة رقم ${originalSaleId}`,
        created_by: userId,
      })
    }

    if (originalSale.customer_id && debtReductionAmount > 0) {
      const newSaleRemainingAmount = Math.max(
        0,
        originalRemainingAmount - debtReductionAmount,
      )

      const newSalePaymentStatus =
        newSaleRemainingAmount === 0
          ? 'paid'
          : Number(originalSale.paid || 0) > 0
            ? 'partial'
            : 'unpaid'

      db.prepare(
        `
        UPDATE sales
        SET
          remaining_amount = ?,
          payment_status = ?
        WHERE id = ?
      `,
      ).run(newSaleRemainingAmount, newSalePaymentStatus, originalSaleId)

      db.prepare(
        `
        UPDATE customers
        SET
          balance = MAX(IFNULL(balance, 0) - ?, 0),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      ).run(debtReductionAmount, originalSale.customer_id)

      db.prepare(
        `
        INSERT INTO customer_payments (
          customer_id,
          sale_id,
          amount,
          payment_method,
          notes
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        originalSale.customer_id,
        originalSaleId,
        debtReductionAmount,
        refundPaymentMethod,
        `تسوية مديونية بسبب مرتجع RET-${String(returnId).padStart(5, '0')}`,
      )
    }

    const insertReturnItem = db.prepare(`
      INSERT INTO sale_return_items (
        return_id,
        original_sale_item_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        unit_price,
        promotion_discount_value,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      VALUES (?, 'in', ?, ?, 'sale_return', ?)
    `)

    for (const item of preparedItems) {
      insertReturnItem.run(
        returnId,
        item.originalItem.id,
        item.originalItem.variant_id,
        item.originalItem.product_name,
        item.originalItem.barcode ?? null,
        item.originalItem.size ?? null,
        item.originalItem.color ?? null,
        item.quantity,
        Number(item.originalItem.unit_cost || 0),
        item.unitPrice,
        item.promotionDiscount,
        item.lineTotal,
      )

      insertStockMovement.run(
        item.originalItem.variant_id,
        item.quantity,
        returnId,
        `مرتجع RET-${String(returnId).padStart(5, '0')} من فاتورة رقم ${originalSaleId}`,
      )
    }

    if (originalSale.customer_id) {
      db.prepare(
        `
    UPDATE customers
    SET
      total_spent = MAX(
        IFNULL(total_spent, 0) - ?,
        0
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(returnValue, originalSale.customer_id)
    }

    if (originalSale.customer_id && loyaltyPointsToReverse > 0) {
      db.prepare(
        `
    UPDATE customers
    SET
      points_balance = MAX(
        IFNULL(points_balance, 0) - ?,
        0
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(loyaltyPointsToReverse, originalSale.customer_id)

      db.prepare(
        `
    INSERT INTO loyalty_transactions (
      customer_id,
      sale_id,
      type,
      points,
      amount,
      notes
    )
    VALUES (?, ?, 'adjust', ?, ?, ?)
    `,
      ).run(
        originalSale.customer_id,
        originalSaleId,
        -loyaltyPointsToReverse,
        returnValue,
        `خصم نقاط بسبب مرتجع RET-${String(returnId).padStart(5, '0')} من فاتورة رقم ${originalSaleId}`,
      )
    }

    return {
      returnId,
      returnCode: `RET-${String(returnId).padStart(5, '0')}`,
      returnSaleId: returnId,
      originalSaleId,
      refundAmount: cashRefundAmount,
      debt_reduction_amount: debtReductionAmount,
      return_value: returnValue,
      loyalty_points_reversed: loyaltyPointsToReverse,
    }
  })

  return tx()
}

export function getSaleReturnHistory(originalSaleId: number) {
  const db = getDb()

  const returns = db
    .prepare(
      `
      SELECT
        sr.id,
        sr.original_sale_id,
        sr.customer_id,
        sr.user_id,
        sr.sub_total,
        sr.loyalty_discount_value,
        sr.refund_amount,
        sr.payment_method,
        sr.reason AS return_reason,
        sr.notes,
        sr.loyalty_points_reversed,
        sr.debt_reduction_amount,
        sr.cash_refund_amount,
        sr.cancelled_at,
        sr.cancelled_by,
        sr.cancel_reason,
        sr.created_at,
        c.name AS customer_name,
        u.name AS cashier_name,
        COUNT(sri.id) AS items_count,
        IFNULL(SUM(sri.quantity), 0) AS total_quantity
      FROM sale_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      LEFT JOIN sale_return_items sri ON sri.return_id = sr.id
      WHERE sr.original_sale_id = ?
      GROUP BY sr.id
      ORDER BY sr.id DESC
    `,
    )
    .all(originalSaleId) as any[]

  const getItems = db.prepare(`
    SELECT
      id,
      return_id,
      original_sale_item_id,
      variant_id,
      product_name,
      barcode,
      size,
      color,
      quantity,
      unit_price,
      line_total
    FROM sale_return_items
    WHERE return_id = ?
    ORDER BY id ASC
  `)

  return returns.map((item) => ({
    ...item,
    code: `RET-${String(item.id).padStart(5, '0')}`,
    grand_total: item.refund_amount,
    items: getItems.all(item.id),
  }))
}

export function getSaleCancellationAccess(
  saleId: number,
  actorId?: number | null,
) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT
        id,
        user_id,
        CASE
          WHEN user_id = ?
            AND datetime(created_at)
              BETWEEN datetime('now', '-24 hours')
              AND datetime('now')
          THEN 0
          ELSE 1
        END AS requires_admin_password
      FROM sales
      WHERE id = ?
        AND IFNULL(type, 'sale') = 'sale'
      LIMIT 1
      `,
    )
    .get(Number(actorId || 0), Number(saleId)) as
    | {
        id: number
        user_id: number
        requires_admin_password: number
      }
    | undefined

  if (!row) {
    throw new Error('فاتورة البيع غير موجودة')
  }

  return {
    sale_id: row.id,
    user_id: row.user_id,
    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  }
}

export function getSaleReturnCancellationAccess(
  returnId: number,
  actorId?: number | null,
) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT
        id,
        user_id,
        CASE
          WHEN user_id = ?
            AND datetime(created_at)
              BETWEEN datetime('now', '-24 hours')
              AND datetime('now')
          THEN 0
          ELSE 1
        END AS requires_admin_password
      FROM sale_returns
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(Number(actorId || 0), Number(returnId)) as
    | {
        id: number
        user_id: number
        requires_admin_password: number
      }
    | undefined

  if (!row) {
    throw new Error('مرتجع البيع غير موجود')
  }

  return {
    return_id: row.id,
    user_id: row.user_id,
    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  }
}

export function cancelSaleInvoice(input: {
  sale_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const saleId = Number(input.sale_id)

  if (!saleId) {
    throw new Error('رقم فاتورة البيع غير صحيح')
  }

  const reason = input.reason?.trim() || 'إلغاء فاتورة بيع'

  const tx = db.transaction(() => {
    const sale = db
      .prepare(
        `
        SELECT *
        FROM sales
        WHERE id = ?
          AND IFNULL(type, 'sale') = 'sale'
        LIMIT 1
        `,
      )
      .get(saleId) as any

    if (!sale) {
      throw new Error('فاتورة البيع غير موجودة')
    }

    if (sale.cancelled_at) {
      throw new Error('فاتورة البيع ملغاة بالفعل')
    }

    const saleBusinessDateRow = db
      .prepare(
        `
    SELECT
      COALESCE(
        NULLIF(business_date, ''),
        date(created_at, 'localtime')
      ) AS business_date
    FROM sales
    WHERE id = ?
    LIMIT 1
    `,
      )
      .get(saleId) as { business_date: string } | undefined

    const saleBusinessDate = saleBusinessDateRow?.business_date || ''

    if (saleBusinessDate) {
      const closedDay = db
        .prepare(
          `
      SELECT id
      FROM cash_day_closings
      WHERE business_date = ?
      LIMIT 1
      `,
        )
        .get(saleBusinessDate)

      if (closedDay) {
        throw new Error(
          `لا يمكن إلغاء فاتورة تخص يوم ${saleBusinessDate} لأنه تم تقفيله`,
        )
      }
    }

    const returnsRow = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM sale_returns
        WHERE original_sale_id = ?
          AND cancelled_at IS NULL
        `,
      )
      .get(saleId) as any

    if (Number(returnsRow?.count || 0) > 0) {
      throw new Error('لا يمكن إلغاء الفاتورة قبل إلغاء المرتجعات الخاصة بها')
    }

    const laterPayments = db
      .prepare(
        `
        SELECT COUNT(*) AS count

        FROM customer_payments cp

        LEFT JOIN customer_payment_batches b
          ON b.id = cp.batch_id

        WHERE cp.sale_id = ?

          AND (
            cp.batch_id IS NULL
            OR b.cancelled_at IS NULL
          )
        `,
      )
      .get(saleId) as any

    if (Number(laterPayments?.count || 0) > 0) {
      throw new Error('لا يمكن إلغاء الفاتورة لأنها تحتوي على دفعات عميل لاحقة')
    }

    const items = db
      .prepare(
        `
        SELECT *
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
        `,
      )
      .all(saleId) as any[]

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل الفاتورة')
    }

    const customerId = Number(sale.customer_id || 0)

    const earnedPoints = Math.max(0, Number(sale.loyalty_points_earned || 0))

    const redeemedPoints = Math.max(
      0,
      Number(sale.loyalty_points_redeemed || 0),
    )

    if (customerId && earnedPoints > 0) {
      const customer = db
        .prepare(
          `
          SELECT points_balance
          FROM customers
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(customerId) as any

      const currentPoints = Number(customer?.points_balance || 0)

      if (currentPoints + redeemedPoints < earnedPoints) {
        throw new Error('لا يمكن إلغاء الفاتورة لأن نقاطها تم استخدامها بالفعل')
      }
    }

    const paidAmount = Math.max(0, Number(sale.paid || 0))

    const remainingAmount = Math.max(0, Number(sale.remaining_amount || 0))

    const grandTotal = Math.max(0, Number(sale.grand_total || 0))

    /*
     * رد المبلغ المدفوع للعميل الآن.
     * الحركة الأصلية تظل محفوظة.
     */
    if (paidAmount > 0) {
      createCashMovement({
        type: 'sale',
        direction: 'out',
        amount: paidAmount,
        payment_method: sale.payment_method || 'store_cash',
        reference_id: saleId,
        reference_type: 'sale_cancel',
        notes: `رد قيمة فاتورة بيع ملغاة رقم ${saleId}`,
        created_by: input.actor_id ?? null,
      })
    }

    const restoreStock = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'in', ?, ?, 'sale_cancel', ?)
    `)

    for (const item of items) {
      restoreStock.run(
        Number(item.variant_id),
        Number(item.quantity || 0),
        saleId,
        `إرجاع مخزون بسبب إلغاء فاتورة بيع رقم ${saleId}`,
      )
    }

    if (customerId) {
      db.prepare(
        `
        UPDATE customers
        SET
          balance = MAX(
            IFNULL(balance, 0) - ?,
            0
          ),
          total_spent = MAX(
            IFNULL(total_spent, 0) - ?,
            0
          ),
          points_balance = MAX(
            IFNULL(points_balance, 0)
            - ?
            + ?,
            0
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(
        remainingAmount,
        grandTotal,
        earnedPoints,
        redeemedPoints,
        customerId,
      )

      const pointsAdjustment = redeemedPoints - earnedPoints

      if (pointsAdjustment !== 0) {
        db.prepare(
          `
          INSERT INTO loyalty_transactions (
            customer_id,
            sale_id,
            type,
            points,
            amount,
            notes
          )
          VALUES (?, ?, 'adjust', ?, ?, ?)
          `,
        ).run(
          customerId,
          saleId,
          pointsAdjustment,
          grandTotal,
          `عكس نقاط بسبب إلغاء فاتورة بيع رقم ${saleId}`,
        )
      }
    }

    db.prepare(
      `
      UPDATE sales
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?,
        payment_status = 'cancelled',
        remaining_amount = 0
      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, saleId)

    return {
      ok: true,
      sale_id: saleId,
      refunded_amount: paidAmount,
      removed_debt: remainingAmount,
      restored_items: items.length,
    }
  })

  return tx()
}

export function cancelSaleReturn(input: {
  return_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const returnId = Number(input.return_id)

  if (!returnId) {
    throw new Error('رقم المرتجع غير صحيح')
  }

  const reason = input.reason?.trim() || 'إلغاء مرتجع بيع'

  const returnCode = `RET-${String(returnId).padStart(5, '0')}`

  const tx = db.transaction(() => {
    const saleReturn = db
      .prepare(
        `
        SELECT
          sr.*,
          s.grand_total AS sale_grand_total,
          s.paid AS sale_paid,
          s.remaining_amount AS sale_remaining,
          s.cancelled_at AS sale_cancelled_at
        FROM sale_returns sr
        JOIN sales s
          ON s.id = sr.original_sale_id
        WHERE sr.id = ?
        LIMIT 1
        `,
      )
      .get(returnId) as any

    if (!saleReturn) {
      throw new Error('مرتجع البيع غير موجود')
    }

    if (saleReturn.cancelled_at) {
      throw new Error('مرتجع البيع ملغي بالفعل')
    }

    const returnBusinessDateRow = db
      .prepare(
        `
    SELECT
      date(created_at, 'localtime') AS business_date
    FROM sale_returns
    WHERE id = ?
    LIMIT 1
    `,
      )
      .get(returnId) as { business_date: string } | undefined

    const returnBusinessDate = returnBusinessDateRow?.business_date || ''

    if (returnBusinessDate) {
      const closedDay = db
        .prepare(
          `
      SELECT id
      FROM cash_day_closings
      WHERE business_date = ?
      LIMIT 1
      `,
        )
        .get(returnBusinessDate)

      if (closedDay) {
        throw new Error(
          `لا يمكن إلغاء مرتجع يخص يوم ${returnBusinessDate} لأنه تم تقفيله`,
        )
      }
    }

    if (saleReturn.sale_cancelled_at) {
      throw new Error('لا يمكن إلغاء المرتجع لأن الفاتورة الأصلية ملغاة')
    }

    const items = db
      .prepare(
        `
        SELECT *
        FROM sale_return_items
        WHERE return_id = ?
        ORDER BY id ASC
        `,
      )
      .all(returnId) as any[]

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل المرتجع')
    }

    const getCurrentStock = db.prepare(`
      SELECT IFNULL(
        SUM(
          CASE
            WHEN type = 'in'
              THEN quantity
            WHEN type = 'out'
              THEN -quantity
            ELSE 0
          END
        ),
        0
      ) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `)

    for (const item of items) {
      const stockRow = getCurrentStock.get(Number(item.variant_id)) as any

      const currentStock = Number(stockRow?.stock || 0)

      const qty = Number(item.quantity || 0)

      if (currentStock < qty) {
        throw new Error(
          `لا يمكن إلغاء المرتجع لأن مخزون الصنف "${item.product_name}" أقل من كمية المرتجع`,
        )
      }
    }

    /*
     * دعم المرتجعات القديمة قبل إضافة
     * cash_refund_amount.
     */
    const cashRow = db
      .prepare(
        `
        SELECT IFNULL(SUM(amount), 0) AS amount
        FROM cash_movements
        WHERE type = 'sale_return'
          AND direction = 'out'
          AND reference_type = 'sale_return'
          AND reference_id = ?
          AND cancelled_at IS NULL
        `,
      )
      .get(returnId) as any

    const cashRefundAmount =
      saleReturn.cash_refund_amount !== null &&
      saleReturn.cash_refund_amount !== undefined
        ? Number(saleReturn.cash_refund_amount || 0)
        : Number(cashRow?.amount || 0)

    const settlementRow = db
      .prepare(
        `
        SELECT IFNULL(SUM(amount), 0) AS amount
        FROM customer_payments
        WHERE sale_id = ?
          AND notes LIKE ?
        `,
      )
      .get(
        Number(saleReturn.original_sale_id),
        `تسوية مديونية بسبب مرتجع ${returnCode}%`,
      ) as any

    const debtReductionAmount =
      saleReturn.debt_reduction_amount !== null &&
      saleReturn.debt_reduction_amount !== undefined
        ? Number(saleReturn.debt_reduction_amount || 0)
        : Number(settlementRow?.amount || 0)

    /*
     * عكس رد الكاش:
     * الكاش يرجع للحساب.
     */
    if (cashRefundAmount > 0) {
      createCashMovement({
        type: 'sale_return',
        direction: 'in',
        amount: cashRefundAmount,
        payment_method: saleReturn.payment_method || 'store_cash',
        reference_id: returnId,
        reference_type: 'sale_return_cancel',
        notes: `عكس مرتجع بيع ملغي ${returnCode}`,
        created_by: input.actor_id ?? null,
      })
    }

    const removeReturnedStock = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (
        ?,
        'out',
        ?,
        ?,
        'sale_return_cancel',
        ?
      )
    `)

    for (const item of items) {
      removeReturnedStock.run(
        Number(item.variant_id),
        Number(item.quantity || 0),
        returnId,
        `عكس مخزون مرتجع بيع ملغي ${returnCode}`,
      )
    }

    const saleId = Number(saleReturn.original_sale_id)

    if (saleReturn.customer_id && debtReductionAmount > 0) {
      const maxRemaining = Math.max(
        0,
        Number(saleReturn.sale_grand_total || 0) -
          Number(saleReturn.sale_paid || 0),
      )

      const newRemaining = Math.min(
        maxRemaining,
        Math.max(
          0,
          Number(saleReturn.sale_remaining || 0) + debtReductionAmount,
        ),
      )

      const newStatus =
        newRemaining <= 0
          ? 'paid'
          : Number(saleReturn.sale_paid || 0) > 0
            ? 'partial'
            : 'unpaid'

      db.prepare(
        `
        UPDATE sales
        SET
          remaining_amount = ?,
          payment_status = ?
        WHERE id = ?
        `,
      ).run(newRemaining, newStatus, saleId)

      db.prepare(
        `
        UPDATE customers
        SET
          balance =
            IFNULL(balance, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(debtReductionAmount, Number(saleReturn.customer_id))

      /*
       * دي حركة داخلية أنشأها المرتجع نفسه،
       * مش دفعة حقيقية من العميل.
       */
      db.prepare(
        `
        DELETE FROM customer_payments
        WHERE sale_id = ?
          AND notes LIKE ?
        `,
      ).run(saleId, `تسوية مديونية بسبب مرتجع ${returnCode}%`)
    }

    if (saleReturn.customer_id) {
      db.prepare(
        `
    UPDATE customers
    SET
      total_spent =
        IFNULL(total_spent, 0) + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(
        Number(saleReturn.refund_amount || 0),
        Number(saleReturn.customer_id),
      )
    }

    const reversedPoints = Math.max(
      0,
      Number(saleReturn.loyalty_points_reversed || 0),
    )

    if (saleReturn.customer_id && reversedPoints > 0) {
      db.prepare(
        `
    UPDATE customers
    SET
      points_balance =
        IFNULL(points_balance, 0) + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
      ).run(reversedPoints, Number(saleReturn.customer_id))

      db.prepare(
        `
    INSERT INTO loyalty_transactions (
      customer_id,
      sale_id,
      type,
      points,
      amount,
      notes
    )
    VALUES (?, ?, 'adjust', ?, ?, ?)
    `,
      ).run(
        Number(saleReturn.customer_id),
        saleId,
        reversedPoints,
        Number(saleReturn.refund_amount || 0),
        `إرجاع نقاط بسبب إلغاء المرتجع ${returnCode}`,
      )
    }

    db.prepare(
      `
      UPDATE sale_returns
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?
      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, returnId)

    return {
      ok: true,
      return_id: returnId,
      sale_id: saleId,
      cash_restored: cashRefundAmount,
      debt_restored: debtReductionAmount,
      items_count: items.length,
    }
  })

  return tx()
}

export function listSaleReturns(input?: {
  search?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
  actor_id?: number | null
}) {
  const db = getDb()

  const search = input?.search?.trim() || ''
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)
  const offset = Math.max(Number(input?.offset || 0), 0)
  const actorId = Number(input?.actor_id || 0)

  const where: string[] = []
  const params: any[] = []

  if (search) {
    where.push(`
      (
        CAST(sr.id AS TEXT) LIKE ?
        OR CAST(sr.original_sale_id AS TEXT) LIKE ?
        OR c.name LIKE ?
        OR c.phone LIKE ?
        OR u.name LIKE ?
        OR IFNULL(sr.reason, '') LIKE ?
      )
    `)

    const q = `%${search}%`
    params.push(q, q, q, q, q, q)
  }

  if (input?.date_from) {
    where.push(`datetime(sr.created_at, 'localtime') >= datetime(?)`)
    params.push(`${input.date_from} 00:00:00`)
  }

  if (input?.date_to) {
    where.push(`datetime(sr.created_at, 'localtime') <= datetime(?)`)
    params.push(`${input.date_to} 23:59:59`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        sr.id,
        sr.original_sale_id,
        sr.customer_id,
        sr.user_id,
        sr.sub_total,
        sr.loyalty_discount_value,
        sr.refund_amount,
        sr.payment_method,
        sr.reason,
        sr.notes,
        sr.cancelled_at,
        sr.cancelled_by,
        sr.cancel_reason,

        CASE
          WHEN sr.user_id = ?
            AND datetime(sr.created_at)
              BETWEEN datetime('now', '-24 hours')
              AND datetime('now')
          THEN 0
          ELSE 1
        END AS requires_admin_password,
        sr.loyalty_points_reversed,
        sr.created_at,
        c.name AS customer_name,
        c.phone AS customer_phone,
        u.name AS cashier_name,
        COUNT(sri.id) AS items_count,
        IFNULL(SUM(sri.quantity), 0) AS total_quantity
      FROM sale_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      LEFT JOIN sale_return_items sri ON sri.return_id = sr.id
      ${whereSql}
      GROUP BY sr.id
      ORDER BY sr.id DESC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(actorId, ...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM sale_returns sr
      LEFT JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN users u ON u.id = sr.user_id
      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows: (rows as any[]).map((row) => ({
      ...row,
      code: `RET-${String(row.id).padStart(5, '0')}`,
    })),
    total: totalRow.total,
    limit,
    offset,
  }
}
