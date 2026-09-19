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

export type CashShiftVarianceResolutionType = 'approved' | 'explained' | 'other'

export type CashShiftVarianceRemainingKind = 'shortage' | 'surplus' | 'balanced'

export type CashShiftVarianceCorrectionReason =
  | 'unregistered_cash_sale'
  | 'unregistered_customer_payment'
  | 'unregistered_cash_deposit'
  | 'payment_recorded_non_cash_but_cash'
  | 'recorded_expense_not_paid'
  | 'recorded_return_not_refunded'
  | 'withdrawal_recorded_not_done'
  | 'cancelled_sale_cash_kept'
  | 'unregistered_expense'
  | 'unregistered_cash_withdrawal'
  | 'unregistered_safe_transfer'
  | 'unregistered_return'
  | 'payment_recorded_cash_but_non_cash'
  | 'duplicate_cash_sale'
  | 'sale_not_fully_collected'
  | 'credit_sale_marked_cash'

export type CashShiftVarianceRow = {
  id: number
  shift_id: number

  stage: 'opening' | 'closing'
  kind: 'shortage' | 'surplus'

  amount: number

  original_signed_amount: number

  correction_effect_amount: number

  remaining_signed_amount: number

  remaining_amount: number

  remaining_kind: CashShiftVarianceRemainingKind

  correction_count: number

  status: CashShiftVarianceStatus

  resolution_type: CashShiftVarianceResolutionType | null

  resolution_notes: string | null

  resolved_by: number | null

  resolved_by_name?: string | null

  resolved_at: string | null

  created_at: string

  shift_status: 'open' | 'closed'

  opened_by: number
  previous_shift_id: number | null

  expected_opening_amount: number | null

  opening_counted_amount: number

  opening_difference: number
  opened_by_name?: string | null

  shift_opened_at: string

  shift_closed_at: string | null
}

export type CashShiftVarianceCorrectionRow = {
  id: number

  variance_id: number

  reason_code: CashShiftVarianceCorrectionReason

  amount: number

  effect_amount: number

  notes: string | null

  reference_type: string | null

  reference_id: number | null

  created_by: number

  created_by_name?: string | null

  created_at: string

  cancelled_at: string | null

  cancelled_by: number | null

  cancelled_by_name?: string | null

  cancel_reason: string | null
  document_title?: string | null

  document_category?: string | null
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
}

export type AddCashShiftVarianceCorrectionInput = {
  variance_id: number

  reason_code: CashShiftVarianceCorrectionReason

  amount: number

  notes?: string | null

  created_by: number

  reference_type?: string | null

  reference_id?: number | null
}

export type CancelCashShiftVarianceCorrectionInput = {
  correction_id: number

  reason: string

  cancelled_by: number
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

const CASH_SHIFT_VARIANCE_CORRECTION_DIRECTIONS: Record<
  CashShiftVarianceCorrectionReason,
  -1 | 1
> = {
  /*
   * الأسباب دي معناها إن النظام كان
   * متوقع كاش أقل من المفروض.
   *
   * بالتالي التصحيح يقلل الرصيد
   * المتبقي في حساب الفروقات.
   */
  unregistered_cash_sale: -1,

  unregistered_customer_payment: -1,

  unregistered_cash_deposit: -1,

  payment_recorded_non_cash_but_cash: -1,

  recorded_expense_not_paid: -1,

  recorded_return_not_refunded: -1,

  withdrawal_recorded_not_done: -1,

  cancelled_sale_cash_kept: -1,

  /*
   * الأسباب دي معناها إن النظام كان
   * متوقع كاش أكبر من المفروض.
   *
   * بالتالي التصحيح يزيد الرصيد
   * المتبقي ناحية الصفر في حالة العجز.
   */
  unregistered_expense: 1,

  unregistered_cash_withdrawal: 1,

  unregistered_safe_transfer: 1,

  unregistered_return: 1,

  payment_recorded_cash_but_non_cash: 1,

  duplicate_cash_sale: 1,

  sale_not_fully_collected: 1,

  credit_sale_marked_cash: 1,
}

function getVarianceOriginalSignedSql() {
  return `
    (
      CASE
        WHEN csv.kind = 'surplus'
          THEN IFNULL(csv.amount, 0)

        ELSE
          -IFNULL(csv.amount, 0)
      END
    )
  `
}

function getVarianceCorrectionEffectSql() {
  return `
    IFNULL(
      (
        SELECT
          SUM(csvc.effect_amount)

        FROM cash_shift_variance_corrections csvc

        WHERE
          csvc.variance_id = csv.id

          AND
            csvc.cancelled_at
            IS NULL
      ),
      0
    )
  `
}

function getVarianceRemainingSignedSql() {
  return `
    ROUND(
      ${getVarianceOriginalSignedSql()}
      +
      ${getVarianceCorrectionEffectSql()},
      2
    )
  `
}

function normalizeVarianceRow(row: CashShiftVarianceRow): CashShiftVarianceRow {
  return {
    ...row,

    amount: roundMoney(Number(row.amount || 0)),

    original_signed_amount: roundMoney(Number(row.original_signed_amount || 0)),

    correction_effect_amount: roundMoney(
      Number(row.correction_effect_amount || 0),
    ),

    remaining_signed_amount: roundMoney(
      Number(row.remaining_signed_amount || 0),
    ),

    remaining_amount: roundMoney(Number(row.remaining_amount || 0)),

    correction_count: Number(row.correction_count || 0),
  }
}

function requireCashShiftVarianceAdmin(userIdInput: number) {
  const db = getDb()

  const userId = Number(userIdInput || 0)

  if (!Number.isInteger(userId) || userId <= 0) {
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
    .get(userId) as
    | {
        id: number
        role: string
        is_active: number
      }
    | undefined

  if (!actor || Number(actor.is_active) !== 1 || actor.role !== 'admin') {
    throw new Error('مراجعة فروق الشفتات متاحة لمدير النظام فقط')
  }

  return actor
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
  const originalSigned = getVarianceOriginalSignedSql()

  const correctionEffect = getVarianceCorrectionEffectSql()

  const remainingSigned = getVarianceRemainingSignedSql()

  return `
    SELECT
      csv.*,

      ${originalSigned}
        AS original_signed_amount,

      ${correctionEffect}
        AS correction_effect_amount,

      ${remainingSigned}
        AS remaining_signed_amount,

      ABS(
        ${remainingSigned}
      )
        AS remaining_amount,

      CASE
        WHEN
          ${remainingSigned} > 0.01
        THEN 'surplus'

        WHEN
          ${remainingSigned} < -0.01
        THEN 'shortage'

        ELSE 'balanced'
      END
        AS remaining_kind,

      (
        SELECT
          COUNT(*)

        FROM cash_shift_variance_corrections csvc_count

        WHERE
          csvc_count.variance_id =
            csv.id

          AND
            csvc_count.cancelled_at
            IS NULL
      )
        AS correction_count,

      cs.status
        AS shift_status,

      cs.opened_by,

      cs.previous_shift_id,

      cs.expected_opening_amount,

      cs.opening_counted_amount,

      cs.opening_difference,

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

  const touchesDrawer = accounts.some(
    (method) => resolveCashAccount(method || 'cash') === 'store_cash',
  )

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

  const normalizedVariances = variances.map(normalizeVarianceRow)

  return {
    shift,
    preview,
    movements,
    variances: normalizedVariances,
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

  return row ? normalizeVarianceRow(row) : null
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
          WHEN
            csv.status = 'pending'
          THEN 0
          ELSE 1
        END,

        csv.id DESC

      LIMIT ?
      OFFSET ?
      `,
    )
    .all(...params, limit, offset) as CashShiftVarianceRow[]

  const normalizedRows = rows.map(normalizeVarianceRow)

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

  const pendingRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total

      FROM cash_shift_variances

      WHERE
        status = 'pending'
      `,
    )
    .get() as {
    total: number
  }

  const remainingSigned = getVarianceRemainingSignedSql()

  const pendingBalances = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN
                x.remaining_signed_amount
                < -0.01
              THEN
                ABS(
                  x.remaining_signed_amount
                )
              ELSE 0
            END
          ),
          0
        )
          AS shortage_total,

        IFNULL(
          SUM(
            CASE
              WHEN
                x.remaining_signed_amount
                > 0.01
              THEN
                x.remaining_signed_amount
              ELSE 0
            END
          ),
          0
        )
          AS surplus_total,

        IFNULL(
          SUM(
            x.remaining_signed_amount
          ),
          0
        )
          AS net_total

      FROM (
        SELECT
          ${remainingSigned}
            AS remaining_signed_amount

        FROM cash_shift_variances csv

        WHERE
          csv.status = 'pending'

          AND
            csv.stage = 'closing'
      ) x
      `,
    )
    .get() as {
    shortage_total: number
    surplus_total: number
    net_total: number
  }

  return {
    rows: normalizedRows,

    total: Number(totalRow?.total || 0),

    pending_count: Number(pendingRow?.total || 0),

    pending_shortage_total: roundMoney(
      Number(pendingBalances?.shortage_total || 0),
    ),

    pending_surplus_total: roundMoney(
      Number(pendingBalances?.surplus_total || 0),
    ),

    pending_net_total: roundMoney(Number(pendingBalances?.net_total || 0)),

    limit,
    offset,
  }
}

export function listCashShiftVarianceCorrections(varianceIdInput: number) {
  const db = getDb()

  const varianceId = Number(varianceIdInput || 0)

  if (!Number.isInteger(varianceId) || varianceId <= 0) {
    throw new Error('رقم فرق الشفت غير صحيح')
  }

  return db
    .prepare(
      `
      SELECT
        csvc.*,

        creator.name
          AS created_by_name,

        canceller.name
          AS cancelled_by_name,

        CASE
          WHEN
            csvc.reference_type =
              'shift_variance_expense_correction'

          THEN (
            SELECT
              e.title

            FROM expenses e

            WHERE
              e.id =
                csvc.reference_id

            LIMIT 1
          )

          ELSE NULL
        END
          AS document_title,

        CASE
          WHEN
            csvc.reference_type =
              'shift_variance_expense_correction'

          THEN (
            SELECT
              e.category

            FROM expenses e

            WHERE
              e.id =
                csvc.reference_id

            LIMIT 1
          )

          ELSE NULL
        END
          AS document_category

      FROM cash_shift_variance_corrections csvc

      LEFT JOIN users creator
        ON
          creator.id =
            csvc.created_by

      LEFT JOIN users canceller
        ON
          canceller.id =
            csvc.cancelled_by

      WHERE
        csvc.variance_id = ?

      ORDER BY
        csvc.id ASC
      `,
    )
    .all(varianceId) as CashShiftVarianceCorrectionRow[]
}

export function getCashShiftVarianceReview(varianceIdInput: number) {
  const variance = getCashShiftVarianceById(varianceIdInput)

  if (!variance) {
    throw new Error('فرق الشفت غير موجود')
  }

  return {
    variance,

    corrections: listCashShiftVarianceCorrections(variance.id),
  }
}

export function reopenCashShiftVarianceForCorrection(input: {
  variance_id: number
  actor_id: number
  reason: string
}) {
  const db = getDb()

  const varianceId = Number(input.variance_id || 0)

  const actorId = Number(input.actor_id || 0)

  const reason = String(input.reason || '').trim()

  if (!Number.isInteger(varianceId) || varianceId <= 0) {
    throw new Error('رقم فرق الشفت غير صحيح')
  }

  requireCashShiftVarianceAdmin(actorId)

  const current = getCashShiftVarianceById(varianceId)

  if (!current) {
    throw new Error('فرق الشفت غير موجود')
  }

  if (current.stage !== 'closing') {
    throw new Error('إعادة فتح التصحيحات متاحة لفروق إغلاق الشفت فقط')
  }

  if (current.status === 'pending') {
    return current
  }

  const result = db
    .prepare(
      `
      UPDATE cash_shift_variances

      SET
        status = 'pending',

        resolution_type = NULL,

        resolution_notes = NULL,

        resolved_by = NULL,

        resolved_at = NULL

      WHERE
        id = ?

        AND
          status = 'resolved'
      `,
    )
    .run(varianceId)

  if (Number(result.changes || 0) !== 1) {
    throw new Error('تعذر إعادة فتح مراجعة فرق الشفت')
  }

  createActivityLog({
    user_id: actorId,

    action: 'cash_shift_variance_reopened',

    entity: 'cash_shift_variances',

    entity_id: varianceId,

    details: JSON.stringify({
      shift_id: current.shift_id,

      previous_resolution_type: current.resolution_type,

      previous_resolution_notes: current.resolution_notes,

      reason,
    }),
  })

  const reopened = getCashShiftVarianceById(varianceId)

  if (!reopened) {
    throw new Error('تعذر تحميل فرق الشفت بعد إعادة فتحه')
  }

  return reopened
}

export function addCashShiftVarianceCorrection(
  input: AddCashShiftVarianceCorrectionInput,
) {
  const db = getDb()

  const varianceId = Number(input.variance_id || 0)

  const createdBy = Number(input.created_by || 0)

  const reasonCode = String(
    input.reason_code || '',
  ) as CashShiftVarianceCorrectionReason

  const rawAmount = Number(input.amount)

  const notes = String(input.notes || '').trim()

  if (!Number.isInteger(varianceId) || varianceId <= 0) {
    throw new Error('رقم فرق الشفت غير صحيح')
  }

  requireCashShiftVarianceAdmin(createdBy)

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error('قيمة تصحيح فرق الشفت غير صحيحة')
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      CASH_SHIFT_VARIANCE_CORRECTION_DIRECTIONS,
      reasonCode,
    )
  ) {
    throw new Error('سبب تصحيح فرق الشفت غير صحيح')
  }

  const current = getCashShiftVarianceById(varianceId)

  if (!current) {
    throw new Error('فرق الشفت غير موجود')
  }

  if (current.status !== 'pending') {
    throw new Error('تم إنهاء مراجعة فرق الشفت بالفعل')
  }

  if (current.stage !== 'closing') {
    throw new Error('التصحيحات المالية متاحة لفروق إغلاق الشفت فقط')
  }

  if (current.shift_status !== 'closed') {
    throw new Error('لا يمكن تسجيل تصحيح على شفت لم يتم إغلاقه')
  }

  const referenceType = String(input.reference_type || '').trim()

  const referenceId = Number(input.reference_id || 0)

  if (!referenceType || !Number.isInteger(referenceId) || referenceId <= 0) {
    throw new Error(
      'لا يمكن تعديل حساب الفروقات بدون عملية تصحيح فعلية مرتبطة به',
    )
  }

  const amount = roundMoney(rawAmount)

  const direction = CASH_SHIFT_VARIANCE_CORRECTION_DIRECTIONS[reasonCode]

  const effectAmount = roundMoney(amount * direction)

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO cash_shift_variance_corrections (
          variance_id,

          reason_code,

          amount,

          effect_amount,

          notes,

          reference_type,
          reference_id,

          created_by
        )

        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
        `,
      )
      .run(
        varianceId,

        reasonCode,

        amount,

        effectAmount,

        notes || null,

        referenceType,

        referenceId,

        createdBy,
      )

    const correctionId = Number(result.lastInsertRowid)

    createActivityLog({
      user_id: createdBy,

      action: 'cash_shift_variance_correction_added',

      entity: 'cash_shift_variance_corrections',

      entity_id: correctionId,

      details: JSON.stringify({
        variance_id: varianceId,

        shift_id: current.shift_id,

        reason_code: reasonCode,

        amount,

        effect_amount: effectAmount,

        reference_type: referenceType,

        reference_id: referenceId,
      }),
    })

    return getCashShiftVarianceReview(varianceId)
  })

  return tx()
}

export function cancelCashShiftVarianceCorrection(
  input: CancelCashShiftVarianceCorrectionInput,
) {
  const db = getDb()

  const correctionId = Number(input.correction_id || 0)

  const cancelledBy = Number(input.cancelled_by || 0)

  const reason = String(input.reason || '').trim()

  if (!Number.isInteger(correctionId) || correctionId <= 0) {
    throw new Error('رقم تصحيح فرق الشفت غير صحيح')
  }

  requireCashShiftVarianceAdmin(cancelledBy)

  if (!reason) {
    throw new Error('سبب إلغاء التصحيح مطلوب')
  }

  const correction = db
    .prepare(
      `
      SELECT
        csvc.*,

        csv.status
          AS variance_status

      FROM cash_shift_variance_corrections csvc

      JOIN cash_shift_variances csv
        ON
          csv.id =
            csvc.variance_id

      WHERE
        csvc.id = ?

      LIMIT 1
      `,
    )
    .get(correctionId) as any

  if (!correction) {
    throw new Error('تصحيح فرق الشفت غير موجود')
  }

  if (correction.cancelled_at) {
    throw new Error('تم إلغاء هذا التصحيح بالفعل')
  }

  const tx = db.transaction(() => {
    reopenCashShiftVarianceForCorrection({
      variance_id: Number(correction.variance_id),

      actor_id: cancelledBy,

      reason: `إلغاء تصحيح فرق الشفت #${correctionId}`,
    })

    if (
      correction.reference_type === 'shift_variance_sale_correction' &&
      Number(correction.reference_id || 0) > 0
    ) {
      const saleId = Number(correction.reference_id)

      const sale = db
        .prepare(
          `
          SELECT
            *

          FROM sales

          WHERE id = ?

          LIMIT 1
          `,
        )
        .get(saleId) as any

      if (!sale) {
        throw new Error('فاتورة التصحيح المرتبطة غير موجودة')
      }

      if (sale.cancelled_at) {
        throw new Error('فاتورة التصحيح ملغاة بالفعل')
      }

      const returnRow = db
        .prepare(
          `
          SELECT
            COUNT(*) AS count

          FROM sale_returns

          WHERE
            original_sale_id = ?

            AND
              cancelled_at
              IS NULL
          `,
        )
        .get(saleId) as any

      if (Number(returnRow?.count || 0) > 0) {
        throw new Error('لا يمكن إلغاء التصحيح بعد وجود مرتجع على الفاتورة')
      }

      const exchangeRow = db
        .prepare(
          `
          SELECT
            COUNT(*) AS count

          FROM sale_exchanges

          WHERE
            original_sale_id = ?

            AND
              cancelled_at
              IS NULL
          `,
        )
        .get(saleId) as any

      if (Number(exchangeRow?.count || 0) > 0) {
        throw new Error('لا يمكن إلغاء التصحيح بعد وجود استبدال على الفاتورة')
      }

      const items = db
        .prepare(
          `
          SELECT
            *

          FROM sale_items

          WHERE
            sale_id = ?

          ORDER BY id ASC
          `,
        )
        .all(saleId) as any[]

      const restoreStock = db.prepare(
        `
          INSERT INTO stock_movements (
            variant_id,

            type,

            quantity,

            reference_id,

            reference_type,

            notes
          )

          VALUES (
            ?,
            'in',
            ?,
            ?,
            'shift_variance_sale_correction_cancel',
            ?
          )
          `,
      )

      for (const item of items) {
        restoreStock.run(
          Number(item.variant_id),

          Number(item.quantity || 0),

          saleId,

          `إلغاء فاتورة تصحيح فرق شفت #${saleId}`,
        )
      }

      db.prepare(
        `
        UPDATE sales

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancel_reason = ?,

          payment_status =
            'cancelled',

          remaining_amount = 0

        WHERE id = ?
        `,
      ).run(
        cancelledBy,

        `إلغاء تصحيح فرق شفت: ${reason}`,

        saleId,
      )
    }

    if (
      correction.reference_type === 'shift_variance_expense_correction' &&
      Number(correction.reference_id || 0) > 0
    ) {
      const expenseId = Number(correction.reference_id)

      const result = db
        .prepare(
          `
          UPDATE expenses

          SET
            cancelled_at =
              CURRENT_TIMESTAMP,

            cancelled_by = ?,

            cancel_reason = ?

          WHERE
            id = ?

            AND
              cancelled_at
              IS NULL
          `,
        )
        .run(
          cancelledBy,

          `إلغاء تصحيح فرق شفت: ${reason}`,

          expenseId,
        )

      if (Number(result.changes || 0) !== 1) {
        throw new Error('المصروف التصحيحي غير موجود أو ملغي بالفعل')
      }
    }

    const result = db
      .prepare(
        `
        UPDATE cash_shift_variance_corrections

        SET
          cancelled_at =
            CURRENT_TIMESTAMP,

          cancelled_by = ?,

          cancel_reason = ?

        WHERE
          id = ?

          AND
            cancelled_at
            IS NULL
        `,
      )
      .run(
        cancelledBy,

        reason,

        correctionId,
      )

    if (Number(result.changes || 0) !== 1) {
      throw new Error('تعذر إلغاء تصحيح فرق الشفت')
    }

    createActivityLog({
      user_id: cancelledBy,

      action: 'cash_shift_variance_correction_cancelled',

      entity: 'cash_shift_variance_corrections',

      entity_id: correctionId,

      details: JSON.stringify({
        variance_id: correction.variance_id,

        reference_type: correction.reference_type,

        reference_id: correction.reference_id,

        reason,

        cash_movement_created: false,
      }),
    })

    return getCashShiftVarianceReview(correction.variance_id)
  })

  return tx()
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

  requireCashShiftVarianceAdmin(resolvedBy)

  if (!['approved', 'explained', 'other'].includes(resolutionType)) {
    throw new Error('نوع مراجعة فرق الشفت غير صحيح')
  }

  if (!resolutionNotes) {
    throw new Error('اكتب ملاحظات مراجعة فرق الشفت')
  }

  const current = getCashShiftVarianceById(varianceId)

  if (!current) {
    throw new Error('فرق الشفت غير موجود')
  }

  if (current.status === 'resolved') {
    throw new Error('تمت مراجعة فرق الشفت بالفعل')
  }

  /*
   * explained معناها إن كل الفرق
   * تم تفسيره بالكامل.
   *
   * لذلك لازم الرصيد المتبقي يكون صفر.
   */
  if (
    resolutionType === 'explained' &&
    Math.abs(Number(current.remaining_signed_amount || 0)) > 0.01
  ) {
    throw new Error(
      'لا يمكن إنهاء الفرق كتفسير كامل قبل وصول حساب الفروقات إلى صفر',
    )
  }

  const tx = db.transaction(() => {
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

        WHERE
          id = ?

          AND
            status = 'pending'
        `,
      )
      .run(
        resolutionType,

        resolutionNotes,

        resolvedBy,

        varianceId,
      )

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

        original_amount: Number(current.amount || 0),

        correction_effect_amount: Number(current.correction_effect_amount || 0),

        remaining_signed_amount: Number(current.remaining_signed_amount || 0),

        resolution_type: resolutionType,

        resolution_notes: resolutionNotes,
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
