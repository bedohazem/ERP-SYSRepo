export type CashShiftVarianceStage = 'opening' | 'closing'

export type CashShiftVarianceKind = 'shortage' | 'surplus'

export type CashShiftVarianceStatus = 'pending' | 'resolved'

export type CashShiftVarianceResolutionType = 'approved' | 'explained' | 'other'

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
      return 'تم التحقق واعتماد الفرق'

    case 'explained':
      return 'تم تفسير سبب الفرق'

    case 'other':
      return 'مراجعة أخرى'

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
