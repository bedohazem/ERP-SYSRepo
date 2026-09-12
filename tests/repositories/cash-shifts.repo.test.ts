import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  closeCashShift,
  getCashShiftExpectedBalance,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'

import {
  createCashMovement,
  getCashSummary,
} from '../../src/main/database/repositories/cash.repo'

describe('cash shifts repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('opens first shift and reconciles drawer balance to actual counted amount', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    expect(shift.status).toBe('open')

    expect(shift.expected_opening_amount).toBeNull()

    expect(shift.opening_counted_amount).toBe(500)

    expect(shift.opening_difference).toBe(0)

    expect(getOpenCashShift()?.id).toBe(shift.id)

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(500)
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

  it('calculates expected drawer balance from shift cash movements', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    const preview = getCashShiftExpectedBalance(shift.id)

    expect(preview.opening_counted_amount).toBe(500)

    expect(preview.cash_in).toBe(1000)
    expect(preview.cash_out).toBe(100)

    expect(preview.expected_closing_amount).toBe(1400)
  })

  it('closes matching shift and transfers excess to safe', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    const closed = closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 1500,

      left_for_next_shift: 300,

      closed_by: 1,
    })

    expect(closed.status).toBe('closed')

    expect(closed.expected_closing_amount).toBe(1500)

    expect(closed.closing_counted_amount).toBe(1500)

    expect(closed.closing_difference).toBe(0)

    expect(closed.left_for_next_shift).toBe(300)

    expect(closed.safe_transfer_amount).toBe(1200)

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(300)

    expect(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    ).toBe(1200)

    const variance = getDb()
      .prepare(
        `
        SELECT id

        FROM cash_shift_variances

        WHERE shift_id = ?
          AND stage = 'closing'

        LIMIT 1
        `,
      )
      .get(shift.id)

    expect(variance).toBeUndefined()
  })

  it('records closing shortage without corrupting drawer balance', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    const closed = closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 1400,

      left_for_next_shift: 400,

      closed_by: 1,
    })

    expect(closed.expected_closing_amount).toBe(1500)

    expect(closed.closing_difference).toBe(-100)

    expect(closed.safe_transfer_amount).toBe(1000)

    const variance = getDb()
      .prepare(
        `
        SELECT *

        FROM cash_shift_variances

        WHERE shift_id = ?
          AND stage = 'closing'

        LIMIT 1
        `,
      )
      .get(shift.id) as any

    expect(variance.kind).toBe('shortage')

    expect(Number(variance.amount)).toBe(100)

    expect(variance.status).toBe('pending')

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(400)

    expect(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    ).toBe(1000)
  })

  it('records closing surplus and keeps it pending', () => {
    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    const closed = closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 1600,

      left_for_next_shift: 400,

      closed_by: 1,
    })

    expect(closed.closing_difference).toBe(100)

    const variance = getDb()
      .prepare(
        `
        SELECT *

        FROM cash_shift_variances

        WHERE shift_id = ?
          AND stage = 'closing'

        LIMIT 1
        `,
      )
      .get(shift.id) as any

    expect(variance.kind).toBe('surplus')

    expect(Number(variance.amount)).toBe(100)

    expect(variance.status).toBe('pending')

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(400)

    expect(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    ).toBe(1200)
  })

  it('compares next shift actual opening against previous handover', () => {
    const firstShift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 300,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: firstShift.id,
    })

    closeCashShift({
      shift_id: firstShift.id,

      closing_counted_amount: 800,

      left_for_next_shift: 800,

      closed_by: 1,
    })

    const secondShift = openCashShift({
      opening_counted_amount: 750,
      opened_by: 1,
    })

    expect(secondShift.previous_shift_id).toBe(firstShift.id)

    expect(secondShift.expected_opening_amount).toBe(800)

    expect(secondShift.opening_counted_amount).toBe(750)

    expect(secondShift.opening_difference).toBe(-50)

    const variance = getDb()
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

    expect(variance.kind).toBe('shortage')

    expect(Number(variance.amount)).toBe(50)

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(750)
  })

  it('allows only shift owner or admin to close shift', () => {
    const db = getDb()

    db.prepare(
      `
      INSERT INTO users (
        name,
        username,
        password,
        role,
        is_active
      )

      VALUES (?, ?, ?, 'cashier', 1)
      `,
    ).run('Cashier One', 'cashier_one', 'x')

    db.prepare(
      `
      INSERT INTO users (
        name,
        username,
        password,
        role,
        is_active
      )

      VALUES (?, ?, ?, 'cashier', 1)
      `,
    ).run('Cashier Two', 'cashier_two', 'x')

    const firstCashier = db
      .prepare(
        `
        SELECT id
        FROM users
        WHERE username = ?
        `,
      )
      .get('cashier_one') as {
      id: number
    }

    const secondCashier = db
      .prepare(
        `
        SELECT id
        FROM users
        WHERE username = ?
        `,
      )
      .get('cashier_two') as {
      id: number
    }

    const shift = openCashShift({
      opening_counted_amount: 0,
      opened_by: firstCashier.id,
    })

    expect(() =>
      closeCashShift({
        shift_id: shift.id,
        closing_counted_amount: 0,
        left_for_next_shift: 0,
        closed_by: secondCashier.id,
      }),
    ).toThrow('لا يمكن إغلاق الشفت إلا بواسطة صاحب الشفت أو المدير')

    expect(() =>
      closeCashShift({
        shift_id: shift.id,
        closing_counted_amount: 0,
        left_for_next_shift: 0,
        closed_by: 1,
      }),
    ).toThrow('سبب إغلاق المدير للشفت مطلوب')

    const closed = closeCashShift({
      shift_id: shift.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
      close_reason: 'إغلاق إداري للشفت',
    })

    expect(closed.status).toBe('closed')
  })
})
