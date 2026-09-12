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
  updatePromotion,
} from '../../src/main/database/repositories/promotions.repo'
import {
  cancelSaleReturn,
  createSale,
  createSaleReturn,
} from '../../src/main/database/repositories/sales.repo'
import {
  createSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo'
import {
  closeCashShift,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'

type TestVariant = {
  variant_id: number
  product_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  sell_price: number
  stock: number
}

function seedExchangeCatalog() {
  const promoCategory = createCategory({
    name: 'Exchange Promo Category',
  })

  const otherCategory = createCategory({
    name: 'Exchange Other Category',
  })

  createProduct({
    name: 'Exchange Promo Product',
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
        barcode: 'EX200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
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
    name: 'Outside Promotion Product',
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

  const variants = {
    EX150: getVariantByBarcode('EX150') as TestVariant,
    EX200: getVariantByBarcode('EX200') as TestVariant,
    EX250: getVariantByBarcode('EX250') as TestVariant,
    EX300: getVariantByBarcode('EX300') as TestVariant,
    EX350: getVariantByBarcode('EX350') as TestVariant,
    OUT999: getVariantByBarcode('OUT999') as TestVariant,
  }

  return {
    promoCategoryId: Number(promoCategory.id),
    otherCategoryId: Number(otherCategory.id),
    variants,
  }
}

function createPromotionSale(
  barcodes: Array<'EX150' | 'EX200' | 'EX250' | 'EX300' | 'EX350'>,
) {
  const catalog = seedExchangeCatalog()

  const promotion = createPromotion({
    name: 'Original Buy 2 Get 1',
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

  const saleItems = barcodes.map((barcode) => {
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

  const subTotal = saleItems.reduce((sum, item) => sum + item.unit_price, 0)

  const cheapest = Math.min(...saleItems.map((item) => item.unit_price))

  const grandTotal = subTotal - cheapest

  const sale = createSale({
    user_id: 1,
    customer_id: null,
    promotion_id: promotion.promotionId,
    sub_total: subTotal,
    discount_value: 0,
    grand_total: grandTotal,
    change_amount: 0,
    payment_method: 'cash',
    paid: grandTotal,
    items: saleItems,
  })

  return {
    ...catalog,
    promotionId: promotion.promotionId,
    sale,
  }
}

function getPromotionUnits(saleId: number) {
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
  return getPromotionUnits(saleId).find(
    (unit) => Number(unit.current_unit_price) === price,
  )
}

function getStock(barcode: string) {
  return Number((getVariantByBarcode(barcode) as TestVariant)?.stock || 0)
}

function getFullReturnInput(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        variant_id,
        quantity
      FROM sale_items
      WHERE sale_id = ?
        AND promotion_group_id IS NOT NULL
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

describe('sale promotion exchanges', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    })
  })

  it('exchanges one gift unit and makes the new cheapest unit the gift', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    expect(giftUnit).toBeTruthy()
    expect(Number(giftUnit.current_is_gift)).toBe(1)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'تغيير الهدية',
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    expect(exchange.old_group_total).toBe(450)
    expect(exchange.new_group_total).toBe(550)
    expect(exchange.difference_amount).toBe(100)
    expect(exchange.amount_to_collect).toBe(100)
    expect(exchange.amount_to_refund).toBe(0)

    const units = getPromotionUnits(result.sale.saleId)

    expect(
      units
        .map((unit) => Number(unit.current_unit_price))
        .sort((a, b) => a - b),
    ).toEqual([200, 250, 300])

    const currentGift = units.find((unit) => Number(unit.current_is_gift) === 1)

    expect(Number(currentGift.current_unit_price)).toBe(200)

    expect(getStock('EX150')).toBe(20)
    expect(getStock('EX300')).toBe(19)

    const cashMovement = getDb()
      .prepare(
        `
        SELECT *
        FROM cash_movements
        WHERE reference_type = 'sale_exchange'
          AND reference_id = ?
        LIMIT 1
        `,
      )
      .get(exchange.exchangeId) as any

    expect(cashMovement.direction).toBe('in')
    expect(Number(cashMovement.amount)).toBe(100)
  })

  it('requires an open shift and links exchange cash movement to the current shift', () => {
    const db = getDb()

    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const originalShift = getOpenCashShift()

    expect(originalShift).toBeTruthy()

    closeCashShift({
      shift_id: originalShift!.id,
      closing_counted_amount: 450,
      left_for_next_shift: 450,
      closed_by: 1,
    })

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        payment_method: 'store_cash',
        items: [
          {
            promotion_unit_id: Number(giftUnit.id),
            new_variant_id: result.variants.EX300.variant_id,
          },
        ],
      }),
    ).toThrow('لا يمكن تسجيل استبدال بدون شفت مفتوح')

    const currentShift = openCashShift({
      opening_counted_amount: 450,
      opened_by: 1,
    })

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'استبدال في شفت جديد',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    expect(exchange.shift_id).toBe(currentShift.id)

    expect(exchange.shift_id).not.toBe(originalShift!.id)

    const exchangeRow = db
      .prepare(
        `
        SELECT shift_id
        FROM sale_exchanges
        WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as {
      shift_id: number
    }

    expect(exchangeRow.shift_id).toBe(currentShift.id)

    const cashMovement = db
      .prepare(
        `
        SELECT shift_id
        FROM cash_movements
        WHERE reference_type =
          'sale_exchange'
          AND reference_id = ?
        LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as {
      shift_id: number
    }

    expect(cashMovement.shift_id).toBe(currentShift.id)
  })

  it('uses the original promotion scope even after the live promotion changes', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    updatePromotion({
      id: result.promotionId,
      name: 'Changed Promotion',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 3,
      free_qty: 1,
      scope_type: 'category',
      category_id: result.otherCategoryId,
      product_ids: [],
      actor_id: 1,
    })

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(giftUnit.id),
            new_variant_id: result.variants.OUT999.variant_id,
          },
        ],
      }),
    ).toThrow('الصنف البديل خارج نطاق العرض الأصلي')

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
  })

  it('supports exchanging the same promotion unit more than once', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const giftUnit = getUnitByPrice(result.sale.saleId, 150)

    const firstExchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    })

    expect(firstExchange.difference_amount).toBe(100)

    const secondExchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX350.variant_id,
        },
      ],
    })

    expect(secondExchange.old_group_total).toBe(550)
    expect(secondExchange.new_group_total).toBe(600)
    expect(secondExchange.difference_amount).toBe(50)

    const currentUnit = getPromotionUnits(result.sale.saleId).find(
      (unit) => Number(unit.id) === Number(giftUnit.id),
    )

    expect(Number(currentUnit.current_variant_id)).toBe(
      result.variants.EX350.variant_id,
    )

    const exchangeCount = getDb()
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM sale_exchanges
        WHERE original_sale_id = ?
        `,
      )
      .get(result.sale.saleId) as any

    expect(Number(exchangeCount.count)).toBe(2)
  })

  it('allows one unit or the whole bundle but rejects two units', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const units = getPromotionUnits(result.sale.saleId)

    expect(units).toHaveLength(3)

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(units[0].id),
            new_variant_id: result.variants.EX300.variant_id,
          },
          {
            promotion_unit_id: Number(units[1].id),
            new_variant_id: result.variants.EX350.variant_id,
          },
        ],
      }),
    ).toThrow('الاستبدال داخل العرض مسموح لقطعة واحدة أو العرض كاملًا فقط')

    const wholeBundleItems = units.map((unit) => {
      const price = Number(unit.current_unit_price)

      let newVariantId = result.variants.EX300.variant_id

      if (price === 200) {
        newVariantId = result.variants.EX350.variant_id
      }

      if (price === 150) {
        newVariantId = result.variants.EX250.variant_id
      }

      return {
        promotion_unit_id: Number(unit.id),
        new_variant_id: newVariantId,
      }
    })

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: wholeBundleItems,
    })

    expect(exchange.old_group_total).toBe(450)
    expect(exchange.new_group_total).toBe(650)
    expect(exchange.difference_amount).toBe(200)
  })

  it('refunds the difference when the recalculated bundle becomes cheaper', () => {
    const result = createPromotionSale(['EX300', 'EX250', 'EX200'])

    const unit300 = getUnitByPrice(result.sale.saleId, 300)

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(unit300.id),
          new_variant_id: result.variants.EX150.variant_id,
        },
      ],
    })

    expect(exchange.old_group_total).toBe(550)
    expect(exchange.new_group_total).toBe(450)
    expect(exchange.difference_amount).toBe(-100)
    expect(exchange.amount_to_collect).toBe(0)
    expect(exchange.amount_to_refund).toBe(100)

    const cashMovement = getDb()
      .prepare(
        `
        SELECT *
        FROM cash_movements
        WHERE reference_type = 'sale_exchange'
          AND reference_id = ?
        LIMIT 1
        `,
      )
      .get(exchange.exchangeId) as any

    expect(cashMovement.direction).toBe('out')
    expect(Number(cashMovement.amount)).toBe(100)
  })

  it('returns the current bundle after an exchange and restores its state when the return is cancelled', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

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

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: getFullReturnInput(result.sale.saleId),
    })

    expect(saleReturn.return_value).toBe(550)

    const returnedUnits = getPromotionUnits(result.sale.saleId)

    expect(returnedUnits.every((unit) => Number(unit.is_returned) === 1)).toBe(
      true,
    )

    const returnItems = getDb()
      .prepare(
        `
        SELECT *
        FROM sale_return_items
        WHERE return_id = ?
        ORDER BY id ASC
        `,
      )
      .all(saleReturn.returnId) as any[]

    expect(returnItems).toHaveLength(3)

    expect(
      returnItems.every((item) => Number(item.promotion_unit_id) > 0),
    ).toBe(true)

    expect(
      returnItems.map((item) => Number(item.unit_price)).sort((a, b) => a - b),
    ).toEqual([200, 250, 300])

    expect(getStock('EX150')).toBe(20)
    expect(getStock('EX200')).toBe(20)
    expect(getStock('EX250')).toBe(20)
    expect(getStock('EX300')).toBe(20)

    cancelSaleReturn({
      return_id: saleReturn.returnId,
      reason: 'اختبار إلغاء المرتجع',
      actor_id: 1,
    })

    const restoredUnits = getPromotionUnits(result.sale.saleId)

    expect(restoredUnits.every((unit) => Number(unit.is_returned) === 0)).toBe(
      true,
    )

    expect(getStock('EX150')).toBe(20)
    expect(getStock('EX200')).toBe(19)
    expect(getStock('EX250')).toBe(19)
    expect(getStock('EX300')).toBe(19)
  })

  it('exposes the current exchange state for the future UI', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150'])

    const state = getSaleExchangeState(result.sale.saleId)

    expect(state.snapshot.promotion_type).toBe('buy_x_get_y')

    expect(state.groups).toHaveLength(1)
    expect(state.groups[0].units).toHaveLength(3)
  })
})
