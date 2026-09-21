export type CashAccountKey =
  | 'store_cash'
  | 'owner_cash'
  | 'owner_bank'
  | 'owner_vodafone'
  | 'fawry_machine'
  | 'store_safe'

export const CASH_ACCOUNT_OPTIONS: Array<{
  value: CashAccountKey
  label: string
}> = [
  { value: 'store_cash', label: 'كاش درج المحل' },
  { value: 'owner_cash', label: 'كاش مع المالك' },
  { value: 'owner_bank', label: 'حساب بنك / فيزا المالك' },
  { value: 'owner_vodafone', label: 'فودافون كاش المالك' },
  { value: 'fawry_machine', label: 'ماكينة فوري' },
]

export const CUSTOMER_PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'كاش' },
  { value: 'card', label: 'كارت / فيزا' },
  { value: 'wallet', label: 'محفظة / فودافون كاش' },
  { value: 'bank_transfer', label: 'تحويل بنكي / انستا باي' },
]

export const ADMIN_CUSTOMER_PAYMENT_METHOD_OPTIONS = [
  ...CUSTOMER_PAYMENT_METHOD_OPTIONS,
  { value: 'store_safe', label: 'الخزنة الآمنة' },
]

export const ADMIN_CASH_ACCOUNT_OPTIONS = [
  ...CASH_ACCOUNT_OPTIONS,
  { value: 'store_safe' as const, label: 'الخزنة الآمنة' },
]

export function getPaymentMethodLabel(value?: string | null) {
  switch (value) {
    case 'cash':
      return 'كاش'

    case 'card':
      return 'كارت / فيزا'

    case 'wallet':
      return 'محفظة'

    case 'bank':
    case 'bank_transfer':
      return 'تحويل بنكي / انستا باي'

    case 'store_cash':
      return 'كاش درج المحل'

    case 'store_safe':
      return 'الخزنة الآمنة'

    case 'owner_cash':
      return 'كاش مع المالك'

    case 'owner_bank':
      return 'حساب بنك / فيزا المالك'

    case 'owner_vodafone':
      return 'فودافون كاش المالك'

    case 'fawry_machine':
      return 'ماكينة فوري'
    case 'split':
      return 'دفع متعدد'

    default:
      return value || '—'
  }
}

export function getPaymentMethodShortLabel(value?: string | null) {
  switch (value) {
    case 'cash':
    case 'store_cash':
      return 'كاش'

    case 'card':
    case 'fawry_machine':
      return 'فيزا'

    case 'wallet':
    case 'owner_vodafone':
      return 'فودافون كاش'

    case 'bank':
    case 'bank_transfer':
    case 'owner_bank':
      return 'انستا'

    case 'owner_cash':
      return 'كاش المالك'

    case 'store_safe':
      return 'الخزنة'

    case 'split':
      return ''

    default:
      return value || '—'
  }
}

export function getCashAccountLabel(value?: string | null) {
  return getPaymentMethodLabel(value)
}
