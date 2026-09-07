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
  createSale,
  createSaleReturn,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo'

import { createSaleExchange } from '../../src/main/database/repositories/sales-exchange.repo'

import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo'

import {
  closeCashDay,
  getCashDayClosePreview,
  getCashSummary,
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

function setLoyaltySettings(input: {
  enabled?: boolean
  earnAmount: number
  earnPoints: number
  pointValue: number
  minRedeemPoints?: number
}) {
  const db = getDb()

  const update = db.prepare(`
    UPDATE app_settings
    SET value = ?
    WHERE key = ?
  `)

  update.run(input.enabled === false ? 'false' : 'true', 'loyalty_enabled')

  update.run(String(input.earnAmount), 'loyalty_earn_amount')

  update.run(String(input.earnPoints), 'loyalty_earn_points')

  update.run(String(input.pointValue), 'loyalty_point_value')

  update.run(String(input.minRedeemPoints ?? 1), 'loyalty_min_redeem_points')
}

function localDateKey() {
  const date = new Date()

  const year = date.getFullYear()

  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function seedSale(input?: { initialPoints?: number; redeemPoints?: number }) {
  const db = getDb()

  const category = createCategory({
    name: 'Exchange Loyalty Category',
  })

  createProduct({
    name: 'Exchange Loyalty Product',

    category_id: Number(category.id),

    image_path: null,
    description: null,

    variants: [
      {
        barcode: 'LOY150',
        size: '150',
        color: 'Black',
        buy_price: 70,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'LOY200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'LOY250',
        size: '250',
        color: 'Black',
        buy_price: 110,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'LOY300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'LOY350',
        size: '350',
        color: 'Black',
        buy_price: 150,
        sell_price: 350,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  })

  const variants = {
    v150: getVariantByBarcode('LOY150') as VariantRow,

    v200: getVariantByBarcode('LOY200') as VariantRow,

    v250: getVariantByBarcode('LOY250') as VariantRow,

    v300: getVariantByBarcode('LOY300') as VariantRow,

    v350: getVariantByBarcode('LOY350') as VariantRow,
  }

  const customerResult = db
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
      'Exchange Loyalty Customer',
      '01055554444',
      Number(input?.initialPoints || 0),
    )

  const customerId = Number(customerResult.lastInsertRowid)

  const promotion = createPromotion({
    name: 'Loyalty Buy 2 Get 1',

    type: 'buy_x_get_y',

    value: 0,

    buy_qty: 2,
    free_qty: 1,

    scope_type: 'category',

    category_id: Number(category.id),

    product_ids: [],

    actor_id: 1,
  })

  togglePromotion(promotion.promotionId, 1)

  const sale = createSale({
    user_id: 1,

    customer_id: customerId,

    promotion_id: promotion.promotionId,

    sub_total: 600,

    discount_value: 0,

    grand_total: 450,

    change_amount: 0,

    payment_method: 'cash',

    loyalty_points_redeemed: Number(input?.redeemPoints || 0),

    items: [
      {
        variant_id: variants.v250.variant_id,

        product_name: variants.v250.product_name,

        barcode: variants.v250.barcode,

        size: variants.v250.size,

        color: variants.v250.color,

        quantity: 1,

        unit_price: 250,
      },
      {
        variant_id: variants.v200.variant_id,

        product_name: variants.v200.product_name,

        barcode: variants.v200.barcode,

        size: variants.v200.size,

        color: variants.v200.color,

        quantity: 1,

        unit_price: 200,
      },
      {
        variant_id: variants.v150.variant_id,

        product_name: variants.v150.product_name,

        barcode: variants.v150.barcode,

        size: variants.v150.size,

        color: variants.v150.color,

        quantity: 1,

        unit_price: 150,
      },
    ],
  })

  return {
    db,
    sale,
    customerId,
    variants,
  }
}

function getCustomerPoints(customerId: number) {
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

function getUnitByPrice(saleId: number, price: number) {
  return getDb()
    .prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE sale_id = ?
        AND current_unit_price = ?
      ORDER BY id ASC
      LIMIT 1
      `,
    )
    .get(saleId, price) as any
}

describe('sale exchange loyalty accounting', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('recalculates earned points using the loyalty rules saved at sale time', () => {
    setLoyaltySettings({
      earnAmount: 100,
      earnPoints: 1,
      pointValue: 1,
    })

    const result = seedSale()

    expect(result.sale.loyalty_points_earned).toBe(4)

    expect(getCustomerPoints(result.customerId)).toBe(4)

    /*
     * تغيير الإعدادات بعد البيع
     * لا يجب أن يغير قواعد
     * الفاتورة الأصلية.
     */
    setLoyaltySettings({
      earnAmount: 1000,
      earnPoints: 1,
      pointValue: 1,
    })

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.v300.variant_id,
        },
      ],
    })

    expect(exchange.difference_amount).toBe(100)

    expect(exchange.loyalty_earned_points_adjustment).toBe(1)

    expect(exchange.loyalty_redeemed_points_adjustment).toBe(0)

    expect(getCustomerPoints(result.customerId)).toBe(5)

    const snapshot = result.db
      .prepare(
        `
            SELECT *
            FROM sale_loyalty_snapshots
            WHERE sale_id = ?
            LIMIT 1
            `,
      )
      .get(result.sale.saleId) as any

    expect(Number(snapshot.earn_amount)).toBe(100)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.current_loyalty_points_earned).toBe(5)
  })

  it('returns unused redeemed points when the new invoice can no longer use them', () => {
    setLoyaltySettings({
      earnAmount: 1000,
      earnPoints: 1,
      pointValue: 50,
    })

    const result = seedSale({
      initialPoints: 8,
      redeemPoints: 8,
    })

    expect(result.sale.loyalty_points_redeemed).toBe(8)

    expect(result.sale.loyalty_discount_value).toBe(400)

    expect(result.sale.grand_total).toBe(50)

    expect(getCustomerPoints(result.customerId)).toBe(0)

    const unit250 = getUnitByPrice(result.sale.saleId, 250)

    const cheaperExchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit250.id),

          new_variant_id: result.variants.v150.variant_id,
        },
      ],
    })

    expect(cheaperExchange.loyalty_redeemed_points_adjustment).toBe(-1)

    expect(cheaperExchange.loyalty_earned_points_adjustment).toBe(0)

    expect(getCustomerPoints(result.customerId)).toBe(1)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.current_loyalty_points_redeemed).toBe(7)

    expect(state.financials.current_loyalty_discount_value).toBe(350)

    /*
     * نحاكي إن العميل استخدم
     * النقطة التي رجعت له
     * في عملية أخرى.
     */
    result.db
      .prepare(
        `
          UPDATE customers
          SET points_balance = 0
          WHERE id = ?
          `,
      )
      .run(result.customerId)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,

        user_id: 1,

        items: [
          {
            promotion_unit_id: Number(unit250.id),

            new_variant_id: result.variants.v300.variant_id,
          },
        ],
      }),
    ).toThrow('رصيد نقاط العميل غير كافٍ لإتمام الاستبدال')
  })

  it('reverses the recalculated earned points when the exchanged invoice is later returned', () => {
    setLoyaltySettings({
      earnAmount: 100,
      earnPoints: 1,
      pointValue: 1,
    })

    const result = seedSale()

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.v300.variant_id,
        },
      ],
    })

    expect(getCustomerPoints(result.customerId)).toBe(5)

    const receipt = getSaleReceipt(result.sale.saleId) as any

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      items: receipt.items.map((item: any) => ({
        sale_item_id: Number(item.id),

        variant_id: Number(item.variant_id),

        quantity: Number(item.quantity),
      })),
    })

    expect(saleReturn.return_value).toBe(550)

    expect(saleReturn.loyalty_points_reversed).toBe(5)

    expect(getCustomerPoints(result.customerId)).toBe(0)
  })

  it('includes exchange cash in the cashier day and rejects exchanges after day close', () => {
    setLoyaltySettings({
      enabled: false,

      earnAmount: 100,
      earnPoints: 1,
      pointValue: 1,
    })

    const result = seedSale()

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.v300.variant_id,
        },
      ],
    })

    const exchangeCash = getCashSummary({
      type: 'sale_exchange',
    })

    expect(exchangeCash.total_in).toBe(100)

    expect(exchangeCash.total_out).toBe(0)

    const today = localDateKey()

    const preview = getCashDayClosePreview(today)

    /*
     * 450 البيع الأصلي
     * + 100 فرق الاستبدال.
     */
    expect(preview.day_cash_in).toBe(550)

    closeCashDay({
      business_date: today,

      counted_amount: preview.system_closing_balance,

      carry_over_amount: preview.system_closing_balance,

      closed_by: 1,
    })

    const unit250 = getUnitByPrice(result.sale.saleId, 250)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,

        user_id: 1,

        items: [
          {
            promotion_unit_id: Number(unit250.id),

            new_variant_id: result.variants.v350.variant_id,
          },
        ],
      }),
    ).toThrow('تم تقفيله')
  })
})
