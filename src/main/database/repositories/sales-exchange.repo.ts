import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'
import { getSaleCurrentState } from './sales-current-state.repo'

export type CreateSaleExchangeInput = {
  original_sale_id: number
  user_id: number
  payment_method?: string | null
  reason?: string | null

  items: Array<{
    promotion_unit_id: number
    new_variant_id: number
  }>
}

type PromotionSnapshotRow = {
  sale_id: number
  promotion_id: number
  promotion_name: string
  promotion_type: string
  promotion_value: number
  buy_qty: number | null
  free_qty: number | null
  scope_type: string
  category_id: number | null
  product_ids_json: string
}

type PromotionUnitRow = {
  id: number
  sale_id: number
  original_sale_item_id: number
  promotion_group_id: string

  original_variant_id: number
  current_variant_id: number

  original_unit_price: number
  current_unit_price: number

  original_is_gift: number
  current_is_gift: number

  is_returned: number
}

type ExchangeVariantRow = {
  variant_id: number
  product_id: number
  product_name: string
  category_id: number | null

  barcode: string | null
  size: string | null
  color: string | null

  buy_price: number
  sell_price: number
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

function getLocalDateKey() {
  const date = new Date()

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function parseProductIds(value: string) {
  try {
    const parsed = JSON.parse(value || '[]')

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.map(Number).filter((id) => Number.isFinite(id) && id > 0)
  } catch {
    return []
  }
}

function getCurrentStock(db: ReturnType<typeof getDb>, variantId: number) {
  const row = db
    .prepare(
      `
      SELECT
        IFNULL(
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
      `,
    )
    .get(variantId) as
    | {
        stock: number
      }
    | undefined

  return Number(row?.stock || 0)
}

function getExchangeVariant(db: ReturnType<typeof getDb>, variantId: number) {
  return db
    .prepare(
      `
      SELECT
        v.id AS variant_id,
        v.product_id,
        p.name AS product_name,
        p.category_id,

        v.barcode,
        v.size,
        v.color,
        v.buy_price,

        CASE
          WHEN v.discount_price IS NOT NULL
            AND v.discount_price > 0
            AND v.discount_price < v.sell_price
          THEN v.discount_price
          ELSE v.sell_price
        END AS sell_price

      FROM product_variants v

      JOIN products p
        ON p.id = v.product_id

      WHERE v.id = ?
        AND v.is_active = 1
        AND p.is_active = 1

      LIMIT 1
      `,
    )
    .get(variantId) as ExchangeVariantRow | undefined
}

function isVariantInsideSnapshot(
  variant: ExchangeVariantRow,
  snapshot: PromotionSnapshotRow,
) {
  if (snapshot.scope_type === 'all') {
    return true
  }

  if (snapshot.scope_type === 'category') {
    return Number(variant.category_id) === Number(snapshot.category_id)
  }

  if (snapshot.scope_type === 'products') {
    const productIds = new Set(parseProductIds(snapshot.product_ids_json))

    return productIds.has(Number(variant.product_id))
  }

  return false
}

export function getSaleExchangeState(saleIdInput: number) {
  const db = getDb()
  const saleId = Number(saleIdInput)

  if (!saleId) {
    throw new Error('رقم الفاتورة غير صحيح')
  }

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
    throw new Error('الفاتورة الأصلية غير موجودة')
  }

  const snapshot = db
    .prepare(
      `
      SELECT *
      FROM sale_promotion_snapshots
      WHERE sale_id = ?
      LIMIT 1
      `,
    )
    .get(saleId) as PromotionSnapshotRow | undefined

  if (!snapshot) {
    throw new Error('الفاتورة لا تحتوي على نسخة محفوظة من العرض الأصلي')
  }

  const units = db
    .prepare(
      `
      SELECT
        spu.*,

        p.id AS current_product_id,
        p.name AS current_product_name,
        p.category_id AS current_category_id,

        v.barcode AS current_barcode,
        v.size AS current_size,
        v.color AS current_color

      FROM sale_promotion_units spu

      JOIN product_variants v
        ON v.id = spu.current_variant_id

      JOIN products p
        ON p.id = v.product_id

      WHERE spu.sale_id = ?

      ORDER BY
        spu.promotion_group_id ASC,
        spu.id ASC
      `,
    )
    .all(saleId) as any[]

  const groupMap = new Map<
    string,
    {
      promotion_group_id: string
      units: any[]
    }
  >()

  for (const unit of units) {
    const groupId = String(unit.promotion_group_id)

    const current = groupMap.get(groupId)

    if (current) {
      current.units.push(unit)
    } else {
      groupMap.set(groupId, {
        promotion_group_id: groupId,
        units: [unit],
      })
    }
  }

  const currentState = getSaleCurrentState(saleId)

  return {
    sale,
    snapshot: {
      ...snapshot,
      product_ids: parseProductIds(snapshot.product_ids_json),
    },
    groups: Array.from(groupMap.values()),
    financials: currentState.financials,
  }
}

export function createSaleExchange(input: CreateSaleExchangeInput) {
  const db = getDb()

  const saleId = Number(input.original_sale_id)
  const userId = Number(input.user_id)

  if (!saleId) {
    throw new Error('رقم الفاتورة الأصلية مطلوب')
  }

  if (!userId) {
    throw new Error('المستخدم مطلوب')
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف للاستبدال')
  }

  const normalizedItems = input.items.map((item) => ({
    promotion_unit_id: Number(item.promotion_unit_id),
    new_variant_id: Number(item.new_variant_id),
  }))

  for (const item of normalizedItems) {
    if (!item.promotion_unit_id) {
      throw new Error('وحدة العرض المطلوب استبدالها غير صحيحة')
    }

    if (!item.new_variant_id) {
      throw new Error('الصنف البديل غير صحيح')
    }
  }

  const uniqueUnitIds = new Set(
    normalizedItems.map((item) => item.promotion_unit_id),
  )

  if (uniqueUnitIds.size !== normalizedItems.length) {
    throw new Error('لا يمكن اختيار نفس قطعة العرض أكثر من مرة')
  }

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
      throw new Error('الفاتورة الأصلية غير موجودة')
    }

    if (sale.cancelled_at) {
      throw new Error('لا يمكن عمل استبدال على فاتورة ملغاة')
    }

    const snapshot = db
      .prepare(
        `
        SELECT *
        FROM sale_promotion_snapshots
        WHERE sale_id = ?
        LIMIT 1
        `,
      )
      .get(saleId) as PromotionSnapshotRow | undefined

    if (!snapshot) {
      throw new Error(
        'لا يمكن استبدال عرض قديم لا يحتوي على نسخة محفوظة من شروط العرض',
      )
    }

    if (snapshot.promotion_type !== 'buy_x_get_y') {
      throw new Error('الاستبدال بهذه الطريقة متاح لعروض اشتري وخد فقط')
    }

    const buyQty = Math.floor(Number(snapshot.buy_qty || 0))

    const freeQty = Math.floor(Number(snapshot.free_qty || 0))

    if (buyQty <= 0 || freeQty <= 0) {
      throw new Error('شروط العرض الأصلي غير صالحة للاستبدال')
    }

    const groupSize = buyQty + freeQty

    const getUnit = db.prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE id = ?
        AND sale_id = ?
      LIMIT 1
      `,
    )

    const selectedUnits = normalizedItems.map((item) => {
      const unit = getUnit.get(item.promotion_unit_id, saleId) as
        | PromotionUnitRow
        | undefined

      if (!unit) {
        throw new Error('قطعة الاستبدال غير موجودة داخل الفاتورة')
      }

      if (Number(unit.is_returned) === 1) {
        throw new Error('لا يمكن استبدال قطعة تم إرجاعها بالفعل')
      }

      return unit
    })

    const promotionGroupId = String(selectedUnits[0].promotion_group_id)

    if (
      selectedUnits.some(
        (unit) => String(unit.promotion_group_id) !== promotionGroupId,
      )
    ) {
      throw new Error('عملية الاستبدال الواحدة يجب أن تكون داخل عرض واحد فقط')
    }

    const groupUnits = db
      .prepare(
        `
        SELECT *
        FROM sale_promotion_units
        WHERE sale_id = ?
          AND promotion_group_id = ?
        ORDER BY id ASC
        `,
      )
      .all(saleId, promotionGroupId) as PromotionUnitRow[]

    if (groupUnits.length !== groupSize) {
      throw new Error('بيانات العرض المحفوظة غير مكتملة')
    }

    if (groupUnits.some((unit) => Number(unit.is_returned) === 1)) {
      throw new Error('لا يمكن استبدال عرض تم إرجاعه')
    }

    if (normalizedItems.length !== 1 && normalizedItems.length !== groupSize) {
      throw new Error(
        'الاستبدال داخل العرض مسموح لقطعة واحدة أو العرض كاملًا فقط',
      )
    }

    const replacementMap = new Map<number, ExchangeVariantRow>()

    const outgoingQuantities = new Map<number, number>()

    const incomingQuantities = new Map<number, number>()

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const request = normalizedItems[index]

      const unit = selectedUnits[index]

      if (request.new_variant_id === Number(unit.current_variant_id)) {
        throw new Error('الصنف البديل هو نفس الصنف الحالي')
      }

      const newVariant = getExchangeVariant(db, request.new_variant_id)

      if (!newVariant) {
        throw new Error('الصنف البديل غير موجود أو غير فعال')
      }

      if (!isVariantInsideSnapshot(newVariant, snapshot)) {
        throw new Error('الصنف البديل خارج نطاق العرض الأصلي')
      }

      replacementMap.set(unit.id, newVariant)

      outgoingQuantities.set(
        newVariant.variant_id,
        Number(outgoingQuantities.get(newVariant.variant_id) || 0) + 1,
      )

      incomingQuantities.set(
        Number(unit.current_variant_id),
        Number(incomingQuantities.get(Number(unit.current_variant_id)) || 0) +
          1,
      )
    }

    for (const [variantId, requiredQty] of outgoingQuantities.entries()) {
      const availableStock = getCurrentStock(db, variantId)

      const incomingQty = Number(incomingQuantities.get(variantId) || 0)

      if (availableStock + incomingQty < requiredQty) {
        throw new Error(
          `المخزون غير كافٍ للصنف البديل. المتاح: ${availableStock}`,
        )
      }
    }

    const beforeState = groupUnits.map((unit) => ({
      id: Number(unit.id),
      current_variant_id: Number(unit.current_variant_id),
      current_unit_price: Number(unit.current_unit_price),
      current_is_gift: Number(unit.current_is_gift),
    }))

    const oldGroupTotal = roundMoney(
      beforeState.reduce(
        (total, unit) =>
          total + (unit.current_is_gift === 1 ? 0 : unit.current_unit_price),
        0,
      ),
    )

    const afterState = beforeState.map((unit) => {
      const replacement = replacementMap.get(unit.id)

      if (!replacement) {
        return {
          ...unit,
        }
      }

      return {
        ...unit,
        current_variant_id: replacement.variant_id,
        current_unit_price: Number(replacement.sell_price),
      }
    })

    const giftUnitIds = new Set(
      [...afterState]
        .sort(
          (a, b) => a.current_unit_price - b.current_unit_price || a.id - b.id,
        )
        .slice(0, freeQty)
        .map((unit) => unit.id),
    )

    for (const unit of afterState) {
      unit.current_is_gift = giftUnitIds.has(unit.id) ? 1 : 0
    }

    const newGroupTotal = roundMoney(
      afterState.reduce(
        (total, unit) =>
          total + (unit.current_is_gift === 1 ? 0 : unit.current_unit_price),
        0,
      ),
    )

    /*
     * The settlement must be based on the
     * CURRENT NET INVOICE, not only the
     * raw promotion bundle.
     *
     * This prevents over-refunding when the
     * original sale also had a normal or
     * loyalty discount.
     */
    const currentStateBefore = getSaleCurrentState(saleId)

    const beforeGroupGross = roundMoney(
      beforeState.reduce(
        (total, unit) => total + Number(unit.current_unit_price || 0),
        0,
      ),
    )

    const beforeGroupPromotionDiscount = roundMoney(
      beforeState.reduce(
        (total, unit) =>
          total +
          (Number(unit.current_is_gift || 0) === 1
            ? Number(unit.current_unit_price || 0)
            : 0),
        0,
      ),
    )

    const afterGroupGross = roundMoney(
      afterState.reduce(
        (total, unit) => total + Number(unit.current_unit_price || 0),
        0,
      ),
    )

    const afterGroupPromotionDiscount = roundMoney(
      afterState.reduce(
        (total, unit) =>
          total +
          (Number(unit.current_is_gift || 0) === 1
            ? Number(unit.current_unit_price || 0)
            : 0),
        0,
      ),
    )

    const nextSubTotal = roundMoney(
      currentStateBefore.financials.current_sub_total -
        beforeGroupGross +
        afterGroupGross,
    )

    const nextPromotionDiscount = Math.max(
      0,
      roundMoney(
        currentStateBefore.financials.current_promotion_discount_value -
          beforeGroupPromotionDiscount +
          afterGroupPromotionDiscount,
      ),
    )

    const nextAfterPromotion = Math.max(
      0,
      roundMoney(nextSubTotal - nextPromotionDiscount),
    )

    const nextNormalDiscount = roundMoney(
      Math.min(
        currentStateBefore.financials.original_normal_discount_value,

        nextAfterPromotion,
      ),
    )

    const nextAfterNormal = Math.max(
      0,
      roundMoney(nextAfterPromotion - nextNormalDiscount),
    )

    const nextLoyaltyDiscount = roundMoney(
      Math.min(
        currentStateBefore.financials.original_loyalty_discount_value,

        nextAfterNormal,
      ),
    )

    const nextGrandTotal = Math.max(
      0,
      roundMoney(nextAfterNormal - nextLoyaltyDiscount),
    )

    /*
     * Existing returns remain historical
     * settled events. An exchange can only
     * affect what is still active.
     */
    const nextNetGrandTotal = Math.max(
      0,
      roundMoney(
        nextGrandTotal - currentStateBefore.financials.total_return_value,
      ),
    )

    const differenceAmount = roundMoney(
      nextNetGrandTotal - currentStateBefore.financials.net_grand_total,
    )

    const paymentMethod = resolveCashAccount(
      input.payment_method?.trim() || sale.payment_method || 'store_cash',
    )

    const businessDate = getLocalDateKey()

    const closedDay = db
      .prepare(
        `
        SELECT id
        FROM cash_day_closings
        WHERE business_date = ?
        LIMIT 1
        `,
      )
      .get(businessDate)

    if (closedDay) {
      throw new Error(`لا يمكن عمل استبدال لأن يوم ${businessDate} تم تقفيله`)
    }

    let cashCollectionAmount = 0
    let debtReductionAmount = 0
    let cashRefundAmount = 0

    if (differenceAmount > 0) {
      cashCollectionAmount = differenceAmount
    }

    if (differenceAmount < 0) {
      const customerCredit = Math.abs(differenceAmount)

      const currentDebt = Math.max(0, Number(sale.remaining_amount || 0))

      debtReductionAmount = sale.customer_id
        ? Math.min(customerCredit, currentDebt)
        : 0

      cashRefundAmount = roundMoney(customerCredit - debtReductionAmount)
    }

    const exchangeResult = db
      .prepare(
        `
        INSERT INTO sale_exchanges (
          original_sale_id,
          user_id,
          promotion_group_id,
          old_group_total,
          new_group_total,
          difference_amount,
          cash_collection_amount,
          debt_reduction_amount,
          cash_refund_amount,
          payment_method,
          reason,
          before_state_json,
          after_state_json,
          business_date
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        `,
      )
      .run(
        saleId,
        userId,
        promotionGroupId,
        oldGroupTotal,
        newGroupTotal,
        differenceAmount,
        cashCollectionAmount,
        debtReductionAmount,
        cashRefundAmount,
        paymentMethod,
        input.reason?.trim() || null,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        businessDate,
      )

    const exchangeId = Number(exchangeResult.lastInsertRowid)

    const exchangeCode = `EXC-${String(exchangeId).padStart(5, '0')}`

    if (cashCollectionAmount > 0) {
      createCashMovement({
        type: 'sale_exchange',
        direction: 'in',
        amount: cashCollectionAmount,
        payment_method: paymentMethod,
        reference_id: exchangeId,
        reference_type: 'sale_exchange',
        notes: `تحصيل فرق استبدال ${exchangeCode} ` + `لفاتورة رقم ${saleId}`,
        created_by: userId,
        business_date: businessDate,
      })
    }

    if (cashRefundAmount > 0) {
      createCashMovement({
        type: 'sale_exchange',
        direction: 'out',
        amount: cashRefundAmount,
        payment_method: paymentMethod,
        reference_id: exchangeId,
        reference_type: 'sale_exchange',
        notes: `رد فرق استبدال ${exchangeCode} ` + `لفاتورة رقم ${saleId}`,
        created_by: userId,
        business_date: businessDate,
      })
    }

    if (sale.customer_id && debtReductionAmount > 0) {
      const newRemainingAmount = Math.max(
        0,
        Number(sale.remaining_amount || 0) - debtReductionAmount,
      )

      const newPaymentStatus =
        newRemainingAmount <= 0
          ? 'paid'
          : Number(sale.paid || 0) > 0
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
      ).run(newRemainingAmount, newPaymentStatus, saleId)

      db.prepare(
        `
        UPDATE customers
        SET
          balance = MAX(
            IFNULL(balance, 0) - ?,
            0
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(debtReductionAmount, sale.customer_id)

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
        sale.customer_id,
        saleId,
        debtReductionAmount,
        paymentMethod,
        `تسوية مديونية بسبب استبدال ${exchangeCode}`,
      )
    }

    const insertStockIn = db.prepare(
      `
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
        'in',
        1,
        ?,
        'sale_exchange',
        ?
      )
      `,
    )

    const insertStockOut = db.prepare(
      `
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
        1,
        ?,
        'sale_exchange',
        ?
      )
      `,
    )

    const insertExchangeItem = db.prepare(
      `
        INSERT INTO sale_exchange_items (
          exchange_id,
          promotion_unit_id,
          old_variant_id,
          new_variant_id,
          old_unit_price,
          new_unit_price,
          old_is_gift,
          new_is_gift,
          quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
    )

    const updateCurrentUnit = db.prepare(
      `
        UPDATE sale_promotion_units
        SET
          current_variant_id = ?,
          current_unit_price = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
          AND sale_id = ?
        `,
    )

    const afterById = new Map(afterState.map((unit) => [unit.id, unit]))

    for (let index = 0; index < selectedUnits.length; index += 1) {
      const oldUnit = selectedUnits[index]

      const replacement = replacementMap.get(oldUnit.id)

      if (!replacement) {
        throw new Error('تعذر تجهيز الصنف البديل')
      }

      const newUnit = afterById.get(oldUnit.id)

      if (!newUnit) {
        throw new Error('تعذر إعادة حساب العرض')
      }

      insertStockIn.run(
        oldUnit.current_variant_id,
        exchangeId,
        `إرجاع صنف قديم بسبب استبدال ${exchangeCode}`,
      )

      insertStockOut.run(
        replacement.variant_id,
        exchangeId,
        `صرف صنف بديل بسبب استبدال ${exchangeCode}`,
      )

      insertExchangeItem.run(
        exchangeId,
        oldUnit.id,
        oldUnit.current_variant_id,
        replacement.variant_id,
        oldUnit.current_unit_price,
        replacement.sell_price,
        oldUnit.current_is_gift,
        newUnit.current_is_gift,
      )

      updateCurrentUnit.run(
        replacement.variant_id,
        replacement.sell_price,
        oldUnit.id,
        saleId,
      )
    }

    const updateGiftState = db.prepare(
      `
      UPDATE sale_promotion_units
      SET
        current_is_gift = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND sale_id = ?
      `,
    )

    for (const unit of afterState) {
      updateGiftState.run(unit.current_is_gift, unit.id, saleId)
    }

    if (sale.customer_id && differenceAmount !== 0) {
      db.prepare(
        `
        UPDATE customers
        SET
          total_spent = MAX(
            IFNULL(total_spent, 0) + ?,
            0
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      ).run(differenceAmount, sale.customer_id)
    }

    return {
      success: true,

      exchangeId,
      exchangeCode,

      original_sale_id: saleId,
      promotion_group_id: promotionGroupId,

      old_group_total: oldGroupTotal,
      new_group_total: newGroupTotal,

      difference_amount: differenceAmount,

      amount_to_collect: cashCollectionAmount,

      amount_to_refund: cashRefundAmount,

      debt_reduction_amount: debtReductionAmount,

      payment_method: paymentMethod,
    }
  })

  return tx()
}
