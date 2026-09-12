import { getDb } from '../db'
import { createActivityLog } from './activity.repo'
import { createCashMovement, getCashSummary } from './cash.repo'

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

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
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

export function openCashShift(input: OpenCashShiftInput): CashShiftRow {
  const db = getDb()

  const openedBy = Number(input.opened_by || 0)

  const openingCountedAmount = roundMoney(Number(input.opening_counted_amount))

  if (!openedBy) {
    throw new Error('المستخدم غير صحيح')
  }

  if (!Number.isFinite(openingCountedAmount) || openingCountedAmount < 0) {
    throw new Error('رصيد افتتاح الشفت غير صحيح')
  }

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
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    )

    const accountReconciliationAmount = roundMoney(
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

export function closeCashShift(input: CloseCashShiftInput): CashShiftRow {
  const db = getDb()

  const shiftId = Number(input.shift_id || 0)
  const closedBy = Number(input.closed_by || 0)

  const closingCountedAmount = roundMoney(Number(input.closing_counted_amount))

  const leftForNextShift = roundMoney(Number(input.left_for_next_shift))

  if (!shiftId) {
    throw new Error('رقم الشفت غير صحيح')
  }

  if (!closedBy) {
    throw new Error('المستخدم غير صحيح')
  }

  if (!Number.isFinite(closingCountedAmount) || closingCountedAmount < 0) {
    throw new Error('قيمة جرد إغلاق الشفت غير صحيحة')
  }

  if (!Number.isFinite(leftForNextShift) || leftForNextShift < 0) {
    throw new Error('المبلغ المتروك للشفت التالي غير صحيح')
  }

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
