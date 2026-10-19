export const CASH_ACCOUNT_KEYS = [
  'store_cash',
  'store_safe',
  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',
] as const;

export type CashAccountKey = (typeof CASH_ACCOUNT_KEYS)[number];

export const CASH_ACCOUNT_LABELS: Record<CashAccountKey, string> = {
  store_cash: 'كاش درج المحل',

  store_safe: 'الخزنة الآمنة',

  owner_cash: 'كاش مع المالك',

  owner_bank: 'حساب بنك / فيزا المالك',

  owner_vodafone: 'فودافون كاش المالك',

  fawry_machine: 'ماكينة فوري',
};

const CASH_ACCOUNT_KEY_SET = new Set<string>(CASH_ACCOUNT_KEYS);

export function isCashAccountKey(value: unknown): value is CashAccountKey {
  return typeof value === 'string' && CASH_ACCOUNT_KEY_SET.has(value);
}

export function resolveCashAccountKey(value?: string | null): CashAccountKey {
  const cleanValue = String(value ?? '').trim();

  if (isCashAccountKey(cleanValue)) {
    return cleanValue;
  }

  switch (cleanValue) {
    case 'cash':
      return 'store_cash';

    case 'card':
      return 'fawry_machine';

    case 'wallet':
      return 'owner_vodafone';

    case 'bank':
    case 'bank_transfer':
      return 'owner_bank';

    default:
      /*
       * نفس الـlegacy behavior الحالي:
       * أي قيمة قديمة/فارغة غير معروفة
       * تعتبر Store Cash.
       */
      return 'store_cash';
  }
}
