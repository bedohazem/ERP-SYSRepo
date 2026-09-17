import { getDb } from './db'

export function getShiftBusinessDate(shiftIdInput: number): string {
  const db = getDb()

  const shiftId = Number(shiftIdInput || 0)

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error('رقم الشفت غير صحيح')
  }

  const row = db
    .prepare(
      `
      SELECT
        date(
          opened_at,
          'localtime'
        ) AS business_date

      FROM cash_shifts

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(shiftId) as
    | {
        business_date: string
      }
    | undefined

  const businessDate = String(row?.business_date || '')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error('تعذر تحديد تاريخ الشفت')
  }

  return businessDate
}
