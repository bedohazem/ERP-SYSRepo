import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'
import { createActivityLog } from './activity.repo'
import { resolveFinancialOperationShift } from './cash-shifts.repo'
import { getShiftBusinessDate } from '../shift-business-date'

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
  can_manage_all?: boolean
  approved_by?: number | null
}

export type UpdateExpenseInput = {
  id: number
  title: string
  category?: string | null
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
  can_manage_all?: boolean
  approved_by?: number | null
}

function getCurrentBusinessDate(db: ReturnType<typeof getDb>) {
  const row = db
    .prepare(
      `
      SELECT
        date('now', 'localtime')
          AS business_date
      `,
    )
    .get() as {
    business_date: string
  }

  return String(row?.business_date || '')
}

function appendCreatedByFilter(
  where: string[],
  params: any[],
  createdBy?: number | null,
) {
  if (createdBy === undefined || createdBy === null) {
    return
  }

  const userId = Number(createdBy)

  if (!Number.isFinite(userId) || userId <= 0) {
    where.push('1 = 0')
    return
  }

  where.push('e.created_by = ?')
  params.push(userId)
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

  const actorId = Number(input.created_by || 0)

  const paymentMethod = resolveCashAccount(input.payment_method || 'cash')

  const openShift = resolveFinancialOperationShift(
    actorId,
    [paymentMethod],
    'لا يمكن تسجيل مصروف من درج المحل بدون شفت مفتوح',
  )

  const businessDate = openShift
    ? getShiftBusinessDate(openShift.id)
    : getCurrentBusinessDate(db)

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
          created_by,
          shift_id
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        title,
        input.category?.trim() || null,
        amount,
        paymentMethod,
        input.notes?.trim() || null,
        actorId,
        openShift?.id ?? null,
      )

    const expenseId = Number(result.lastInsertRowid)

    createActivityLog({
      user_id: actorId,

      action: 'expense_created',

      entity: 'expenses',

      entity_id: expenseId,

      details: JSON.stringify({
        title,

        category: input.category?.trim() || null,

        amount,

        payment_method: paymentMethod,

        notes: input.notes?.trim() || null,

        shift_id: openShift?.id ?? null,
      }),
    })

    createCashMovement({
      type: 'expense',

      direction: 'out',

      amount,

      payment_method: paymentMethod,

      reference_id: expenseId,

      reference_type: 'expense',

      notes: `مصروف: ${title}`,

      created_by: actorId,

      business_date: businessDate,

      shift_id: openShift?.id ?? null,
    })

    return {
      id: expenseId,

      success: true,

      shift_id: openShift?.id ?? null,
    }
  })

  return tx()
}

export function listExpenses(input?: {
  date_from?: string
  date_to?: string
  created_by?: number | null
}) {
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

  appendCreatedByFilter(where, params, input?.created_by)

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
  created_by?: number | null
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

  appendCreatedByFilter(where, params, input?.created_by)

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

  const totalRow = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM expenses e
    ${whereSql}
    `,
    )
    .get(...params) as any

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
    total: Number(totalRow?.total || 0),
    total_amount: Number(summary?.total_amount || 0),
    limit,
    offset,
  }
}

export function updateExpense(input: UpdateExpenseInput) {
  const db = getDb()

  const expenseId = Number(input.id || 0)

  if (!expenseId) {
    throw new Error('رقم المصروف غير صحيح')
  }

  const title = String(input.title || '').trim()

  if (!title) {
    throw new Error('عنوان المصروف مطلوب')
  }

  const amount = Number(input.amount || 0)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('قيمة المصروف غير صحيحة')
  }

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

  const actorId = Number(input.actor_id || 0)

  if (
    input.can_manage_all !== true &&
    (!actorId || Number(expense.created_by || 0) !== actorId)
  ) {
    throw new Error('غير مصرح لك بتعديل هذا المصروف')
  }

  if (expense.cancelled_at) {
    throw new Error('لا يمكن تعديل مصروف ملغي')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT cm.*

      FROM cash_movements cm

      WHERE cm.type =
        'expense'

        AND cm.direction =
          'out'

        AND cm.reference_type =
          'expense'

        AND cm.reference_id = ?

      ORDER BY cm.id DESC

      LIMIT 1
      `,
    )
    .get(expenseId) as any

  if (!cashMovement) {
    throw new Error('حركة الخزنة الخاصة بالمصروف غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة الخزنة الخاصة بالمصروف ملغاة بالفعل')
  }

  if (
    Math.abs(Number(cashMovement.amount || 0) - Number(expense.amount || 0)) >
    0.01
  ) {
    throw new Error('قيمة المصروف لا تطابق حركة الخزنة')
  }

  if (
    resolveCashAccount(cashMovement.payment_method) !==
    resolveCashAccount(expense.payment_method)
  ) {
    throw new Error('حساب المصروف لا يطابق حركة الخزنة')
  }

  const category = String(input.category || '').trim() || null

  const notes = String(input.notes || '').trim() || null

  const paymentMethod = resolveCashAccount(
    input.payment_method || expense.payment_method || 'store_cash',
  )

  const openShift = resolveFinancialOperationShift(
    actorId,
    [cashMovement.payment_method, paymentMethod],
    'لا يمكن تعديل مصروف يؤثر على درج المحل بدون شفت مفتوح',
  )

  const correctionBusinessDate = openShift
    ? getShiftBusinessDate(openShift.id)
    : getCurrentBusinessDate(db)

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE expenses

      SET
        title = ?,
        category = ?,
        amount = ?,
        payment_method = ?,
        notes = ?,
        updated_shift_id = ?

      WHERE id = ?
      `,
    ).run(
      title,
      category,
      amount,
      paymentMethod,
      notes,
      openShift?.id ?? null,
      expenseId,
    )

    /*
     * لا نلغي حركة المصروف القديمة.
     * نعكسها في الشفت الحالي.
     */
    const reverse = createCashMovement({
      type: 'expense',

      direction: 'in',

      amount: Number(cashMovement.amount || 0),

      payment_method: cashMovement.payment_method,

      reference_id: expenseId,

      reference_type: 'expense_update_reverse',

      notes: `عكس المصروف القديم بسبب التعديل #${expenseId}`,

      created_by: actorId,

      business_date: correctionBusinessDate,

      shift_id: openShift?.id ?? null,
    })

    const reverseCashMovementId = Number(reverse.lastInsertRowid || 0)

    /*
     * نسجل القيمة الجديدة
     * كحركة مالية جديدة.
     */
    const replacement = createCashMovement({
      type: 'expense',

      direction: 'out',

      amount,

      payment_method: paymentMethod,

      reference_id: expenseId,

      reference_type: 'expense',

      notes: `مصروف: ${title}`,

      created_by: actorId,

      business_date: correctionBusinessDate,

      shift_id: openShift?.id ?? null,
    })

    const newCashMovementId = Number(replacement.lastInsertRowid || 0)

    createActivityLog({
      user_id: actorId,
      approved_by: input.approved_by ?? null,
      action: 'expense_updated',

      entity: 'expenses',

      entity_id: expenseId,

      details: JSON.stringify({
        before: {
          title: expense.title,

          category: expense.category,

          amount: Number(expense.amount || 0),

          payment_method: expense.payment_method,

          notes: expense.notes,

          cash_movement_id: Number(cashMovement.id),
        },

        after: {
          title,

          category,

          amount,

          payment_method: paymentMethod,

          notes,

          cash_movement_id: newCashMovementId,

          reverse_cash_movement_id: reverseCashMovementId,

          shift_id: openShift?.id ?? null,
        },
      }),
    })

    return {
      success: true,

      id: expenseId,

      old_cash_movement_id: Number(cashMovement.id),

      reverse_cash_movement_id: reverseCashMovementId,

      cash_movement_id: newCashMovementId,

      updated_shift_id: openShift?.id ?? null,
    }
  })

  return tx()
}

export function cancelExpense(input: CancelExpenseInput) {
  const db = getDb()

  const expenseId = Number(input.id)

  if (!expenseId) {
    throw new Error('رقم المصروف غير صحيح')
  }

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

  const actorId = Number(input.actor_id || 0)

  if (
    input.can_manage_all !== true &&
    (!actorId || Number(expense.created_by || 0) !== actorId)
  ) {
    throw new Error('غير مصرح لك بإلغاء هذا المصروف')
  }

  if (expense.cancelled_at) {
    throw new Error('المصروف ملغي بالفعل')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT cm.*

      FROM cash_movements cm

      WHERE cm.type =
        'expense'

        AND cm.direction =
          'out'

        AND cm.reference_type =
          'expense'

        AND cm.reference_id = ?

      ORDER BY cm.id DESC

      LIMIT 1
      `,
    )
    .get(expenseId) as any

  if (!cashMovement) {
    throw new Error('حركة الخزنة الخاصة بالمصروف غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة الخزنة الخاصة بالمصروف ملغاة بالفعل')
  }

  const openShift = resolveFinancialOperationShift(
    actorId,
    [cashMovement.payment_method],
    'لا يمكن إلغاء مصروف يؤثر على درج المحل بدون شفت مفتوح',
  )

  const cancellationBusinessDate = openShift
    ? getShiftBusinessDate(openShift.id)
    : getCurrentBusinessDate(db)

  const reason = String(input.reason || '').trim() || 'إلغاء مصروف'

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE expenses

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancelled_shift_id = ?,

        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(actorId, openShift?.id ?? null, reason, expenseId)

    const reverse = createCashMovement({
      type: 'expense',

      direction: 'in',

      amount: Number(cashMovement.amount || 0),

      payment_method: cashMovement.payment_method,

      reference_id: expenseId,

      reference_type: 'expense_cancel',

      notes: `عكس مصروف ملغي #${expenseId}`,

      created_by: actorId,

      business_date: cancellationBusinessDate,

      shift_id: openShift?.id ?? null,
    })

    const reverseCashMovementId = Number(reverse.lastInsertRowid || 0)

    createActivityLog({
      user_id: actorId,
      approved_by: input.approved_by ?? null,
      action: 'expense_cancelled',

      entity: 'expenses',

      entity_id: expenseId,

      details: JSON.stringify({
        title: expense.title,

        amount: expense.amount,

        payment_method: expense.payment_method,

        reason,

        original_cash_movement_id: cashMovement.id,

        reverse_cash_movement_id: reverseCashMovementId,

        shift_id: openShift?.id ?? null,
      }),
    })

    return {
      success: true,

      id: expenseId,

      cancelled_shift_id: openShift?.id ?? null,

      reverse_cash_movement_id: reverseCashMovementId,
    }
  })

  return tx()
}
