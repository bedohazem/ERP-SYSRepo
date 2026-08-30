import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'
import { createActivityLog } from './activity.repo'

export type CreateLiabilityInput = {
  party_name: string
  title: string
  category?: string | null
  total_amount: number
  paid_amount?: number
  payment_method?: string
  due_date?: string | null
  notes?: string | null
  actor_id?: number | null
}

export type RecordLiabilityPaymentInput = {
  liability_id: number
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}

export type UpdateLiabilityInput = {
  id: number
  party_name: string
  title: string
  category?: string | null
  total_amount: number
  due_date?: string | null
  notes?: string | null
  actor_id?: number | null
}

export type UpdateLiabilityPaymentInput = {
  payment_id: number
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function getLiabilityByIdOrThrow(id: number) {
  const db = getDb()

  const row = db
    .prepare(`SELECT * FROM store_liabilities WHERE id = ? LIMIT 1`)
    .get(id) as any

  if (!row) {
    throw new Error('الالتزام غير موجود')
  }

  return row
}

function getStatus(remaining: number) {
  return remaining <= 0 ? 'paid' : 'open'
}

function roundMoney(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100
}

export function createLiability(input: CreateLiabilityInput) {
  const db = getDb()

  const partyName = cleanText(input.party_name)
  const title = cleanText(input.title)
  const totalAmount = Number(input.total_amount || 0)
  const initialPaid = Math.min(
    Math.max(Number(input.paid_amount || 0), 0),
    totalAmount,
  )

  if (!partyName) {
    throw new Error('اسم الشخص أو الجهة مطلوب')
  }

  if (!title) {
    throw new Error('عنوان الالتزام مطلوب')
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('قيمة الالتزام غير صحيحة')
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO store_liabilities (
          party_name,
          title,
          category,
          total_amount,
          paid_amount,
          remaining_amount,
          status,
          due_date,
          notes,
          created_by,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      )
      .run(
        partyName,
        title,
        cleanText(input.category) || null,
        totalAmount,
        0,
        totalAmount,
        'open',
        input.due_date || null,
        cleanText(input.notes) || null,
        input.actor_id ?? null,
      )

    const liabilityId = Number(result.lastInsertRowid)

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'liability_created',
      entity: 'store_liabilities',
      entity_id: liabilityId,
      details: JSON.stringify({
        party_name: partyName,
        title,
        total_amount: totalAmount,
        initial_paid: initialPaid,
        remaining_amount: totalAmount,
      }),
    })

    if (initialPaid > 0) {
      recordLiabilityPayment({
        liability_id: liabilityId,
        amount: initialPaid,
        payment_method: input.payment_method || 'cash',
        notes: 'دفعة مبدئية عند إنشاء الالتزام',
        actor_id: input.actor_id ?? null,
      })
    }

    const liability = getLiabilityByIdOrThrow(liabilityId)

    return {
      success: true,
      liability_id: liabilityId,
      liability,
    }
  })

  return tx()
}

export function recordLiabilityPayment(input: RecordLiabilityPaymentInput) {
  const db = getDb()

  const liability = getLiabilityByIdOrThrow(Number(input.liability_id))
  const amount = Number(input.amount || 0)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح')
  }

  if (liability.status === 'cancelled') {
    throw new Error('لا يمكن تسجيل دفعة على التزام ملغي')
  }

  const remainingBefore = Number(liability.remaining_amount || 0)

  if (amount > remainingBefore) {
    throw new Error('مبلغ الدفعة أكبر من المتبقي')
  }

  const tx = db.transaction(() => {
    const paymentResult = db
      .prepare(
        `
        INSERT INTO store_liability_payments (
          liability_id,
          amount,
          payment_method,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(
        liability.id,
        amount,
        input.payment_method || 'cash',
        cleanText(input.notes) || null,
        input.actor_id ?? null,
      )

    const paymentId = Number(paymentResult.lastInsertRowid)

    const nextPaid = Number(liability.paid_amount || 0) + amount
    const nextRemaining = Math.max(
      0,
      Number(liability.total_amount || 0) - nextPaid,
    )
    const nextStatus = getStatus(nextRemaining)

    db.prepare(
      `
      UPDATE store_liabilities
      SET
        paid_amount = ?,
        remaining_amount = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(nextPaid, nextRemaining, nextStatus, liability.id)

    createCashMovement({
      type: 'liability_payment',
      direction: 'out',
      amount,
      payment_method: input.payment_method || 'cash',
      reference_id: paymentId,
      reference_type: 'store_liability_payment',
      notes: `سداد التزام: ${liability.title} - ${liability.party_name}`,
      created_by: input.actor_id ?? null,
    })

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'liability_payment_created',
      entity: 'store_liability_payments',
      entity_id: paymentId,
      details: JSON.stringify({
        liability_id: liability.id,
        title: liability.title,
        party_name: liability.party_name,
        amount,
        remaining_after: nextRemaining,
      }),
    })

    return {
      success: true,
      payment_id: paymentId,
      liability_id: liability.id,
      paid_amount: nextPaid,
      remaining_amount: nextRemaining,
      status: nextStatus,
    }
  })

  return tx()
}

export function listLiabilities(input?: { search?: string; status?: string }) {
  const db = getDb()

  const where: string[] = []
  const params: any[] = []

  if (input?.status && input.status !== 'all') {
    where.push(`l.status = ?`)
    params.push(input.status)
  }

  if (input?.search?.trim()) {
    where.push(`(
      l.party_name LIKE ?
      OR l.title LIKE ?
      OR l.category LIKE ?
      OR l.notes LIKE ?
    )`)

    const search = `%${input.search.trim()}%`
    params.push(search, search, search, search)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  return db
    .prepare(
      `
      SELECT
        l.*,
        u.name AS created_by_name,
        (
          SELECT COUNT(*)
          FROM store_liability_payments p
          WHERE p.liability_id = l.id
            AND p.cancelled_at IS NULL
        ) AS payments_count
      FROM store_liabilities l
      LEFT JOIN users u ON u.id = l.created_by
      ${whereSql}
      ORDER BY l.id DESC
    `,
    )
    .all(...params)
}

export function listLiabilitiesPage(input?: {
  search?: string
  status?: string
  limit?: number
  offset?: number
}) {
  const db = getDb()

  const where: string[] = []
  const params: any[] = []

  if (input?.status && input.status !== 'all') {
    where.push(`l.status = ?`)
    params.push(input.status)
  }

  if (input?.search?.trim()) {
    where.push(`
      (
        l.party_name LIKE ?
        OR l.title LIKE ?
        OR IFNULL(l.category, '') LIKE ?
        OR IFNULL(l.notes, '') LIKE ?
      )
    `)

    const search = `%${input.search.trim()}%`

    params.push(search, search, search, search)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const rows = db
    .prepare(
      `
      SELECT
        l.*,
        u.name AS created_by_name,

        (
          SELECT COUNT(*)
          FROM store_liability_payments p
          WHERE p.liability_id = l.id
            AND p.cancelled_at IS NULL
        ) AS payments_count

      FROM store_liabilities l

      LEFT JOIN users u
        ON u.id = l.created_by

      ${whereSql}

      ORDER BY l.id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM store_liabilities l
      ${whereSql}
    `,
    )
    .get(...params) as {
    total: number
  }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}

export function getLiabilityStatement(liabilityId: number) {
  const db = getDb()
  const liability = getLiabilityByIdOrThrow(liabilityId)

  const payments = db
    .prepare(
      `
      SELECT
        p.*,
        u.name AS created_by_name
      FROM store_liability_payments p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.liability_id = ?
      ORDER BY p.id DESC
    `,
    )
    .all(liabilityId)

  return {
    liability,
    payments,
  }
}

export function updateLiability(input: UpdateLiabilityInput) {
  const db = getDb()

  const liabilityId = Number(input.id || 0)

  if (!liabilityId) {
    throw new Error('رقم الالتزام غير صحيح')
  }

  const liability = getLiabilityByIdOrThrow(liabilityId)

  if (liability.status === 'cancelled' || liability.cancelled_at) {
    throw new Error('لا يمكن تعديل التزام ملغي')
  }

  const partyName = cleanText(input.party_name)

  const title = cleanText(input.title)

  const totalAmount = roundMoney(Number(input.total_amount || 0))

  if (!partyName) {
    throw new Error('اسم الشخص أو الجهة مطلوب')
  }

  if (!title) {
    throw new Error('عنوان الالتزام مطلوب')
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('قيمة الالتزام غير صحيحة')
  }

  const paidRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(amount),
          0
        ) AS paid

      FROM store_liability_payments

      WHERE liability_id = ?
        AND cancelled_at IS NULL
      `,
    )
    .get(liabilityId) as {
    paid: number
  }

  const activePaid = roundMoney(Number(paidRow?.paid || 0))

  if (totalAmount + 0.0001 < activePaid) {
    throw new Error(
      `لا يمكن جعل قيمة الالتزام أقل من إجمالي المدفوع وهو ${activePaid.toFixed(2)} ج.م`,
    )
  }

  const remaining = roundMoney(Math.max(0, totalAmount - activePaid))

  const status = getStatus(remaining)

  const category = cleanText(input.category) || null

  const dueDate = cleanText(input.due_date) || null

  const notes = cleanText(input.notes) || null

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE store_liabilities

      SET
        party_name = ?,
        title = ?,
        category = ?,
        total_amount = ?,
        paid_amount = ?,
        remaining_amount = ?,
        status = ?,
        due_date = ?,
        notes = ?,
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(
      partyName,
      title,
      category,
      totalAmount,
      activePaid,
      remaining,
      status,
      dueDate,
      notes,
      liabilityId,
    )

    createActivityLog({
      user_id: input.actor_id ?? null,

      action: 'liability_updated',

      entity: 'store_liabilities',

      entity_id: liabilityId,

      details: JSON.stringify({
        before: {
          party_name: liability.party_name,

          title: liability.title,

          category: liability.category,

          total_amount: Number(liability.total_amount || 0),

          paid_amount: Number(liability.paid_amount || 0),

          remaining_amount: Number(liability.remaining_amount || 0),

          status: liability.status,

          due_date: liability.due_date,

          notes: liability.notes,
        },

        after: {
          party_name: partyName,

          title,

          category,

          total_amount: totalAmount,

          paid_amount: activePaid,

          remaining_amount: remaining,

          status,

          due_date: dueDate,

          notes,
        },
      }),
    })

    return {
      success: true,

      liability_id: liabilityId,

      total_amount: totalAmount,

      paid_amount: activePaid,

      remaining_amount: remaining,

      status,
    }
  })

  return tx()
}

export function cancelLiability(input: {
  id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()
  const liability = getLiabilityByIdOrThrow(Number(input.id))

  if (Number(liability.paid_amount || 0) > 0) {
    throw new Error('لا يمكن إلغاء التزام عليه دفعات')
  }

  db.prepare(
    `
  UPDATE store_liabilities
  SET
    status = 'cancelled',
    cancelled_at = CURRENT_TIMESTAMP,
    cancelled_by = ?,
    cancel_reason = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  `,
  ).run(
    input.actor_id ?? null,
    String(input.reason || '').trim() || 'إلغاء الالتزام',
    liability.id,
  )

  createActivityLog({
    user_id: input.actor_id ?? null,
    action: 'liability_cancelled',
    entity: 'store_liabilities',
    entity_id: liability.id,
    details: JSON.stringify({
      title: liability.title,
      party_name: liability.party_name,
      total_amount: liability.total_amount,
    }),
  })

  return {
    success: true,
  }
}

export function getLiabilitiesSummary(input?: {
  date_from?: string
  date_to?: string
}) {
  const db = getDb()

  const where: string[] = []
  const params: any[] = []

  if (input?.date_from) {
    where.push(`datetime(p.created_at, 'localtime') >= datetime(?)`)
    params.push(`${input.date_from} 00:00:00`)
  }

  if (input?.date_to) {
    where.push(`datetime(p.created_at, 'localtime') <= datetime(?)`)
    params.push(`${input.date_to} 23:59:59`)
  }

  where.push(`p.cancelled_at IS NULL`)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const paidRow = db
    .prepare(
      `
      SELECT IFNULL(SUM(p.amount), 0) AS paid_total
      FROM store_liability_payments p
      ${whereSql}
    `,
    )
    .get(...params) as any

  const totalsRow = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(total_amount), 0) AS total_liabilities,
        IFNULL(SUM(paid_amount), 0) AS total_paid,
        IFNULL(SUM(remaining_amount), 0) AS total_remaining,
        COUNT(*) AS count,

        SUM(
          CASE
            WHEN status = 'open' THEN 1
            ELSE 0
          END
        ) AS open_count,

        SUM(
          CASE
            WHEN status = 'paid' THEN 1
            ELSE 0
          END
        ) AS paid_count

      FROM store_liabilities
      WHERE status != 'cancelled'
    `,
    )
    .get() as any

  return {
    paid_in_period: Number(paidRow.paid_total || 0),
    total_liabilities: Number(totalsRow.total_liabilities || 0),
    total_paid: Number(totalsRow.total_paid || 0),
    total_remaining: Number(totalsRow.total_remaining || 0),
    count: Number(totalsRow.count || 0),
    open_count: Number(totalsRow.open_count || 0),
    paid_count: Number(totalsRow.paid_count || 0),
  }
}

function getLiabilityPaymentMutationContext(paymentIdInput: number) {
  const db = getDb()

  const paymentId = Number(paymentIdInput || 0)

  if (!paymentId) {
    throw new Error('رقم دفعة الالتزام غير صحيح')
  }

  const payment = db
    .prepare(
      `
      SELECT
        p.*,

        l.total_amount,

        l.status
          AS liability_status,

        l.title
          AS liability_title,

        l.party_name
          AS liability_party_name

      FROM store_liability_payments p

      JOIN store_liabilities l
        ON l.id = p.liability_id

      WHERE p.id = ?

      LIMIT 1
      `,
    )
    .get(paymentId) as any

  if (!payment) {
    throw new Error('دفعة الالتزام غير موجودة')
  }

  if (payment.cancelled_at) {
    throw new Error('الدفعة ملغاة بالفعل')
  }

  if (payment.liability_status === 'cancelled') {
    throw new Error('الالتزام نفسه ملغي')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT
        cm.*,

        COALESCE(
          NULLIF(
            cm.business_date,
            ''
          ),

          date(
            cm.created_at,
            'localtime'
          )
        ) AS accounting_date

      FROM cash_movements cm

      WHERE cm.type =
        'liability_payment'

        AND cm.direction = 'out'

        AND cm.reference_type =
          'store_liability_payment'

        AND cm.reference_id = ?

      ORDER BY cm.id DESC

      LIMIT 1
      `,
    )
    .get(paymentId) as any

  if (!cashMovement) {
    throw new Error('حركة الخزنة الخاصة بدفعة الالتزام غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة الخزنة الخاصة بالدفعة ملغاة بالفعل')
  }

  if (
    Math.abs(
      roundMoney(Number(cashMovement.amount || 0)) -
        roundMoney(Number(payment.amount || 0)),
    ) > 0.01
  ) {
    throw new Error('قيمة دفعة الالتزام لا تطابق حركة الخزنة')
  }

  if (
    resolveCashAccount(cashMovement.payment_method) !==
    resolveCashAccount(payment.payment_method)
  ) {
    throw new Error('حساب دفعة الالتزام لا يطابق حركة الخزنة')
  }

  const accountingDate = String(cashMovement.accounting_date || '')

  const closing = db
    .prepare(
      `
      SELECT id

      FROM cash_day_closings

      WHERE business_date = ?

      LIMIT 1
      `,
    )
    .get(accountingDate)

  if (closing) {
    throw new Error(
      `لا يمكن تعديل أو إلغاء الدفعة لأن يوم ${accountingDate} تم تقفيله`,
    )
  }

  return {
    db,
    paymentId,
    payment,
    cashMovement,
    accountingDate,
  }
}

export function updateLiabilityPayment(input: UpdateLiabilityPaymentInput) {
  const amount = roundMoney(Number(input.amount || 0))

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ الدفعة المعدل غير صحيح')
  }

  const { db, paymentId, payment, cashMovement, accountingDate } =
    getLiabilityPaymentMutationContext(Number(input.payment_id))

  const otherPaidRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(amount),
          0
        ) AS paid

      FROM store_liability_payments

      WHERE liability_id = ?

        AND cancelled_at IS NULL

        AND id != ?
      `,
    )
    .get(payment.liability_id, paymentId) as {
    paid: number
  }

  const otherPaid = roundMoney(Number(otherPaidRow?.paid || 0))

  const maximumAmount = roundMoney(
    Math.max(
      0,

      Number(payment.total_amount || 0) - otherPaid,
    ),
  )

  if (amount > maximumAmount + 0.0001) {
    throw new Error(
      `مبلغ الدفعة المعدل أكبر من المتاح وهو ${maximumAmount.toFixed(2)} ج.م`,
    )
  }

  const paymentMethod = resolveCashAccount(
    input.payment_method || payment.payment_method || 'store_cash',
  )

  const notes =
    input.notes === undefined
      ? (payment.notes ?? null)
      : cleanText(input.notes) || null

  const originalCreatedBy =
    payment.created_by ?? cashMovement.created_by ?? input.actor_id ?? null

  const tx = db.transaction(() => {
    const replacementResult = db
      .prepare(
        `
        INSERT INTO store_liability_payments (
          liability_id,
          amount,
          payment_method,
          notes,
          created_by,
          created_at
        )

        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          COALESCE(
            ?,
            CURRENT_TIMESTAMP
          )
        )
        `,
      )
      .run(
        payment.liability_id,
        amount,
        paymentMethod,
        notes,
        originalCreatedBy,
        payment.created_at ?? null,
      )

    const newPaymentId = Number(replacementResult.lastInsertRowid)

    db.prepare(
      `
      UPDATE store_liability_payments

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason =
          'تم تعديل دفعة الالتزام',

        replacement_payment_id = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, newPaymentId, paymentId)

    db.prepare(
      `
      UPDATE cash_movements

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason =
          'تم تعديل دفعة الالتزام'

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, Number(cashMovement.id))

    const replacementCash = createCashMovement({
      type: 'liability_payment',

      direction: 'out',

      amount,

      payment_method: paymentMethod,

      reference_id: newPaymentId,

      reference_type: 'store_liability_payment',

      notes: `سداد التزام: ${payment.liability_title} - ${payment.liability_party_name}`,

      created_by: originalCreatedBy,

      business_date: accountingDate,
    })

    const newCashMovementId = Number(replacementCash.lastInsertRowid || 0)

    const totals = db
      .prepare(
        `
        SELECT
          IFNULL(
            SUM(amount),
            0
          ) AS paid

        FROM store_liability_payments

        WHERE liability_id = ?
          AND cancelled_at IS NULL
        `,
      )
      .get(payment.liability_id) as {
      paid: number
    }

    const nextPaid = roundMoney(Number(totals?.paid || 0))

    const nextRemaining = roundMoney(
      Math.max(
        0,

        Number(payment.total_amount || 0) - nextPaid,
      ),
    )

    const nextStatus = getStatus(nextRemaining)

    db.prepare(
      `
      UPDATE store_liabilities

      SET
        paid_amount = ?,
        remaining_amount = ?,
        status = ?,
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(nextPaid, nextRemaining, nextStatus, payment.liability_id)

    createActivityLog({
      user_id: input.actor_id ?? null,

      action: 'liability_payment_updated',

      entity: 'store_liability_payments',

      entity_id: paymentId,

      details: JSON.stringify({
        liability_id: payment.liability_id,

        before: {
          payment_id: paymentId,

          amount: Number(payment.amount || 0),

          payment_method: payment.payment_method,

          notes: payment.notes,

          cash_movement_id: Number(cashMovement.id),
        },

        after: {
          payment_id: newPaymentId,

          amount,

          payment_method: paymentMethod,

          notes,

          cash_movement_id: newCashMovementId,
        },
      }),
    })

    return {
      success: true,

      liability_id: Number(payment.liability_id),

      replaced_payment_id: paymentId,

      payment_id: newPaymentId,

      old_amount: roundMoney(Number(payment.amount || 0)),

      new_amount: amount,

      paid_amount: nextPaid,

      remaining_amount: nextRemaining,

      status: nextStatus,

      payment_method: paymentMethod,
    }
  })

  return tx()
}

export function cancelLiabilityPayment(input: {
  payment_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const { db, paymentId, payment, cashMovement } =
    getLiabilityPaymentMutationContext(Number(input.payment_id))

  const reason = String(input.reason || '').trim() || 'إلغاء دفعة التزام'

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE store_liability_payments

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, paymentId)

    db.prepare(
      `
      UPDATE cash_movements

      SET
        cancelled_at =
          CURRENT_TIMESTAMP,

        cancelled_by = ?,

        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, Number(cashMovement.id))

    const totals = db
      .prepare(
        `
        SELECT
          IFNULL(
            SUM(amount),
            0
          ) AS paid

        FROM store_liability_payments

        WHERE liability_id = ?
          AND cancelled_at IS NULL
        `,
      )
      .get(payment.liability_id) as any

    const nextPaid = roundMoney(Number(totals?.paid || 0))

    const nextRemaining = roundMoney(
      Math.max(
        0,

        Number(payment.total_amount || 0) - nextPaid,
      ),
    )

    const nextStatus = getStatus(nextRemaining)

    db.prepare(
      `
      UPDATE store_liabilities

      SET
        paid_amount = ?,
        remaining_amount = ?,
        status = ?,
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(nextPaid, nextRemaining, nextStatus, payment.liability_id)

    createActivityLog({
      user_id: input.actor_id ?? null,

      action: 'liability_payment_cancelled',

      entity: 'store_liability_payments',

      entity_id: paymentId,

      details: JSON.stringify({
        liability_id: payment.liability_id,

        amount: payment.amount,

        cash_movement_id: Number(cashMovement.id),

        reason,
      }),
    })

    return {
      success: true,

      liability_id: payment.liability_id,

      payment_id: paymentId,

      paid_amount: nextPaid,

      remaining_amount: nextRemaining,

      status: nextStatus,
    }
  })

  return tx()
}
