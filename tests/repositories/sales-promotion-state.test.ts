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
  createSale,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo'

type TestVariant = {
  variant_id: number
  product_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  sell_price: number
}

function seedPromotionCatalog() {
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
        barcode: 'EX250',
        size: 'A',
        color: 'Black',
        buy_price: 100,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 10,
      },
      {
        barcode: 'EX200',
        size: 'B',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 10,
      },
      {
        barcode: 'EX150',
        size: 'C',
        color: 'Black',
        buy_price: 80,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 10,
      },
    ],
  })

  const variant250 = getVariantByBarcode('EX250') as TestVariant
  const variant200 = getVariantByBarcode('EX200') as TestVariant
  const variant150 = getVariantByBarcode('EX150') as TestVariant

  return {
    promoCategoryId: Number(promoCategory.id),
    otherCategoryId: Number(otherCategory.id),
    variant250,
    variant200,
    variant150,
  }
}

function createBuy2Get1Sale() {
  const catalog = seedPromotionCatalog()

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
        variant_id: catalog.variant250.variant_id,
        product_name: catalog.variant250.product_name,
        barcode: catalog.variant250.barcode,
        size: catalog.variant250.size,
        color: catalog.variant250.color,
        quantity: 1,
        unit_price: 250,
      },
      {
        variant_id: catalog.variant200.variant_id,
        product_name: catalog.variant200.product_name,
        barcode: catalog.variant200.barcode,
        size: catalog.variant200.size,
        color: catalog.variant200.color,
        quantity: 1,
        unit_price: 200,
      },
      {
        variant_id: catalog.variant150.variant_id,
        product_name: catalog.variant150.product_name,
        barcode: catalog.variant150.barcode,
        size: catalog.variant150.size,
        color: catalog.variant150.color,
        quantity: 1,
        unit_price: 150,
      },
    ],
  })

  return {
    ...catalog,
    promotionId: promotion.promotionId,
    sale,
  }
}

describe('sale promotion exchange state', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('stores an immutable promotion snapshot and one state row per bundle unit', () => {
    const result = createBuy2Get1Sale()
    const db = getDb()

    const snapshot = db
      .prepare(
        `
        SELECT *
        FROM sale_promotion_snapshots
        WHERE sale_id = ?
        LIMIT 1
        `,
      )
      .get(result.sale.saleId) as any

    expect(snapshot).toBeTruthy()
    expect(Number(snapshot.promotion_id)).toBe(result.promotionId)
    expect(snapshot.promotion_type).toBe('buy_x_get_y')
    expect(Number(snapshot.buy_qty)).toBe(2)
    expect(Number(snapshot.free_qty)).toBe(1)
    expect(snapshot.scope_type).toBe('category')
    expect(Number(snapshot.category_id)).toBe(result.promoCategoryId)
    expect(JSON.parse(snapshot.product_ids_json)).toEqual([])

    const units = db
      .prepare(
        `
        SELECT *
        FROM sale_promotion_units
        WHERE sale_id = ?
        ORDER BY id ASC
        `,
      )
      .all(result.sale.saleId) as any[]

    expect(units).toHaveLength(3)

    const groupIds = Array.from(
      new Set(units.map((unit) => String(unit.promotion_group_id))),
    )

    expect(groupIds).toHaveLength(1)

    expect(
      units.filter((unit) => Number(unit.current_is_gift || 0) === 1),
    ).toHaveLength(1)

    const giftUnit = units.find(
      (unit) => Number(unit.current_is_gift || 0) === 1,
    )

    expect(Number(giftUnit.current_unit_price)).toBe(150)

    expect(
      units
        .map((unit) => Number(unit.current_unit_price))
        .sort((a, b) => a - b),
    ).toEqual([150, 200, 250])

    for (const unit of units) {
      expect(Number(unit.original_variant_id)).toBe(
        Number(unit.current_variant_id),
      )

      expect(Number(unit.original_unit_price)).toBe(
        Number(unit.current_unit_price),
      )

      expect(Number(unit.original_is_gift)).toBe(Number(unit.current_is_gift))

      expect(Number(unit.is_returned)).toBe(0)
    }

    const receipt = getSaleReceipt(result.sale.saleId) as any

    expect(receipt.items.every((item: any) => item.promotion_group_id)).toBe(
      true,
    )

    expect(
      receipt.items.filter((item: any) => Number(item.is_gift || 0) === 1),
    ).toHaveLength(1)
  })

  it('keeps original promotion rules after the promotion is edited later', () => {
    const result = createBuy2Get1Sale()

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

    const db = getDb()

    const livePromotion = db
      .prepare(
        `
        SELECT
          buy_qty,
          free_qty,
          category_id
        FROM promotions
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(result.promotionId) as any

    expect(Number(livePromotion.buy_qty)).toBe(3)
    expect(Number(livePromotion.free_qty)).toBe(1)
    expect(Number(livePromotion.category_id)).toBe(result.otherCategoryId)

    const snapshot = db
      .prepare(
        `
        SELECT *
        FROM sale_promotion_snapshots
        WHERE sale_id = ?
        LIMIT 1
        `,
      )
      .get(result.sale.saleId) as any

    expect(Number(snapshot.buy_qty)).toBe(2)
    expect(Number(snapshot.free_qty)).toBe(1)
    expect(Number(snapshot.category_id)).toBe(result.promoCategoryId)
    expect(snapshot.scope_type).toBe('category')
  })
})
