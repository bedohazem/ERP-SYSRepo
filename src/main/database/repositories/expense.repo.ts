import { getDb } from '../db'
import { createCashMovement } from './cash.repo'
import { createActivityLog } from './activity.repo'

export type CreateExpenseInput = {
  title: string
  category?: string | null
  amount: number
  payment_method?: string
  notes?: string | null
  created_by?: number | null
}

export type CancelExpenseInput = {
  id: number
  reason?: string | null
  actor_id?: number | null
}

export function createExpense(input: CreateExpenseInput) {
  const db = getDb()

  const title = input.title?.trim()

  if (!title) {
    throw new Error('عنوان المصروف مطلوب')
  }

  const amount = Number(input.amount || 0)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('قيمة المصروف غير صحيحة')
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO expenses (
          title,
          category,
          amount,
          payment_method,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        title,
        input.category?.trim() || null,
        amount,
        input.payment_method || 'cash',
        input.notes?.trim() || null,
        input.created_by ?? null,
      )

    const expenseId = Number(result.lastInsertRowid)

    createActivityLog({
      user_id: input.created_by ?? null,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: expenseId,
      details: JSON.stringify({
        title,
        category: input.category?.trim() || null,
        amount,
        payment_method: input.payment_method || 'cash',
        notes: input.notes?.trim() || null,
      }),
    })

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount,
      payment_method: input.payment_method || 'cash',
      reference_id: expenseId,
      reference_type: 'expense',
      notes: `مصروف: ${title}`,
      created_by: input.created_by ?? null,
    })

    return {
      id: expenseId,
      success: true,
    }
  })

  return tx()
}

export function listExpenses(input?: { date_from?: string; date_to?: string }) {
  const db = getDb()

  const where: string[] = [`e.cancelled_at IS NULL`]
  const params: any[] = []

  if (input?.date_from) {
    where.push(`datetime(e.created_at, 'localtime') >= datetime(?)`)
    params.push(`${input.date_from} 00:00:00`)
  }

  if (input?.date_to) {
    where.push(`datetime(e.created_at, 'localtime') <= datetime(?)`)
    params.push(`${input.date_to} 23:59:59`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  return db
    .prepare(
      `
      SELECT
        e.*,
        u.name AS created_by_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.created_by

      ${whereSql}

      ORDER BY e.id DESC
    `,
    )
    .all(...params)
}

export function listExpensesPage(input?: {
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}) {
  const db = getDb()

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)
  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (input?.date_from) {
    where.push(`datetime(e.created_at, 'localtime') >= datetime(?)`)
    params.push(`${input.date_from} 00:00:00`)
  }

  if (input?.date_to) {
    where.push(`datetime(e.created_at, 'localtime') <= datetime(?)`)
    params.push(`${input.date_to} 23:59:59`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        u.name AS created_by_name

      FROM expenses e

      LEFT JOIN users u
        ON u.id = e.created_by

      ${whereSql}

      ORDER BY e.id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const activeWhereSql = where.length
    ? `${whereSql} AND e.cancelled_at IS NULL`
    : `WHERE e.cancelled_at IS NULL`

  const summary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        IFNULL(SUM(e.amount), 0) AS total_amount

      FROM expenses e

      ${activeWhereSql}
    `,
    )
    .get(...params) as any

  return {
    rows,
    total: Number(summary?.total || 0),
    total_amount: Number(summary?.total_amount || 0),
    limit,
    offset,
  }
}

export function cancelExpense(input: CancelExpenseInput) {
  const db = getDb()

  const expenseId = Number(input.id)

  const expense = db
    .prepare(
      `
      SELECT *
      FROM expenses
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(expenseId) as any

  if (!expense) {
    throw new Error('المصروف غير موجود')
  }

  if (expense.cancelled_at) {
    throw new Error('المصروف ملغي بالفعل')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT
        cm.*,
        COALESCE(
          NULLIF(cm.business_date, ''),
          date(cm.created_at, 'localtime')
        ) AS accounting_date

      FROM cash_movements cm

      WHERE cm.type = 'expense'
        AND cm.reference_type = 'expense'
        AND cm.reference_id = ?

      ORDER BY cm.id DESC
      LIMIT 1
      `,
    )
    .get(expenseId) as any

  if (cashMovement && !cashMovement.cancelled_at) {
    const closing = db
      .prepare(
        `
        SELECT id
        FROM cash_day_closings
        WHERE business_date = ?
        LIMIT 1
        `,
      )
      .get(cashMovement.accounting_date)

    if (closing) {
      throw new Error(
        `لا يمكن إلغاء المصروف لأن يوم ${cashMovement.accounting_date} تم تقفيله`,
      )
    }
  }

  const reason = String(input.reason || '').trim() || 'إلغاء مصروف'

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE expenses
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?
      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, expenseId)

    if (cashMovement && !cashMovement.cancelled_at) {
      db.prepare(
        `
        UPDATE cash_movements
        SET
          cancelled_at = CURRENT_TIMESTAMP,
          cancelled_by = ?,
          cancel_reason = ?
        WHERE id = ?
        `,
      ).run(input.actor_id ?? null, reason, cashMovement.id)
    }

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'expense_cancelled',
      entity: 'expenses',
      entity_id: expenseId,
      details: JSON.stringify({
        title: expense.title,
        amount: expense.amount,
        payment_method: expense.payment_method,
        reason,
        cash_movement_id: cashMovement?.id ?? null,
      }),
    })

    return {
      success: true,
      id: expenseId,
    }
  })

  return tx()
}
