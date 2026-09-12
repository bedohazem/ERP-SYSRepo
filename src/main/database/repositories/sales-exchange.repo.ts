import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'
import {
  calculateSaleEarnedPoints,
  getSaleCurrentState,
} from './sales-current-state.repo'
import { syncCustomerTotalSpent } from './sales.repo'
import { getOpenCashShift } from './cash-shifts.repo'

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

export type CancelSaleExchangeInput = {
  exchange_id: number

  reason?: string | null

  actor_id?: number | null
}

export type ListSaleExchangesInput = {
  search?: string

  date_from?: string
  date_to?: string

  status?: 'all' | 'active' | 'cancelled'

  actor_id?: number | null

  limit?: number
  offset?: number
}

type ExchangeUnitState = {
  id: number

  current_variant_id: number

  current_unit_price: number

  current_unit_cost: number | null

  current_is_gift: number
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
  original_unit_cost: number | null
  current_unit_cost: number | null
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

function parseExchangeStateJson(
  value: unknown,
  label: string,
): ExchangeUnitState[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(String(value || '[]'))
  } catch {
    throw new Error(`بيانات ${label} غير صالحة`)
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`بيانات ${label} غير مكتملة`)
  }

  return parsed.map((raw: any) => {
    const id = Number(raw?.id)

    const variantId = Number(raw?.current_variant_id)

    const unitPrice = Number(raw?.current_unit_price)

    const rawCost = raw?.current_unit_cost

    const unitCost =
      rawCost === null || rawCost === undefined ? null : Number(rawCost)

    const isGift = Number(raw?.current_is_gift || 0) === 1 ? 1 : 0

    if (
      !id ||
      !variantId ||
      !Number.isFinite(unitPrice) ||
      (unitCost !== null && !Number.isFinite(unitCost))
    ) {
      throw new Error(`بيانات ${label} غير مكتملة`)
    }

    return {
      id,

      current_variant_id: variantId,

      current_unit_price: unitPrice,

      current_unit_cost: unitCost,

      current_is_gift: isGift,
    }
  })
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

  const openShift = getOpenCashShift()

  if (!openShift) {
    throw new Error('لا يمكن تسجيل استبدال بدون شفت مفتوح')
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

      current_unit_cost: Number(unit.current_unit_cost || 0),

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

        current_unit_cost: Number(replacement.buy_price || 0),
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
    const loyaltySnapshot = currentStateBefore.loyalty_snapshot

    const loyaltySnapshotIsExact = Boolean(loyaltySnapshot?.is_exact)

    const hasHistoricalLoyaltyActivity =
      Number(sale.loyalty_points_earned || 0) > 0 ||
      Number(sale.loyalty_points_redeemed || 0) > 0 ||
      Number(sale.loyalty_discount_value || 0) > 0

    if (!loyaltySnapshotIsExact && hasHistoricalLoyaltyActivity) {
      throw new Error(
        'لا يمكن إعادة حساب نقاط هذه الفاتورة القديمة بأمان لأن شروط النقاط الأصلية غير محفوظة',
      )
    }

    const loyaltyEnabled =
      loyaltySnapshotIsExact && Boolean(loyaltySnapshot?.enabled)

    const earnAmount = Math.max(0, Number(loyaltySnapshot?.earn_amount || 0))

    const earnPoints = Math.max(0, Number(loyaltySnapshot?.earn_points || 0))

    const pointValue = Math.max(0, Number(loyaltySnapshot?.point_value || 0))
    const minRedeemPoints = Math.max(
      0,
      Math.floor(Number(loyaltySnapshot?.min_redeem_points || 0)),
    )

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

    const originalRedeemedPoints = Math.max(
      0,
      Math.floor(Number(sale.loyalty_points_redeemed || 0)),
    )

    const maxNextRedeemedPoints =
      loyaltyEnabled && pointValue > 0
        ? Math.min(
            originalRedeemedPoints,

            Math.floor((nextAfterNormal + 0.0000001) / pointValue),
          )
        : 0

    const nextRedeemedPoints =
      maxNextRedeemedPoints > 0 && maxNextRedeemedPoints < minRedeemPoints
        ? 0
        : maxNextRedeemedPoints

    const nextLoyaltyDiscount = roundMoney(nextRedeemedPoints * pointValue)

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

    const currentEarnedPoints = Math.max(
      0,
      Number(currentStateBefore.financials.current_loyalty_points_earned || 0),
    )

    const currentRedeemedPoints = Math.max(
      0,
      Number(currentStateBefore.financials.ledger_loyalty_points_redeemed || 0),
    )

    const nextEarnedPoints =
      sale.customer_id && loyaltyEnabled && earnAmount > 0 && earnPoints > 0
        ? Math.floor(nextNetGrandTotal / earnAmount) * earnPoints
        : 0

    const loyaltyEarnedPointsAdjustment = Math.round(
      nextEarnedPoints - currentEarnedPoints,
    )

    /*
     * موجب = نقاط إضافية ستُستخدم.
     * سالب = نقاط مستخدمة سابقًا
     * ستعود للعميل.
     */
    const loyaltyRedeemedPointsAdjustment = Math.round(
      nextRedeemedPoints - currentRedeemedPoints,
    )

    /*
     * Earn +1 يزيد الرصيد.
     * Redeem +1 يخفض الرصيد.
     */
    const loyaltyBalanceAdjustment =
      loyaltyEarnedPointsAdjustment - loyaltyRedeemedPointsAdjustment

    if (sale.customer_id && loyaltyBalanceAdjustment < 0) {
      const customerPointsRow = db
        .prepare(
          `
          SELECT points_balance
          FROM customers
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(sale.customer_id) as any

      const currentPoints = Number(customerPointsRow?.points_balance || 0)

      if (currentPoints + loyaltyBalanceAdjustment < 0) {
        throw new Error('رصيد نقاط العميل غير كافٍ لإتمام الاستبدال')
      }
    }

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
          shift_id,
          promotion_group_id,

          old_group_total,
          new_group_total,
          difference_amount,

          old_invoice_sub_total,
          new_invoice_sub_total,

          old_promotion_discount_value,
          new_promotion_discount_value,

          old_normal_discount_value,
          new_normal_discount_value,

          old_loyalty_discount_value,
          new_loyalty_discount_value,

          old_invoice_grand_total,
          new_invoice_grand_total,

          old_net_total,
          new_net_total,

          loyalty_earned_points_adjustment,
          loyalty_redeemed_points_adjustment,

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
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?
        )
        `,
      )
      .run(
        saleId,
        userId,
        openShift.id,
        promotionGroupId,

        oldGroupTotal,
        newGroupTotal,
        differenceAmount,

        currentStateBefore.financials.current_sub_total,

        nextSubTotal,

        currentStateBefore.financials.current_promotion_discount_value,

        nextPromotionDiscount,

        currentStateBefore.financials.current_normal_discount_value,

        nextNormalDiscount,

        currentStateBefore.financials.current_loyalty_discount_value,

        nextLoyaltyDiscount,

        currentStateBefore.financials.current_grand_total,

        nextGrandTotal,

        currentStateBefore.financials.net_grand_total,

        nextNetGrandTotal,

        loyaltyEarnedPointsAdjustment,

        loyaltyRedeemedPointsAdjustment,

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
        shift_id: openShift.id,
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
        shift_id: openShift.id,
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

          old_unit_cost,
          new_unit_cost,

          old_is_gift,
          new_is_gift,

          quantity
        )
        VALUES (
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          1
        )
        `,
    )

    const updateCurrentUnit = db.prepare(
      `
        UPDATE sale_promotion_units
        SET
          current_variant_id = ?,
          current_unit_price = ?,
          current_unit_cost = ?,

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

        Number(oldUnit.current_unit_cost || 0),

        Number(replacement.buy_price || 0),

        oldUnit.current_is_gift,
        newUnit.current_is_gift,
      )

      updateCurrentUnit.run(
        replacement.variant_id,

        replacement.sell_price,

        Number(replacement.buy_price || 0),

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

    if (sale.customer_id) {
      syncCustomerTotalSpent(Number(sale.customer_id))
    }

    if (sale.customer_id && loyaltyBalanceAdjustment !== 0) {
      db.prepare(
        `
        UPDATE customers
        SET
          points_balance =
            IFNULL(
              points_balance,
              0
            ) + ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
      ).run(loyaltyBalanceAdjustment, sale.customer_id)
    }

    if (sale.customer_id && loyaltyEarnedPointsAdjustment !== 0) {
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
        VALUES (
          ?, ?,
          'adjust',
          ?, ?, ?
        )
        `,
      ).run(
        sale.customer_id,

        saleId,

        loyaltyEarnedPointsAdjustment,

        Math.abs(differenceAmount),

        `تعديل نقاط مكتسبة بسبب استبدال ${exchangeCode}`,
      )
    }

    if (sale.customer_id && loyaltyRedeemedPointsAdjustment !== 0) {
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
        VALUES (
          ?, ?,
          'adjust',
          ?, ?, ?
        )
        `,
      ).run(
        sale.customer_id,

        saleId,

        -loyaltyRedeemedPointsAdjustment,

        Math.abs(differenceAmount),

        loyaltyRedeemedPointsAdjustment > 0
          ? `استخدام نقاط إضافية بسبب استبدال ${exchangeCode}`
          : `إرجاع نقاط مستخدمة بسبب استبدال ${exchangeCode}`,
      )
    }

    return {
      success: true,

      exchangeId,
      exchangeCode,

      original_sale_id: saleId,
      promotion_group_id: promotionGroupId,

      old_group_total: oldGroupTotal,
      new_group_total: newGroupTotal,

      loyalty_earned_points_adjustment: loyaltyEarnedPointsAdjustment,

      loyalty_redeemed_points_adjustment: loyaltyRedeemedPointsAdjustment,

      loyalty_balance_adjustment: loyaltyBalanceAdjustment,

      difference_amount: differenceAmount,

      amount_to_collect: cashCollectionAmount,

      amount_to_refund: cashRefundAmount,

      debt_reduction_amount: debtReductionAmount,

      payment_method: paymentMethod,
      shift_id: openShift.id,
    }
  })

  return tx()
}

export function getSaleExchangeCancellationAccess(
  exchangeIdInput: number,
  actorId?: number | null,
) {
  const db = getDb()

  const exchangeId = Number(exchangeIdInput)

  if (!exchangeId) {
    throw new Error('رقم الاستبدال غير صحيح')
  }

  const row = db
    .prepare(
      `
      SELECT
        id,
        user_id,

        CASE
          WHEN
            user_id = ?

            AND
              datetime(created_at)
              BETWEEN
                datetime(
                  'now',
                  '-24 hours'
                )

                AND datetime('now')

          THEN 0
          ELSE 1
        END
          AS requires_admin_password

      FROM sale_exchanges

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(Number(actorId || 0), exchangeId) as
    | {
        id: number
        user_id: number | null
        requires_admin_password: number
      }
    | undefined

  if (!row) {
    throw new Error('عملية الاستبدال غير موجودة')
  }

  return {
    exchange_id: Number(row.id),

    user_id: row.user_id == null ? null : Number(row.user_id),

    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  }
}

export function listSaleExchanges(input?: ListSaleExchangesInput) {
  const db = getDb()

  const search = input?.search?.trim() || ''

  const status = input?.status || 'all'

  const actorId = Number(input?.actor_id || 0)

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []

  const params: any[] = []

  if (search) {
    const q = `%${search}%`

    where.push(`
      (
        CAST(
          se.id AS TEXT
        ) LIKE ?

        OR CAST(
          se.original_sale_id
          AS TEXT
        ) LIKE ?

        OR IFNULL(
          c.name,
          ''
        ) LIKE ?

        OR IFNULL(
          c.phone,
          ''
        ) LIKE ?

        OR IFNULL(
          u.name,
          ''
        ) LIKE ?

        OR IFNULL(
          se.reason,
          ''
        ) LIKE ?
      )
    `)

    params.push(q, q, q, q, q, q)
  }

  if (input?.date_from) {
    where.push(`
      COALESCE(
        NULLIF(
          se.business_date,
          ''
        ),
        date(
          se.created_at,
          'localtime'
        )
      ) >= ?
    `)

    params.push(input.date_from)
  }

  if (input?.date_to) {
    where.push(`
      COALESCE(
        NULLIF(
          se.business_date,
          ''
        ),
        date(
          se.created_at,
          'localtime'
        )
      ) <= ?
    `)

    params.push(input.date_to)
  }

  if (status === 'active') {
    where.push(`se.cancelled_at IS NULL`)
  }

  if (status === 'cancelled') {
    where.push(`se.cancelled_at IS NOT NULL`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        se.*,

        COALESCE(
          NULLIF(
            se.business_date,
            ''
          ),
          date(
            se.created_at,
            'localtime'
          )
        )
          AS accounting_date,

        s.customer_id,

        c.name
          AS customer_name,

        c.phone
          AS customer_phone,

        u.name
          AS cashier_name,

        cu.name
          AS cancelled_by_name,

        COUNT(
          sei.id
        )
          AS items_count,

        IFNULL(
          SUM(
            sei.quantity
          ),
          0
        )
          AS total_quantity,

        CASE
          WHEN
            se.user_id = ?

            AND
              datetime(
                se.created_at
              )
              BETWEEN
                datetime(
                  'now',
                  '-24 hours'
                )

                AND datetime(
                  'now'
                )

          THEN 0
          ELSE 1
        END
          AS requires_admin_password,

        CASE
          WHEN
            se.cancelled_at
            IS NULL

            AND
              se.id = (
                SELECT
                  se2.id

                FROM
                  sale_exchanges
                  se2

                WHERE
                  se2.original_sale_id =
                    se.original_sale_id

                  AND
                    se2.cancelled_at
                    IS NULL

                ORDER BY
                  se2.id DESC

                LIMIT 1
              )

          THEN 1
          ELSE 0
        END
          AS is_latest_active,

        CASE
          WHEN EXISTS (
            SELECT 1
            FROM sale_promotion_units spu
            WHERE spu.sale_id = se.original_sale_id
              AND spu.promotion_group_id = se.promotion_group_id
              AND spu.is_returned = 1
          )
          THEN 1
          ELSE 0
        END AS has_later_active_return, 

        CASE
          WHEN EXISTS (
            SELECT 1

            FROM
              cash_day_closings
              cdc

            WHERE
              cdc.business_date =
                COALESCE(
                  NULLIF(
                    se.business_date,
                    ''
                  ),
                  date(
                    se.created_at,
                    'localtime'
                  )
                )
          )

          THEN 1
          ELSE 0
        END
          AS is_day_closed

      FROM sale_exchanges se

      JOIN sales s
        ON
          s.id =
            se.original_sale_id

      LEFT JOIN customers c
        ON
          c.id =
            s.customer_id

      LEFT JOIN users u
        ON
          u.id =
            se.user_id

      LEFT JOIN users cu
        ON
          cu.id =
            se.cancelled_by

      LEFT JOIN
        sale_exchange_items
        sei
        ON
          sei.exchange_id =
            se.id

      ${whereSql}

      GROUP BY se.id

      ORDER BY
        se.id DESC

      LIMIT ?
      OFFSET ?
      `,
    )
    .all(actorId, ...params, limit, offset) as any[]

  const getItems = db.prepare(
    `
      SELECT
        sei.*,

        old_product.name
          AS old_product_name,

        old_variant.barcode
          AS old_barcode,

        old_variant.size
          AS old_size,

        old_variant.color
          AS old_color,

        new_product.name
          AS new_product_name,

        new_variant.barcode
          AS new_barcode,

        new_variant.size
          AS new_size,

        new_variant.color
          AS new_color

      FROM sale_exchange_items sei

      JOIN product_variants
        old_variant
        ON
          old_variant.id =
            sei.old_variant_id

      JOIN products
        old_product
        ON
          old_product.id =
            old_variant.product_id

      JOIN product_variants
        new_variant
        ON
          new_variant.id =
            sei.new_variant_id

      JOIN products
        new_product
        ON
          new_product.id =
            new_variant.product_id

      WHERE
        sei.exchange_id = ?

      ORDER BY
        sei.id ASC
      `,
  )

  const mappedRows = rows.map((row: any) => {
    let cancelBlockReason: string | null = null

    if (row.cancelled_at) {
      cancelBlockReason = 'عملية الاستبدال ملغاة بالفعل'
    } else if (Number(row.is_latest_active || 0) !== 1) {
      cancelBlockReason = 'يجب إلغاء آخر عملية استبدال أولًا'
    } else if (Number(row.has_later_active_return || 0) === 1) {
      cancelBlockReason = 'يجب إلغاء المرتجع الأحدث أولًا'
    } else if (Number(row.is_day_closed || 0) === 1) {
      cancelBlockReason = 'يوم الاستبدال تم تقفيله'
    }

    return {
      ...row,

      code: `EXC-${String(row.id).padStart(5, '0')}`,

      can_cancel: cancelBlockReason === null,

      cancel_block_reason: cancelBlockReason,

      items: getItems.all(row.id),
    }
  })

  const totalRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total

      FROM sale_exchanges se

      JOIN sales s
        ON
          s.id =
            se.original_sale_id

      LEFT JOIN customers c
        ON
          c.id =
            s.customer_id

      LEFT JOIN users u
        ON
          u.id =
            se.user_id

      ${whereSql}
      `,
    )
    .get(...params) as {
    total: number
  }

  return {
    rows: mappedRows,

    total: Number(totalRow.total || 0),

    limit,

    offset,
  }
}

export function cancelSaleExchange(input: CancelSaleExchangeInput) {
  const db = getDb()

  const exchangeId = Number(input.exchange_id)

  if (!exchangeId) {
    throw new Error('رقم الاستبدال غير صحيح')
  }

  const reason = input.reason?.trim() || 'إلغاء عملية استبدال'

  const exchangeCode = `EXC-${String(exchangeId).padStart(5, '0')}`

  const tx = db.transaction(() => {
    const exchange = db
      .prepare(
        `
          SELECT
            se.*,

            s.customer_id,

            s.paid,

            s.remaining_amount,

            s.payment_status,

            s.cancelled_at
              AS sale_cancelled_at

          FROM sale_exchanges se

          JOIN sales s
            ON
              s.id =
                se.original_sale_id

          WHERE
            se.id = ?

          LIMIT 1
          `,
      )
      .get(exchangeId) as any

    if (!exchange) {
      throw new Error('عملية الاستبدال غير موجودة')
    }

    if (exchange.cancelled_at) {
      throw new Error('عملية الاستبدال ملغاة بالفعل')
    }

    if (exchange.sale_cancelled_at) {
      throw new Error('لا يمكن إلغاء الاستبدال لأن الفاتورة الأصلية ملغاة')
    }

    const saleId = Number(exchange.original_sale_id)

    const exchangeDateRow = db
      .prepare(
        `
          SELECT
            COALESCE(
              NULLIF(
                business_date,
                ''
              ),
              date(
                created_at,
                'localtime'
              )
            )
              AS business_date

          FROM sale_exchanges

          WHERE id = ?

          LIMIT 1
          `,
      )
      .get(exchangeId) as
      | {
          business_date: string
        }
      | undefined

    const resolvedAccountingDate = String(exchangeDateRow?.business_date || '')

    if (resolvedAccountingDate) {
      const closed = db
        .prepare(
          `
            SELECT id

            FROM
              cash_day_closings

            WHERE
              business_date = ?

            LIMIT 1
            `,
        )
        .get(resolvedAccountingDate)

      if (closed) {
        throw new Error(
          `لا يمكن إلغاء استبدال يخص يوم ${resolvedAccountingDate} لأنه تم تقفيله`,
        )
      }
    }

    const cancelBusinessDate = getLocalDateKey()

    if (cancelBusinessDate !== resolvedAccountingDate) {
      const currentDayClosed = db
        .prepare(
          `
            SELECT id

            FROM
              cash_day_closings

            WHERE
              business_date = ?

            LIMIT 1
            `,
        )
        .get(cancelBusinessDate)

      if (currentDayClosed) {
        throw new Error(
          `لا يمكن إلغاء الاستبدال لأن يوم ${cancelBusinessDate} تم تقفيله`,
        )
      }
    }

    const latestActive = db
      .prepare(
        `
          SELECT id

          FROM sale_exchanges

          WHERE
            original_sale_id = ?

            AND
              cancelled_at
              IS NULL

          ORDER BY id DESC

          LIMIT 1
          `,
      )
      .get(saleId) as
      | {
          id: number
        }
      | undefined

    if (Number(latestActive?.id || 0) !== exchangeId) {
      throw new Error('يجب إلغاء آخر عملية استبدال أولًا')
    }

    const beforeState = parseExchangeStateJson(
      exchange.before_state_json,

      'الحالة قبل الاستبدال',
    )

    const afterState = parseExchangeStateJson(
      exchange.after_state_json,

      'الحالة بعد الاستبدال',
    )

    if (beforeState.length !== afterState.length) {
      throw new Error('بيانات الاستبدال التاريخية غير متطابقة')
    }

    const beforeIds = new Set(beforeState.map((unit) => unit.id))

    if (afterState.some((unit) => !beforeIds.has(unit.id))) {
      throw new Error('بيانات الاستبدال التاريخية غير متطابقة')
    }

    const items = db
      .prepare(
        `
          SELECT *

          FROM
            sale_exchange_items

          WHERE
            exchange_id = ?

          ORDER BY id ASC
          `,
      )
      .all(exchangeId) as any[]

    if (items.length === 0) {
      throw new Error('لا توجد أصناف داخل عملية الاستبدال')
    }

    const getUnit = db.prepare(
      `
          SELECT *

          FROM
            sale_promotion_units

          WHERE
            id = ?

            AND
              sale_id = ?

          LIMIT 1
          `,
    )

    const currentUnits = new Map<number, any>()

    for (const expected of afterState) {
      const current = getUnit.get(expected.id, saleId) as any

      if (!current) {
        throw new Error('تعذر العثور على حالة العرض الحالية')
      }

      if (Number(current.is_returned || 0) === 1) {
        throw new Error('يجب إلغاء المرتجع الأحدث أولًا')
      }

      const sameVariant =
        Number(current.current_variant_id) ===
        Number(expected.current_variant_id)

      const samePrice =
        Math.abs(
          Number(current.current_unit_price || 0) -
            Number(expected.current_unit_price || 0),
        ) < 0.01

      const sameGift =
        Number(current.current_is_gift || 0) ===
        Number(expected.current_is_gift || 0)

      if (!sameVariant || !samePrice || !sameGift) {
        throw new Error(
          'حالة العرض تغيرت بعد هذه العملية ولا يمكن إلغاؤها مباشرة',
        )
      }

      currentUnits.set(expected.id, current)
    }

    const outgoingOld = new Map<number, number>()

    const incomingNew = new Map<number, number>()

    for (const item of items) {
      const qty = Math.max(0, Number(item.quantity || 0))

      const oldVariantId = Number(item.old_variant_id)

      const newVariantId = Number(item.new_variant_id)

      outgoingOld.set(
        oldVariantId,

        Number(outgoingOld.get(oldVariantId) || 0) + qty,
      )

      incomingNew.set(
        newVariantId,

        Number(incomingNew.get(newVariantId) || 0) + qty,
      )
    }

    for (const [variantId, requiredQty] of outgoingOld.entries()) {
      const available = getCurrentStock(db, variantId)

      const incoming = Number(incomingNew.get(variantId) || 0)

      if (available + incoming < requiredQty) {
        throw new Error(
          `لا يمكن إلغاء الاستبدال لأن مخزون الصنف السابق غير كافٍ. المتاح: ${available}`,
        )
      }
    }

    const loyaltyBeforeCancellation = getSaleCurrentState(saleId)

    const paymentMethod = resolveCashAccount(
      exchange.payment_method || 'store_cash',
    )

    const cashCollectionAmount = Math.max(
      0,
      Number(exchange.cash_collection_amount || 0),
    )

    const cashRefundAmount = Math.max(
      0,
      Number(exchange.cash_refund_amount || 0),
    )

    const debtReductionAmount = Math.max(
      0,
      Number(exchange.debt_reduction_amount || 0),
    )

    /*
     * الاستبدال الأصلي حصل فيه
     * تحصيل فرق من العميل.
     *
     * الإلغاء = رد نفس الفرق.
     */
    if (cashCollectionAmount > 0) {
      createCashMovement({
        type: 'sale_exchange',

        direction: 'out',

        amount: cashCollectionAmount,

        payment_method: paymentMethod,

        reference_id: exchangeId,

        reference_type: 'sale_exchange_cancel',

        notes: `رد تحصيل بسبب إلغاء ${exchangeCode}`,

        created_by: input.actor_id ?? null,

        business_date: cancelBusinessDate,
      })
    }

    /*
     * الاستبدال الأصلي رد كاش
     * للعميل.
     *
     * الإلغاء = استرداد المبلغ
     * من العميل.
     */
    if (cashRefundAmount > 0) {
      createCashMovement({
        type: 'sale_exchange',

        direction: 'in',

        amount: cashRefundAmount,

        payment_method: paymentMethod,

        reference_id: exchangeId,

        reference_type: 'sale_exchange_cancel',

        notes: `استرداد رد فرق بسبب إلغاء ${exchangeCode}`,

        created_by: input.actor_id ?? null,

        business_date: cancelBusinessDate,
      })
    }

    const stockIn = db.prepare(
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
            ?,
            ?,
            'sale_exchange_cancel',
            ?
          )
          `,
    )

    const stockOut = db.prepare(
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
            ?,
            ?,
            'sale_exchange_cancel',
            ?
          )
          `,
    )

    for (const item of items) {
      const qty = Math.max(0, Number(item.quantity || 0))

      stockIn.run(
        Number(item.new_variant_id),

        qty,

        exchangeId,

        `إرجاع الصنف البديل بسبب إلغاء ${exchangeCode}`,
      )

      stockOut.run(
        Number(item.old_variant_id),

        qty,

        exchangeId,

        `إعادة صرف الصنف السابق بسبب إلغاء ${exchangeCode}`,
      )
    }

    const itemByUnit = new Map<number, any>(
      items.map((item) => [Number(item.promotion_unit_id), item]),
    )

    const restoreUnit = db.prepare(
      `
          UPDATE
            sale_promotion_units

          SET
            current_variant_id = ?,

            current_unit_price = ?,

            current_unit_cost = ?,

            current_is_gift = ?,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            id = ?

            AND sale_id = ?
          `,
    )

    for (const before of beforeState) {
      const current = currentUnits.get(before.id)

      const exchangeItem = itemByUnit.get(before.id)

      const restoredCost =
        before.current_unit_cost !== null
          ? Number(before.current_unit_cost)
          : Number(
              exchangeItem?.old_unit_cost ?? current?.current_unit_cost ?? 0,
            )

      restoreUnit.run(
        before.current_variant_id,

        before.current_unit_price,

        restoredCost,

        before.current_is_gift,

        before.id,

        saleId,
      )
    }

    const loyaltyAfterCancellation = getSaleCurrentState(saleId)

    const beforeEarned = Number(
      loyaltyBeforeCancellation.financials.current_loyalty_points_earned || 0,
    )

    const targetEarned = calculateSaleEarnedPoints(
      loyaltyAfterCancellation,
      loyaltyAfterCancellation.financials.net_grand_total,
      beforeEarned - Number(exchange.loyalty_earned_points_adjustment || 0),
    )

    const earnedAdjustment = Math.round(beforeEarned - targetEarned)

    const redeemedAdjustment = Number(
      exchange.loyalty_redeemed_points_adjustment || 0,
    )

    const reverseLoyaltyBalanceAdjustment =
      -earnedAdjustment + redeemedAdjustment

    if (exchange.customer_id && reverseLoyaltyBalanceAdjustment < 0) {
      const customer = db
        .prepare('SELECT points_balance FROM customers WHERE id = ? LIMIT 1')
        .get(Number(exchange.customer_id)) as
        | { points_balance: number }
        | undefined

      if (
        Number(customer?.points_balance || 0) +
          reverseLoyaltyBalanceAdjustment <
        0
      ) {
        throw new Error('لا يمكن إلغاء الاستبدال لأن نقاطه تم استخدامها بالفعل')
      }
    }

    if (exchange.customer_id && debtReductionAmount > 0) {
      const newRemaining = roundMoney(
        Math.max(
          0,
          Number(exchange.remaining_amount || 0) + debtReductionAmount,
        ),
      )

      const paidAmount = Math.max(0, Number(exchange.paid || 0))

      const newStatus =
        newRemaining <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

      db.prepare(
        `
          UPDATE sales

          SET
            remaining_amount = ?,

            payment_status = ?

          WHERE id = ?
          `,
      ).run(
        newRemaining,

        newStatus,

        saleId,
      )

      db.prepare(
        `
          UPDATE customers

          SET
            balance =
              IFNULL(
                balance,
                0
              ) + ?,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?
          `,
      ).run(
        debtReductionAmount,

        Number(exchange.customer_id),
      )

      /*
       * دي حركة داخلية أنشأها
       * الاستبدال نفسه.
       */
      db.prepare(
        `
          DELETE FROM
            customer_payments

          WHERE
            sale_id = ?

            AND notes LIKE ?
          `,
      ).run(
        saleId,

        `تسوية مديونية بسبب استبدال ${exchangeCode}%`,
      )
    }

    if (exchange.customer_id && reverseLoyaltyBalanceAdjustment !== 0) {
      db.prepare(
        `
          UPDATE customers

          SET
            points_balance =
              IFNULL(
                points_balance,
                0
              ) + ?,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?
          `,
      ).run(
        reverseLoyaltyBalanceAdjustment,

        Number(exchange.customer_id),
      )
    }

    if (exchange.customer_id && earnedAdjustment !== 0) {
      db.prepare(
        `
          INSERT INTO
            loyalty_transactions (
              customer_id,
              sale_id,
              type,
              points,
              amount,
              notes
            )

          VALUES (
            ?,
            ?,
            'adjust',
            ?,
            ?,
            ?
          )
          `,
      ).run(
        Number(exchange.customer_id),

        saleId,

        -earnedAdjustment,

        Math.abs(Number(exchange.difference_amount || 0)),

        `عكس تعديل النقاط المكتسبة بسبب إلغاء ${exchangeCode}`,
      )
    }

    if (exchange.customer_id && redeemedAdjustment !== 0) {
      db.prepare(
        `
          INSERT INTO
            loyalty_transactions (
              customer_id,
              sale_id,
              type,
              points,
              amount,
              notes
            )

          VALUES (
            ?,
            ?,
            'adjust',
            ?,
            ?,
            ?
          )
          `,
      ).run(
        Number(exchange.customer_id),

        saleId,

        redeemedAdjustment,

        Math.abs(Number(exchange.difference_amount || 0)),

        `عكس تعديل النقاط المستخدمة بسبب إلغاء ${exchangeCode}`,
      )
    }

    db.prepare(
      `
        UPDATE sale_exchanges

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancel_reason = ?

        WHERE id = ?
        `,
    ).run(
      input.actor_id ?? null,

      reason,

      exchangeId,
    )

    if (exchange.customer_id) {
      syncCustomerTotalSpent(Number(exchange.customer_id))
    }

    return {
      ok: true,

      exchange_id: exchangeId,

      exchange_code: exchangeCode,

      sale_id: saleId,

      cash_refunded: cashCollectionAmount,

      cash_collected: cashRefundAmount,

      debt_restored: debtReductionAmount,

      loyalty_balance_reversed: reverseLoyaltyBalanceAdjustment,

      restored_items: items.length,
    }
  })

  return tx()
}
