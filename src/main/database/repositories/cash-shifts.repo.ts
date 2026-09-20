import { getDb } from '../db'
import { createActivityLog } from './activity.repo'
import {
  createCashMovement,
  getCashSummary,
  resolveCashAccount,
} from './cash.repo'

export type CashShiftRow = {
  id: number

  status: 'open' | 'closed'

  opened_by: number
  opened_by_name?: string | null
  opened_at: string

  previous_shift_id: number | null

  expected_opening_amount: number | null
  opening_counted_amount: number
  opening_difference: number

  expected_closing_amount: number | null
  closing_counted_amount: number | null
  closing_difference: number | null

  left_for_next_shift: number | null
  safe_transfer_amount: number | null

  closed_by: number | null
  closed_by_name?: string | null
  closed_at: string | null

  close_reason: string | null
}

export type OpenCashShiftInput = {
  opening_counted_amount: number
  opened_by: number
}

export type CloseCashShiftInput = {
  shift_id: number
  closing_counted_amount: number
  left_for_next_shift: number
  closed_by: number
  close_reason?: string | null
}

export type CashShiftDaySummaryInput = {
  business_date: string
  user_id?: number | null
}

export type CashShiftHistoryFilterInput = {
  status?: 'all' | 'open' | 'closed'

  user_id?: number | null

  date_from?: string | null
  date_to?: string | null

  limit?: number
  offset?: number
}

export type CashShiftHistoryRow = CashShiftRow & {
  duration_minutes: number

  cash_in: number
  cash_out: number

  variance_count: number
  pending_variance_count: number
}

export type CashShiftVarianceStatus = 'pending' | 'resolved'

export type CashShiftVarianceResolutionType =
  | 'approved'
  | 'rejected'
  | 'corrected'
  | 'explained'
  | 'other'

export type CashShiftVarianceRow = {
  id: number
  shift_id: number

  stage: 'opening' | 'closing'
  kind: 'shortage' | 'surplus'

  amount: number

  status: CashShiftVarianceStatus

  resolution_type: CashShiftVarianceResolutionType | null

  resolution_notes: string | null

  resolved_by: number | null
  resolved_by_name?: string | null
  resolved_at: string | null

  created_at: string

  shift_status: 'open' | 'closed'

  opened_by: number
  opened_by_name?: string | null

  shift_opened_at: string
  shift_closed_at: string | null
}

export type CashShiftVarianceFilterInput = {
  status?: 'all' | CashShiftVarianceStatus

  user_id?: number | null

  date_from?: string | null
  date_to?: string | null

  limit?: number
  offset?: number
}

export type ResolveCashShiftVarianceInput = {
  variance_id: number

  resolution_type: CashShiftVarianceResolutionType

  resolution_notes: string

  resolved_by: number
  reversal_account?: string | null
  corrected_opening_amount?: number | null
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function normalizeShiftBusinessDate(value?: string | null) {
  const businessDate = String(value || '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error('تاريخ ملخص الشفتات غير صحيح')
  }

  return businessDate
}

function normalizeShiftHistoryDate(value?: string | null) {
  const date = String(value || '').trim()

  if (!date) {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('تاريخ فلتر الشفتات غير صحيح')
  }

  return date
}

function getShiftSelectSql() {
  return `
    SELECT
      cs.*,

      opened_user.name AS opened_by_name,
      closed_user.name AS closed_by_name

    FROM cash_shifts cs

    LEFT JOIN users opened_user
      ON opened_user.id = cs.opened_by

    LEFT JOIN users closed_user
      ON closed_user.id = cs.closed_by
  `
}

function getVarianceSelectSql() {
  return `
    SELECT
      csv.*,

      cs.status
        AS shift_status,

      cs.opened_by,

      cs.opened_at
        AS shift_opened_at,

      cs.closed_at
        AS shift_closed_at,

      opener.name
        AS opened_by_name,

      resolver.name
        AS resolved_by_name

    FROM cash_shift_variances csv

    JOIN cash_shifts cs
      ON cs.id = csv.shift_id

    LEFT JOIN users opener
      ON opener.id = cs.opened_by

    LEFT JOIN users resolver
      ON resolver.id = csv.resolved_by
  `
}

export function getCashShiftById(shiftId: number): CashShiftRow | null {
  const db = getDb()

  const id = Number(shiftId || 0)

  if (!id) {
    return null
  }

  const row = db
    .prepare(
      `
      ${getShiftSelectSql()}

      WHERE cs.id = ?

      LIMIT 1
      `,
    )
    .get(id) as CashShiftRow | undefined

  return row || null
}

export function getOpenCashShift(): CashShiftRow | null {
  const db = getDb()

  const row = db
    .prepare(
      `
      ${getShiftSelectSql()}

      WHERE cs.status = 'open'

      ORDER BY cs.id DESC

      LIMIT 1
      `,
    )
    .get() as CashShiftRow | undefined

  return row || null
}

export function requireOperationalCashShift(
  actorIdInput: number,
  noShiftMessage = 'لا يوجد شفت مفتوح',
): CashShiftRow {
  const db = getDb()

  const actorId = Number(actorIdInput || 0)

  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  const actor = db
    .prepare(
      `
      SELECT
        id,
        role,
        is_active

      FROM users

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(actorId) as
    | {
        id: number
        role: string
        is_active: number
      }
    | undefined

  if (!actor || Number(actor.is_active) !== 1) {
    throw new Error('المستخدم غير موجود أو غير مفعل')
  }

  const shift = getOpenCashShift()

  if (!shift) {
    throw new Error(noShiftMessage)
  }

  /*
   * الكاشير لا يعمل على شفت مستخدم آخر.
   *
   * الأدمن مسموح له بالعمل أثناء الشفت
   * المفتوح لأغراض الإدارة والطوارئ.
   */
  if (actor.role !== 'admin' && Number(shift.opened_by) !== actorId) {
    throw new Error('الشفت المفتوح تابع لمستخدم آخر')
  }

  return shift
}

export function resolveFinancialOperationShift(
  actorIdInput: number,
  paymentMethods: Array<string | null | undefined>,
  noShiftMessage = 'لا يوجد شفت مفتوح',
): CashShiftRow | null {
  const db = getDb()

  const actorId = Number(actorIdInput || 0)

  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  const actor = db
    .prepare(
      `
      SELECT
        id,
        role,
        is_active
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(actorId) as
    | {
        id: number
        role: string
        is_active: number
      }
    | undefined

  if (!actor || Number(actor.is_active) !== 1) {
    throw new Error('المستخدم غير موجود أو غير مفعل')
  }

  const accounts = paymentMethods.length > 0 ? paymentMethods : ['cash']

  const resolvedAccounts = accounts.map((method) =>
    resolveCashAccount(method || 'cash'),
  )

  if (actor.role !== 'admin' && resolvedAccounts.includes('store_safe')) {
    throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط')
  }

  const touchesDrawer = resolvedAccounts.includes('store_cash')

  /*
   * الأدمن يقدر يعمل عملية على
   * حسابات المالك/البنك بدون شفت.
   *
   * لكن أي عملية تمس درج المحل
   * لازم يكون لها شفت.
   *
   * والكاشير أصلًا أي عملية مالية
   * له لازم تكون أثناء شفته.
   */
  if (actor.role === 'admin' && !touchesDrawer) {
    return null
  }

  return requireOperationalCashShift(actorId, noShiftMessage)
}

export function getCashShiftOpeningPreview() {
  const db = getDb()

  const currentOpenShift = getOpenCashShift()

  if (currentOpenShift) {
    return {
      can_open: false,
      open_shift: currentOpenShift,
      previous_shift_id: null,
      expected_opening_amount: null,
    }
  }

  const previousShift = db
    .prepare(
      `
      SELECT
        id,
        left_for_next_shift,
        closed_at

      FROM cash_shifts

      WHERE status = 'closed'

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get() as
    | {
        id: number
        left_for_next_shift: number | null
        closed_at: string | null
      }
    | undefined

  const expectedOpeningAmount =
    previousShift?.left_for_next_shift === null ||
    previousShift?.left_for_next_shift === undefined
      ? null
      : roundMoney(Number(previousShift.left_for_next_shift))

  return {
    can_open: true,

    open_shift: null,

    previous_shift_id: previousShift?.id ?? null,

    expected_opening_amount: expectedOpeningAmount,

    previous_closed_at: previousShift?.closed_at ?? null,
  }
}

export function openCashShift(input: OpenCashShiftInput): CashShiftRow {
  const db = getDb()

  const openedBy = Number(input.opened_by || 0)

  const rawOpeningCountedAmount = Number(input.opening_counted_amount)

  if (!Number.isInteger(openedBy) || openedBy <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  if (
    !Number.isFinite(rawOpeningCountedAmount) ||
    rawOpeningCountedAmount < 0
  ) {
    throw new Error('رصيد افتتاح الشفت غير صحيح')
  }

  const openingCountedAmount = roundMoney(rawOpeningCountedAmount)

  const tx = db.transaction(() => {
    const currentOpenShift = db
      .prepare(
        `
        SELECT
          id,
          opened_by,
          opened_at

        FROM cash_shifts

        WHERE status = 'open'

        LIMIT 1
        `,
      )
      .get() as
      | {
          id: number
          opened_by: number
          opened_at: string
        }
      | undefined

    if (currentOpenShift) {
      throw new Error(`يوجد شفت مفتوح بالفعل رقم ${currentOpenShift.id}`)
    }

    const previousShift = db
      .prepare(
        `
        SELECT
          id,
          left_for_next_shift

        FROM cash_shifts

        WHERE status = 'closed'

        ORDER BY id DESC

        LIMIT 1
        `,
      )
      .get() as
      | {
          id: number
          left_for_next_shift: number | null
        }
      | undefined

    const expectedOpeningAmount =
      previousShift?.left_for_next_shift === null ||
      previousShift?.left_for_next_shift === undefined
        ? null
        : roundMoney(Number(previousShift.left_for_next_shift))

    const openingDifference =
      expectedOpeningAmount === null
        ? 0
        : roundMoney(openingCountedAmount - expectedOpeningAmount)

    const result = db
      .prepare(
        `
        INSERT INTO cash_shifts (
          status,

          opened_by,

          previous_shift_id,

          expected_opening_amount,
          opening_counted_amount,
          opening_difference
        )

        VALUES (
          'open',
          ?,
          ?,
          ?,
          ?,
          ?
        )
        `,
      )
      .run(
        openedBy,

        previousShift?.id ?? null,

        expectedOpeningAmount,

        openingCountedAmount,

        openingDifference,
      )

    const shiftId = Number(result.lastInsertRowid)

    if (expectedOpeningAmount !== null && Math.abs(openingDifference) > 0.01) {
      db.prepare(
        `
        INSERT INTO cash_shift_variances (
          shift_id,
          stage,
          kind,
          amount,
          status
        )

        VALUES (
          ?,
          'opening',
          ?,
          ?,
          'pending'
        )
        `,
      ).run(
        shiftId,

        openingDifference < 0 ? 'shortage' : 'surplus',

        Math.abs(openingDifference),
      )
    }

    const currentDrawerBalance = roundMoney(
      Number(
        getCashSummary({
          payment_method: 'store_cash',
        }).balance,
      ),
    )

    let accountReconciliationAmount = 0
    let openingSafeTransferAmount = 0

    /*
     * أول شفت فقط هو نقطة الانتقال
     * من نظام الخزنة القديم لنظام الشفتات.
     *
     * أي رصيد قديم زائد عن مبلغ افتتاح
     * الشفت لا يختفي من رأس المال،
     * بل ينتقل للخزنة الآمنة.
     */
    if (!previousShift) {
      const legacyDrawerExcess = roundMoney(
        currentDrawerBalance - openingCountedAmount,
      )

      if (legacyDrawerExcess > 0.01) {
        openingSafeTransferAmount = legacyDrawerExcess

        const outResult = createCashMovement({
          type: 'transfer',

          direction: 'out',

          amount: openingSafeTransferAmount,

          payment_method: 'store_cash',

          reference_id: shiftId,

          reference_type: 'cash_shift_safe_transfer',

          notes: `ترحيل الرصيد السابق عند فتح أول شفت #${shiftId} إلى الخزنة الآمنة`,

          created_by: openedBy,
          shift_id: shiftId,
        })

        createCashMovement({
          type: 'transfer',

          direction: 'in',

          amount: openingSafeTransferAmount,

          payment_method: 'store_safe',

          reference_id: Number(outResult.lastInsertRowid || 0),

          reference_type: 'cash_shift_safe_transfer',

          notes: `ترحيل الرصيد السابق عند فتح أول شفت #${shiftId} إلى الخزنة الآمنة`,

          created_by: openedBy,
          shift_id: shiftId,
        })
      } else if (legacyDrawerExcess < -0.01) {
        accountReconciliationAmount = roundMoney(
          openingCountedAmount - currentDrawerBalance,
        )

        createCashMovement({
          type: 'shift_adjustment',

          direction: 'in',

          amount: accountReconciliationAmount,

          payment_method: 'store_cash',

          reference_id: shiftId,

          reference_type: 'cash_shift_opening_reconcile',

          notes: `تسوية رصيد درج المحل عند فتح الشفت #${shiftId}`,

          created_by: openedBy,
          shift_id: shiftId,
        })
      }
    } else {
      /*
       * بعد أول شفت:
       * الرصيد المفروض جاء من تسليم الشفت
       * السابق، وأي اختلاف فعلي يعتبر
       * عجز/زيادة افتتاح.
       */
      accountReconciliationAmount = roundMoney(
        openingCountedAmount - currentDrawerBalance,
      )

      if (Math.abs(accountReconciliationAmount) > 0.01) {
        createCashMovement({
          type: 'shift_adjustment',

          direction: accountReconciliationAmount > 0 ? 'in' : 'out',

          amount: Math.abs(accountReconciliationAmount),

          payment_method: 'store_cash',

          reference_id: shiftId,

          reference_type: 'cash_shift_opening_reconcile',

          notes: `تسوية رصيد درج المحل عند فتح الشفت #${shiftId}`,

          created_by: openedBy,
          shift_id: shiftId,
        })
      }
    }

    createActivityLog({
      user_id: openedBy,

      action: 'cash_shift_opened',

      entity: 'cash_shifts',

      entity_id: shiftId,

      details: JSON.stringify({
        previous_shift_id: previousShift?.id ?? null,

        expected_opening_amount: expectedOpeningAmount,

        opening_counted_amount: openingCountedAmount,

        opening_difference: openingDifference,
        account_reconciliation_amount: accountReconciliationAmount,
        opening_safe_transfer_amount: openingSafeTransferAmount,
      }),
    })

    const shift = getCashShiftById(shiftId)

    if (!shift) {
      throw new Error('تعذر تحميل الشفت بعد فتحه')
    }

    return shift
  })

  return tx()
}

export function getCashShiftExpectedBalance(shiftId: number) {
  const db = getDb()

  const shift = getCashShiftById(shiftId)

  if (!shift) {
    throw new Error('الشفت غير موجود')
  }

  const totals = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN direction = 'in'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_in,

        IFNULL(
          SUM(
            CASE
              WHEN direction = 'out'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS total_out

      FROM cash_movements

      WHERE shift_id = ?
        AND payment_method = 'store_cash'
        AND cancelled_at IS NULL

        AND type != 'shift_adjustment'

        AND IFNULL(
          reference_type,
          ''
        ) != 'cash_shift_safe_transfer'
      `,
    )
    .get(shift.id) as
    | {
        total_in: number
        total_out: number
      }
    | undefined

  const cashIn = roundMoney(Number(totals?.total_in || 0))

  const cashOut = roundMoney(Number(totals?.total_out || 0))

  const expectedClosingAmount = roundMoney(
    Number(shift.opening_counted_amount || 0) + cashIn - cashOut,
  )

  const breakdown = db
    .prepare(
      `
      SELECT
        type,
        direction,
        IFNULL(SUM(amount), 0) AS total

      FROM cash_movements

      WHERE shift_id = ?
        AND payment_method = 'store_cash'
        AND cancelled_at IS NULL

        AND type != 'shift_adjustment'

        AND IFNULL(
          reference_type,
          ''
        ) != 'cash_shift_safe_transfer'

      GROUP BY
        type,
        direction

      ORDER BY
        type ASC,
        direction ASC
      `,
    )
    .all(shift.id)
    .map((row: any) => ({
      type: String(row.type || ''),
      direction: row.direction as 'in' | 'out',
      total: roundMoney(Number(row.total || 0)),
    }))

  return {
    shift_id: shift.id,

    opening_counted_amount: roundMoney(
      Number(shift.opening_counted_amount || 0),
    ),

    cash_in: cashIn,
    cash_out: cashOut,

    expected_closing_amount: expectedClosingAmount,

    breakdown,
  }
}

export function getCashShiftDaySummary(input: CashShiftDaySummaryInput) {
  const db = getDb()

  const businessDate = normalizeShiftBusinessDate(input.business_date)

  const userId = Number(input.user_id || 0)

  const where = [`date(cs.opened_at, 'localtime') = ?`]

  const params: any[] = [businessDate]

  if (userId > 0) {
    where.push(`cs.opened_by = ?`)
    params.push(userId)
  }

  const shifts = db
    .prepare(
      `
      ${getShiftSelectSql()}

      WHERE ${where.join(' AND ')}

      ORDER BY
        cs.opened_at ASC,
        cs.id ASC
      `,
    )
    .all(...params) as CashShiftRow[]

  if (shifts.length === 0) {
    return {
      business_date: businessDate,

      user_id: userId > 0 ? userId : null,

      shifts_count: 0,
      closed_shifts_count: 0,

      has_open_shift: false,
      all_closed: false,

      first_shift_id: null,
      last_shift_id: null,
      last_shift_status: null,

      opening_drawer_balance: 0,

      cash_in: 0,
      cash_out: 0,

      balance_before_handover: 0,
      ending_drawer_balance: 0,
    }
  }

  const shiftIds = shifts.map((shift) => Number(shift.id))

  const placeholders = shiftIds.map(() => '?').join(', ')

  /*
   * نحسب فقط التشغيل الحقيقي للدرج.
   *
   * لا نحسب:
   * - تسويات فتح/إغلاق الشفت
   * - توريد إغلاق الشفت إلى الخزنة الآمنة
   *
   * لأنهما جزء من reconciliation/handover
   * وليس مبيعات أو مصروفات اليوم.
   */
  const totals = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN cm.direction = 'in'
                THEN cm.amount
              ELSE 0
            END
          ),
          0
        ) AS total_in,

        IFNULL(
          SUM(
            CASE
              WHEN cm.direction = 'out'
                THEN cm.amount
              ELSE 0
            END
          ),
          0
        ) AS total_out

      FROM cash_movements cm

      WHERE cm.shift_id IN (${placeholders})

        AND cm.payment_method = 'store_cash'

        AND cm.cancelled_at IS NULL

        AND cm.type != 'shift_adjustment'

        AND IFNULL(
          cm.reference_type,
          ''
        ) != 'cash_shift_safe_transfer'
      `,
    )
    .get(...shiftIds) as
    | {
        total_in: number
        total_out: number
      }
    | undefined

  const firstShift = shifts[0]

  const lastShift = shifts[shifts.length - 1]

  const cashIn = roundMoney(Number(totals?.total_in || 0))

  const cashOut = roundMoney(Number(totals?.total_out || 0))

  let balanceBeforeHandover = 0
  let endingDrawerBalance = 0

  if (lastShift.status === 'closed') {
    balanceBeforeHandover = roundMoney(
      Number(
        lastShift.closing_counted_amount ??
          lastShift.expected_closing_amount ??
          lastShift.opening_counted_amount ??
          0,
      ),
    )

    endingDrawerBalance = roundMoney(
      Number(lastShift.left_for_next_shift ?? balanceBeforeHandover),
    )
  } else {
    const preview = getCashShiftExpectedBalance(lastShift.id)

    balanceBeforeHandover = roundMoney(
      Number(preview.expected_closing_amount || 0),
    )

    endingDrawerBalance = balanceBeforeHandover
  }

  const closedShiftsCount = shifts.filter(
    (shift) => shift.status === 'closed',
  ).length

  return {
    business_date: businessDate,

    user_id: userId > 0 ? userId : null,

    shifts_count: shifts.length,

    closed_shifts_count: closedShiftsCount,

    has_open_shift: shifts.some((shift) => shift.status === 'open'),

    all_closed: shifts.length > 0 && closedShiftsCount === shifts.length,

    first_shift_id: Number(firstShift.id),

    last_shift_id: Number(lastShift.id),

    last_shift_status: lastShift.status,

    opening_drawer_balance: roundMoney(
      Number(firstShift.opening_counted_amount || 0),
    ),

    cash_in: cashIn,
    cash_out: cashOut,

    balance_before_handover: balanceBeforeHandover,

    ending_drawer_balance: endingDrawerBalance,
  }
}

export function listCashShifts(input?: CashShiftHistoryFilterInput) {
  const db = getDb()

  const status = input?.status || 'all'

  if (status !== 'all' && status !== 'open' && status !== 'closed') {
    throw new Error('حالة الشفت غير صحيحة')
  }

  const userId = Number(input?.user_id || 0)

  const dateFrom = normalizeShiftHistoryDate(input?.date_from)

  const dateTo = normalizeShiftHistoryDate(input?.date_to)

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('تاريخ البداية أكبر من تاريخ النهاية')
  }

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (status !== 'all') {
    where.push(`cs.status = ?`)
    params.push(status)
  }

  if (userId > 0) {
    where.push(`cs.opened_by = ?`)
    params.push(userId)
  }

  if (dateFrom) {
    where.push(`date(cs.opened_at, 'localtime') >= ?`)

    params.push(dateFrom)
  }

  if (dateTo) {
    where.push(`date(cs.opened_at, 'localtime') <= ?`)

    params.push(dateTo)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        cs.*,

        opened_user.name
          AS opened_by_name,

        closed_user.name
          AS closed_by_name,

        MAX(
          0,
          CAST(
            (
              julianday(
                COALESCE(
                  cs.closed_at,
                  CURRENT_TIMESTAMP
                )
              ) -
              julianday(cs.opened_at)
            ) * 1440
            AS INTEGER
          )
        ) AS duration_minutes,

        (
          SELECT
            IFNULL(SUM(cm.amount), 0)

          FROM cash_movements cm

          WHERE cm.shift_id = cs.id

            AND cm.payment_method =
              'store_cash'

            AND cm.direction = 'in'

            AND cm.cancelled_at IS NULL

            AND cm.type !=
              'shift_adjustment'

            AND IFNULL(
              cm.reference_type,
              ''
            ) !=
              'cash_shift_safe_transfer'
        ) AS cash_in,

        (
          SELECT
            IFNULL(SUM(cm.amount), 0)

          FROM cash_movements cm

          WHERE cm.shift_id = cs.id

            AND cm.payment_method =
              'store_cash'

            AND cm.direction = 'out'

            AND cm.cancelled_at IS NULL

            AND cm.type !=
              'shift_adjustment'

            AND IFNULL(
              cm.reference_type,
              ''
            ) !=
              'cash_shift_safe_transfer'
        ) AS cash_out,

        (
          SELECT COUNT(*)

          FROM cash_shift_variances csv

          WHERE csv.shift_id = cs.id
        ) AS variance_count,

        (
          SELECT COUNT(*)

          FROM cash_shift_variances csv

          WHERE csv.shift_id = cs.id
            AND csv.status = 'pending'
        ) AS pending_variance_count

      FROM cash_shifts cs

      LEFT JOIN users opened_user
        ON opened_user.id = cs.opened_by

      LEFT JOIN users closed_user
        ON closed_user.id = cs.closed_by

      ${whereSql}

      ORDER BY cs.id DESC

      LIMIT ?
      OFFSET ?
      `,
    )
    .all(...params, limit, offset) as CashShiftHistoryRow[]

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total

      FROM cash_shifts cs

      ${whereSql}
      `,
    )
    .get(...params) as {
    total: number
  }

  return {
    rows: rows.map((row) => ({
      ...row,

      duration_minutes: Number(row.duration_minutes || 0),

      cash_in: roundMoney(Number(row.cash_in || 0)),

      cash_out: roundMoney(Number(row.cash_out || 0)),

      variance_count: Number(row.variance_count || 0),

      pending_variance_count: Number(row.pending_variance_count || 0),
    })),

    total: Number(totalRow?.total || 0),

    limit,
    offset,
  }
}

export function getCashShiftDetails(shiftIdInput: number) {
  const db = getDb()

  const shiftId = Number(shiftIdInput || 0)

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error('رقم الشفت غير صحيح')
  }

  const shift = getCashShiftById(shiftId)

  if (!shift) {
    throw new Error('الشفت غير موجود')
  }

  const preview = getCashShiftExpectedBalance(shiftId)

  const movements = db
    .prepare(
      `
      SELECT
        cm.*,

        u.name AS created_by_name

      FROM cash_movements cm

      LEFT JOIN users u
        ON u.id = cm.created_by

      WHERE cm.shift_id = ?

      ORDER BY cm.id ASC
      `,
    )
    .all(shiftId)

  const variances = db
    .prepare(
      `
      ${getVarianceSelectSql()}

      WHERE csv.shift_id = ?

      ORDER BY csv.id ASC
      `,
    )
    .all(shiftId) as CashShiftVarianceRow[]

  return {
    shift,
    preview,
    movements,
    variances,
  }
}

export function getCashShiftVarianceById(
  varianceIdInput: number,
): CashShiftVarianceRow | null {
  const db = getDb()

  const varianceId = Number(varianceIdInput || 0)

  if (!varianceId) {
    return null
  }

  const row = db
    .prepare(
      `
      ${getVarianceSelectSql()}

      WHERE csv.id = ?

      LIMIT 1
      `,
    )
    .get(varianceId) as CashShiftVarianceRow | undefined

  return row || null
}

export function listCashShiftVariances(input?: CashShiftVarianceFilterInput) {
  const db = getDb()

  const status = input?.status || 'pending'

  if (status !== 'all' && status !== 'pending' && status !== 'resolved') {
    throw new Error('حالة فرق الشفت غير صحيحة')
  }

  const userId = Number(input?.user_id || 0)

  const dateFrom = normalizeShiftHistoryDate(input?.date_from)

  const dateTo = normalizeShiftHistoryDate(input?.date_to)

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('تاريخ البداية أكبر من تاريخ النهاية')
  }

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (status !== 'all') {
    where.push(`csv.status = ?`)

    params.push(status)
  }

  if (userId > 0) {
    where.push(`cs.opened_by = ?`)

    params.push(userId)
  }

  if (dateFrom) {
    where.push(`date(cs.opened_at, 'localtime') >= ?`)

    params.push(dateFrom)
  }

  if (dateTo) {
    where.push(`date(cs.opened_at, 'localtime') <= ?`)

    params.push(dateTo)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      ${getVarianceSelectSql()}

      ${whereSql}

      ORDER BY
        CASE
          WHEN csv.status = 'pending'
            THEN 0
          ELSE 1
        END,

        csv.id DESC

      LIMIT ?
      OFFSET ?
      `,
    )
    .all(...params, limit, offset) as CashShiftVarianceRow[]

  const totalRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total

      FROM cash_shift_variances csv

      JOIN cash_shifts cs
        ON cs.id = csv.shift_id

      ${whereSql}
      `,
    )
    .get(...params) as {
    total: number
  }

  /*
   * ده يفضل Global عشان المدير
   * يعرف دائمًا إجمالي الفروق
   * المعلقة حتى لو عامل فلتر.
   */
  const pendingRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total

      FROM cash_shift_variances

      WHERE status = 'pending'
      `,
    )
    .get() as {
    total: number
  }

  return {
    rows,

    total: Number(totalRow?.total || 0),

    pending_count: Number(pendingRow?.total || 0),

    limit,
    offset,
  }
}

export function resolveCashShiftVariance(input: ResolveCashShiftVarianceInput) {
  const db = getDb()

  const varianceId = Number(input.variance_id || 0)

  const resolvedBy = Number(input.resolved_by || 0)

  const resolutionType = String(
    input.resolution_type || '',
  ) as CashShiftVarianceResolutionType

  const resolutionNotes = String(input.resolution_notes || '').trim()

  if (!Number.isInteger(varianceId) || varianceId <= 0) {
    throw new Error('رقم فرق الشفت غير صحيح')
  }

  if (!Number.isInteger(resolvedBy) || resolvedBy <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  if (
    !['approved', 'rejected', 'corrected', 'explained', 'other'].includes(
      resolutionType,
    )
  ) {
    throw new Error('نوع مراجعة فرق الشفت غير صحيح')
  }

  if (!resolutionNotes) {
    throw new Error('اكتب ملاحظات مراجعة فرق الشفت')
  }

  const actor = db
    .prepare(
      `
      SELECT
        id,
        role,
        is_active

      FROM users

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(resolvedBy) as
    | {
        id: number
        role: string
        is_active: number
      }
    | undefined

  if (!actor || Number(actor.is_active) !== 1 || actor.role !== 'admin') {
    throw new Error('مراجعة فروق الشفتات متاحة لمدير النظام فقط')
  }

  const current = getCashShiftVarianceById(varianceId)

  if (!current) {
    throw new Error('فرق الشفت غير موجود')
  }

  if (current.status === 'resolved') {
    throw new Error('تمت مراجعة فرق الشفت بالفعل')
  }

  let openingShift: CashShiftRow | null = null
  let correctedOpeningAmount: number | null = null

  if (resolutionType === 'corrected') {
    if (current.stage !== 'opening') {
      throw new Error('تصحيح الجرد متاح لفروق افتتاح الشفت فقط')
    }

    if (
      input.corrected_opening_amount === null ||
      input.corrected_opening_amount === undefined
    ) {
      throw new Error('اكتب الجرد الصحيح عند افتتاح الشفت')
    }

    const rawCorrectedOpeningAmount = Number(input.corrected_opening_amount)

    if (
      !Number.isFinite(rawCorrectedOpeningAmount) ||
      rawCorrectedOpeningAmount < 0
    ) {
      throw new Error('الجرد الصحيح عند افتتاح الشفت غير صحيح')
    }

    correctedOpeningAmount = roundMoney(rawCorrectedOpeningAmount)

    openingShift = getCashShiftById(current.shift_id)

    if (!openingShift) {
      throw new Error('الشفت المرتبط بفرق الافتتاح غير موجود')
    }

    if (openingShift.status !== 'open') {
      throw new Error(
        'لا يمكن تصحيح جرد افتتاح شفت بعد إغلاقه، يمكن اعتماد الفرق فقط',
      )
    }

    if (openingShift.expected_opening_amount === null) {
      throw new Error('لا يوجد رصيد افتتاح متوقع لهذا الشفت')
    }

    if (
      Math.abs(
        correctedOpeningAmount -
          roundMoney(Number(openingShift.opening_counted_amount || 0)),
      ) <= 0.01
    ) {
      throw new Error('الجرد الصحيح يساوي الجرد المسجل بالفعل')
    }
  }

  let reversalAccount: ReturnType<typeof resolveCashAccount> | null = null

  if (resolutionType === 'rejected') {
    if (current.stage !== 'closing') {
      throw new Error('عدم اعتماد الفرق متاح حاليًا لفروق إغلاق الشفت فقط')
    }

    const rawReversalAccount = String(input.reversal_account || '').trim()

    if (!rawReversalAccount) {
      throw new Error('اختر الحساب الذي سيتم عكس فرق الإغلاق عليه')
    }

    reversalAccount = resolveCashAccount(rawReversalAccount)

    if (reversalAccount === 'store_cash') {
      throw new Error('لا يمكن عكس فرق شفت مغلق على درج المحل')
    }
  }

  const tx = db.transaction(() => {
    const varianceAmount = roundMoney(Number(current.amount || 0))

    if (
      resolutionType === 'corrected' &&
      openingShift &&
      correctedOpeningAmount !== null
    ) {
      const previousOpeningCounted = roundMoney(
        Number(openingShift.opening_counted_amount || 0),
      )

      const expectedOpeningAmount = roundMoney(
        Number(openingShift.expected_opening_amount || 0),
      )

      const correctionAmount = roundMoney(
        correctedOpeningAmount - previousOpeningCounted,
      )

      if (Math.abs(correctionAmount) > 0.01) {
        createCashMovement({
          type: 'shift_adjustment',

          direction: correctionAmount > 0 ? 'in' : 'out',

          amount: Math.abs(correctionAmount),

          payment_method: 'store_cash',

          reference_id: current.id,

          reference_type: 'cash_shift_opening_count_correction',

          notes: `تصحيح جرد افتتاح الشفت #${current.shift_id} من ${previousOpeningCounted.toFixed(
            2,
          )} إلى ${correctedOpeningAmount.toFixed(2)}`,

          created_by: resolvedBy,

          shift_id: current.shift_id,
        })
      }

      const newOpeningDifference = roundMoney(
        correctedOpeningAmount - expectedOpeningAmount,
      )

      const shiftResult = db
        .prepare(
          `
          UPDATE cash_shifts

          SET
            opening_counted_amount = ?,
            opening_difference = ?

          WHERE id = ?
            AND status = 'open'
          `,
        )
        .run(correctedOpeningAmount, newOpeningDifference, current.shift_id)

      if (Number(shiftResult.changes || 0) !== 1) {
        throw new Error('تعذر تحديث جرد افتتاح الشفت')
      }

      if (Math.abs(newOpeningDifference) <= 0.01) {
        db.prepare(
          `
          UPDATE cash_shift_variances

          SET
            kind = ?,
            amount = 0,
            status = 'resolved',
            resolution_type = 'corrected',
            resolution_notes = ?,
            resolved_by = ?,
            resolved_at = CURRENT_TIMESTAMP

          WHERE id = ?
            AND status = 'pending'
          `,
        ).run(current.kind, resolutionNotes, resolvedBy, varianceId)
      } else {
        db.prepare(
          `
          UPDATE cash_shift_variances

          SET
            kind = ?,
            amount = ?,
            status = 'pending',
            resolution_type = NULL,
            resolution_notes = NULL,
            resolved_by = NULL,
            resolved_at = NULL

          WHERE id = ?
            AND status = 'pending'
          `,
        ).run(
          newOpeningDifference < 0 ? 'shortage' : 'surplus',
          Math.abs(newOpeningDifference),
          varianceId,
        )
      }

      createActivityLog({
        user_id: resolvedBy,

        action: 'cash_shift_opening_count_corrected',

        entity: 'cash_shift_variances',

        entity_id: varianceId,

        details: JSON.stringify({
          shift_id: current.shift_id,

          previous_opening_counted: previousOpeningCounted,

          corrected_opening_counted: correctedOpeningAmount,

          expected_opening_amount: expectedOpeningAmount,

          previous_difference: openingShift.opening_difference,

          new_difference: newOpeningDifference,

          notes: resolutionNotes,
        }),
      })

      const correctedVariance = getCashShiftVarianceById(varianceId)

      if (!correctedVariance) {
        throw new Error('تعذر تحميل فرق الافتتاح بعد التصحيح')
      }

      return correctedVariance
    }

    if (resolutionType === 'rejected' && reversalAccount) {
      if (current.kind === 'surplus') {
        const accountBalance = roundMoney(
          Number(
            getCashSummary({
              payment_method: reversalAccount,
            }).balance,
          ),
        )

        if (accountBalance + 0.01 < varianceAmount) {
          throw new Error('رصيد الحساب المختار غير كافٍ لعكس مبلغ الزيادة')
        }
      }

      createCashMovement({
        type: 'shift_adjustment',

        direction: current.kind === 'surplus' ? 'out' : 'in',

        amount: varianceAmount,

        payment_method: reversalAccount,

        reference_id: current.id,

        reference_type: 'cash_shift_variance_reversal',

        notes:
          current.kind === 'surplus'
            ? `عدم اعتماد زيادة إغلاق الشفت #${current.shift_id}`
            : `عدم اعتماد عجز إغلاق الشفت #${current.shift_id}`,

        created_by: resolvedBy,

        shift_id: null,
      })
    }
    const result = db
      .prepare(
        `
        UPDATE cash_shift_variances

        SET
          status = 'resolved',

          resolution_type = ?,

          resolution_notes = ?,

          resolved_by = ?,

          resolved_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
          AND status = 'pending'
        `,
      )
      .run(resolutionType, resolutionNotes, resolvedBy, varianceId)

    if (Number(result.changes || 0) !== 1) {
      throw new Error('تعذر مراجعة فرق الشفت')
    }

    createActivityLog({
      user_id: resolvedBy,

      action: 'cash_shift_variance_resolved',

      entity: 'cash_shift_variances',

      entity_id: varianceId,

      details: JSON.stringify({
        shift_id: current.shift_id,

        stage: current.stage,

        kind: current.kind,

        amount: Number(current.amount || 0),

        resolution_type: resolutionType,

        resolution_notes: resolutionNotes,
        reversal_account: reversalAccount,
      }),
    })

    const resolved = getCashShiftVarianceById(varianceId)

    if (!resolved) {
      throw new Error('تعذر تحميل فرق الشفت بعد المراجعة')
    }

    return resolved
  })

  return tx()
}

export function closeCashShift(input: CloseCashShiftInput): CashShiftRow {
  const db = getDb()

  const shiftId = Number(input.shift_id || 0)
  const closedBy = Number(input.closed_by || 0)

  const rawClosingCountedAmount = Number(input.closing_counted_amount)

  const rawLeftForNextShift = Number(input.left_for_next_shift)

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error('رقم الشفت غير صحيح')
  }

  if (!Number.isInteger(closedBy) || closedBy <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  if (
    !Number.isFinite(rawClosingCountedAmount) ||
    rawClosingCountedAmount < 0
  ) {
    throw new Error('قيمة جرد إغلاق الشفت غير صحيحة')
  }

  if (!Number.isFinite(rawLeftForNextShift) || rawLeftForNextShift < 0) {
    throw new Error('المبلغ المتروك للشفت التالي غير صحيح')
  }

  const closingCountedAmount = roundMoney(rawClosingCountedAmount)

  const leftForNextShift = roundMoney(rawLeftForNextShift)

  if (leftForNextShift > closingCountedAmount) {
    throw new Error(
      'المبلغ المتروك للشفت التالي أكبر من المبلغ الموجود فعليًا في الدرج',
    )
  }

  const tx = db.transaction(() => {
    const shift = getCashShiftById(shiftId)

    if (!shift) {
      throw new Error('الشفت غير موجود')
    }

    if (shift.status !== 'open') {
      throw new Error('هذا الشفت مغلق بالفعل')
    }

    const actor = db
      .prepare(
        `
        SELECT
          id,
          role,
          is_active

        FROM users

        WHERE id = ?

        LIMIT 1
        `,
      )
      .get(closedBy) as
      | {
          id: number
          role: string
          is_active: number
        }
      | undefined

    if (!actor || Number(actor.is_active) !== 1) {
      throw new Error('المستخدم غير موجود أو غير مفعل')
    }

    const isAdmin = actor.role === 'admin'

    const isShiftOwner = Number(shift.opened_by) === closedBy

    if (!isAdmin && !isShiftOwner) {
      throw new Error('لا يمكن إغلاق الشفت إلا بواسطة صاحب الشفت أو المدير')
    }

    if (isAdmin && !isShiftOwner && !input.close_reason?.trim()) {
      throw new Error('سبب إغلاق المدير للشفت مطلوب')
    }

    const preview = getCashShiftExpectedBalance(shift.id)

    const expectedClosingAmount = roundMoney(preview.expected_closing_amount)

    const closingDifference = roundMoney(
      closingCountedAmount - expectedClosingAmount,
    )

    let closingVarianceId: number | null = null

    if (Math.abs(closingDifference) > 0.01) {
      const varianceResult = db
        .prepare(
          `
          INSERT INTO cash_shift_variances (
            shift_id,
            stage,
            kind,
            amount,
            status
          )

          VALUES (
            ?,
            'closing',
            ?,
            ?,
            'pending'
          )
          `,
        )
        .run(
          shift.id,

          closingDifference < 0 ? 'shortage' : 'surplus',

          Math.abs(closingDifference),
        )

      closingVarianceId = Number(varianceResult.lastInsertRowid)

      createCashMovement({
        type: 'shift_adjustment',

        direction: closingDifference > 0 ? 'in' : 'out',

        amount: Math.abs(closingDifference),

        payment_method: 'store_cash',

        reference_id: closingVarianceId,

        reference_type: 'cash_shift_variance',

        notes:
          closingDifference < 0
            ? `تسوية عجز إغلاق الشفت #${shift.id}`
            : `تسوية زيادة إغلاق الشفت #${shift.id}`,

        created_by: closedBy,
        shift_id: shift.id,
      })
    }

    const safeTransferAmount = roundMoney(
      closingCountedAmount - leftForNextShift,
    )

    if (safeTransferAmount > 0) {
      const outResult = createCashMovement({
        type: 'transfer',

        direction: 'out',

        amount: safeTransferAmount,

        payment_method: 'store_cash',

        reference_id: shift.id,

        reference_type: 'cash_shift_safe_transfer',

        notes: `توريد إغلاق الشفت #${shift.id} إلى الخزنة الآمنة`,

        created_by: closedBy,
        shift_id: shift.id,
      })

      createCashMovement({
        type: 'transfer',

        direction: 'in',

        amount: safeTransferAmount,

        payment_method: 'store_safe',

        reference_id: Number(outResult.lastInsertRowid || 0),

        reference_type: 'cash_shift_safe_transfer',

        notes: `توريد إغلاق الشفت #${shift.id} إلى الخزنة الآمنة`,

        created_by: closedBy,
        shift_id: shift.id,
      })
    }

    db.prepare(
      `
      UPDATE cash_shifts

      SET
        status = 'closed',

        expected_closing_amount = ?,
        closing_counted_amount = ?,
        closing_difference = ?,

        left_for_next_shift = ?,
        safe_transfer_amount = ?,

        closed_by = ?,
        closed_at = CURRENT_TIMESTAMP,
        close_reason = ?

      WHERE id = ?
        AND status = 'open'
      `,
    ).run(
      expectedClosingAmount,
      closingCountedAmount,
      closingDifference,

      leftForNextShift,
      safeTransferAmount,

      closedBy,

      input.close_reason?.trim() || null,

      shift.id,
    )

    createActivityLog({
      user_id: closedBy,

      action: 'cash_shift_closed',

      entity: 'cash_shifts',

      entity_id: shift.id,

      details: JSON.stringify({
        expected_closing_amount: expectedClosingAmount,

        closing_counted_amount: closingCountedAmount,

        closing_difference: closingDifference,

        left_for_next_shift: leftForNextShift,

        safe_transfer_amount: safeTransferAmount,

        closing_variance_id: closingVarianceId,
      }),
    })

    const closedShift = getCashShiftById(shift.id)

    if (!closedShift) {
      throw new Error('تعذر تحميل الشفت بعد إغلاقه')
    }

    return closedShift
  })

  return tx()
}
