import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo'

import {
  createPromotion,
  togglePromotion,
} from '../../src/main/database/repositories/promotions.repo'

import {
  cancelSaleReturn,
  createSale,
  createSaleReturn,
  listSales,
} from '../../src/main/database/repositories/sales.repo'

import {
  cancelSaleExchange,
  createSaleExchange,
  listSaleExchanges,
} from '../../src/main/database/repositories/sales-exchange.repo'

import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo'

import { getReportsSummary } from '../../src/main/database/repositories/reports.repo'

import {
  closeCashDay,
  getCashDayClosePreview,
} from '../../src/main/database/repositories/cash.repo'

type VariantRow = {
  variant_id: number
  product_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  buy_price: number
  sell_price: number
  stock: number
}

type PromoBarcode = 'CEX150' | 'CEX200' | 'CEX250' | 'CEX300' | 'CEX350'

function setLoyaltyEnabled(enabled: boolean) {
  const db = getDb()

  const update = db.prepare(`
    UPDATE app_settings
    SET value = ?
    WHERE key = ?
  `)

  update.run(enabled ? 'true' : 'false', 'loyalty_enabled')

  update.run('100', 'loyalty_earn_amount')

  update.run('1', 'loyalty_earn_points')

  update.run('1', 'loyalty_point_value')

  update.run('1', 'loyalty_min_redeem_points')
}

function localDateKey() {
  const date = new Date()

  const year = date.getFullYear()

  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function seedCatalog() {
  const category = createCategory({
    name: 'Exchange Cancellation Category',
  })

  createProduct({
    name: 'Exchange Cancellation Product',

    category_id: Number(category.id),

    image_path: null,
    description: null,

    variants: [
      {
        barcode: 'CEX150',
        size: '150',
        color: 'Black',
        buy_price: 70,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX250',
        size: '250',
        color: 'Black',
        buy_price: 110,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX350',
        size: '350',
        color: 'Black',
        buy_price: 150,
        sell_price: 350,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  })

  const get = (barcode: PromoBarcode) =>
    getVariantByBarcode(barcode) as VariantRow

  return {
    categoryId: Number(category.id),

    variants: {
      CEX150: get('CEX150'),
      CEX200: get('CEX200'),
      CEX250: get('CEX250'),
      CEX300: get('CEX300'),
      CEX350: get('CEX350'),
    },
  }
}

function createCustomer(points = 0) {
  const result = getDb()
    .prepare(
      `
      INSERT INTO customers (
        name,
        phone,
        points_balance
      )
      VALUES (?, ?, ?)
      `,
    )
    .run(
      'Exchange Cancel Customer',
      `0109${Date.now().toString().slice(-7)}`,
      points,
    )

  return Number(result.lastInsertRowid)
}

function createPromotionSale(
  barcodes: PromoBarcode[],
  options?: {
    customerId?: number | null
    paid?: number
  },
) {
  const catalog = seedCatalog()

  const promotion = createPromotion({
    name: 'Cancel Test Buy 2 Get 1',

    type: 'buy_x_get_y',

    value: 0,

    buy_qty: 2,
    free_qty: 1,

    scope_type: 'category',

    category_id: catalog.categoryId,

    product_ids: [],

    actor_id: 1,
  })

  togglePromotion(promotion.promotionId, 1)

  const items = barcodes.map((barcode) => {
    const variant = catalog.variants[barcode]

    return {
      variant_id: variant.variant_id,

      product_name: variant.product_name,

      barcode: variant.barcode,

      size: variant.size,

      color: variant.color,

      quantity: 1,

      unit_price: variant.sell_price,
    }
  })

  const subTotal = items.reduce(
    (total, item) => total + Number(item.unit_price),
    0,
  )

  const freeCount = Math.floor(items.length / 3)

  const promotionDiscount = [...items]
    .sort((a, b) => Number(a.unit_price) - Number(b.unit_price))
    .slice(0, freeCount)
    .reduce((total, item) => total + Number(item.unit_price), 0)

  const grandTotal = subTotal - promotionDiscount

  const sale = createSale({
    user_id: 1,

    customer_id: options?.customerId ?? null,

    promotion_id: promotion.promotionId,

    sub_total: subTotal,

    discount_value: 0,

    grand_total: grandTotal,

    change_amount: 0,

    payment_method: 'cash',

    paid: options?.paid === undefined ? grandTotal : options.paid,

    items,
  })

  return {
    ...catalog,

    promotionId: promotion.promotionId,

    sale,
  }
}

function getUnits(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE sale_id = ?
      ORDER BY id ASC
      `,
    )
    .all(saleId) as any[]
}

function getUnitByPrice(saleId: number, price: number) {
  return getUnits(saleId).find(
    (unit) => Number(unit.current_unit_price) === price,
  )
}

function stock(barcode: string) {
  return Number((getVariantByBarcode(barcode) as VariantRow).stock || 0)
}

function customerBalance(customerId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as any

  return Number(row?.balance || 0)
}

function customerPoints(customerId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT points_balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as any

  return Number(row?.points_balance || 0)
}

function fullBundleReturnItems(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        variant_id,
        quantity

      FROM sale_items

      WHERE
        sale_id = ?

        AND
          promotion_group_id
          IS NOT NULL

      ORDER BY id ASC
      `,
    )
    .all(saleId)
    .map((item: any) => ({
      sale_item_id: Number(item.id),

      variant_id: Number(item.variant_id),

      quantity: Number(item.quantity),
    }))
}

describe('sale exchange cancellation', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    setLoyaltyEnabled(false)
  })

  it('cancels the latest exchange and restores stock current state cash reports and audit history', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'])

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'تغيير الهدية',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    })

    expect(exchange.difference_amount).toBe(100)

    expect(stock('CEX150')).toBe(20)

    expect(stock('CEX300')).toBe(19)

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      reason: 'رجوع عن الاستبدال',

      actor_id: 1,
    })

    expect(cancelled.ok).toBe(true)

    expect(cancelled.exchange_id).toBe(exchange.exchangeId)

    expect(cancelled.cash_refunded).toBe(100)

    const units = getUnits(result.sale.saleId)

    expect(
      units
        .map((unit) => Number(unit.current_unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250])

    const gift = units.find((unit) => Number(unit.current_is_gift) === 1)

    expect(Number(gift.current_unit_price)).toBe(150)

    expect(stock('CEX150')).toBe(19)

    expect(stock('CEX300')).toBe(20)

    const reverseCash = getDb()
      .prepare(
        `
            SELECT *
            FROM cash_movements

            WHERE
              reference_type =
                'sale_exchange_cancel'

              AND
                reference_id = ?

            ORDER BY id DESC
            LIMIT 1
            `,
      )
      .get(exchange.exchangeId) as any

    expect(reverseCash).toBeTruthy()

    expect(reverseCash.direction).toBe('out')

    expect(Number(reverseCash.amount)).toBe(100)

    const exchangeRow = getDb()
      .prepare(
        `
            SELECT *
            FROM sale_exchanges
            WHERE id = ?
            LIMIT 1
            `,
      )
      .get(exchange.exchangeId) as any

    expect(exchangeRow.cancelled_at).toBeTruthy()

    expect(exchangeRow.cancel_reason).toBe('رجوع عن الاستبدال')

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.exchange_count).toBe(0)

    expect(state.financials.net_grand_total).toBe(450)

    expect(state.exchanges).toHaveLength(1)

    expect(state.exchanges[0].cancelled_at).toBeTruthy()

    const history = listSaleExchanges({
      status: 'cancelled',

      search: String(exchange.exchangeId),
    })

    expect(history.rows).toHaveLength(1)

    expect(history.rows[0].can_cancel).toBe(false)

    const sales = listSales({
      search: `#${result.sale.saleId}`,

      limit: 50,
      offset: 0,
    })

    expect(Number((sales.rows[0] as any).exchange_count)).toBe(0)

    expect(Number((sales.rows[0] as any).cancelled_exchange_count)).toBe(1)

    const reports = getReportsSummary() as any

    expect(reports.summary.exchange_count).toBe(0)

    expect(reports.summary.gross_sales).toBe(450)

    expect(reports.summary.net_sales).toBe(450)
  })

  it('requires LIFO cancellation across the whole invoice', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'])

    const unit = getUnitByPrice(result.sale.saleId, 150)

    const first = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    })

    const second = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.variants.CEX350.variant_id,
        },
      ],
    })

    expect(() =>
      cancelSaleExchange({
        exchange_id: first.exchangeId,

        actor_id: 1,

        reason: 'إلغاء غير مرتب',
      }),
    ).toThrow('يجب إلغاء آخر عملية استبدال أولًا')

    cancelSaleExchange({
      exchange_id: second.exchangeId,

      actor_id: 1,

      reason: 'إلغاء الثاني',
    })

    cancelSaleExchange({
      exchange_id: first.exchangeId,

      actor_id: 1,

      reason: 'إلغاء الأول',
    })

    const units = getUnits(result.sale.saleId)

    expect(
      units
        .map((item) => Number(item.current_unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250])
  })

  it('blocks exchange cancellation while a newer active return exists', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'])

    const gift = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    })

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      items: fullBundleReturnItems(result.sale.saleId),
    })

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,

        actor_id: 1,

        reason: 'محاولة قبل المرتجع',
      }),
    ).toThrow('يجب إلغاء المرتجع الأحدث أولًا')

    cancelSaleReturn({
      return_id: saleReturn.returnId,

      actor_id: 1,

      reason: 'إلغاء المرتجع',
    })

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء بعد المرتجع',
    })

    expect(cancelled.ok).toBe(true)
  })

  it('restores customer debt when cancelling a cheaper exchange', () => {
    const customerId = createCustomer()

    const result = createPromotionSale(['CEX300', 'CEX250', 'CEX200'], {
      customerId,
      paid: 400,
    })

    expect(result.sale.remaining_amount).toBe(150)

    expect(customerBalance(customerId)).toBe(150)

    const unit300 = getUnitByPrice(result.sale.saleId, 300)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit300.id),

          new_variant_id: result.variants.CEX150.variant_id,
        },
      ],
    })

    expect(exchange.difference_amount).toBe(-100)

    expect(exchange.debt_reduction_amount).toBe(100)

    const afterExchange = getDb()
      .prepare(
        `
            SELECT
              remaining_amount

            FROM sales
            WHERE id = ?
            `,
      )
      .get(result.sale.saleId) as any

    expect(Number(afterExchange.remaining_amount)).toBe(50)

    expect(customerBalance(customerId)).toBe(50)

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء استبدال خفض الدين',
    })

    expect(cancelled.debt_restored).toBe(100)

    const restoredSale = getDb()
      .prepare(
        `
            SELECT
              remaining_amount,
              payment_status

            FROM sales
            WHERE id = ?
            `,
      )
      .get(result.sale.saleId) as any

    expect(Number(restoredSale.remaining_amount)).toBe(150)

    expect(restoredSale.payment_status).toBe('partial')

    expect(customerBalance(customerId)).toBe(150)
  })

  it('reverses loyalty adjustments created by the cancelled exchange', () => {
    setLoyaltyEnabled(true)

    const customerId = createCustomer()

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'], {
      customerId,
    })

    expect(result.sale.loyalty_points_earned).toBe(4)

    expect(customerPoints(customerId)).toBe(4)

    const gift = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    })

    expect(exchange.loyalty_earned_points_adjustment).toBe(1)

    expect(customerPoints(customerId)).toBe(5)

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء مع النقاط',
    })

    expect(cancelled.loyalty_balance_reversed).toBe(-1)

    expect(customerPoints(customerId)).toBe(4)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.current_loyalty_points_earned).toBe(4)
  })

  it('rejects cancellation when the exchange accounting day is closed', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'])

    const gift = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    })

    const today = localDateKey()

    const preview = getCashDayClosePreview(today)

    closeCashDay({
      business_date: today,

      counted_amount: preview.system_closing_balance,

      carry_over_amount: preview.system_closing_balance,

      closed_by: 1,
    })

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,

        actor_id: 1,

        reason: 'إلغاء بعد التقفيل',
      }),
    ).toThrow('تم تقفيله')
  })
})
