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

import { getReportsSummary } from '../../src/main/database/repositories/reports.repo'

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

function seedExchangeReportSale() {
  const category = createCategory({
    name: 'Exchange Report Category',
  })

  createProduct({
    name: 'Exchange Report Product',
    category_id: Number(category.id),
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'REP150',
        size: '150',
        color: 'Black',
        buy_price: 80,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'REP200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'REP250',
        size: '250',
        color: 'Black',
        buy_price: 100,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'REP300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  })

  const variant150 = getVariantByBarcode('REP150') as VariantRow

  const variant200 = getVariantByBarcode('REP200') as VariantRow

  const variant250 = getVariantByBarcode('REP250') as VariantRow

  const variant300 = getVariantByBarcode('REP300') as VariantRow

  const db = getDb()

  const customerResult = db
    .prepare(
      `
      INSERT INTO customers (
        name,
        phone
      )
      VALUES (?, ?)
      `,
    )
    .run('Exchange Report Customer', '01098765432')

  const customerId = Number(customerResult.lastInsertRowid)

  const promotion = createPromotion({
    name: 'Report Buy 2 Get 1',
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
    paid: 450,

    items: [
      {
        variant_id: variant250.variant_id,
        product_name: variant250.product_name,
        barcode: variant250.barcode,
        size: variant250.size,
        color: variant250.color,
        quantity: 1,
        unit_price: 250,
      },
      {
        variant_id: variant200.variant_id,
        product_name: variant200.product_name,
        barcode: variant200.barcode,
        size: variant200.size,
        color: variant200.color,
        quantity: 1,
        unit_price: 200,
      },
      {
        variant_id: variant150.variant_id,
        product_name: variant150.product_name,
        barcode: variant150.barcode,
        size: variant150.size,
        color: variant150.color,
        quantity: 1,
        unit_price: 150,
      },
    ],
  })

  const giftUnit = db
    .prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE sale_id = ?
        AND current_is_gift = 1
      LIMIT 1
      `,
    )
    .get(sale.saleId) as any

  expect(giftUnit).toBeTruthy()

  const exchange = createSaleExchange({
    original_sale_id: sale.saleId,

    user_id: 1,

    payment_method: 'store_cash',

    items: [
      {
        promotion_unit_id: Number(giftUnit.id),

        new_variant_id: variant300.variant_id,
      },
    ],
  })

  return {
    db,
    sale,
    exchange,

    customerId,

    variant150,
    variant200,
    variant250,
    variant300,
  }
}

describe('reports with sale exchanges', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('includes an exchange in sales discounts products customers and profit', () => {
    const result = seedExchangeReportSale()

    const report = getReportsSummary() as any

    expect(report.summary.sales_count).toBe(1)

    expect(report.summary.exchange_count).toBe(1)

    expect(report.summary.exchange_adjustment).toBe(100)

    expect(report.summary.gross_sales).toBe(550)

    expect(report.summary.net_sales).toBe(550)

    expect(report.summary.promotion_discounts).toBe(200)

    expect(report.summary.total_discounts).toBe(200)

    expect(report.summary.gross_profit_before_discounts).toBe(430)

    expect(report.summary.net_profit_after_discounts).toBe(230)

    expect(report.summary.final_net_profit).toBe(230)

    const product150 = report.topProducts.find(
      (row: any) => Number(row.variant_id) === result.variant150.variant_id,
    )

    const product200 = report.topProducts.find(
      (row: any) => Number(row.variant_id) === result.variant200.variant_id,
    )

    const product250 = report.topProducts.find(
      (row: any) => Number(row.variant_id) === result.variant250.variant_id,
    )

    const product300 = report.topProducts.find(
      (row: any) => Number(row.variant_id) === result.variant300.variant_id,
    )

    expect(product150).toBeUndefined()

    expect(Number(product200.net_quantity)).toBe(1)

    expect(Number(product250.net_quantity)).toBe(1)

    expect(Number(product300.net_quantity)).toBe(1)

    expect(Number(product300.net_total)).toBe(300)

    expect(
      report.dailySales.reduce(
        (total: number, row: any) => total + Number(row.total || 0),
        0,
      ),
    ).toBe(550)

    const payment = report.paymentMethods.find(
      (row: any) => row.payment_method === 'cash',
    )

    expect(payment).toBeTruthy()

    expect(Number(payment.count)).toBe(1)

    expect(Number(payment.total)).toBe(550)

    const customer = report.topCustomers.find(
      (row: any) => Number(row.id) === result.customerId,
    )

    expect(customer).toBeTruthy()

    expect(Number(customer.total_spent)).toBe(550)

    const exchangeItem = result.db
      .prepare(
        `
            SELECT *
            FROM sale_exchange_items
            WHERE exchange_id = ?
            LIMIT 1
            `,
      )
      .get(result.exchange.exchangeId) as any

    expect(Number(exchangeItem.old_unit_cost)).toBe(80)

    expect(Number(exchangeItem.new_unit_cost)).toBe(130)

    /*
     * تغيير سعر الشراء الحالي بعد
     * الاستبدال لا يجوز أن يغير
     * ربح العملية التاريخية.
     */
    result.db
      .prepare(
        `
          UPDATE product_variants
          SET buy_price = 999
          WHERE id = ?
          `,
      )
      .run(result.variant300.variant_id)

    const reportAfterCostChange = getReportsSummary() as any

    expect(reportAfterCostChange.summary.net_profit_after_discounts).toBe(230)
  })

  it('attributes the exchange adjustment to the exchange date instead of the original sale date', () => {
    const result = seedExchangeReportSale()

    result.db
      .prepare(
        `
          UPDATE sales
          SET
            business_date =
              '2026-08-10',
            created_at =
              '2026-08-10 10:00:00'
          WHERE id = ?
          `,
      )
      .run(result.sale.saleId)

    result.db
      .prepare(
        `
          UPDATE sale_exchanges
          SET
            business_date =
              '2026-08-12',
            created_at =
              '2026-08-12 10:00:00'
          WHERE id = ?
          `,
      )
      .run(result.exchange.exchangeId)

    const saleDay = getReportsSummary({
      date_from: '2026-08-10',
      date_to: '2026-08-10',
    }) as any

    expect(saleDay.summary.sales_count).toBe(1)

    expect(saleDay.summary.exchange_count).toBe(0)

    expect(saleDay.summary.gross_sales).toBe(450)

    expect(saleDay.summary.promotion_discounts).toBe(150)

    expect(saleDay.summary.net_profit_after_discounts).toBe(180)

    const exchangeDay = getReportsSummary({
      date_from: '2026-08-12',
      date_to: '2026-08-12',
    }) as any

    expect(exchangeDay.summary.sales_count).toBe(0)

    expect(exchangeDay.summary.exchange_count).toBe(1)

    expect(exchangeDay.summary.exchange_adjustment).toBe(100)

    expect(exchangeDay.summary.gross_sales).toBe(100)

    expect(exchangeDay.summary.net_sales).toBe(100)

    expect(exchangeDay.summary.promotion_discounts).toBe(50)

    expect(exchangeDay.summary.gross_profit_before_discounts).toBe(100)

    expect(exchangeDay.summary.net_profit_after_discounts).toBe(50)
  })

  it('returns the exchanged bundle without leaving sales profit or products behind', () => {
    const result = seedExchangeReportSale()

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

    const report = getReportsSummary() as any

    expect(report.summary.gross_sales).toBe(550)

    expect(report.summary.total_returns).toBe(550)

    expect(report.summary.net_sales).toBe(0)

    expect(report.summary.total_discounts).toBe(0)

    expect(report.summary.gross_profit_before_discounts).toBe(0)

    expect(report.summary.net_profit_after_discounts).toBe(0)

    expect(report.summary.final_net_profit).toBe(0)

    expect(report.topProducts).toHaveLength(0)

    const customer = report.topCustomers.find(
      (row: any) => Number(row.id) === result.customerId,
    )

    expect(Number(customer?.total_spent || 0)).toBe(0)
  })
})
