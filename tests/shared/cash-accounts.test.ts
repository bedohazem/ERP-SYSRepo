import { describe, expect, it } from 'vitest';

import {
  CASH_ACCOUNT_KEYS,
  isCashAccountKey,
  resolveCashAccountKey,
} from '../../src/shared/cash-accounts';

describe('cash account contract', () => {
  it('contains unique canonical accounts', () => {
    expect(new Set(CASH_ACCOUNT_KEYS).size).toBe(CASH_ACCOUNT_KEYS.length);

    for (const account of CASH_ACCOUNT_KEYS) {
      expect(isCashAccountKey(account)).toBe(true);

      expect(resolveCashAccountKey(account)).toBe(account);
    }
  });

  it('normalizes legacy payment methods', () => {
    expect(resolveCashAccountKey('cash')).toBe('store_cash');

    expect(resolveCashAccountKey('card')).toBe('fawry_machine');

    expect(resolveCashAccountKey('wallet')).toBe('owner_vodafone');

    expect(resolveCashAccountKey('bank')).toBe('owner_bank');

    expect(resolveCashAccountKey('bank_transfer')).toBe('owner_bank');
  });

  it('keeps legacy fallback behavior for empty or unknown values', () => {
    expect(resolveCashAccountKey(null)).toBe('store_cash');

    expect(resolveCashAccountKey('')).toBe('store_cash');

    expect(resolveCashAccountKey('legacy_unknown')).toBe('store_cash');
  });
});
