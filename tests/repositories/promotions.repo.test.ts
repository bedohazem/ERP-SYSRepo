import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  createPromotion,
  getActivePromotion,
  listPromotions,
  togglePromotion,
} from '../../src/main/database/repositories/promotions.repo'

describe('promotions repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('keeps only one promotion active', () => {
    const first = createPromotion({
      name: 'First Offer',

      type: 'percent',

      value: 25,

      scope_type: 'all',

      actor_id: 1,
    })

    const second = createPromotion({
      name: 'Second Offer',

      type: 'fixed_invoice',

      value: 100,

      scope_type: 'all',

      actor_id: 1,
    })

    togglePromotion(first.promotionId, 1)

    expect(getActivePromotion()?.id).toBe(first.promotionId)

    togglePromotion(second.promotionId, 1)

    expect(getActivePromotion()?.id).toBe(second.promotionId)

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
})
