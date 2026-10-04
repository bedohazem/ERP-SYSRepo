import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  calculateActivePromotionsForSale,
  createPromotion,
  getActivePromotions,
  listPromotions,
  togglePromotion,
} from '../../src/main/database/repositories/promotions.repo'

describe('promotions repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('allows multiple non-overlapping promotions and calculates both', () => {
    const db = getDb()

    const categoryA = Number(
      db
        .prepare(
          `
        INSERT INTO categories (
          name,
          is_active
        )
        VALUES (
          'Multi A',
          1
        )
        `,
        )
        .run().lastInsertRowid,
    )

    const categoryB = Number(
      db
        .prepare(
          `
        INSERT INTO categories (
          name,
          is_active
        )
        VALUES (
          'Multi B',
          1
        )
        `,
        )
        .run().lastInsertRowid,
    )

    const productA = Number(
      db
        .prepare(
          `
        INSERT INTO products (
          name,
          category_id,
          is_active
        )
        VALUES (
          'Product A',
          ?,
          1
        )
        `,
        )
        .run(categoryA).lastInsertRowid,
    )

    const productB = Number(
      db
        .prepare(
          `
        INSERT INTO products (
          name,
          category_id,
          is_active
        )
        VALUES (
          'Product B',
          ?,
          1
        )
        `,
        )
        .run(categoryB).lastInsertRowid,
    )

    const variantA = Number(
      db
        .prepare(
          `
        INSERT INTO product_variants (
          product_id,
          buy_price,
          sell_price,
          is_active
        )
        VALUES (
          ?,
          50,
          100,
          1
        )
        `,
        )
        .run(productA).lastInsertRowid,
    )

    const variantB = Number(
      db
        .prepare(
          `
        INSERT INTO product_variants (
          product_id,
          buy_price,
          sell_price,
          is_active
        )
        VALUES (
          ?,
          30,
          50,
          1
        )
        `,
        )
        .run(productB).lastInsertRowid,
    )

    const first = createPromotion({
      name: 'Offer A',

      type: 'percent',

      value: 10,

      scope_type: 'products',

      product_ids: [productA],

      actor_id: 1,
    })

    const second = createPromotion({
      name: 'Offer B',

      type: 'fixed_per_item',

      value: 5,

      scope_type: 'products',

      product_ids: [productB],

      actor_id: 1,
    })

    togglePromotion(first.promotionId, 1)

    togglePromotion(second.promotionId, 1)

    expect(
      getActivePromotions().map((promotion: any) => Number(promotion.id)),
    ).toEqual([first.promotionId, second.promotionId])

    const result = calculateActivePromotionsForSale([
      {
        variant_id: variantA,

        quantity: 1,

        unit_price: 100,
      },

      {
        variant_id: variantB,

        quantity: 2,

        unit_price: 50,
      },
    ])

    expect(result.promotion_discount_value).toBe(20)

    expect(result.item_discounts).toEqual([10, 10])
  })

  it('rejects overlapping active promotions', () => {
    const db = getDb()

    const productId = Number(
      db
        .prepare(
          `
        INSERT INTO products (
          name,
          is_active
        )
        VALUES (
          'Overlap Product',
          1
        )
        `,
        )
        .run().lastInsertRowid,
    )

    const first = createPromotion({
      name: 'First Overlap',

      type: 'percent',

      value: 10,

      scope_type: 'products',

      product_ids: [productId],
    })

    const second = createPromotion({
      name: 'Second Overlap',

      type: 'percent',

      value: 20,

      scope_type: 'products',

      product_ids: [productId],
    })

    togglePromotion(first.promotionId, 1)

    expect(() => togglePromotion(second.promotionId, 1)).toThrow(
      'يتداخل مع العرض',
    )

    const rows = listPromotions() as any[]

    expect(rows.filter((row) => Number(row.is_active) === 1)).toHaveLength(1)
  })

  it('rejects percent above 100', () => {
    expect(() =>
      createPromotion({
        name: 'Bad Offer',

        type: 'percent',

        value: 120,

        scope_type: 'all',

        actor_id: 1,
      }),
    ).toThrow('نسبة الخصم لا يمكن أن تتجاوز 100%')
  })

  it('rounds fixed promotion money but preserves fractional percentages', () => {
    const fixed = createPromotion({
      name: 'Rounded Fixed',

      type: 'fixed_invoice',

      value: 12.5,

      scope_type: 'all',
    })

    const percent = createPromotion({
      name: 'Fractional Percent',

      type: 'percent',

      value: 12.5,

      scope_type: 'all',
    })

    const rows = listPromotions() as any[]

    const fixedRow = rows.find((row) => Number(row.id) === fixed.promotionId)

    const percentRow = rows.find(
      (row) => Number(row.id) === percent.promotionId,
    )

    expect(Number(fixedRow.value)).toBe(13)

    expect(Number(percentRow.value)).toBe(12.5)
  })
})
