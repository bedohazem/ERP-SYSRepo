import { getDb } from '../db'
import { createActivityLog } from './activity.repo'

export type CashMovementInput = {
  type:
    | 'sale'
    | 'sale_return'
    | 'purchase_return'
    | 'customer_payment'
    | 'supplier_payment'
    | 'liability_payment'
    | 'expense'
    | 'withdraw'
    | 'deposit'
    | 'transfer'

  direction: 'in' | 'out'

  amount: number

  payment_method?: string

  reference_id?: number | null
  reference_type?: string | null

  notes?: string | null

  created_by?: number | null
  business_date?: string | null
}

export type CashFilterInput = {
  date_from?: string
  date_to?: string
  type?: string
  direction?: 'all' | 'in' | 'out'
  payment_method?: string
  search?: string
  reference_type?: string
  created_by?: number | null
  limit?: number
  offset?: number
}

export type CashAccountKey =
  | 'store_cash'
  | 'owner_cash'
  | 'owner_bank'
  | 'owner_vodafone'
  | 'fawry_machine'

export type CashTransferInput = {
  from_account: string
  to_account: string
  amount: number
  notes?: string | null
  created_by?: number | null
}

export type CashDayCloseInput = {
  business_date: string
  counted_amount: number
  carry_over_amount?: number
  target_account?: string
  closed_by?: number | null
}

export function resolveCashAccount(value?: string | null): CashAccountKey {
  switch (value) {
    case 'store_cash':
    case 'owner_cash':
    case 'owner_bank':
    case 'owner_vodafone':
    case 'fawry_machine':
      return value

    case 'cash':
      return 'store_cash'

    case 'card':
      return 'fawry_machine'

    case 'wallet':
      return 'owner_vodafone'

    case 'bank':
    case 'bank_transfer':
      return 'owner_bank'

    default:
      return 'store_cash'
  }
}

function normalizeLegacyCashMovementAccounts() {
  const db = getDb()

  db.prepare(
    `
    UPDATE cash_movements
    SET payment_method = CASE
      WHEN payment_method IS NULL OR TRIM(payment_method) = '' THEN 'store_cash'
      WHEN payment_method = 'cash' THEN 'store_cash'
      WHEN payment_method = 'card' THEN 'fawry_machine'
      WHEN payment_method = 'wallet' THEN 'owner_vodafone'
      WHEN payment_method IN ('bank', 'bank_transfer') THEN 'owner_bank'
      ELSE payment_method
    END
    WHERE payment_method IS NULL
       OR TRIM(payment_method) = ''
       OR payment_method IN ('cash', 'card', 'wallet', 'bank', 'bank_transfer')
  `,
  ).run()
}

function getAccountBalance(account: string) {
  const db = getDb()
  normalizeLegacyCashMovementAccounts()
  const safeAccount = resolveCashAccount(account)

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_movements
      WHERE payment_method = ?
       AND cancelled_at IS NULL
    `,
    )
    .get(safeAccount) as { total_in: number; total_out: number } | undefined

  return Number(row?.total_in || 0) - Number(row?.total_out || 0)
}

function getAccountLabel(account: CashAccountKey) {
  switch (account) {
    case 'store_cash':
      return 'كاش درج المحل'
    case 'owner_cash':
      return 'كاش مع المالك'
    case 'owner_bank':
      return 'حساب بنك / فيزا المالك'
    case 'owner_vodafone':
      return 'فودافون كاش المالك'
    case 'fawry_machine':
      return 'ماكينة فوري'
    default:
      return account
  }
}

function buildCashWhere(
  input?: CashFilterInput,
  options?: {
    activeOnly?: boolean
  },
) {
  const where: string[] = options?.activeOnly ? [`cm.cancelled_at IS NULL`] : []
  const params: any[] = []

  if (input?.date_from) {
    where.push(`
      COALESCE(
        NULLIF(cm.business_date, ''),
        date(cm.created_at, 'localtime')
      ) >= ?
    `)

    params.push(input.date_from)
  }

  if (input?.date_to) {
    where.push(`
      COALESCE(
        NULLIF(cm.business_date, ''),
        date(cm.created_at, 'localtime')
      ) <= ?
    `)

    params.push(input.date_to)
  }

  if (input?.type && input.type !== 'all') {
    where.push(`cm.type = ?`)
    params.push(input.type)
  }

  if (input?.direction && input.direction !== 'all') {
    where.push(`cm.direction = ?`)
    params.push(input.direction)
  }

  if (input?.payment_method && input.payment_method !== 'all') {
    where.push(`cm.payment_method = ?`)
    params.push(resolveCashAccount(input.payment_method))
  }

  if (input?.reference_type && input.reference_type !== 'all') {
    where.push(`cm.reference_type = ?`)
    params.push(input.reference_type)
  }

  if (input?.created_by) {
    where.push(`cm.created_by = ?`)
    params.push(Number(input.created_by))
  }

  if (input?.search?.trim()) {
    where.push(`(
      cm.notes LIKE ?
      OR cm.type LIKE ?
      OR cm.payment_method LIKE ?
      OR u.name LIKE ?
      OR u.username LIKE ?
    )`)

    const search = `%${input.search.trim()}%`
    params.push(search, search, search, search, search)
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  }
}

export function createCashMovement(input: CashMovementInput) {
  const db = getDb()

  const amount = Number(input.amount || 0)
  const type = String(input.type || '').trim()
  const direction = input.direction
  const account = resolveCashAccount(input.payment_method || 'store_cash')

  const businessDate = input.business_date
    ? normalizeBusinessDate(input.business_date)
    : null

  if (!type) {
    throw new Error('نوع حركة الخزنة مطلوب')
  }

  if (direction !== 'in' && direction !== 'out') {
    throw new Error('اتجاه حركة الخزنة غير صحيح')
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ حركة الخزنة غير صحيح')
  }

  if (direction === 'out') {
    const currentBalance = getAccountBalance(account)

    if (amount > currentBalance) {
      throw new Error(
        `لا يمكن إتمام العملية: رصيد ${getAccountLabel(account)} غير كافٍ. الرصيد الحالي ${currentBalance.toFixed(2)} ج.م والمطلوب ${amount.toFixed(2)} ج.م`,
      )
    }
  }

  const result = db
    .prepare(
      `
      INSERT INTO cash_movements (
        type,
        amount,
        direction,
        payment_method,
        reference_id,
        reference_type,
        notes,
        created_by,
        business_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      type,
      amount,
      direction,
      account,
      input.reference_id ?? null,
      input.reference_type ?? null,
      input.notes ?? null,
      input.created_by ?? null,
      businessDate,
    )

  const movementId = Number(result.lastInsertRowid)

  createActivityLog({
    user_id: input.created_by ?? null,
    action: direction === 'in' ? 'cash_in' : 'cash_out',
    entity: 'cash_movements',
    entity_id: movementId,
    details: JSON.stringify({
      type,
      amount,
      direction,
      payment_method: account,
      notes: input.notes ?? null,
      business_date: businessDate,
    }),
  })

  return result
}

export function getCashSummary(input?: CashFilterInput) {
  const db = getDb()
  normalizeLegacyCashMovementAccounts()
  const { whereSql, params } = buildCashWhere(input, {
    activeOnly: true,
  })

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(CASE WHEN cm.direction = 'in' THEN cm.amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN cm.direction = 'out' THEN cm.amount ELSE 0 END), 0) AS total_out,
        COUNT(*) AS movements_count
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
    `,
    )
    .get(...params) as {
    total_in: number
    total_out: number
    movements_count: number
  }

  return {
    total_in: Number(row.total_in || 0),
    total_out: Number(row.total_out || 0),
    balance: Number(row.total_in || 0) - Number(row.total_out || 0),
    movements_count: Number(row.movements_count || 0),
  }
}

export function listCashMovements(input?: CashFilterInput) {
  const db = getDb()

  normalizeLegacyCashMovementAccounts()

  const { whereSql, params } = buildCashWhere(input)

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const rows = db
    .prepare(
      `
      SELECT
        cm.*,
        u.name AS created_by_name
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
      ORDER BY cm.id DESC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM cash_movements cm
      LEFT JOIN users u ON u.id = cm.created_by
      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}

export function createCashTransfer(input: CashTransferInput) {
  const db = getDb()
  normalizeLegacyCashMovementAccounts()

  const amount = Number(input.amount || 0)
  const fromAccount = resolveCashAccount(input.from_account)
  const toAccount = resolveCashAccount(input.to_account)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ التحويل غير صحيح')
  }

  if (fromAccount === toAccount) {
    throw new Error('لا يمكن التحويل لنفس الحساب')
  }

  const fromBalance = getAccountBalance(fromAccount)

  if (amount > fromBalance) {
    throw new Error('المبلغ المسحوب أكبر من رصيد الحساب')
  }

  const tx = db.transaction(() => {
    const outResult = createCashMovement({
      type: 'transfer',
      direction: 'out',
      amount,
      payment_method: fromAccount,
      reference_id: null,
      reference_type: 'cash_transfer',
      notes: input.notes || `تحويل من ${fromAccount} إلى ${toAccount}`,
      created_by: input.created_by ?? null,
    })

    const inResult = createCashMovement({
      type: 'transfer',
      direction: 'in',
      amount,
      payment_method: toAccount,
      reference_id: Number(outResult.lastInsertRowid || 0),
      reference_type: 'cash_transfer',
      notes: input.notes || `تحويل من ${fromAccount} إلى ${toAccount}`,
      created_by: input.created_by ?? null,
    })

    return {
      ok: true,
      from_account: fromAccount,
      to_account: toAccount,
      amount,
      out_id: Number(outResult.lastInsertRowid || 0),
      in_id: Number(inResult.lastInsertRowid || 0),
    }
  })

  return tx()
}

function roundMoney(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function normalizeBusinessDate(value?: string | null) {
  const businessDate = String(value || '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error('تاريخ تقفيل اليوم غير صحيح')
  }

  return businessDate
}

export function getCashDayClosePreview(businessDateInput: string) {
  const db = getDb()

  normalizeLegacyCashMovementAccounts()

  const businessDate = normalizeBusinessDate(businessDateInput)

  const existingClosing = db
    .prepare(
      `
      SELECT
        c.*,
        u.name AS closed_by_name
      FROM cash_day_closings c
      LEFT JOIN users u ON u.id = c.closed_by
      WHERE c.business_date = ?
      LIMIT 1
    `,
    )
    .get(businessDate) as any

  if (existingClosing) {
    return {
      business_date: businessDate,
      already_closed: true,
      closing: existingClosing,

      opening_drawer_balance: Number(
        existingClosing.opening_drawer_balance || 0,
      ),

      day_cash_in: Number(existingClosing.day_cash_in || 0),

      day_cash_out: Number(existingClosing.day_cash_out || 0),

      system_closing_balance: Number(
        existingClosing.system_closing_balance || 0,
      ),

      breakdown: [],
    }
  }

  const openingRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN direction = 'in' THEN amount
              WHEN direction = 'out' THEN -amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM cash_movements
      WHERE payment_method = 'store_cash'
      AND cancelled_at IS NULL
        AND COALESCE(
          NULLIF(business_date, ''),
          date(created_at, 'localtime')
        ) < ?
    `,
    )
    .get(businessDate) as { balance: number } | undefined

  const todayRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN direction = 'in' THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_in,

        IFNULL(
          SUM(
            CASE
              WHEN direction = 'out' THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_out

      FROM cash_movements

      WHERE payment_method = 'store_cash'
      AND cancelled_at IS NULL
        AND COALESCE(
          NULLIF(business_date, ''),
          date(created_at, 'localtime')
        ) = ?
    `,
    )
    .get(businessDate) as
    | {
        total_in: number
        total_out: number
      }
    | undefined

  const breakdown = db
    .prepare(
      `
      SELECT
        type,
        direction,
        IFNULL(SUM(amount), 0) AS total

      FROM cash_movements

      WHERE payment_method = 'store_cash'
      AND cancelled_at IS NULL
        AND COALESCE(
          NULLIF(business_date, ''),
          date(created_at, 'localtime')
        ) = ?

      GROUP BY type, direction

      ORDER BY type ASC
    `,
    )
    .all(businessDate)
    .map((row: any) => ({
      type: row.type,
      direction: row.direction,
      total: Number(row.total || 0),
    }))

  const openingDrawerBalance = roundMoney(Number(openingRow?.balance || 0))

  const dayCashIn = roundMoney(Number(todayRow?.total_in || 0))

  const dayCashOut = roundMoney(Number(todayRow?.total_out || 0))

  const systemClosingBalance = roundMoney(
    openingDrawerBalance + dayCashIn - dayCashOut,
  )

  return {
    business_date: businessDate,
    already_closed: false,
    closing: null,

    opening_drawer_balance: openingDrawerBalance,
    day_cash_in: dayCashIn,
    day_cash_out: dayCashOut,
    system_closing_balance: systemClosingBalance,

    breakdown,
  }
}

export function closeCashDay(input: CashDayCloseInput) {
  const db = getDb()

  const businessDate = normalizeBusinessDate(input.business_date)

  const countedAmount = roundMoney(Number(input.counted_amount || 0))

  const carryOverAmount = roundMoney(Number(input.carry_over_amount || 0))

  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw new Error('قيمة الجرد الفعلي غير صحيحة')
  }

  if (!Number.isFinite(carryOverAmount) || carryOverAmount < 0) {
    throw new Error('المبلغ المتبقي في الدرج غير صحيح')
  }

  const targetAccount = resolveCashAccount(input.target_account || 'owner_cash')

  if (!['owner_cash', 'owner_bank', 'owner_vodafone'].includes(targetAccount)) {
    throw new Error('حساب تحويل تقفيل اليوم غير صحيح')
  }

  const tx = db.transaction(() => {
    const preview = getCashDayClosePreview(businessDate)

    if (preview.already_closed) {
      throw new Error(`تم تقفيل يوم ${businessDate} بالفعل`)
    }

    const systemClosingBalance = roundMoney(
      Number(preview.system_closing_balance || 0),
    )

    const difference = roundMoney(countedAmount - systemClosingBalance)

    if (Math.abs(difference) > 0.01) {
      throw new Error(
        `يوجد فرق في جرد الدرج. رصيد النظام ${systemClosingBalance.toFixed(
          2,
        )} ج.م والجرد الفعلي ${countedAmount.toFixed(
          2,
        )} ج.م والفرق ${difference.toFixed(2)} ج.م`,
      )
    }

    if (carryOverAmount > countedAmount) {
      throw new Error('المبلغ المتبقي لليوم التالي أكبر من رصيد الدرج')
    }

    const transferAmount = roundMoney(countedAmount - carryOverAmount)

    const closingResult = db
      .prepare(
        `
        INSERT INTO cash_day_closings (
          business_date,
          opening_drawer_balance,
          day_cash_in,
          day_cash_out,
          system_closing_balance,
          counted_closing_balance,
          difference,
          carry_over_amount,
          transfer_amount,
          target_account,
          closed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        businessDate,
        Number(preview.opening_drawer_balance || 0),
        Number(preview.day_cash_in || 0),
        Number(preview.day_cash_out || 0),
        systemClosingBalance,
        countedAmount,
        difference,
        carryOverAmount,
        transferAmount,
        transferAmount > 0 ? targetAccount : null,
        input.closed_by ?? null,
      )

    const closingId = Number(closingResult.lastInsertRowid)

    if (transferAmount > 0) {
      const note =
        `تقفيل يوم ${businessDate} - ` +
        `تحويل ${transferAmount.toFixed(2)} ج.م - ` +
        `المتبقي في الدرج ${carryOverAmount.toFixed(2)} ج.م`

      createCashMovement({
        type: 'transfer',
        direction: 'out',
        amount: transferAmount,
        payment_method: 'store_cash',
        reference_id: closingId,
        reference_type: 'day_close',
        notes: note,
        created_by: input.closed_by ?? null,
        business_date: businessDate,
      })

      createCashMovement({
        type: 'transfer',
        direction: 'in',
        amount: transferAmount,
        payment_method: targetAccount,
        reference_id: closingId,
        reference_type: 'day_close',
        notes: note,
        created_by: input.closed_by ?? null,
        business_date: businessDate,
      })
    }

    createActivityLog({
      user_id: input.closed_by ?? null,
      action: 'cash_day_closed',
      entity: 'cash_day_closings',
      entity_id: closingId,
      details: JSON.stringify({
        business_date: businessDate,
        opening_drawer_balance: preview.opening_drawer_balance,
        day_cash_in: preview.day_cash_in,
        day_cash_out: preview.day_cash_out,
        system_closing_balance: systemClosingBalance,
        counted_closing_balance: countedAmount,
        difference,
        carry_over_amount: carryOverAmount,
        transfer_amount: transferAmount,
        target_account: transferAmount > 0 ? targetAccount : null,
      }),
    })

    return {
      ok: true,
      closing_id: closingId,
      business_date: businessDate,

      opening_drawer_balance: Number(preview.opening_drawer_balance || 0),

      day_cash_in: Number(preview.day_cash_in || 0),

      day_cash_out: Number(preview.day_cash_out || 0),

      system_closing_balance: systemClosingBalance,
      counted_closing_balance: countedAmount,
      difference,
      carry_over_amount: carryOverAmount,
      transfer_amount: transferAmount,

      target_account: transferAmount > 0 ? targetAccount : null,
    }
  })

  return tx()
}

function getCashDayClosingMutationContext(closingId: number) {
  const db = getDb()

  if (!closingId) {
    throw new Error('رقم تقفيل اليوم غير صحيح')
  }

  const closing = db
    .prepare(
      `
      SELECT *

      FROM cash_day_closings

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(closingId) as any

  if (!closing) {
    throw new Error('تقفيل اليوم غير موجود')
  }

  const latestClosing = db
    .prepare(
      `
      SELECT
        id,
        business_date

      FROM cash_day_closings

      ORDER BY
        business_date DESC,
        id DESC

      LIMIT 1
      `,
    )
    .get() as
    | {
        id: number
        business_date: string
      }
    | undefined

  if (Number(latestClosing?.id || 0) !== closingId) {
    throw new Error(
      'لا يمكن تعديل أو إلغاء هذا التقفيل قبل إلغاء التقفيلات الأحدث',
    )
  }

  const movements = db
    .prepare(
      `
      SELECT *

      FROM cash_movements

      WHERE reference_type = 'day_close'
        AND reference_id = ?
        AND cancelled_at IS NULL

      ORDER BY id ASC
      `,
    )
    .all(closingId) as any[]

  const transferAmount = roundMoney(Number(closing.transfer_amount || 0))

  if (transferAmount > 0) {
    const outMovement = movements.find(
      (movement) =>
        movement.direction === 'out' &&
        resolveCashAccount(movement.payment_method) === 'store_cash',
    )

    const inMovement = movements.find((movement) => movement.direction === 'in')

    if (!outMovement || !inMovement) {
      throw new Error('حركات تحويل تقفيل اليوم غير مكتملة')
    }

    if (
      Math.abs(Number(outMovement.amount || 0) - transferAmount) > 0.01 ||
      Math.abs(Number(inMovement.amount || 0) - transferAmount) > 0.01
    ) {
      throw new Error('قيمة تحويل تقفيل اليوم غير متطابقة')
    }

    const destinationBalance = getAccountBalance(inMovement.payment_method)

    if (destinationBalance + 0.0001 < transferAmount) {
      throw new Error(
        `لا يمكن تعديل أو إلغاء التقفيل لأن رصيد ${getAccountLabel(
          resolveCashAccount(inMovement.payment_method),
        )} لا يكفي لعكس تحويل التقفيل`,
      )
    }
  } else if (movements.length > 0) {
    throw new Error('بيانات تحويل تقفيل اليوم غير متطابقة')
  }

  return {
    db,
    closing,
    movements,
  }
}

function cancelDayCloseMovements(
  movements: any[],
  actorId: number | null,
  reason: string,
) {
  const db = getDb()

  const cancelMovement = db.prepare(
    `
    UPDATE cash_movements

    SET
      cancelled_at =
        CURRENT_TIMESTAMP,

      cancelled_by = ?,

      cancel_reason = ?

    WHERE id = ?
      AND cancelled_at IS NULL
    `,
  )

  for (const movement of movements) {
    cancelMovement.run(actorId, reason, Number(movement.id))
  }
}

export function cancelCashDayClosing(input: {
  closing_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const closingId = Number(input.closing_id || 0)

  const reason = String(input.reason || '').trim() || 'إلغاء تقفيل يوم'

  const tx = db.transaction(() => {
    const { closing, movements } = getCashDayClosingMutationContext(closingId)

    const businessDate = String(closing.business_date || '')

    cancelDayCloseMovements(movements, input.actor_id ?? null, reason)

    /*
      نحذف سجل التقفيل النشط حتى يصبح
      اليوم مفتوحًا ويمكن تقفيله مرة أخرى.

      تفاصيل التقفيل القديمة محفوظة
      في Activity Log وحركات التحويل
      القديمة تظل موجودة بحالة ملغاة.
    */
    db.prepare(
      `
      DELETE FROM cash_day_closings

      WHERE id = ?
      `,
    ).run(closingId)

    createActivityLog({
      user_id: input.actor_id ?? null,

      action: 'cash_day_close_cancelled',

      entity: 'cash_day_closings',

      entity_id: closingId,

      details: JSON.stringify({
        business_date: businessDate,

        opening_drawer_balance: Number(closing.opening_drawer_balance || 0),

        day_cash_in: Number(closing.day_cash_in || 0),

        day_cash_out: Number(closing.day_cash_out || 0),

        system_closing_balance: Number(closing.system_closing_balance || 0),

        counted_closing_balance: Number(closing.counted_closing_balance || 0),

        carry_over_amount: Number(closing.carry_over_amount || 0),

        transfer_amount: Number(closing.transfer_amount || 0),

        target_account: closing.target_account ?? null,

        reason,
      }),
    })

    return {
      success: true,

      closing_id: closingId,

      business_date: businessDate,
    }
  })

  return tx()
}

export function updateCashDayClosing(input: {
  closing_id: number
  carry_over_amount: number
  target_account?: string
  actor_id?: number | null
}) {
  const db = getDb()

  const closingId = Number(input.closing_id || 0)

  const carryOverAmount = roundMoney(Number(input.carry_over_amount || 0))

  if (!Number.isFinite(carryOverAmount) || carryOverAmount < 0) {
    throw new Error('المبلغ المتبقي في الدرج غير صحيح')
  }

  const targetAccount = resolveCashAccount(input.target_account || 'owner_cash')

  if (!['owner_cash', 'owner_bank', 'owner_vodafone'].includes(targetAccount)) {
    throw new Error('حساب تحويل تقفيل اليوم غير صحيح')
  }

  const tx = db.transaction(() => {
    const { closing, movements } = getCashDayClosingMutationContext(closingId)

    const countedAmount = roundMoney(
      Number(closing.counted_closing_balance || 0),
    )

    if (carryOverAmount > countedAmount) {
      throw new Error('المبلغ المتبقي لليوم التالي أكبر من رصيد الدرج')
    }

    const newTransferAmount = roundMoney(countedAmount - carryOverAmount)

    const businessDate = String(closing.business_date || '')

    const oldCarryOver = Number(closing.carry_over_amount || 0)

    const oldTransferAmount = Number(closing.transfer_amount || 0)

    const oldTargetAccount = closing.target_account ?? null

    cancelDayCloseMovements(
      movements,
      input.actor_id ?? null,
      `تم تعديل تقفيل يوم ${businessDate}`,
    )

    db.prepare(
      `
      UPDATE cash_day_closings

      SET
        carry_over_amount = ?,

        transfer_amount = ?,

        target_account = ?

      WHERE id = ?
      `,
    ).run(
      carryOverAmount,

      newTransferAmount,

      newTransferAmount > 0 ? targetAccount : null,

      closingId,
    )

    if (newTransferAmount > 0) {
      const note =
        `تقفيل يوم ${businessDate} - ` +
        `تحويل ${newTransferAmount.toFixed(2)} ج.م - ` +
        `المتبقي في الدرج ${carryOverAmount.toFixed(2)} ج.م`

      createCashMovement({
        type: 'transfer',

        direction: 'out',

        amount: newTransferAmount,

        payment_method: 'store_cash',

        reference_id: closingId,

        reference_type: 'day_close',

        notes: note,

        created_by: input.actor_id ?? null,

        business_date: businessDate,
      })

      createCashMovement({
        type: 'transfer',

        direction: 'in',

        amount: newTransferAmount,

        payment_method: targetAccount,

        reference_id: closingId,

        reference_type: 'day_close',

        notes: note,

        created_by: input.actor_id ?? null,

        business_date: businessDate,
      })
    }

    createActivityLog({
      user_id: input.actor_id ?? null,

      action: 'cash_day_close_updated',

      entity: 'cash_day_closings',

      entity_id: closingId,

      details: JSON.stringify({
        business_date: businessDate,

        before: {
          carry_over_amount: oldCarryOver,

          transfer_amount: oldTransferAmount,

          target_account: oldTargetAccount,
        },

        after: {
          carry_over_amount: carryOverAmount,

          transfer_amount: newTransferAmount,

          target_account: newTransferAmount > 0 ? targetAccount : null,
        },
      }),
    })

    return {
      success: true,

      closing_id: closingId,

      business_date: businessDate,

      counted_closing_balance: countedAmount,

      carry_over_amount: carryOverAmount,

      transfer_amount: newTransferAmount,

      target_account: newTransferAmount > 0 ? targetAccount : null,
    }
  })

  return tx()
}

export function cancelCashMovement(input: {
  id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  normalizeLegacyCashMovementAccounts()

  const movementId = Number(input.id)

  const movement = db
    .prepare(
      `
      SELECT
        cm.*,
        COALESCE(
          NULLIF(cm.business_date, ''),
          date(cm.created_at, 'localtime')
        ) AS accounting_date
      FROM cash_movements cm
      WHERE cm.id = ?
      LIMIT 1
      `,
    )
    .get(movementId) as any

  if (!movement) {
    throw new Error('حركة الخزنة غير موجودة')
  }

  if (movement.cancelled_at) {
    throw new Error('حركة الخزنة ملغاة بالفعل')
  }

  const isManual =
    movement.reference_type === 'manual' &&
    (movement.type === 'deposit' || movement.type === 'withdraw')

  const isTransfer =
    movement.type === 'transfer' && movement.reference_type === 'cash_transfer'

  if (!isManual && !isTransfer) {
    throw new Error('هذه الحركة مرتبطة بعملية أخرى ويجب إلغاؤها من مصدرها')
  }

  const reason = String(input.reason || '').trim() || 'إلغاء حركة خزنة'

  function ensureOpenDate(row: any) {
    const accountingDate = String(row.accounting_date || '')

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
        `لا يمكن إلغاء حركة تخص يوم ${accountingDate} لأنه تم تقفيله`,
      )
    }
  }

  if (isManual) {
    ensureOpenDate(movement)

    if (movement.direction === 'in') {
      const currentBalance = getAccountBalance(movement.payment_method)

      if (currentBalance + 0.0001 < Number(movement.amount || 0)) {
        throw new Error(
          'لا يمكن إلغاء الإيداع لأن الرصيد الحالي لا يكفي لعكس الحركة',
        )
      }
    }

    const tx = db.transaction(() => {
      db.prepare(
        `
        UPDATE cash_movements
        SET
          cancelled_at = CURRENT_TIMESTAMP,
          cancelled_by = ?,
          cancel_reason = ?
        WHERE id = ?
        `,
      ).run(input.actor_id ?? null, reason, movement.id)

      createActivityLog({
        user_id: input.actor_id ?? null,
        action: 'cash_movement_cancelled',
        entity: 'cash_movements',
        entity_id: movement.id,
        details: JSON.stringify({
          type: movement.type,
          direction: movement.direction,
          amount: movement.amount,
          payment_method: movement.payment_method,
          reason,
        }),
      })

      return {
        success: true,
        cancelled_ids: [movement.id],
      }
    })

    return tx()
  }

  const outId =
    movement.direction === 'in'
      ? Number(movement.reference_id || 0)
      : Number(movement.id)

  const outMovement = db
    .prepare(
      `
      SELECT
        cm.*,
        COALESCE(
          NULLIF(cm.business_date, ''),
          date(cm.created_at, 'localtime')
        ) AS accounting_date
      FROM cash_movements cm
      WHERE cm.id = ?
        AND cm.type = 'transfer'
        AND cm.direction = 'out'
        AND cm.reference_type = 'cash_transfer'
      LIMIT 1
      `,
    )
    .get(outId) as any

  const inMovement = db
    .prepare(
      `
      SELECT
        cm.*,
        COALESCE(
          NULLIF(cm.business_date, ''),
          date(cm.created_at, 'localtime')
        ) AS accounting_date
      FROM cash_movements cm
      WHERE cm.type = 'transfer'
        AND cm.direction = 'in'
        AND cm.reference_type = 'cash_transfer'
        AND cm.reference_id = ?
      ORDER BY cm.id ASC
      LIMIT 1
      `,
    )
    .get(outId) as any

  if (!outMovement || !inMovement) {
    throw new Error('تعذر العثور على طرفي التحويل')
  }

  if (outMovement.cancelled_at || inMovement.cancelled_at) {
    throw new Error('التحويل ملغي بالفعل')
  }

  ensureOpenDate(outMovement)
  ensureOpenDate(inMovement)

  const destinationBalance = getAccountBalance(inMovement.payment_method)

  if (destinationBalance + 0.0001 < Number(inMovement.amount || 0)) {
    throw new Error(
      'لا يمكن إلغاء التحويل لأن رصيد الحساب المستلم لا يكفي لعكسه',
    )
  }

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE cash_movements
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?
      WHERE id IN (?, ?)
      `,
    ).run(input.actor_id ?? null, reason, outMovement.id, inMovement.id)

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'cash_transfer_cancelled',
      entity: 'cash_movements',
      entity_id: outMovement.id,
      details: JSON.stringify({
        out_id: outMovement.id,
        in_id: inMovement.id,
        amount: outMovement.amount,
        from_account: outMovement.payment_method,
        to_account: inMovement.payment_method,
        reason,
      }),
    })

    return {
      success: true,
      cancelled_ids: [outMovement.id, inMovement.id],
    }
  })

  return tx()
}
