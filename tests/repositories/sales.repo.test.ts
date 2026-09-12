import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo'
import {
  createSale,
  createSaleReturn,
  getSaleReceipt,
  cancelSaleReturn,
  listSales,
} from '../../src/main/database/repositories/sales.repo'
import {
  closeCashShift,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'
import {
  createPromotion,
  togglePromotion,
} from '../../src/main/database/repositories/promotions.repo'
import { createCashMovement } from '../../src/main/database/repositories/cash.repo'

type SaleVariantTestRow = {
  variant_id: number
  product_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  sell_price: number
  buy_price: number
  stock: number
  min_stock: number
  is_active: number
}

function seedProduct() {
  createProduct({
    name: 'Sales Test Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'SALE001',
        size: 'M',
        color: 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: 5,
        opening_qty: 10,
      },
    ],
  })

  const variant = getVariantByBarcode('SALE001') as
    | SaleVariantTestRow
    | undefined

  if (!variant) {
    throw new Error('Failed to seed test product variant')
  }

  return variant
}

function getCashMovementCount() {
  const db = getDb()
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM cash_movements`)
    .get() as {
    count: number
  }

  return row.count
}

function getCashMovementTotal(direction: 'in' | 'out') {
  const db = getDb()
  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(amount), 0) AS total
      FROM cash_movements
      WHERE direction = ?
      `,
    )
    .get(direction) as { total: number }

  return row.total
}

function createTestCustomer() {
  const db = getDb()

  const result = db
    .prepare(
      `
      INSERT INTO customers (name, phone, email, address, notes)
      VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run('Test Customer', '01000000000', null, null, null)

  return Number(result.lastInsertRowid)
}

function getCustomerBalance(customerId: number) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as { balance: number }

  return Number(row.balance || 0)
}

function getCustomerPoints(customerId: number) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT points_balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as { points_balance: number }

  return Number(row.points_balance || 0)
}

function getLoyaltyTransactionsCount(customerId: number) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM loyalty_transactions
      WHERE customer_id = ?
      `,
    )
    .get(customerId) as { count: number }

  return Number(row.count || 0)
}

function setCustomerPoints(customerId: number, points: number) {
  const db = getDb()

  db.prepare(
    `
    UPDATE customers
    SET points_balance = ?
    WHERE id = ?
    `,
  ).run(points, customerId)
}

function resetLoyaltySettingsForSalesTests() {
  const db = getDb()

  const update = db.prepare(`
    UPDATE app_settings
    SET value = ?
    WHERE key = ?
  `)

  update.run('true', 'loyalty_enabled')

  update.run('100', 'loyalty_earn_amount')

  update.run('1', 'loyalty_earn_points')

  update.run('1', 'loyalty_point_value')

  update.run('1', 'loyalty_min_redeem_points')
}

function getStockByBarcode(barcode: string) {
  const variant = getVariantByBarcode(barcode) as SaleVariantTestRow | undefined

  if (!variant) {
    throw new Error(`Variant not found for barcode: ${barcode}`)
  }

  return Number(variant.stock || 0)
}

describe('sales repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    resetLoyaltySettingsForSalesTests()
    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    })
  })

  it('rejects missing user_id', () => {
    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 0,
        customer_id: null,
        sub_total: 150,
        discount_value: 0,
        grand_total: 150,
        change_amount: 0,
        payment_method: 'cash',
        paid: 150,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 1,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('User ID is required')
  })

  it('rejects sale without items', () => {
    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 0,
        discount_value: 0,
        grand_total: 0,
        change_amount: 0,
        payment_method: 'cash',
        paid: 0,
        items: [],
      }),
    ).toThrow('Sale items are required')
  })

  it('requires an open shift and links the sale cash movement to it', () => {
    const db = getDb()

    db.prepare(
      `
    DELETE FROM cash_shifts
  `,
    ).run()

    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 150,
        discount_value: 0,
        grand_total: 150,
        change_amount: 0,
        payment_method: 'cash',
        paid: 150,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 1,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('لا يمكن تسجيل فاتورة بيع بدون شفت مفتوح')

    const shift = openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    })

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 150,
      discount_value: 0,
      grand_total: 150,
      change_amount: 0,
      payment_method: 'cash',
      paid: 150,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 150,
        },
      ],
    })

    expect(result.shift_id).toBe(shift.id)

    const sale = db
      .prepare(
        `
      SELECT shift_id
      FROM sales
      WHERE id = ?
    `,
      )
      .get(result.saleId) as {
      shift_id: number
    }

    expect(sale.shift_id).toBe(shift.id)

    const movement = db
      .prepare(
        `
      SELECT shift_id
      FROM cash_movements
      WHERE reference_type = 'sale'
        AND reference_id = ?
      LIMIT 1
    `,
      )
      .get(result.saleId) as {
      shift_id: number
    }

    expect(movement.shift_id).toBe(shift.id)
  })

  it('rejects item quantity less than or equal zero', () => {
    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 0,
        discount_value: 0,
        grand_total: 0,
        change_amount: 0,
        payment_method: 'cash',
        paid: 0,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 0,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('كمية غير صحيحة')
  })

  it('rejects sale quantity greater than available stock', () => {
    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 1650,
        discount_value: 0,
        grand_total: 1650,
        change_amount: 0,
        payment_method: 'cash',
        paid: 1650,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 11,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('المخزون غير كافي')
  })

  it('creates a fully paid cash sale', () => {
    const variant = seedProduct()

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.saleId).toBeGreaterThan(0)
    expect(result.grand_total).toBe(300)
    expect(result.paid_amount).toBe(300)
    expect(result.remaining_amount).toBe(0)
    expect(result.payment_status).toBe('paid')

    const receipt = getSaleReceipt(result.saleId) as any

    expect(receipt.sale.id).toBe(result.saleId)
    expect(receipt.items).toHaveLength(1)
    expect(receipt.items[0].quantity).toBe(2)
    expect(receipt.items[0].line_total).toBe(300)
  })

  it('decreases stock after sale', () => {
    const variant = seedProduct()

    createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    const updatedVariant = getVariantByBarcode('SALE001') as
      | SaleVariantTestRow
      | undefined

    expect(updatedVariant?.stock).toBe(8)
  })

  it('creates cash movement for paid sale amount', () => {
    const variant = seedProduct()

    expect(getCashMovementCount()).toBe(0)

    createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(getCashMovementCount()).toBe(1)
    expect(getCashMovementTotal('in')).toBe(300)
  })

  it('rejects credit sale without customer', () => {
    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 100,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('لا يمكن البيع آجل بدون اختيار عميل')
  })

  it('creates a partial sale with customer and increases customer balance', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 100,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.saleId).toBeGreaterThan(0)
    expect(result.grand_total).toBe(300)
    expect(result.paid_amount).toBe(100)
    expect(result.remaining_amount).toBe(200)
    expect(result.payment_status).toBe('partial')

    expect(getCustomerBalance(customerId)).toBe(200)
    expect(getCashMovementTotal('in')).toBe(100)
  })

  it('caps paid amount to grand total when customer pays more than total', () => {
    const variant = seedProduct()

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 200,
      payment_method: 'cash',
      paid: 500,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.grand_total).toBe(300)
    expect(result.paid_amount).toBe(300)
    expect(result.remaining_amount).toBe(0)
    expect(result.payment_status).toBe('paid')

    expect(getCashMovementTotal('in')).toBe(300)

    const receipt = getSaleReceipt(result.saleId) as any

    expect(receipt.sale.paid).toBe(300)
    expect(receipt.sale.change_amount).toBe(200)
  })

  it('calculates grand total from subtotal and discount value', () => {
    const variant = seedProduct()

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 50,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 250,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.grand_total).toBe(250)
    expect(result.paid_amount).toBe(250)
    expect(result.remaining_amount).toBe(0)
    expect(result.payment_status).toBe('paid')

    const receipt = getSaleReceipt(result.saleId) as any

    expect(receipt.sale.sub_total).toBe(300)
    expect(receipt.sale.discount_value).toBe(50)
    expect(receipt.sale.grand_total).toBe(250)
  })

  it('earns loyalty points for customer sale', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.loyalty_points_earned).toBe(3)
    expect(result.loyalty_points_redeemed).toBe(0)
    expect(result.loyalty_discount_value).toBe(0)

    expect(getCustomerPoints(customerId)).toBe(3)
    expect(getLoyaltyTransactionsCount(customerId)).toBe(1)
  })

  it('redeems loyalty points and applies loyalty discount', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    setCustomerPoints(customerId, 10)

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 295,
      loyalty_points_redeemed: 5,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(result.loyalty_points_redeemed).toBe(5)
    expect(result.loyalty_discount_value).toBe(5)
    expect(result.grand_total).toBe(295)
    expect(result.paid_amount).toBe(295)
    expect(result.remaining_amount).toBe(0)
    expect(result.payment_status).toBe('paid')

    expect(result.loyalty_points_earned).toBe(2)
    expect(getCustomerPoints(customerId)).toBe(7)
    expect(getLoyaltyTransactionsCount(customerId)).toBe(2)

    const receipt = getSaleReceipt(result.saleId) as any

    expect(receipt.sale.loyalty_points_redeemed).toBe(5)
    expect(receipt.sale.loyalty_discount_value).toBe(5)
    expect(receipt.sale.grand_total).toBe(295)
  })

  it('rejects redemption when invoice value would reduce redeemed points below the minimum', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    setCustomerPoints(customerId, 10)

    const db = getDb()

    const updateSetting = db.prepare(`
        UPDATE app_settings
        SET value = ?
        WHERE key = ?
      `)

    updateSetting.run('4', 'loyalty_min_redeem_points')

    updateSetting.run('100', 'loyalty_point_value')

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: customerId,

        sub_total: 300,
        discount_value: 0,
        grand_total: 300,

        change_amount: 0,
        payment_method: 'cash',

        loyalty_points_redeemed: 4,

        items: [
          {
            variant_id: variant.variant_id,

            product_name: variant.product_name,

            barcode: variant.barcode,

            size: variant.size,

            color: variant.color,

            quantity: 2,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('قيمة الفاتورة لا تسمح باستخدام الحد الأدنى من النقاط')

    expect(getCustomerPoints(customerId)).toBe(10)
  })

  it('rejects redeeming more loyalty points than customer balance', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    setCustomerPoints(customerId, 3)

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: customerId,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 300,
        loyalty_points_redeemed: 5,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('رصيد نقاط العميل غير كافي')

    expect(getCustomerPoints(customerId)).toBe(3)
  })

  it('rejects redeeming loyalty points for missing customer', () => {
    const variant = seedProduct()

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: 999999,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 300,
        loyalty_points_redeemed: 1,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150,
          },
        ],
      }),
    ).toThrow('العميل غير موجود')
  })

  it('creates a sale return for a fully paid sale and restores stock with cash refund', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(getStockByBarcode('SALE001')).toBe(8)
    expect(getCashMovementTotal('in')).toBe(300)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Customer returned one item',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.returnId).toBeGreaterThan(0)
    expect(saleReturn.return_value).toBe(150)
    expect(saleReturn.refundAmount).toBe(150)
    expect(saleReturn.debt_reduction_amount).toBe(0)

    expect(getStockByBarcode('SALE001')).toBe(9)
    expect(getCashMovementTotal('out')).toBe(150)
  })

  it('requires a new open shift for return and links refund to current shift', () => {
    const db = getDb()

    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    const originalShift = getOpenCashShift()

    expect(originalShift).toBeTruthy()

    closeCashShift({
      shift_id: originalShift!.id,
      closing_counted_amount: 300,
      left_for_next_shift: 300,
      closed_by: 1,
    })

    const receipt = getSaleReceipt(sale.saleId) as any

    const saleItemId = receipt.items[0].id

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        reason: 'Return without shift',
        items: [
          {
            sale_item_id: saleItemId,
            variant_id: variant.variant_id,
            quantity: 1,
          },
        ],
      }),
    ).toThrow('لا يمكن تسجيل مرتجع بيع بدون شفت مفتوح')

    const currentShift = openCashShift({
      opening_counted_amount: 300,
      opened_by: 1,
    })

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return in next shift',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.shift_id).toBe(currentShift.id)

    expect(saleReturn.shift_id).not.toBe(originalShift!.id)

    const returnRow = db
      .prepare(
        `
      SELECT shift_id
      FROM sale_returns
      WHERE id = ?
    `,
      )
      .get(saleReturn.returnId) as {
      shift_id: number
    }

    expect(returnRow.shift_id).toBe(currentShift.id)

    const refundMovement = db
      .prepare(
        `
      SELECT shift_id
      FROM cash_movements
      WHERE reference_type = 'sale_return'
        AND reference_id = ?
        AND direction = 'out'
      LIMIT 1
    `,
      )
      .get(saleReturn.returnId) as {
      shift_id: number
    }

    expect(refundMovement.shift_id).toBe(currentShift.id)
  })

  it('reduces customer debt before cash refund when returning from partial sale', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 100,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.remaining_amount).toBe(200)
    expect(sale.payment_status).toBe('partial')
    expect(getCustomerBalance(customerId)).toBe(200)
    expect(getStockByBarcode('SALE001')).toBe(8)
    expect(getCashMovementTotal('in')).toBe(100)
    expect(getCashMovementTotal('out')).toBe(0)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return from partial sale',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(150)
    expect(saleReturn.debt_reduction_amount).toBe(150)
    expect(saleReturn.refundAmount).toBe(0)

    expect(getCustomerBalance(customerId)).toBe(50)
    expect(getStockByBarcode('SALE001')).toBe(9)
    expect(getCashMovementTotal('out')).toBe(0)

    const updatedReceipt = getSaleReceipt(sale.saleId) as any

    expect(updatedReceipt.sale.remaining_amount).toBe(50)
    expect(updatedReceipt.sale.payment_status).toBe('partial')
  })

  it('reduces full customer debt then refunds remaining cash on return', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 200,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.remaining_amount).toBe(100)
    expect(sale.payment_status).toBe('partial')
    expect(getCustomerBalance(customerId)).toBe(100)
    expect(getCashMovementTotal('in')).toBe(200)
    expect(getCashMovementTotal('out')).toBe(0)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return exceeds remaining debt',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(150)
    expect(saleReturn.debt_reduction_amount).toBe(100)
    expect(saleReturn.refundAmount).toBe(50)

    expect(getCustomerBalance(customerId)).toBe(0)
    expect(getStockByBarcode('SALE001')).toBe(9)
    expect(getCashMovementTotal('out')).toBe(50)

    const updatedReceipt = getSaleReceipt(sale.saleId) as any

    expect(updatedReceipt.sale.remaining_amount).toBe(0)
    expect(updatedReceipt.sale.payment_status).toBe('paid')
  })

  it('rejects returning quantity greater than sold quantity', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        reason: 'Invalid return quantity',
        items: [
          {
            sale_item_id: saleItemId,
            variant_id: variant.variant_id,
            quantity: 3,
          },
        ],
      }),
    ).toThrow('الكمية المطلوبة أكبر من المتاح للمرتجع')

    expect(getStockByBarcode('SALE001')).toBe(8)
    expect(getCashMovementTotal('out')).toBe(0)
  })

  it('rejects returning more than remaining returnable quantity after previous return', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'First return',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(firstReturn.return_value).toBe(150)
    expect(getStockByBarcode('SALE001')).toBe(9)
    expect(getCashMovementTotal('out')).toBe(150)

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        reason: 'Second invalid return',
        items: [
          {
            sale_item_id: saleItemId,
            variant_id: variant.variant_id,
            quantity: 2,
          },
        ],
      }),
    ).toThrow('الكمية المطلوبة أكبر من المتاح للمرتجع')

    expect(getStockByBarcode('SALE001')).toBe(9)
    expect(getCashMovementTotal('out')).toBe(150)
  })

  it('calculates sale return value proportionally when original sale has discount', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 60,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 240,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.grand_total).toBe(240)
    expect(getCashMovementTotal('in')).toBe(240)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return with discount',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(120)
    expect(saleReturn.refundAmount).toBe(120)
    expect(saleReturn.debt_reduction_amount).toBe(0)

    expect(getCashMovementTotal('out')).toBe(120)
    expect(getStockByBarcode('SALE001')).toBe(9)
  })

  it('rounds returns to whole pounds while preserving the cumulative invoice value', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 1000,
      discount_value: 50,
      grand_total: 950,
      change_amount: 0,
      payment_method: 'cash',
      paid: 950,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 350,
        },
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 350,
        },
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 300,
        },
      ],
    })

    expect(sale.grand_total).toBe(950)

    const receipt = getSaleReceipt(sale.saleId) as any

    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'First rounded return',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: receipt.items[0].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(firstReturn.return_value).toBe(333)
    expect(firstReturn.refundAmount).toBe(333)

    const secondReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Second rounded return',
      items: [
        {
          sale_item_id: receipt.items[1].id,
          variant_id: receipt.items[1].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(secondReturn.return_value).toBe(332)
    expect(secondReturn.refundAmount).toBe(332)

    const thirdReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Third rounded return',
      items: [
        {
          sale_item_id: receipt.items[2].id,
          variant_id: receipt.items[2].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(thirdReturn.return_value).toBe(285)
    expect(thirdReturn.refundAmount).toBe(285)

    expect(getCashMovementTotal('out')).toBe(950)

    const rows = getDb()
      .prepare(
        `
      SELECT refund_amount
      FROM sale_returns
      WHERE original_sale_id = ?
        AND cancelled_at IS NULL
      ORDER BY id ASC
      `,
      )
      .all(sale.saleId) as Array<{
      refund_amount: number
    }>

    expect(rows.map((row) => Number(row.refund_amount))).toEqual([
      333, 332, 285,
    ])

    expect(
      rows.every((row) => Number.isInteger(Number(row.refund_amount))),
    ).toBe(true)
  })

  it('allows a later return to be zero when previous rounding already covered its value', () => {
    const variant = seedProduct()

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 4,
      discount_value: 3,
      grand_total: 1,
      change_amount: 0,
      payment_method: 'cash',
      paid: 1,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 2,
        },
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 1,
        },
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 1,
        },
      ],
    })

    expect(sale.grand_total).toBe(1)

    const receipt = getSaleReceipt(sale.saleId) as any

    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: receipt.items[0].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(firstReturn.return_value).toBe(1)

    const secondReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: [
        {
          sale_item_id: receipt.items[1].id,
          variant_id: receipt.items[1].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(secondReturn.return_value).toBe(0)

    expect(getCashMovementTotal('out')).toBe(1)
  })

  it('allows fractional debt settlement and restores it on return cancellation', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 100.5,
      discount_value: 0,
      grand_total: 100.5,
      change_amount: 0,
      payment_method: 'cash',
      paid: 50,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 100.5,
        },
      ],
    })

    expect(sale.remaining_amount).toBe(50.5)

    const receipt = getSaleReceipt(sale.saleId) as any

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 1,
      payment_method: 'store_cash',
      notes: 'Cash buffer for return rounding',
      created_by: 1,
    })

    const result = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: receipt.items[0].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(result.return_value).toBe(101)
    expect(result.debt_reduction_amount).toBe(50.5)
    expect(result.refundAmount).toBe(50.5)
    expect(getCashMovementTotal('out')).toBe(50.5)

    const afterReturn = getSaleReceipt(sale.saleId) as any
    expect(afterReturn.sale.remaining_amount).toBe(0)

    cancelSaleReturn({
      return_id: result.returnId,
      actor_id: 1,
      reason: 'Verify fractional debt restoration',
    })

    const afterCancellation = getSaleReceipt(sale.saleId) as any
    expect(afterCancellation.sale.remaining_amount).toBe(50.5)

    const customer = getDb()
      .prepare(
        `
        SELECT balance, total_spent
        FROM customers
        WHERE id = ?
      `,
      )
      .get(customerId) as {
      balance: number
      total_spent: number
    }

    expect(customer.balance).toBe(50.5)
    expect(customer.total_spent).toBe(100.5)
  })

  it('calculates sale return value proportionally when original sale has loyalty discount', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    setCustomerPoints(customerId, 10)

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 294,
      loyalty_points_redeemed: 6,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.grand_total).toBe(294)
    expect(sale.loyalty_points_redeemed).toBe(6)
    expect(sale.loyalty_discount_value).toBe(6)
    expect(getCashMovementTotal('in')).toBe(294)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return with loyalty discount',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(147)
    expect(saleReturn.refundAmount).toBe(147)
    expect(saleReturn.debt_reduction_amount).toBe(0)

    expect(getCashMovementTotal('out')).toBe(147)
    expect(getStockByBarcode('SALE001')).toBe(9)
  })

  it('recalculates earned loyalty points from the remaining sale value after return', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.loyalty_points_earned).toBe(3)
    expect(getCustomerPoints(customerId)).toBe(3)

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return should reverse points',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(150)

    /*
     * Original sale = 300
     * Earned points = 3
     *
     * After returning 150:
     * remaining sale value = 150
     *
     * Loyalty rule:
     * 1 point per 100
     *
     * New earned target = floor(150 / 100) = 1
     * Therefore reverse 3 - 1 = 2 points.
     */
    expect(saleReturn.loyalty_points_reversed).toBe(2)

    expect(getCustomerPoints(customerId)).toBe(1)
  })

  it('uses recorded loyalty points proportionally for legacy returns instead of estimated rules', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,

      sub_total: 300,
      discount_value: 0,
      grand_total: 300,

      change_amount: 0,
      payment_method: 'cash',
      paid: 300,

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    expect(sale.loyalty_points_earned).toBe(3)

    expect(getCustomerPoints(customerId)).toBe(3)

    const db = getDb()

    db.prepare(
      `
      UPDATE sale_loyalty_snapshots

      SET
        source =
          'legacy_estimated',

        earn_amount = 999,

        earn_points = 99

      WHERE sale_id = ?
      `,
    ).run(sale.saleId)

    const receipt = getSaleReceipt(sale.saleId) as any

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      items: [
        {
          sale_item_id: Number(receipt.items[0].id),

          variant_id: Number(receipt.items[0].variant_id),

          quantity: 1,
        },
      ],
    })

    expect(saleReturn.return_value).toBe(150)

    /*
     * Legacy invoice:
     *
     * recorded earned points = 3
     * returned value = 150 / 300 = 50%
     *
     * We cannot know the historical
     * earning rule, so preserve recorded
     * data proportionally:
     *
     * floor(3 * 50%) = 1 point reversed.
     */
    expect(saleReturn.loyalty_points_reversed).toBe(1)

    expect(getCustomerPoints(customerId)).toBe(2)
  })

  it('filters sales by payment state', () => {
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const createTestSale = (paid: number) =>
      createSale({
        user_id: 1,
        customer_id: customerId,

        sub_total: 150,
        discount_value: 0,
        grand_total: 150,

        change_amount: 0,
        payment_method: 'cash',

        paid,

        items: [
          {
            variant_id: variant.variant_id,

            product_name: variant.product_name,

            barcode: variant.barcode,

            size: variant.size,

            color: variant.color,

            quantity: 1,
            unit_price: 150,
          },
        ],
      })

    const paid = createTestSale(150)

    const partial = createTestSale(50)

    const unpaid = createTestSale(0)

    const paidResult = listSales({
      payment_filter: 'paid',
    }) as any

    expect(paidResult.rows.map((row: any) => row.id)).toEqual([paid.saleId])

    const unpaidResult = listSales({
      payment_filter: 'unpaid',
    }) as any

    const unpaidIds = unpaidResult.rows.map((row: any) => row.id)

    expect(unpaidIds).toContain(partial.saleId)

    expect(unpaidIds).toContain(unpaid.saleId)

    expect(unpaidIds).not.toContain(paid.saleId)
  })

  it('applies active promotion and preserves discount on return', () => {
    const variant = seedProduct()

    const promotion = createPromotion({
      name: '25 Percent Sale',

      type: 'percent',

      value: 25,

      scope_type: 'all',

      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      promotion_id: promotion.promotionId,

      sub_total: 150,

      discount_value: 10,

      grand_total: 102.5,

      change_amount: 0,

      payment_method: 'cash',

      paid: 102.5,

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 150,
        },
      ],
    })

    expect(sale.promotion_discount_value).toBe(37.5)

    expect(sale.grand_total).toBe(102.5)

    const receipt = getSaleReceipt(sale.saleId) as any

    expect(receipt.sale.promotion_discount_value).toBe(37.5)

    expect(receipt.items[0].promotion_discount_value).toBe(37.5)

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 1,
      payment_method: 'store_cash',
      notes: 'Test cash buffer for rounded return',
      created_by: 1,
    })

    const result = createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      items: [
        {
          sale_item_id: receipt.items[0].id,

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    })

    expect(result.return_value).toBe(103)
    expect(result.refundAmount).toBe(103)

    const db = getDb()

    const returnRow = db
      .prepare(
        `
          SELECT
            promotion_discount_value,
            refund_amount

          FROM sale_returns

          WHERE original_sale_id = ?
          LIMIT 1
          `,
      )
      .get(sale.saleId) as any

    expect(Number(returnRow.promotion_discount_value)).toBe(37.5)

    expect(Number(returnRow.refund_amount)).toBe(103)
  })

  it('applies buy 2 get 1 promotion', () => {
    const variant = seedProduct()

    const promotion = createPromotion({
      name: 'Buy 2 Get 1',

      type: 'buy_x_get_y',

      value: 0,

      buy_qty: 2,

      free_qty: 1,

      scope_type: 'all',

      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      promotion_id: promotion.promotionId,

      sub_total: 450,

      discount_value: 0,

      grand_total: 300,

      change_amount: 0,

      payment_method: 'cash',

      paid: 300,

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 3,

          unit_price: 150,
        },
      ],
    })

    expect(sale.promotion_discount_value).toBe(150)

    expect(sale.grand_total).toBe(300)

    const listedSales = listSales({
      search: `#${sale.saleId}`,
      limit: 50,
      offset: 0,
    })

    expect(listedSales.rows).toHaveLength(1)

    const listedSale = listedSales.rows[0] as any

    expect(Number(listedSale.promotion_id)).toBe(promotion.promotionId)

    expect(listedSale.promotion_name).toBe('Buy 2 Get 1')

    expect(Number(listedSale.promotion_discount_value)).toBe(150)

    const receipt = getSaleReceipt(sale.saleId) as any

    expect(receipt.items).toHaveLength(2)

    const giftItem = receipt.items.find(
      (item: any) => Number(item.promotion_discount_value || 0) > 0,
    )

    const paidItem = receipt.items.find(
      (item: any) => Number(item.promotion_discount_value || 0) === 0,
    )

    expect(giftItem).toBeTruthy()
    expect(paidItem).toBeTruthy()

    expect(Number(giftItem.quantity)).toBe(1)
    expect(Number(giftItem.promotion_discount_value)).toBe(150)

    expect(Number(paidItem.quantity)).toBe(2)
    expect(Number(paidItem.promotion_discount_value)).toBe(0)

    const returned = createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      items: [
        {
          sale_item_id: paidItem.id,

          variant_id: variant.variant_id,

          quantity: 2,
        },
        {
          sale_item_id: giftItem.id,

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    })

    expect(returned.return_value).toBe(300)
  })

  it('rejects partial return of a buy x get y bundle but allows the full bundle', () => {
    const variant = seedProduct()

    const promotion = createPromotion({
      name: 'Buy 2 Get 1 Return Bundle Test',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'all',
      category_id: null,
      product_ids: [],
      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      promotion_id: promotion.promotionId,
      sub_total: 450,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 3,
          unit_price: 150,
        },
      ],
    })

    expect(sale.promotion_discount_value).toBe(150)
    expect(sale.grand_total).toBe(300)

    const db = getDb()

    const saleItems = db
      .prepare(
        `
      SELECT
        id,
        variant_id,
        quantity,
        promotion_discount_value,
        is_gift,
        promotion_group_id
      FROM sale_items
      WHERE sale_id = ?
      ORDER BY id ASC
      `,
      )
      .all(sale.saleId) as any[]

    expect(saleItems).toHaveLength(2)

    const paidItem = saleItems.find(
      (item: any) => Number(item.is_gift || 0) === 0,
    )

    const giftItem = saleItems.find(
      (item: any) => Number(item.is_gift || 0) === 1,
    )

    expect(paidItem).toBeTruthy()
    expect(giftItem).toBeTruthy()

    expect(Number(paidItem.quantity)).toBe(2)
    expect(Number(giftItem.quantity)).toBe(1)

    expect(paidItem.promotion_group_id).toBeTruthy()
    expect(giftItem.promotion_group_id).toBe(paidItem.promotion_group_id)

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        items: [
          {
            sale_item_id: paidItem.id,
            variant_id: paidItem.variant_id,
            quantity: 1,
          },
        ],
      }),
    ).toThrow('لا يمكن عمل مرتجع جزئي للعرض')

    expect(getStockByBarcode('SALE001')).toBe(7)

    const fullReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: [
        {
          sale_item_id: paidItem.id,
          variant_id: paidItem.variant_id,
          quantity: 2,
        },
        {
          sale_item_id: giftItem.id,
          variant_id: giftItem.variant_id,
          quantity: 1,
        },
      ],
    })

    expect(fullReturn.return_value).toBe(300)
    expect(getStockByBarcode('SALE001')).toBe(10)
  })

  it('allows returning the standalone paid unit outside a buy 2 get 1 bundle', () => {
    const variant = seedProduct()

    const promotion = createPromotion({
      name: 'Buy 2 Get 1 With Standalone Unit',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'all',
      category_id: null,
      product_ids: [],
      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      promotion_id: promotion.promotionId,
      sub_total: 600,
      discount_value: 0,
      grand_total: 450,
      change_amount: 0,
      payment_method: 'cash',
      paid: 450,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 4,
          unit_price: 150,
        },
      ],
    })

    expect(sale.promotion_discount_value).toBe(150)
    expect(sale.grand_total).toBe(450)

    const db = getDb()

    const saleItems = db
      .prepare(
        `
        SELECT
          id,
          variant_id,
          quantity,
          is_gift,
          promotion_group_id
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
        `,
      )
      .all(sale.saleId) as any[]

    const groupedItems = saleItems.filter(
      (item: any) => item.promotion_group_id,
    )

    const standaloneItems = saleItems.filter(
      (item: any) => !item.promotion_group_id,
    )

    expect(
      groupedItems.reduce(
        (total: number, item: any) => total + Number(item.quantity),
        0,
      ),
    ).toBe(3)

    expect(standaloneItems).toHaveLength(1)
    expect(Number(standaloneItems[0].quantity)).toBe(1)
    expect(Number(standaloneItems[0].is_gift || 0)).toBe(0)

    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: [
        {
          sale_item_id: standaloneItems[0].id,
          variant_id: standaloneItems[0].variant_id,
          quantity: 1,
        },
      ],
    })

    expect(returned.return_value).toBe(150)
    expect(getStockByBarcode('SALE001')).toBe(7)
  })

  it('creates independent groups for two buy 2 get 1 bundles', () => {
    const variant = seedProduct()

    const promotion = createPromotion({
      name: 'Two Buy 2 Get 1 Bundles',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'all',
      category_id: null,
      product_ids: [],
      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      promotion_id: promotion.promotionId,
      sub_total: 900,
      discount_value: 0,
      grand_total: 600,
      change_amount: 0,
      payment_method: 'cash',
      paid: 600,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 6,
          unit_price: 150,
        },
      ],
    })

    expect(sale.promotion_discount_value).toBe(300)
    expect(sale.grand_total).toBe(600)

    const db = getDb()

    const saleItems = db
      .prepare(
        `
        SELECT
          id,
          variant_id,
          quantity,
          is_gift,
          promotion_group_id
        FROM sale_items
        WHERE sale_id = ?
          AND promotion_group_id IS NOT NULL
        ORDER BY id ASC
        `,
      )
      .all(sale.saleId) as any[]

    const groupIds = Array.from(
      new Set(saleItems.map((item: any) => String(item.promotion_group_id))),
    )

    expect(groupIds).toHaveLength(2)

    for (const groupId of groupIds) {
      const groupItems = saleItems.filter(
        (item: any) => item.promotion_group_id === groupId,
      )

      expect(
        groupItems.reduce(
          (total: number, item: any) => total + Number(item.quantity),
          0,
        ),
      ).toBe(3)

      expect(
        groupItems.reduce(
          (total: number, item: any) =>
            total +
            (Number(item.is_gift || 0) === 1 ? Number(item.quantity) : 0),
          0,
        ),
      ).toBe(1)
    }

    const firstGroupItems = saleItems.filter(
      (item: any) => item.promotion_group_id === groupIds[0],
    )

    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: firstGroupItems.map((item: any) => ({
        sale_item_id: Number(item.id),
        variant_id: Number(item.variant_id),
        quantity: Number(item.quantity),
      })),
    })

    expect(returned.return_value).toBe(300)
    expect(getStockByBarcode('SALE001')).toBe(7)
  })

  it('groups different priced items into the same buy 2 get 1 bundle and makes the cheapest item the gift', () => {
    createProduct({
      name: 'Mixed Promotion Product',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'PROMO250',
          size: 'A',
          color: 'Black',
          buy_price: 100,
          sell_price: 250,
          min_stock: 1,
          opening_qty: 5,
        },
        {
          barcode: 'PROMO200',
          size: 'B',
          color: 'Black',
          buy_price: 90,
          sell_price: 200,
          min_stock: 1,
          opening_qty: 5,
        },
        {
          barcode: 'PROMO150',
          size: 'C',
          color: 'Black',
          buy_price: 80,
          sell_price: 150,
          min_stock: 1,
          opening_qty: 5,
        },
      ],
    })

    const variant250 = getVariantByBarcode('PROMO250') as SaleVariantTestRow
    const variant200 = getVariantByBarcode('PROMO200') as SaleVariantTestRow
    const variant150 = getVariantByBarcode('PROMO150') as SaleVariantTestRow

    const promotion = createPromotion({
      name: 'Mixed Price Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'all',
      category_id: null,
      product_ids: [],
      actor_id: 1,
    })

    togglePromotion(promotion.promotionId, 1)

    const sale = createSale({
      user_id: 1,
      customer_id: null,
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

    expect(sale.promotion_discount_value).toBe(150)
    expect(sale.grand_total).toBe(450)

    const db = getDb()

    const saleItems = db
      .prepare(
        `
        SELECT
          id,
          variant_id,
          quantity,
          unit_price,
          promotion_discount_value,
          is_gift,
          promotion_group_id
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
        `,
      )
      .all(sale.saleId) as any[]

    expect(saleItems).toHaveLength(3)

    const groupIds = Array.from(
      new Set(saleItems.map((item: any) => String(item.promotion_group_id))),
    )

    expect(groupIds).toHaveLength(1)

    const giftItem = saleItems.find(
      (item: any) => Number(item.is_gift || 0) === 1,
    )

    expect(giftItem).toBeTruthy()
    expect(Number(giftItem.unit_price)).toBe(150)
    expect(Number(giftItem.promotion_discount_value)).toBe(150)

    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      items: saleItems.map((item: any) => ({
        sale_item_id: Number(item.id),
        variant_id: Number(item.variant_id),
        quantity: Number(item.quantity),
      })),
    })

    expect(returned.return_value).toBe(450)
  })

  it.each([2, 3])(
    'checks combined return quantities with %s units in stock',
    (remainingStock) => {
      const db = getDb()
      const variant = seedProduct()

      const promotion = createPromotion({
        name: 'Return cancellation stock check',
        type: 'buy_x_get_y',
        value: 0,
        buy_qty: 2,
        free_qty: 1,
        scope_type: 'all',
        actor_id: 1,
      })

      togglePromotion(promotion.promotionId, 1)

      function sell(
        quantity: number,
        total: number,
        promotionId: number | null = null,
      ) {
        return createSale({
          user_id: 1,
          customer_id: null,
          promotion_id: promotionId,
          sub_total: quantity * variant.sell_price,
          discount_value: 0,
          grand_total: total,
          paid: total,
          change_amount: 0,
          payment_method: 'cash',
          items: [
            {
              variant_id: variant.variant_id,
              product_name: variant.product_name,
              barcode: variant.barcode,
              size: variant.size,
              color: variant.color,
              quantity,
              unit_price: variant.sell_price,
            },
          ],
        })
      }

      const sale = sell(3, 300, promotion.promotionId)
      const receipt = getSaleReceipt(sale.saleId) as any

      const returned = createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        refund_payment_method: 'store_cash',
        items: receipt.items.map((item: any) => ({
          sale_item_id: Number(item.id),
          variant_id: Number(item.variant_id),
          quantity: Number(item.quantity),
        })),
      })

      const returnedItems = db
        .prepare(
          'SELECT variant_id, quantity FROM sale_return_items WHERE return_id = ?',
        )
        .all(returned.returnId) as Array<{
        variant_id: number
        quantity: number
      }>

      expect(returnedItems.length).toBeGreaterThan(1)
      expect(new Set(returnedItems.map((item) => item.variant_id)).size).toBe(1)
      expect(returnedItems.reduce((sum, item) => sum + item.quantity, 0)).toBe(
        3,
      )

      togglePromotion(promotion.promotionId, 0)

      const soldLater = 10 - remainingStock
      sell(soldLater, soldLater * variant.sell_price)

      expect(getStockByBarcode(variant.barcode)).toBe(remainingStock)

      const tables = [
        'sales',
        'sale_returns',
        'sale_promotion_units',
        'stock_movements',
        'cash_movements',
      ]

      const snapshot = () =>
        tables.map((table) =>
          db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
        )

      const before = snapshot()
      const cashInBefore = getCashMovementTotal('in')

      const cancel = () =>
        cancelSaleReturn({
          return_id: returned.returnId,
          actor_id: 1,
          reason: 'Stock regression test',
        })

      if (remainingStock === 2) {
        expect(cancel).toThrow('أقل من كمية المرتجع')
        expect(snapshot()).toEqual(before)
        expect(getStockByBarcode(variant.barcode)).toBe(2)
        return
      }

      expect(cancel().ok).toBe(true)
      expect(getStockByBarcode(variant.barcode)).toBe(0)
      expect(getCashMovementTotal('in')).toBe(cashInBefore + 300)

      const returnRow = db
        .prepare('SELECT cancelled_at FROM sale_returns WHERE id = ?')
        .get(returned.returnId) as { cancelled_at: string | null }

      expect(returnRow.cancelled_at).not.toBeNull()
    },
  )

  it('requires cancelling newer returns before restoring loyalty points', () => {
    const db = getDb()
    const variant = seedProduct()
    const customerId = createTestCustomer()

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      paid: 300,
      change_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    })

    const receipt = getSaleReceipt(sale.saleId) as any

    function returnOne() {
      return createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        refund_payment_method: 'store_cash',
        items: [
          {
            sale_item_id: Number(receipt.items[0].id),
            variant_id: variant.variant_id,
            quantity: 1,
          },
        ],
      })
    }

    expect(getCustomerPoints(customerId)).toBe(3)

    const firstReturn = returnOne()
    expect(getCustomerPoints(customerId)).toBe(1)

    const secondReturn = returnOne()
    expect(getCustomerPoints(customerId)).toBe(0)

    // نفس التوقيت للتأكد أن ترتيب الإلغاء يعتمد على رقم المرتجع.
    db.prepare(
      `
      UPDATE sale_returns
      SET created_at = (
        SELECT created_at
        FROM sale_returns
        WHERE id = ?
      )
      WHERE id = ?
      `,
    ).run(firstReturn.returnId, secondReturn.returnId)

    const tables = [
      'customers',
      'sales',
      'sale_returns',
      'stock_movements',
      'cash_movements',
      'customer_payments',
      'loyalty_transactions',
    ]

    const snapshot = () =>
      tables.map((table) =>
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      )

    const before = snapshot()

    expect(() =>
      cancelSaleReturn({
        return_id: firstReturn.returnId,
        actor_id: 1,
      }),
    ).toThrow('يجب إلغاء المرتجع الأحدث')

    expect(snapshot()).toEqual(before)

    expect(
      cancelSaleReturn({
        return_id: secondReturn.returnId,
        actor_id: 1,
      }).ok,
    ).toBe(true)

    expect(getCustomerPoints(customerId)).toBe(1)
    expect(getStockByBarcode(variant.barcode)).toBe(9)

    expect(
      cancelSaleReturn({
        return_id: firstReturn.returnId,
        actor_id: 1,
      }).ok,
    ).toBe(true)

    expect(getCustomerPoints(customerId)).toBe(3)
    expect(getStockByBarcode(variant.barcode)).toBe(8)
  })
})
