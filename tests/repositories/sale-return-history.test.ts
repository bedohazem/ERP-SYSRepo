import { describe, expect, it } from 'vitest'

import { getActiveSaleReturnHistory } from '../../src/renderer/utils/sale-return-history'

describe('sale return history', () => {
  it('hides cancelled returns from the active invoice return history', () => {
    const history = [
      {
        id: 77,
        code: 'RET-00077',
        cancelled_at: null,
      },
      {
        id: 78,
        code: 'RET-00078',
        cancelled_at: '2026-09-07 04:30:00',
      },
    ]

    const result = getActiveSaleReturnHistory(history)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(77)
  })
})
