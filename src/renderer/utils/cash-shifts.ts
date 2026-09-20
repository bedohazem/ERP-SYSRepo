export type CashShiftVarianceStage = 'opening' | 'closing'

export type CashShiftVarianceKind = 'shortage' | 'surplus'

export type CashShiftVarianceStatus = 'pending' | 'resolved'

export function getCashShiftVarianceStageLabel(value?: string | null) {
  switch (value) {
    case 'opening':
      return 'افتتاح الشفت'

    case 'closing':
      return 'إغلاق الشفت'

    default:
      return 'غير معروف'
  }
}

export function getCashShiftVarianceKindLabel(value?: string | null) {
  switch (value) {
    case 'shortage':
      return 'عجز'

    case 'surplus':
      return 'زيادة'

    default:
      return 'غير معروف'
  }
}

export function getCashShiftVarianceStatusLabel(value?: string | null) {
  switch (value) {
    case 'pending':
      return 'قيد المراجعة'

    case 'resolved':
      return 'تمت المراجعة'

    default:
      return 'غير معروف'
  }
}

export function getCashShiftVarianceResolutionLabel(value?: string | null) {
  switch (value) {
    case 'approved':
      return 'فرق فعلي معتمد — يؤثر على رأس المال'

    case 'explained':
      return 'معالجة يدوية — بدون تأثير على رأس المال'

    case 'other':
      return 'مراجعة قديمة'

    default:
      return '—'
  }
}

export function canResolveCashShiftVariance(
  variance?: {
    status?: string | null
  } | null,
) {
  return variance?.status === 'pending'
}

export function getCashShiftStatusLabel(value?: string | null) {
  switch (value) {
    case 'open':
      return 'مفتوح'

    case 'closed':
      return 'مغلق'

    default:
      return 'غير معروف'
  }
}

export function formatCashShiftDuration(minutesInput?: number | null) {
  const minutes = Math.max(0, Math.floor(Number(minutesInput || 0)))

  const hours = Math.floor(minutes / 60)

  const remainingMinutes = minutes % 60

  if (hours <= 0) {
    return `${remainingMinutes} دقيقة`
  }

  if (remainingMinutes <= 0) {
    return `${hours} ساعة`
  }

  return `${hours} ساعة و ${remainingMinutes} دقيقة`
}
