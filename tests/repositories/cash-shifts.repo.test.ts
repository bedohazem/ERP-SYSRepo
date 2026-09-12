import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'

describe('cash shifts repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('opens the first shift using the actual counted drawer amount', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    expect(shift.status).toBe('open')

    expect(shift.opened_by).toBe(1)

    expect(shift.opening_counted_amount).toBe(500)

    expect(shift.expected_opening_amount).toBeNull()

    expect(shift.opening_difference).toBe(0)

    expect(getOpenCashShift()?.id).toBe(shift.id)
  })

  it('prevents opening more than one shift at the same time', () => {
    openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    expect(() =>
      openCashShift({
        opening_counted_amount: 600,
        opened_by: 1,
      }),
    ).toThrow('يوجد شفت مفتوح بالفعل')
  })

  it('creates an opening shortage when the next cashier counts less than the previous handover', () => {
    const db = getDb()

    const firstShift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    db.prepare(
      `
      UPDATE cash_shifts

      SET
        status = 'closed',

        expected_closing_amount = 1000,
        closing_counted_amount = 1000,
        closing_difference = 0,

        left_for_next_shift = 800,
        safe_transfer_amount = 200,

        closed_by = 1,
        closed_at = CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(firstShift.id)

    const secondShift = openCashShift({
      opening_counted_amount: 750,
      opened_by: 1,
    })

    expect(secondShift.previous_shift_id).toBe(firstShift.id)

    expect(secondShift.expected_opening_amount).toBe(800)

    expect(secondShift.opening_counted_amount).toBe(750)

    expect(secondShift.opening_difference).toBe(-50)

    const variance = db
      .prepare(
        `
        SELECT *

        FROM cash_shift_variances

        WHERE shift_id = ?
          AND stage = 'opening'

        LIMIT 1
        `,
      )
      .get(secondShift.id) as any

    expect(variance).toBeTruthy()

    expect(variance.kind).toBe('shortage')

    expect(Number(variance.amount)).toBe(50)

    expect(variance.status).toBe('pending')
  })
})
