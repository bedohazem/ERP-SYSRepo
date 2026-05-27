export function getPaymentMethodLabel(value?: string | null) {
  switch (value) {
    case 'cash':
      return 'كاش';

    case 'card':
      return 'كارت / فيزا';

    case 'wallet':
      return 'محفظة';

    case 'bank':
    case 'bank_transfer':
      return 'تحويل بنكي / انستا باي';

    default:
      return value || '—';
  }
}