import { getDb } from '../db'
import { createActivityLog } from './activity.repo'

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
