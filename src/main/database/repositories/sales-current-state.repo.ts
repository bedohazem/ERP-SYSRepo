import { getDb } from '../db'

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

function positive(value: unknown) {
  return Math.max(0, Number(value || 0))
}

export function getSaleCurrentState(saleIdInput: number) {
  const db = getDb()

  const saleId = Number(saleIdInput)

  if (!saleId) {
    throw new Error('رقم الفاتورة غير صحيح')
  }

  const sale = db
    .prepare(
      `
      SELECT
        s.*,

        c.name AS customer_name,
        c.phone AS customer_phone,

        u.name AS cashier_name

      FROM sales s

      LEFT JOIN customers c
        ON c.id = s.customer_id

      LEFT JOIN users u
        ON u.id = s.user_id

      WHERE s.id = ?
        AND IFNULL(
          s.type,
          'sale'
        ) = 'sale'

      LIMIT 1
      `,
    )
    .get(saleId) as any

  if (!sale) {
    throw new Error('الفاتورة غير موجودة')
  }

  const loyaltySnapshot = db
    .prepare(
      `
      SELECT *
      FROM sale_loyalty_snapshots
      WHERE sale_id = ?
      LIMIT 1
      `,
    )
    .get(saleId) as any

  const loyaltySnapshotIsExact =
    String(loyaltySnapshot?.source || 'legacy_estimated') === 'exact'

  const effectiveLoyaltySnapshot = {
    enabled: Number(loyaltySnapshot?.enabled || 0) === 1,

    earn_amount: Math.max(0, Number(loyaltySnapshot?.earn_amount || 0)),

    earn_points: Math.max(0, Number(loyaltySnapshot?.earn_points || 0)),

    point_value: Math.max(0, Number(loyaltySnapshot?.point_value || 0)),

    min_redeem_points: Math.max(
      0,
      Math.floor(Number(loyaltySnapshot?.min_redeem_points || 0)),
    ),

    source: loyaltySnapshotIsExact ? 'exact' : 'legacy_estimated',

    is_exact: loyaltySnapshotIsExact,
  }

  /*
   * Original immutable sale items.
   * These remain the audit/history source.
   */
  const originalItems = db
    .prepare(
      `
      SELECT
        si.*,

        IFNULL(
          (
            SELECT SUM(
              sri.quantity
            )

            FROM sale_returns sr

            JOIN sale_return_items sri
              ON sri.return_id =
                sr.id

            WHERE
              sr.original_sale_id =
                si.sale_id

              AND sr.cancelled_at
                IS NULL

              AND
                sri.original_sale_item_id
                = si.id
          ),
          0
        ) AS returned_quantity

      FROM sale_items si

      WHERE si.sale_id = ?

      ORDER BY si.id ASC
      `,
    )
    .all(saleId) as any[]

  const loyalty = db
    .prepare(
      `
      SELECT *
      FROM loyalty_transactions
      WHERE sale_id = ?
      ORDER BY id ASC
      `,
    )
    .all(saleId) as any[]

  /*
   * Promotion units represent the physical
   * CURRENT state of Buy-X-Get-Y bundles.
   */
  const promotionUnits = db
    .prepare(
      `
      SELECT
        spu.*,

        pv.product_id
          AS current_product_id,

        pv.barcode
          AS current_barcode,

        pv.size
          AS current_size,

        pv.color
          AS current_color,

        COALESCE(
          spu.current_unit_cost,
          pv.buy_price
        ) AS current_unit_cost,

        p.name
          AS current_product_name,

        p.category_id
          AS current_category_id

      FROM sale_promotion_units spu

      JOIN product_variants pv
        ON pv.id =
          spu.current_variant_id

      JOIN products p
        ON p.id =
          pv.product_id

      WHERE spu.sale_id = ?

      ORDER BY
        spu.promotion_group_id ASC,
        spu.id ASC
      `,
    )
    .all(saleId) as any[]

  const representedGroupIds = new Set(
    promotionUnits.map((unit) => String(unit.promotion_group_id)),
  )

  /*
   * Aggregate current promotion units for
   * display. Paid/gift states are deliberately
   * separate even for the same variant.
   */
  const currentUnitBuckets = new Map<string, any>()

  for (const unit of promotionUnits) {
    const groupId = String(unit.promotion_group_id)

    const key = [
      groupId,
      Number(unit.current_variant_id),
      Number(unit.current_unit_price),
      Number(unit.current_is_gift),
    ].join(':')

    let bucket = currentUnitBuckets.get(key)

    if (!bucket) {
      bucket = {
        id: `promotion-unit-${Number(unit.id)}`,

        sale_id: saleId,

        variant_id: Number(unit.current_variant_id),

        product_name: String(unit.current_product_name || ''),

        barcode: unit.current_barcode ?? null,

        size: unit.current_size ?? null,

        color: unit.current_color ?? null,

        quantity: 0,

        unit_cost: Number(unit.current_unit_cost || 0),

        unit_price: Number(unit.current_unit_price || 0),

        promotion_discount_value: 0,

        line_total: 0,

        is_gift: Number(unit.current_is_gift || 0),

        promotion_group_id: groupId,

        returned_quantity: 0,

        promotion_unit_ids: [],

        original_sale_item_ids: [],

        sort_order: Number(unit.original_sale_item_id),
      }

      currentUnitBuckets.set(key, bucket)
    }

    bucket.quantity += 1

    bucket.returned_quantity += Number(unit.is_returned || 0) === 1 ? 1 : 0

    bucket.promotion_unit_ids.push(Number(unit.id))

    if (
      !bucket.original_sale_item_ids.includes(
        Number(unit.original_sale_item_id),
      )
    ) {
      bucket.original_sale_item_ids.push(Number(unit.original_sale_item_id))
    }

    bucket.sort_order = Math.min(
      Number(bucket.sort_order),
      Number(unit.original_sale_item_id),
    )
  }

  const currentPromotionItems = Array.from(currentUnitBuckets.values()).map(
    (item) => {
      const lineTotal = roundMoney(
        Number(item.quantity) * Number(item.unit_price),
      )

      return {
        ...item,

        line_total: lineTotal,

        promotion_discount_value: Number(item.is_gift) === 1 ? lineTotal : 0,
      }
    },
  )

  /*
   * Any item that has no current PromotionUnit
   * stays exactly as originally sold.
   *
   * This covers:
   * - normal items
   * - standalone quantity outside a bundle
   * - percent promotions
   * - legacy sales
   */
  const unchangedItems = originalItems
    .filter((item) => {
      const groupId = item.promotion_group_id

      if (!groupId) {
        return true
      }

      return !representedGroupIds.has(String(groupId))
    })
    .map((item) => ({
      ...item,

      id: Number(item.id),

      quantity: Number(item.quantity || 0),

      unit_price: Number(item.unit_price || 0),

      unit_cost: Number(item.unit_cost || 0),

      line_total: Number(item.line_total || 0),

      promotion_discount_value: Number(item.promotion_discount_value || 0),

      is_gift: Number(item.is_gift || 0),

      returned_quantity: Number(item.returned_quantity || 0),

      sort_order: Number(item.id),
    }))

  const currentItems = [...currentPromotionItems, ...unchangedItems].sort(
    (a, b) =>
      Number(a.sort_order) - Number(b.sort_order) ||
      String(a.id).localeCompare(String(b.id)),
  )

  const currentSubTotal = roundMoney(
    currentItems.reduce(
      (total, item) => total + Number(item.line_total || 0),
      0,
    ),
  )

  const currentPromotionDiscount = roundMoney(
    currentItems.reduce(
      (total, item) => total + Number(item.promotion_discount_value || 0),
      0,
    ),
  )

  /*
   * Normal discount and loyalty discount keep
   * their ORIGINAL values after exchange.
   *
   * But they can never make the invoice
   * negative. The applied amount is capped by
   * what remains payable.
   */
  const originalNormalDiscount = positive(sale.discount_value)

  const originalLoyaltyDiscount = positive(sale.loyalty_discount_value)

  const afterPromotion = Math.max(
    0,
    roundMoney(currentSubTotal - currentPromotionDiscount),
  )

  const currentNormalDiscount = roundMoney(
    Math.min(originalNormalDiscount, afterPromotion),
  )

  const afterNormalDiscount = Math.max(
    0,
    roundMoney(afterPromotion - currentNormalDiscount),
  )

  const originalRedeemedPoints = Math.max(
    0,
    Math.floor(Number(sale.loyalty_points_redeemed || 0)),
  )

  const loyaltyPointValue = Number(effectiveLoyaltySnapshot.point_value || 0)

  const maxRedeemablePoints =
    effectiveLoyaltySnapshot.enabled && loyaltyPointValue > 0
      ? Math.min(
          originalRedeemedPoints,

          Math.floor((afterNormalDiscount + 0.0000001) / loyaltyPointValue),
        )
      : 0

  const exactRedeemedPoints =
    maxRedeemablePoints > 0 &&
    maxRedeemablePoints < effectiveLoyaltySnapshot.min_redeem_points
      ? 0
      : maxRedeemablePoints

  /*
   * Legacy invoices do not have reliable
   * historical loyalty settings.
   *
   * Preserve the original recorded loyalty
   * values instead of pretending the current
   * settings were the purchase-time rules.
   */
  const currentLoyaltyPointsRedeemed = loyaltySnapshotIsExact
    ? exactRedeemedPoints
    : originalRedeemedPoints

  const currentLoyaltyDiscount = loyaltySnapshotIsExact
    ? roundMoney(currentLoyaltyPointsRedeemed * loyaltyPointValue)
    : roundMoney(Math.min(originalLoyaltyDiscount, afterNormalDiscount))

  const currentGrandTotal = Math.max(
    0,
    roundMoney(afterNormalDiscount - currentLoyaltyDiscount),
  )

  const returnSummary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS return_count,

        IFNULL(
          SUM(sr.sub_total),
          0
        ) AS returned_sub_total,

        IFNULL(
          SUM(
            sr.promotion_discount_value
          ),
          0
        )
          AS returned_promotion_discount,

        IFNULL(
          SUM(
            CASE
              WHEN
                sr.normal_discount_value
                IS NOT NULL

              THEN
                sr.normal_discount_value

              ELSE MAX(
                0,

                sr.sub_total
                - sr.refund_amount
                - IFNULL(
                    sr.loyalty_discount_value,
                    0
                  )
                - IFNULL(
                    sr.promotion_discount_value,
                    0
                  )
              )
            END
          ),
          0
        )
          AS returned_normal_discount,

        IFNULL(
          SUM(
            sr.loyalty_discount_value
          ),
          0
        )
          AS returned_loyalty_discount,

        IFNULL(
          SUM(
            IFNULL(
              sr.loyalty_points_reversed,
              0
            )
          ),
          0
        )
          AS returned_loyalty_points_reversed,

        IFNULL(
          SUM(sr.refund_amount),
          0
        )
          AS total_return_value,

        IFNULL(
          SUM(
            IFNULL(
              sr.debt_reduction_amount,
              0
            )
          ),
          0
        )
          AS return_debt_reduction,

        IFNULL(
          SUM(
            IFNULL(
              sr.cash_refund_amount,
              sr.refund_amount
            )
          ),
          0
        )
          AS return_cash_refund

      FROM sale_returns sr

      WHERE
        sr.original_sale_id = ?

        AND sr.cancelled_at
          IS NULL
      `,
    )
    .get(saleId) as any

  const totalReturnValue = roundMoney(
    Number(returnSummary?.total_return_value || 0),
  )

  const netGrandTotal = Math.max(
    0,
    roundMoney(currentGrandTotal - totalReturnValue),
  )

  const remainingAmount = positive(sale.remaining_amount)

  const netPaidAmount = Math.max(0, roundMoney(netGrandTotal - remainingAmount))

  const exchangeSummary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS exchange_count,

        IFNULL(
          SUM(
            difference_amount
          ),
          0
        )
          AS difference_total,

        IFNULL(
          SUM(
            cash_collection_amount
          ),
          0
        )
          AS cash_collection_total,

        IFNULL(
          SUM(
            debt_reduction_amount
          ),
          0
        )
          AS debt_reduction_total,

        IFNULL(
          SUM(
            cash_refund_amount
          ),
          0
        )
          AS cash_refund_total,

        IFNULL(
          SUM(
            IFNULL(
              loyalty_earned_points_adjustment,
              0
            )
          ),
          0
        )
          AS loyalty_earned_points_adjustment,

        IFNULL(
          SUM(
            IFNULL(
              loyalty_redeemed_points_adjustment,
              0
            )
          ),
          0
        )
          AS loyalty_redeemed_points_adjustment

      FROM sale_exchanges

      WHERE
        original_sale_id = ?

        AND cancelled_at
          IS NULL
      `,
    )
    .get(saleId) as any

  const exchanges = db
    .prepare(
      `
      SELECT
        se.*,

        u.name
          AS cashier_name,

        cu.name
          AS cancelled_by_name

      FROM sale_exchanges se

      LEFT JOIN users u
        ON u.id = se.user_id

      LEFT JOIN users cu
        ON cu.id =
          se.cancelled_by

      WHERE
        se.original_sale_id = ?

      ORDER BY se.id ASC
      `,
    )
    .all(saleId) as any[]

  const currentLoyaltyPointsEarned = Math.max(
    0,

    Number(sale.loyalty_points_earned || 0) +
      Number(exchangeSummary?.loyalty_earned_points_adjustment || 0) -
      Number(returnSummary?.returned_loyalty_points_reversed || 0),
  )

  const ledgerLoyaltyPointsRedeemed = Math.max(
    0,

    Number(sale.loyalty_points_redeemed || 0) +
      Number(exchangeSummary?.loyalty_redeemed_points_adjustment || 0),
  )

  const getExchangeItems = db.prepare(
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
        ON old_variant.id =
          sei.old_variant_id

      JOIN products
        old_product
        ON old_product.id =
          old_variant.product_id

      JOIN product_variants
        new_variant
        ON new_variant.id =
          sei.new_variant_id

      JOIN products
        new_product
        ON new_product.id =
          new_variant.product_id

      WHERE sei.exchange_id = ?

      ORDER BY sei.id ASC
      `,
  )

  const exchangeHistory = exchanges.map((exchange) => ({
    ...exchange,

    code: `EXC-${String(exchange.id).padStart(5, '0')}`,

    items: getExchangeItems.all(exchange.id),
  }))

  const currentTotalDiscount = roundMoney(
    currentPromotionDiscount + currentNormalDiscount + currentLoyaltyDiscount,
  )

  const exchangeDifferenceTotal = roundMoney(
    Number(exchangeSummary?.difference_total || 0),
  )

  /*
   * Helpful audit check:
   *
   * original grand total
   * + all exchange financial differences
   * should equal the current grand total.
   */
  const eventCalculatedGrandTotal = Math.max(
    0,
    roundMoney(Number(sale.grand_total || 0) + exchangeDifferenceTotal),
  )

  const financialIntegrityDelta = roundMoney(
    currentGrandTotal - eventCalculatedGrandTotal,
  )

  const financials = {
    original_sub_total: roundMoney(Number(sale.sub_total || 0)),

    original_promotion_discount_value: roundMoney(
      Number(sale.promotion_discount_value || 0),
    ),

    original_normal_discount_value: roundMoney(originalNormalDiscount),

    original_loyalty_discount_value: roundMoney(originalLoyaltyDiscount),

    original_grand_total: roundMoney(Number(sale.grand_total || 0)),

    current_sub_total: currentSubTotal,

    current_promotion_discount_value: currentPromotionDiscount,

    current_normal_discount_value: currentNormalDiscount,

    current_loyalty_discount_value: currentLoyaltyDiscount,

    current_total_discount: currentTotalDiscount,

    current_grand_total: currentGrandTotal,

    total_return_value: totalReturnValue,

    net_grand_total: netGrandTotal,

    remaining_amount: remainingAmount,

    net_paid_amount: netPaidAmount,

    return_count: Number(returnSummary?.return_count || 0),

    returned_sub_total: roundMoney(
      Number(returnSummary?.returned_sub_total || 0),
    ),

    returned_promotion_discount: roundMoney(
      Number(returnSummary?.returned_promotion_discount || 0),
    ),

    returned_normal_discount: roundMoney(
      Number(returnSummary?.returned_normal_discount || 0),
    ),

    returned_loyalty_discount: roundMoney(
      Number(returnSummary?.returned_loyalty_discount || 0),
    ),

    exchange_count: Number(exchangeSummary?.exchange_count || 0),

    exchange_difference_total: exchangeDifferenceTotal,

    exchange_cash_collection_total: roundMoney(
      Number(exchangeSummary?.cash_collection_total || 0),
    ),

    exchange_debt_reduction_total: roundMoney(
      Number(exchangeSummary?.debt_reduction_total || 0),
    ),

    exchange_cash_refund_total: roundMoney(
      Number(exchangeSummary?.cash_refund_total || 0),
    ),

    event_calculated_grand_total: eventCalculatedGrandTotal,

    financial_integrity_delta: financialIntegrityDelta,

    current_loyalty_points_earned: currentLoyaltyPointsEarned,

    current_loyalty_points_redeemed: currentLoyaltyPointsRedeemed,

    ledger_loyalty_points_redeemed: ledgerLoyaltyPointsRedeemed,
  }

  const originalReceipt = {
    sale: {
      ...sale,
    },

    items: originalItems,

    loyalty,
  }

  const currentSale = {
    ...sale,

    original_sub_total: Number(sale.sub_total || 0),

    original_discount_value: Number(sale.discount_value || 0),

    original_promotion_discount_value: Number(
      sale.promotion_discount_value || 0,
    ),

    original_loyalty_discount_value: Number(sale.loyalty_discount_value || 0),

    original_grand_total: Number(sale.grand_total || 0),

    sub_total: currentSubTotal,

    discount_value: currentNormalDiscount,

    promotion_discount_value: currentPromotionDiscount,

    loyalty_discount_value: currentLoyaltyDiscount,

    grand_total: currentGrandTotal,

    total_discount_value: currentTotalDiscount,

    total_return_amount: totalReturnValue,

    current_net_total: netGrandTotal,

    current_paid_amount: netPaidAmount,

    exchange_count: Number(exchangeSummary?.exchange_count || 0),

    exchange_difference_total: exchangeDifferenceTotal,
  }

  const currentReceipt = {
    sale: currentSale,

    items: currentItems.map(({ sort_order, ...item }) => item),

    loyalty,
  }

  return {
    sale: currentSale,

    financials,

    loyalty_snapshot: effectiveLoyaltySnapshot,

    current_receipt: currentReceipt,

    original_receipt: originalReceipt,

    exchanges: exchangeHistory,

    promotion_units: promotionUnits,
  }
}
