import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  closeCashShift,
  getCashShiftExpectedBalance,
  getOpenCashShift,
  openCashShift,
  getCashShiftOpeningPreview,
  requireOperationalCashShift,
  resolveFinancialOperationShift,
  getCashShiftDaySummary,
  listCashShiftVariances,
  getCashShiftDetails,
  listCashShifts,
  resolveCashShiftVariance,
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

  it('shows previous handover before opening the next shift', () => {
    const firstShift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    closeCashShift({
      shift_id: firstShift.id,
      closing_counted_amount: 500,
      left_for_next_shift: 300,
      closed_by: 1,
    })

    const preview = getCashShiftOpeningPreview()

    expect(preview.can_open).toBe(true)

    expect(preview.previous_shift_id).toBe(firstShift.id)

    expect(preview.expected_opening_amount).toBe(300)
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

  it('prevents a cashier from operating on another cashier shift', () => {
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
    ).run('Shift Cashier One', 'shift_cashier_one', 'x')

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
    ).run('Shift Cashier Two', 'shift_cashier_two', 'x')

    const firstCashier = db
      .prepare(
        `
      SELECT id
      FROM users
      WHERE username =
        'shift_cashier_one'
    `,
      )
      .get() as {
      id: number
    }

    const secondCashier = db
      .prepare(
        `
      SELECT id
      FROM users
      WHERE username =
        'shift_cashier_two'
    `,
      )
      .get() as {
      id: number
    }

    const shift = openCashShift({
      opening_counted_amount: 100,
      opened_by: firstCashier.id,
    })

    expect(requireOperationalCashShift(firstCashier.id).id).toBe(shift.id)

    expect(() => requireOperationalCashShift(secondCashier.id)).toThrow(
      'الشفت المفتوح تابع لمستخدم آخر',
    )

    /*
     * المستخدم رقم 1 هو الأدمن الافتراضي.
     */
    expect(requireOperationalCashShift(1).id).toBe(shift.id)
  })

  it('allows admin non-drawer financial operations without an open shift', () => {
    expect(resolveFinancialOperationShift(1, ['owner_bank'])).toBeNull()

    expect(resolveFinancialOperationShift(1, ['owner_cash'])).toBeNull()

    expect(resolveFinancialOperationShift(1, ['owner_vodafone'])).toBeNull()

    expect(() =>
      resolveFinancialOperationShift(
        1,
        ['store_cash'],
        'لا يمكن تنفيذ العملية بدون شفت مفتوح',
      ),
    ).toThrow('لا يمكن تنفيذ العملية بدون شفت مفتوح')
  })

  it('requires cashiers to have their own shift for every financial account', () => {
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
    ).run('Financial Shift Cashier', 'financial_shift_cashier', 'x')

    const cashier = db
      .prepare(
        `
        SELECT id
        FROM users
        WHERE username = 'financial_shift_cashier'
        `,
      )
      .get() as {
      id: number
    }

    expect(() =>
      resolveFinancialOperationShift(
        cashier.id,
        ['owner_bank'],
        'لا يمكن تنفيذ العملية بدون شفت مفتوح',
      ),
    ).toThrow('لا يمكن تنفيذ العملية بدون شفت مفتوح')

    const shift = openCashShift({
      opening_counted_amount: 100,
      opened_by: cashier.id,
    })

    expect(resolveFinancialOperationShift(cashier.id, ['owner_bank'])?.id).toBe(
      shift.id,
    )

    expect(resolveFinancialOperationShift(cashier.id, ['store_cash'])?.id).toBe(
      shift.id,
    )
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

  it('resolves a pending shift variance without changing cash balances', () => {
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

    closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 1400,

      left_for_next_shift: 400,

      closed_by: 1,
    })

    const pendingBefore = listCashShiftVariances({
      status: 'pending',
    })

    expect(pendingBefore.total).toBe(1)

    const variance = pendingBefore.rows[0]

    expect(variance.shift_id).toBe(shift.id)

    expect(variance.stage).toBe('closing')

    expect(variance.kind).toBe('shortage')

    expect(Number(variance.amount)).toBe(100)

    const drawerBefore = getCashSummary({
      payment_method: 'store_cash',
    }).balance

    const safeBefore = getCashSummary({
      payment_method: 'store_safe',
    }).balance

    const resolved = resolveCashShiftVariance({
      variance_id: variance.id,

      resolution_type: 'explained',

      resolution_notes: 'تمت مراجعة العجز واعتماد نتيجة الجرد',

      resolved_by: 1,
    })

    expect(resolved.status).toBe('resolved')

    expect(resolved.resolution_type).toBe('explained')

    expect(resolved.resolution_notes).toBe(
      'تمت مراجعة العجز واعتماد نتيجة الجرد',
    )

    expect(resolved.resolved_by).toBe(1)

    expect(resolved.resolved_at).toBeTruthy()

    expect(
      listCashShiftVariances({
        status: 'pending',
      }).total,
    ).toBe(0)

    expect(
      listCashShiftVariances({
        status: 'resolved',
      }).total,
    ).toBe(1)

    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(drawerBefore)

    expect(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    ).toBe(safeBefore)

    expect(() =>
      resolveCashShiftVariance({
        variance_id: variance.id,

        resolution_type: 'approved',

        resolution_notes: 'محاولة مراجعة ثانية',

        resolved_by: 1,
      }),
    ).toThrow('تمت مراجعة فرق الشفت بالفعل')
  })

  it('allows only admins to resolve shift variances', () => {
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

    VALUES (
      ?,
      ?,
      ?,
      'cashier',
      1
    )
    `,
    ).run('Variance Cashier', 'variance_cashier', 'x')

    const cashier = db
      .prepare(
        `
      SELECT id

      FROM users

      WHERE username =
        'variance_cashier'
      `,
      )
      .get() as {
      id: number
    }

    const shift = openCashShift({
      opening_counted_amount: 500,
      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
    })

    closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 550,

      left_for_next_shift: 550,

      closed_by: 1,
    })

    const variance = listCashShiftVariances({
      status: 'pending',
    }).rows[0]

    expect(() =>
      resolveCashShiftVariance({
        variance_id: variance.id,

        resolution_type: 'explained',

        resolution_notes: 'Trying as cashier',

        resolved_by: cashier.id,
      }),
    ).toThrow('مراجعة فروق الشفتات متاحة لمدير النظام فقط')
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

  it('moves legacy drawer excess to safe on the first shift without reducing total cash', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 3267,
      payment_method: 'store_cash',
      created_by: 1,
    })

    const beforeDrawer = Number(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    )

    const beforeSafe = Number(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    )

    expect(beforeDrawer + beforeSafe).toBe(3267)

    const shift = openCashShift({
      opening_counted_amount: 10,
      opened_by: 1,
    })

    const drawer = Number(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    )

    const safe = Number(
      getCashSummary({
        payment_method: 'store_safe',
      }).balance,
    )

    expect(drawer).toBe(10)
    expect(safe).toBe(3257)

    expect(drawer + safe).toBe(3267)

    const preview = getCashShiftExpectedBalance(shift.id)

    expect(preview.expected_closing_amount).toBe(10)
  })

  it('rejects invalid shift amounts', () => {
    expect(() =>
      openCashShift({
        opening_counted_amount: Number.NaN,
        opened_by: 1,
      }),
    ).toThrow('رصيد افتتاح الشفت غير صحيح')

    const shift = openCashShift({
      opening_counted_amount: 100,
      opened_by: 1,
    })

    expect(() =>
      closeCashShift({
        shift_id: shift.id,
        closing_counted_amount: Number.NaN,
        left_for_next_shift: 0,
        closed_by: 1,
      }),
    ).toThrow('قيمة جرد إغلاق الشفت غير صحيحة')
  })

  it('summarizes drawer activity from shifts without counting safe handover transfers', () => {
    const db = getDb()

    const dayRow = db
      .prepare(
        `
      SELECT date('now', 'localtime') AS day
      `,
      )
      .get() as {
      day: string
    }

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
      left_for_next_shift: 200,
      closed_by: 1,
    })

    const secondShift = openCashShift({
      opening_counted_amount: 200,
      opened_by: 1,
    })

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount: 50,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: secondShift.id,
    })

    const summary = getCashShiftDaySummary({
      business_date: dayRow.day,
      user_id: 1,
    })

    expect(summary.shifts_count).toBe(2)
    expect(summary.closed_shifts_count).toBe(1)

    expect(summary.has_open_shift).toBe(true)
    expect(summary.all_closed).toBe(false)

    expect(summary.first_shift_id).toBe(firstShift.id)

    expect(summary.last_shift_id).toBe(secondShift.id)

    expect(summary.opening_drawer_balance).toBe(500)

    expect(summary.cash_in).toBe(300)
    expect(summary.cash_out).toBe(50)

    expect(summary.balance_before_handover).toBe(150)

    expect(summary.ending_drawer_balance).toBe(150)
  })

  it('lists shift history with operational drawer totals', () => {
    const firstShift = openCashShift({
      opening_counted_amount: 500,

      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',

      direction: 'in',

      amount: 200,

      payment_method: 'store_cash',

      created_by: 1,

      shift_id: firstShift.id,
    })

    createCashMovement({
      type: 'expense',

      direction: 'out',

      amount: 50,

      payment_method: 'store_cash',

      created_by: 1,

      shift_id: firstShift.id,
    })

    closeCashShift({
      shift_id: firstShift.id,

      closing_counted_amount: 650,

      left_for_next_shift: 100,

      closed_by: 1,
    })

    const secondShift = openCashShift({
      opening_counted_amount: 100,

      opened_by: 1,
    })

    const all = listCashShifts({
      status: 'all',
    })

    expect(all.total).toBe(2)

    expect(all.rows[0].id).toBe(secondShift.id)

    const closed = listCashShifts({
      status: 'closed',
    })

    expect(closed.total).toBe(1)

    expect(closed.rows[0].id).toBe(firstShift.id)

    expect(closed.rows[0].cash_in).toBe(200)

    expect(closed.rows[0].cash_out).toBe(50)

    expect(closed.rows[0].safe_transfer_amount).toBe(550)

    expect(closed.rows[0].pending_variance_count).toBe(0)
  })

  it('returns complete shift details', () => {
    const shift = openCashShift({
      opening_counted_amount: 300,

      opened_by: 1,
    })

    createCashMovement({
      type: 'sale',

      direction: 'in',

      amount: 150,

      payment_method: 'store_cash',

      created_by: 1,

      shift_id: shift.id,
    })

    createCashMovement({
      type: 'expense',

      direction: 'out',

      amount: 25,

      payment_method: 'store_cash',

      created_by: 1,

      shift_id: shift.id,
    })

    closeCashShift({
      shift_id: shift.id,

      closing_counted_amount: 425,

      left_for_next_shift: 100,

      closed_by: 1,
    })

    const details = getCashShiftDetails(shift.id)

    expect(details.shift.id).toBe(shift.id)

    expect(details.shift.status).toBe('closed')

    expect(details.preview.cash_in).toBe(150)

    expect(details.preview.cash_out).toBe(25)

    expect(details.preview.expected_closing_amount).toBe(425)

    expect(details.movements.length).toBeGreaterThanOrEqual(4)

    expect(details.variances).toHaveLength(0)
  })
})
