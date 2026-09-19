export type CashShiftVarianceStage = 'opening' | 'closing'

export type CashShiftVarianceKind = 'shortage' | 'surplus'

export type CashShiftVarianceStatus = 'pending' | 'resolved'

export type CashShiftVarianceResolutionType = 'approved' | 'explained' | 'other'

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

export type CashShiftVarianceRemainingKind = 'shortage' | 'surplus' | 'balanced'

export type CashShiftVarianceCorrectionOption = {
  value: CashShiftVarianceCorrectionReason
  label: string
}

const surplusCorrectionOptions: CashShiftVarianceCorrectionOption[] = [
  {
    value: 'unregistered_cash_sale',
    label: 'بيع كاش تم ولم يتم تسجيل الفاتورة',
  },
  {
    value: 'unregistered_customer_payment',
    label: 'دفعة عميل تم تحصيلها ولم يتم تسجيلها',
  },
  {
    value: 'unregistered_cash_deposit',
    label: 'إيداع كاش في الدرج لم يتم تسجيله',
  },
  {
    value: 'payment_recorded_non_cash_but_cash',
    label: 'عملية مسجلة فيزا/محفظة لكنها دُفعت كاش',
  },
  {
    value: 'recorded_expense_not_paid',
    label: 'مصروف مسجل لكنه لم يُدفع فعليًا',
  },
  {
    value: 'recorded_return_not_refunded',
    label: 'مرتجع مسجل لكن المبلغ لم يُرد للعميل',
  },
  {
    value: 'withdrawal_recorded_not_done',
    label: 'سحب نقدي مسجل لكنه لم يحدث فعليًا',
  },
  {
    value: 'cancelled_sale_cash_kept',
    label: 'فاتورة أُلغيت لكن الكاش لم يُرد للعميل',
  },
]

const shortageCorrectionOptions: CashShiftVarianceCorrectionOption[] = [
  {
    value: 'unregistered_expense',
    label: 'مصروف دُفع من الدرج ولم يتم تسجيله',
  },
  {
    value: 'unregistered_cash_withdrawal',
    label: 'سحب من الدرج لم يتم تسجيله',
  },
  {
    value: 'unregistered_safe_transfer',
    label: 'توريد للخزنة تم ولم يتم تسجيله',
  },
  {
    value: 'unregistered_return',
    label: 'مبلغ مرتجع دُفع للعميل ولم يتم تسجيله',
  },
  {
    value: 'payment_recorded_cash_but_non_cash',
    label: 'عملية مسجلة كاش لكنها دُفعت فيزا/محفظة',
  },
  {
    value: 'duplicate_cash_sale',
    label: 'فاتورة كاش مسجلة أكثر من مرة',
  },
  {
    value: 'sale_not_fully_collected',
    label: 'الفاتورة مسجلة مدفوعة لكن لم يتم تحصيل كامل المبلغ',
  },
  {
    value: 'credit_sale_marked_cash',
    label: 'بيع آجل تم تسجيله بالخطأ كاش',
  },
]

export function getCashShiftVarianceCorrectionOptions(
  kind?: CashShiftVarianceRemainingKind | null,
) {
  if (kind === 'surplus') {
    return surplusCorrectionOptions
  }

  if (kind === 'shortage') {
    return shortageCorrectionOptions
  }

  return []
}

export function getCashShiftVarianceCorrectionReasonLabel(
  value?: string | null,
) {
  const option = [
    ...surplusCorrectionOptions,
    ...shortageCorrectionOptions,
  ].find((item) => item.value === value)

  return option?.label || value || '—'
}

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
