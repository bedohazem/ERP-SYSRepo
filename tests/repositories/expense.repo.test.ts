import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createExpense,
  listExpenses,
  listExpensesPage,
} from '../../src/main/database/repositories/expense.repo'

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
    expect(expenses[0].payment_method).toBe('cash')
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
    })

    const expenses = listExpenses() as ExpenseTestRow[]

    expect(expenses).toHaveLength(1)
    expect(expenses[0].payment_method).toBe('cash')

    expect(getCashMovementTotal('out')).toBe(100)
  })

  it('lists expenses ordered by newest first', () => {
    createExpense({
      title: 'First Expense',
      amount: 100,
    })

    createExpense({
      title: 'Second Expense',
      amount: 200,
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
    })

    createExpense({
      title: 'Paged Expense 2',
      amount: 200,
    })

    createExpense({
      title: 'Paged Expense 3',
      amount: 300,
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
})
