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
  getSaleReceipt,
  listSales,
} from '../../src/main/database/repositories/sales.repo'

import { createSaleExchange } from '../../src/main/database/repositories/sales-exchange.repo'

import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo'

type TestVariant = {
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

type PromoBarcode =
  | 'EX150'
  | 'EX150B'
  | 'EX200'
  | 'EX220ZERO'
  | 'EX250'
  | 'EX300'
  | 'EX350'

function seedCatalog() {
  const promoCategory = createCategory({
    name: 'Current State Promo Category',
  })

  const otherCategory = createCategory({
    name: 'Current State Other Category',
  })

  createProduct({
    name: 'Current State Promo Product',
    category_id: promoCategory.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'EX150',
        size: '150',
        color: 'Black',
        buy_price: 70,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX150B',
        size: '150B',
        color: 'Blue',
        buy_price: 72,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX220ZERO',
        size: '220',
        color: 'Red',
        buy_price: 95,
        sell_price: 220,
        min_stock: 1,
        opening_qty: 0,
      },
      {
        barcode: 'EX250',
        size: '250',
        color: 'Black',
        buy_price: 110,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX350',
        size: '350',
        color: 'Black',
        buy_price: 150,
        sell_price: 350,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  })

  createProduct({
    name: 'Outside Current State Promotion',
    category_id: otherCategory.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'OUT999',
        size: '999',
        color: 'White',
        buy_price: 400,
        sell_price: 999,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  })

  const get = (barcode: string) => getVariantByBarcode(barcode) as TestVariant

  return {
    promoCategoryId: Number(promoCategory.id),

    variants: {
      EX150: get('EX150'),
      EX150B: get('EX150B'),
      EX200: get('EX200'),
      EX220ZERO: get('EX220ZERO'),
      EX250: get('EX250'),
      EX300: get('EX300'),
      EX350: get('EX350'),
      OUT999: get('OUT999'),
    },
  }
}

function createPromotionSale(
  barcodes: PromoBarcode[],
  options?: {
    normalDiscount?: number
    paid?: number
  },
) {
  const catalog = seedCatalog()

  const promotion = createPromotion({
    name: 'Current State Buy 2 Get 1',
    type: 'buy_x_get_y',
    value: 0,
    buy_qty: 2,
    free_qty: 1,
    scope_type: 'category',
    category_id: catalog.promoCategoryId,
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

  const subTotal = items.reduce((sum, item) => sum + Number(item.unit_price), 0)

  const freeQty = Math.floor(items.length / 3)

  const promotionDiscount = [...items]
    .sort((a, b) => Number(a.unit_price) - Number(b.unit_price))
    .slice(0, freeQty)
    .reduce((sum, item) => sum + Number(item.unit_price), 0)

  const afterPromotion = subTotal - promotionDiscount

  const normalDiscount = Math.min(
    afterPromotion,
    Math.max(0, Number(options?.normalDiscount || 0)),
  )

  const grandTotal = afterPromotion - normalDiscount

  const sale = createSale({
    user_id: 1,
    customer_id: null,
    promotion_id: promotion.promotionId,
    sub_total: subTotal,
    discount_value: normalDiscount,
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
  return Number((getVariantByBarcode(barcode) as TestVariant).stock || 0)
}

describe('sale current state after exchanges', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('keeps original receipt and exposes current receipt after exchanging the gift', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    expect(exchange.difference_amount).toBe(100)

    const originalReceipt = getSaleReceipt(result.sale.saleId) as any

    expect(
      originalReceipt.items
        .map((item: any) => Number(item.unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250])

    const state = getSaleCurrentState(result.sale.saleId)

    expect(
      state.current_receipt.items
        .map((item: any) => Number(item.unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([200, 250, 300])

    const currentGift = state.current_receipt.items.find(
      (item: any) => Number(item.is_gift) === 1,
    )

    expect(Number(currentGift.unit_price)).toBe(200)

    expect(state.financials.current_sub_total).toBe(750)

    expect(state.financials.current_promotion_discount_value).toBe(200)

    expect(state.financials.current_grand_total).toBe(550)

    expect(state.financials.current_total_discount).toBe(200)

    expect(state.financials.net_grand_total).toBe(550)

    expect(state.financials.net_paid_amount).toBe(550)

    expect(
      state.original_receipt.items
        .map((item: any) => Number(item.unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250])

    expect(state.exchanges).toHaveLength(1)

    expect(Number(state.exchanges[0].difference_amount)).toBe(100)

    expect(Number(state.exchanges[0].items[0].old_unit_price)).toBe(150)

    expect(Number(state.exchanges[0].items[0].new_unit_price)).toBe(300)
  })

  it('makes invoice-list discount include the promotion discount', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const before = listSales({
      search: `#${result.sale.saleId}`,
      limit: 50,
      offset: 0,
    })

    expect(before.rows).toHaveLength(1)

    expect(Number((before.rows[0] as any).total_discount_value)).toBe(150)

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    const after = listSales({
      search: `#${result.sale.saleId}`,
      limit: 50,
      offset: 0,
    })

    const row = after.rows[0] as any

    expect(Number(row.sub_total)).toBe(750)

    expect(Number(row.promotion_discount_value)).toBe(200)

    expect(Number(row.total_discount_value)).toBe(200)

    expect(Number(row.grand_total)).toBe(550)

    expect(Number(row.current_net_total)).toBe(550)

    expect(Number(row.current_paid_amount)).toBe(550)

    expect(Number(row.exchange_count)).toBe(1)
  })

  it('exchanges a paid unit and keeps the cheapest unit as the gift', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const paidUnit = getUnitByPrice(result.sale.saleId, 250)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(paidUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    expect(exchange.old_group_total).toBe(450)

    expect(exchange.new_group_total).toBe(500)

    expect(exchange.difference_amount).toBe(50)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.current_grand_total).toBe(500)

    const gift = state.current_receipt.items.find(
      (item: any) => Number(item.is_gift) === 1,
    )

    expect(Number(gift.unit_price)).toBe(150)

    expect(stock('EX250')).toBe(20)
    expect(stock('EX300')).toBe(19)
  })

  it('supports a zero-value exchange without creating an exchange cash movement', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX150B.variant_id,
        },
      ],
    })

    expect(exchange.difference_amount).toBe(0)

    expect(exchange.amount_to_collect).toBe(0)

    expect(exchange.amount_to_refund).toBe(0)

    const movementCount = getDb()
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM cash_movements
          WHERE reference_type =
            'sale_exchange'
          `,
      )
      .get() as any

    expect(Number(movementCount.count)).toBe(0)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.current_grand_total).toBe(450)
  })

  it('never refunds more than the remaining invoice value when a large original discount exists', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'], {
      normalDiscount: 400,
    })

    expect(result.sale.grand_total).toBe(50)

    const unit250 = getUnitByPrice(result.sale.saleId, 250)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(unit250.id),

          new_variant_id: result.variants.EX150B.variant_id,
        },
      ],
    })

    /*
     * Bundle payable:
     * 450 -> 350
     *
     * But invoice net was only 50
     * because of the 400 normal discount.
     *
     * Customer must receive only 50,
     * never 100.
     */
    expect(exchange.difference_amount).toBe(-50)

    expect(exchange.amount_to_refund).toBe(50)

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.financials.original_normal_discount_value).toBe(400)

    expect(state.financials.current_normal_discount_value).toBe(350)

    expect(state.financials.current_grand_total).toBe(0)

    expect(state.financials.net_grand_total).toBe(0)
  })

  it('changes only the selected promotion bundle when a sale contains two bundles', () => {
    const result = createPromotionSale([
      'EX250',
      'EX200',
      'EX150',

      'EX350',
      'EX300',
      'EX200',
    ])

    const unitsBefore = getUnits(result.sale.saleId)

    const groupIds = Array.from(
      new Set(unitsBefore.map((unit) => String(unit.promotion_group_id))),
    )

    expect(groupIds).toHaveLength(2)

    const firstGroup = unitsBefore.filter(
      (unit) => String(unit.promotion_group_id) === groupIds[0],
    )

    const secondGroupBefore = unitsBefore
      .filter((unit) => String(unit.promotion_group_id) === groupIds[1])
      .map((unit) => ({
        id: Number(unit.id),
        variant_id: Number(unit.current_variant_id),
        price: Number(unit.current_unit_price),
        gift: Number(unit.current_is_gift),
      }))

    const target = firstGroup[0]

    const replacementId =
      Number(target.current_variant_id) === result.variants.EX350.variant_id
        ? result.variants.EX300.variant_id
        : result.variants.EX350.variant_id

    createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(target.id),

          new_variant_id: replacementId,
        },
      ],
    })

    const unitsAfter = getUnits(result.sale.saleId)

    const secondGroupAfter = unitsAfter
      .filter((unit) => String(unit.promotion_group_id) === groupIds[1])
      .map((unit) => ({
        id: Number(unit.id),
        variant_id: Number(unit.current_variant_id),
        price: Number(unit.current_unit_price),
        gift: Number(unit.current_is_gift),
      }))

    expect(secondGroupAfter).toEqual(secondGroupBefore)
  })

  it('keeps standalone quantity outside the bundle unchanged', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150', 'EX350'])

    const before = getSaleCurrentState(result.sale.saleId)

    const standaloneBefore = before.current_receipt.items.find(
      (item: any) => !item.promotion_group_id && item.barcode === 'EX350',
    )

    expect(standaloneBefore).toBeTruthy()

    const unit200 = getUnitByPrice(result.sale.saleId, 200)

    createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(unit200.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    const after = getSaleCurrentState(result.sale.saleId)

    const standaloneAfter = after.current_receipt.items.find(
      (item: any) => !item.promotion_group_id && item.barcode === 'EX350',
    )

    expect(standaloneAfter).toBeTruthy()

    expect(Number(standaloneAfter.quantity)).toBe(1)

    expect(Number(standaloneAfter.unit_price)).toBe(350)

    expect(
      after.current_receipt.items.reduce(
        (total: number, item: any) => total + Number(item.quantity || 0),
        0,
      ),
    ).toBe(4)
  })

  it('rejects exchanging a unit with its same current variant', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const unit = getUnitByPrice(result.sale.saleId, 250)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(unit.id),

            new_variant_id: Number(unit.current_variant_id),
          },
        ],
      }),
    ).toThrow('الصنف البديل هو نفس الصنف الحالي')
  })

  it('rejects a valid promotion replacement when replacement stock is zero', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const unit = getUnitByPrice(result.sale.saleId, 250)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(unit.id),

            new_variant_id: result.variants.EX220ZERO.variant_id,
          },
        ],
      }),
    ).toThrow('المخزون غير كافٍ للصنف البديل')
  })
})
