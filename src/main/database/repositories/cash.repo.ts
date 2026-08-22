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

function buildCashWhere(input?: CashFilterInput) {
  const where: string[] = []
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
  const { whereSql, params } = buildCashWhere(input)

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
