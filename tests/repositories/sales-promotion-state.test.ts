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
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo'
import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo'
import { getSaleExchangeState } from '../../src/main/database/repositories/sales-exchange.repo'

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

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    })
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

    const state = getSaleCurrentState(result.sale.saleId)

    expect(state.promotion_snapshot).toBeTruthy()

    expect(state.promotion_snapshot.promotion_name).toBe('Original Buy 2 Get 1')

    expect(state.promotion_snapshot.promotion_type).toBe('buy_x_get_y')

    expect(Number(state.promotion_snapshot.buy_qty)).toBe(2)

    expect(Number(state.promotion_snapshot.free_qty)).toBe(1)

    expect(state.promotion_snapshot.scope_type).toBe('category')

    expect(Number(state.promotion_snapshot.category_id)).toBe(
      result.promoCategoryId,
    )
  })

  it('keeps multiple buy-x-get-y groups linked to their own promotion snapshots', () => {
    const categoryA = createCategory({
      name: 'Multi Promo A',
    })

    const categoryB = createCategory({
      name: 'Multi Promo B',
    })

    createProduct({
      name: 'Multi Product A',

      category_id: categoryA.id,

      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'MULTI-A',

          size: 'A',
          color: 'Black',

          buy_price: 50,
          sell_price: 100,

          min_stock: 1,

          opening_qty: 10,
        },
      ],
    })

    createProduct({
      name: 'Multi Product B',

      category_id: categoryB.id,

      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'MULTI-B',

          size: 'B',
          color: 'Black',

          buy_price: 100,
          sell_price: 200,

          min_stock: 1,

          opening_qty: 10,
        },
      ],
    })

    const variantA = getVariantByBarcode('MULTI-A') as TestVariant

    const variantB = getVariantByBarcode('MULTI-B') as TestVariant

    const promotionA = createPromotion({
      name: 'Multi Offer A',

      type: 'buy_x_get_y',

      value: 0,

      buy_qty: 1,
      free_qty: 1,

      scope_type: 'category',

      category_id: Number(categoryA.id),

      product_ids: [],

      actor_id: 1,
    })

    const promotionB = createPromotion({
      name: 'Multi Offer B',

      type: 'buy_x_get_y',

      value: 0,

      buy_qty: 1,
      free_qty: 1,

      scope_type: 'category',

      category_id: Number(categoryB.id),

      product_ids: [],

      actor_id: 1,
    })

    togglePromotion(promotionA.promotionId, 1)

    togglePromotion(promotionB.promotionId, 1)

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      promotion_id: null,

      promotion_ids: [promotionA.promotionId, promotionB.promotionId],

      sub_total: 600,

      discount_value: 0,

      grand_total: 300,

      paid: 300,

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variantA.variant_id,

          product_name: variantA.product_name,

          barcode: variantA.barcode,

          size: variantA.size,

          color: variantA.color,

          quantity: 2,

          unit_price: 100,
        },

        {
          variant_id: variantB.variant_id,

          product_name: variantB.product_name,

          barcode: variantB.barcode,

          size: variantB.size,

          color: variantB.color,

          quantity: 2,

          unit_price: 200,
        },
      ],
    })

    const db = getDb()

    const snapshots = db
      .prepare(
        `
      SELECT
        promotion_id

      FROM
        sale_promotion_snapshots

      WHERE sale_id = ?

      ORDER BY
        promotion_id ASC
      `,
      )
      .all(sale.saleId) as Array<{
      promotion_id: number
    }>

    expect(snapshots.map((snapshot) => Number(snapshot.promotion_id))).toEqual(
      [promotionA.promotionId, promotionB.promotionId].sort((a, b) => a - b),
    )

    const currentState = getSaleCurrentState(sale.saleId)

    expect(currentState.promotion_snapshot).toBeNull()

    expect(currentState.promotion_snapshots).toHaveLength(2)

    const exchangeState = getSaleExchangeState(sale.saleId)

    const promotionGroups = exchangeState.groups.filter(
      (group) => group.group_kind === 'promotion',
    )

    expect(promotionGroups).toHaveLength(2)

    const linkedPromotionIds = promotionGroups
      .map((group) => Number(group.promotion_snapshot?.promotion_id))
      .sort((a, b) => a - b)

    expect(linkedPromotionIds).toEqual(
      [promotionA.promotionId, promotionB.promotionId].sort((a, b) => a - b),
    )

    for (const group of promotionGroups) {
      expect(group.promotion_snapshot?.promotion_type).toBe('buy_x_get_y')

      expect(String(group.promotion_group_id)).toContain(
        `_promotion_${group.promotion_snapshot?.promotion_id}_bundle_`,
      )
    }
  })
})
