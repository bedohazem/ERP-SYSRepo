import { getDb } from './db';

import { getShiftBusinessDate } from './shift-business-date';

import {
  assertSystemClockStable,
  getLocalBusinessDate,
} from './system-clock-guard';

function getBusinessDateGapDays(previousDate: string, currentDate: string) {
  const previousMs = Date.parse(`${previousDate}T00:00:00Z`);

  const currentMs = Date.parse(`${currentDate}T00:00:00Z`);

  if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs)) {
    throw new Error('تعذر التحقق من تاريخ العملية المالية');
  }

  return Math.round((currentMs - previousMs) / 86_400_000);
}

export function resolveFinancialBusinessDate(
  shiftIdInput?: number | null,
): string {
  assertSystemClockStable();

  const shiftId = Number(shiftIdInput || 0);

  /*
   * العملية مرتبطة بشفت:
   * تاريخ الشفت هو المرجع النهائي.
   */
  if (shiftId > 0) {
    if (!Number.isInteger(shiftId)) {
      throw new Error('رقم الشفت غير صحيح');
    }

    return getShiftBusinessDate(shiftId);
  }

  /*
   * Admin بدون شفت.
   *
   * نحتاج وجود شفت سابق
   * كنقطة مرجعية للنظام.
   */
  const db = getDb();

  const previousShift = db
    .prepare(
      `
      SELECT
        id,

        COALESCE(
          NULLIF(
            business_date,
            ''
          ),

          date(
            opened_at,
            'localtime'
          )
        ) AS business_date

      FROM cash_shifts

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get() as
    | {
        id: number;

        business_date: string;
      }
    | undefined;

  const previousBusinessDate = String(previousShift?.business_date || '');

  if (!previousShift || !/^\d{4}-\d{2}-\d{2}$/.test(previousBusinessDate)) {
    throw new Error(
      'يجب فتح أول شفت في النظام قبل تنفيذ أي عملية مالية بدون شفت. تأكد من تاريخ ووقت الجهاز ثم افتح أول شفت.',
    );
  }

  const currentBusinessDate = getLocalBusinessDate();

  const gapDays = getBusinessDateGapDays(
    previousBusinessDate,
    currentBusinessDate,
  );

  /*
   * Windows رجع لتاريخ أقدم
   * من آخر شفت.
   */
  if (gapDays < 0) {
    throw new Error(
      `تاريخ الجهاز ${currentBusinessDate} أقدم من آخر شفت بتاريخ ${previousBusinessDate}. صحح تاريخ Windows قبل تنفيذ العملية المالية.`,
    );
  }

  /*
   * نفس اليوم أو اليوم التالي
   * انتقال طبيعي.
   */
  if (gapDays <= 1) {
    return currentBusinessDate;
  }

  /*
   * قفزة أكبر من يوم:
   *
   * لا نعتمد Windows مباشرة.
   *
   * لو المحل كان مغلقًا فعلًا،
   * يفتح المدير شفتًا جديدًا أولًا
   * ويؤكد القفزة من شاشة الشفت.
   */
  throw new Error(
    `يوجد فرق ${gapDays} أيام بين تاريخ الجهاز ${currentBusinessDate} وآخر شفت بتاريخ ${previousBusinessDate}. افتح شفتًا جديدًا أولًا لتأكيد التاريخ قبل تنفيذ عملية مالية بدون شفت.`,
  );
}
