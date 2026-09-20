import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  cancelExpense,
  createExpense,
  listExpenses,
  listExpensesPage,
  updateExpense,
} from '../../src/main/database/repositories/expense.repo'

import {
  closeCashShift,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'

type ExpenseTestRow = {
  id: number
  title: string
  category: string | null
  amount: number
  payment_method: string
  notes: string | null
  created_by: number | null
  created_at: string
  created_by_name?: string | null
}

function seedStoreCashBalance() {
  const db = getDb()

  db.prepare(
    `
    INSERT INTO cash_movements (
      type,
      amount,
      direction,
      payment_method,
      reference_id,
      reference_type,
      notes,
      created_by
    )
    VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)
    `,
  ).run(
    'deposit',
    1000000,
    'in',
    'store_cash',
    'test_seed',
    'Test opening cash balance',
  )
}

function getCashMovementTotal(direction: 'in' | 'out') {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(amount), 0) AS total
      FROM cash_movements
      WHERE direction = ?
      `,
    )
    .get(direction) as { total: number }

  return Number(row.total || 0)
}

function getCashMovementsCount() {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM cash_movements
      WHERE IFNULL(reference_type, '') <> 'test_seed'
      `,
    )
    .get() as { count: number }

  return Number(row.count || 0)
}

function getActivityLogsCount() {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM activity_logs
      `,
    )
    .get() as { count: number }

  return Number(row.count || 0)
}

function getLastActivityLog() {
  const db = getDb()

  return db
    .prepare(
      `
      SELECT *
      FROM activity_logs
      ORDER BY id DESC
      LIMIT 1
      `,
    )
    .get() as any
}

describe('expense repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    seedStoreCashBalance()

    openCashShift({
      opening_counted_amount: 1000000,

      opened_by: 1,
    })

    /*
     * فتح الشفت نفسه له Activity Log،
     * والاختبارات القديمة بتحسب Logs
     * المصروف فقط.
     */
    getDb()
      .prepare(
        `
      DELETE FROM activity_logs
      `,
      )
      .run()
  })

  it('creates an expense and records cash movement and activity log', () => {
    const result = createExpense({
      title: '  Internet Bill  ',
      category: ' utilities ',
      amount: 250,
      payment_method: 'cash',
      notes: ' monthly internet ',
      created_by: 1,
    })

    expect(result.success).toBe(true)
    expect(result.id).toBeGreaterThan(0)

    const expenses = listExpenses() as ExpenseTestRow[]

    expect(expenses).toHaveLength(1)
    expect(expenses[0].id).toBe(result.id)
    expect(expenses[0].title).toBe('Internet Bill')
    expect(expenses[0].category).toBe('utilities')
    expect(expenses[0].amount).toBe(250)
    expect(expenses[0].payment_method).toBe('store_cash')
    expect(expenses[0].notes).toBe('monthly internet')
    expect(expenses[0].created_by).toBe(1)

    expect(getCashMovementsCount()).toBe(1)
    expect(getCashMovementTotal('out')).toBe(250)

    expect(getActivityLogsCount()).toBe(2)

    const lastLog = getLastActivityLog()

    expect(lastLog.action).toBe('cash_out')
    expect(lastLog.entity).toBe('cash_movements')
  })

  it('uses cash as default payment method', () => {
    createExpense({
      title: 'Office Supplies',
      amount: 100,
      created_by: 1,
    })

    const expenses = listExpenses() as ExpenseTestRow[]

    expect(expenses).toHaveLength(1)
    expect(expenses[0].payment_method).toBe('store_cash')

    expect(getCashMovementTotal('out')).toBe(100)
  })

  it('lists expenses ordered by newest first', () => {
    createExpense({
      title: 'First Expense',
      amount: 100,
      created_by: 1,
    })

    createExpense({
      title: 'Second Expense',
      amount: 200,
      created_by: 1,
    })

    const expenses = listExpenses() as ExpenseTestRow[]

    expect(expenses).toHaveLength(2)
    expect(expenses[0].title).toBe('Second Expense')
    expect(expenses[1].title).toBe('First Expense')
  })

  it('rejects expense with empty title', () => {
    expect(() =>
      createExpense({
        title: '   ',
        amount: 100,
      }),
    ).toThrow('عنوان المصروف مطلوب')

    expect(listExpenses() as ExpenseTestRow[]).toHaveLength(0)
    expect(getCashMovementsCount()).toBe(0)
  })

  it('rejects expense with zero amount', () => {
    expect(() =>
      createExpense({
        title: 'Invalid Expense',
        amount: 0,
      }),
    ).toThrow('قيمة المصروف غير صحيحة')

    expect(listExpenses() as ExpenseTestRow[]).toHaveLength(0)
    expect(getCashMovementsCount()).toBe(0)
  })

  it('rejects expense with negative amount', () => {
    expect(() =>
      createExpense({
        title: 'Invalid Expense',
        amount: -100,
      }),
    ).toThrow('قيمة المصروف غير صحيحة')

    expect(listExpenses() as ExpenseTestRow[]).toHaveLength(0)
    expect(getCashMovementsCount()).toBe(0)
  })

  it('paginates expenses and keeps totals for all matching rows', () => {
    createExpense({
      title: 'Paged Expense 1',
      amount: 100,
      created_by: 1,
    })

    createExpense({
      title: 'Paged Expense 2',
      amount: 200,
      created_by: 1,
    })

    createExpense({
      title: 'Paged Expense 3',
      amount: 300,
      created_by: 1,
    })

    const firstPage = listExpensesPage({
      limit: 2,
      offset: 0,
    })

    expect(firstPage.total).toBe(3)
    expect(firstPage.total_amount).toBe(600)
    expect(firstPage.rows).toHaveLength(2)
    expect((firstPage.rows[0] as any).title).toBe('Paged Expense 3')
    expect((firstPage.rows[1] as any).title).toBe('Paged Expense 2')
    expect(firstPage.limit).toBe(2)
    expect(firstPage.offset).toBe(0)

    const secondPage = listExpensesPage({
      limit: 2,
      offset: 2,
    })

    expect(secondPage.total).toBe(3)
    expect(secondPage.total_amount).toBe(600)
    expect(secondPage.rows).toHaveLength(1)
    expect((secondPage.rows[0] as any).title).toBe('Paged Expense 1')
    expect(secondPage.offset).toBe(2)
  })

  it('filters cashier expenses by creator while admin scope sees all expenses', () => {
    const db = getDb()

    db.prepare(
      `
    INSERT OR IGNORE INTO users (
      id,
      name,
      username,
      password,
      role,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, 1)
    `,
    ).run(2, 'Cashier Two', 'cashier-two', 'test-password', 'cashier')

    createExpense({
      title: 'Admin Expense',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
    })

    const adminShift = getOpenCashShift()!

    closeCashShift({
      shift_id: adminShift.id,

      closing_counted_amount: 999900,

      left_for_next_shift: 999900,

      closed_by: 1,
    })

    openCashShift({
      opening_counted_amount: 999900,

      opened_by: 2,
    })

    createExpense({
      title: 'Cashier Expense',
      amount: 200,
      payment_method: 'store_cash',
      created_by: 2,
    })

    const cashierPage = listExpensesPage({
      created_by: 2,
      limit: 50,
      offset: 0,
    })

    expect(cashierPage.total).toBe(1)
    expect(cashierPage.total_amount).toBe(200)
    expect(cashierPage.rows).toHaveLength(1)

    expect((cashierPage.rows[0] as any).title).toBe('Cashier Expense')

    expect(Number((cashierPage.rows[0] as any).created_by)).toBe(2)

    const cashierList = listExpenses({
      created_by: 2,
    }) as ExpenseTestRow[]

    expect(cashierList).toHaveLength(1)
    expect(cashierList[0].title).toBe('Cashier Expense')

    const adminPage = listExpensesPage({
      limit: 50,
      offset: 0,
    })

    expect(adminPage.total).toBe(2)
    expect(adminPage.total_amount).toBe(300)
    expect(adminPage.rows).toHaveLength(2)
  })

  it('updates expense and replaces its active cash movement', () => {
    const created = createExpense({
      title: 'Old Expense',

      category: 'old',

      amount: 250,

      payment_method: 'store_cash',

      notes: 'old note',

      created_by: 1,
    })

    const db = getDb()

    const oldMovement = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE reference_type =
        'expense'

        AND reference_id = ?

        AND cancelled_at
          IS NULL

      LIMIT 1
      `,
      )
      .get(created.id) as any

    const result = updateExpense({
      id: created.id,

      title: 'New Expense',

      category: 'new',

      amount: 400,

      payment_method: 'store_cash',

      notes: 'new note',

      actor_id: 1,
    })

    expect(result.success).toBe(true)

    const expense = db
      .prepare(
        `
      SELECT *

      FROM expenses

      WHERE id = ?
      `,
      )
      .get(created.id) as any

    expect(expense.title).toBe('New Expense')

    expect(Number(expense.amount)).toBe(400)

    expect(expense.category).toBe('new')

    const oldAfter = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE id = ?
      `,
      )
      .get(oldMovement.id) as any

    expect(oldAfter.cancelled_at).toBeNull()

    const reverseMovement = db
      .prepare(
        `
    SELECT *

    FROM cash_movements

    WHERE reference_type =
      'expense_update_reverse'

      AND reference_id = ?

    ORDER BY id DESC

    LIMIT 1
    `,
      )
      .get(created.id) as any

    expect(reverseMovement).toBeTruthy()

    expect(reverseMovement.direction).toBe('in')

    expect(Number(reverseMovement.amount)).toBe(250)

    const activeMovement = db
      .prepare(
        `
        SELECT *

        FROM cash_movements

        WHERE reference_type =
          'expense'

          AND reference_id = ?

          AND direction = 'out'

        ORDER BY id DESC

        LIMIT 1
        `,
      )
      .get(created.id) as any

    expect(Number(activeMovement.amount)).toBe(400)

    expect(activeMovement.id).not.toBe(oldMovement.id)

    const expenseNet = db
      .prepare(
        `
    SELECT
      IFNULL(
        SUM(
          CASE
            WHEN direction = 'out'
              THEN amount

            WHEN direction = 'in'
              THEN -amount

            ELSE 0
          END
        ),
        0
      ) AS net_out

    FROM cash_movements

    WHERE type =
      'expense'

      AND cancelled_at
        IS NULL
    `,
      )
      .get() as {
      net_out: number
    }

    expect(Number(expenseNet.net_out)).toBe(400)
  })

  it('updates and cancels a previous-shift expense in the current shift', () => {
    const db = getDb()

    const shift1 = getOpenCashShift()!

    const created = createExpense({
      title: 'Previous Shift Expense',

      amount: 100,

      payment_method: 'store_cash',

      created_by: 1,
    })

    const originalMovement = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE reference_type =
        'expense'

        AND reference_id = ?

      ORDER BY id ASC

      LIMIT 1
      `,
      )
      .get(created.id) as any

    expect(Number(originalMovement.shift_id)).toBe(shift1.id)

    closeCashShift({
      shift_id: shift1.id,

      closing_counted_amount: 999900,

      left_for_next_shift: 999900,

      closed_by: 1,
    })

    const shift2 = openCashShift({
      opening_counted_amount: 999900,

      opened_by: 1,
    })

    const updated = updateExpense({
      id: created.id,

      title: 'Corrected Expense',

      amount: 150,

      payment_method: 'store_cash',

      actor_id: 1,
    })

    expect(updated.updated_shift_id).toBe(shift2.id)

    const expenseAfterUpdate = db
      .prepare(
        `
      SELECT
        shift_id,
        updated_shift_id

      FROM expenses

      WHERE id = ?
      `,
      )
      .get(created.id) as any

    expect(Number(expenseAfterUpdate.shift_id)).toBe(shift1.id)

    expect(Number(expenseAfterUpdate.updated_shift_id)).toBe(shift2.id)

    const originalAfterUpdate = db
      .prepare(
        `
        SELECT
          cancelled_at,
          shift_id

        FROM cash_movements

        WHERE id = ?
        `,
      )
      .get(originalMovement.id) as any

    expect(originalAfterUpdate.cancelled_at).toBeNull()

    expect(Number(originalAfterUpdate.shift_id)).toBe(shift1.id)

    const cancelled = cancelExpense({
      id: created.id,

      reason: 'Cancel in current shift',

      actor_id: 1,
    })

    expect(cancelled.cancelled_shift_id).toBe(shift2.id)

    const expenseAfterCancel = db
      .prepare(
        `
      SELECT
        shift_id,
        updated_shift_id,
        cancelled_shift_id

      FROM expenses

      WHERE id = ?
      `,
      )
      .get(created.id) as any

    expect(Number(expenseAfterCancel.shift_id)).toBe(shift1.id)

    expect(Number(expenseAfterCancel.updated_shift_id)).toBe(shift2.id)

    expect(Number(expenseAfterCancel.cancelled_shift_id)).toBe(shift2.id)

    const cancelReverse = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE reference_type =
        'expense_cancel'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
      )
      .get(created.id) as any

    expect(cancelReverse.direction).toBe('in')

    expect(Number(cancelReverse.amount)).toBe(150)

    expect(Number(cancelReverse.shift_id)).toBe(shift2.id)
  })
})
