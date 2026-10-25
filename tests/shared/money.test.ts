import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  roundFinancial,
  roundMoney,
} from '../../src/shared/money';

describe('whole-pound money policy', () => {
  it('rounds .5 and above up and values below .5 down', () => {
    expect(roundMoney(10)).toBe(10);

    expect(roundMoney(10.49)).toBe(10);

    expect(roundMoney(10.5)).toBe(11);

    expect(roundMoney(10.99)).toBe(11);

    expect(roundMoney(100.499)).toBe(100);

    expect(roundMoney(100.5)).toBe(101);
  });

  it('rounds negative accounting differences symmetrically', () => {
    expect(roundMoney(-10.49)).toBe(-10);

    expect(roundMoney(-10.5)).toBe(-11);
  });

  it('never returns fractional money', () => {
    const samples = [0, 0.49, 0.5, 12.75, 999.01, -20.8];

    for (const sample of samples) {
      expect(Number.isInteger(roundMoney(sample))).toBe(true);
    }
  });

  it('formats financial values without unnecessary trailing zeros', () => {
    expect(formatMoney(100)).toBe('100 ج.م');

    expect(formatMoney(100.5)).toBe('100.5 ج.م');

    expect(formatMoney(100.05)).toBe('100.05 ج.م');

    expect(formatMoney(100.055)).toBe('100.06 ج.م');
  });

  it('keeps financial amounts at two decimal places', () => {
    expect(roundFinancial(100)).toBe(100);

    expect(roundFinancial(100.05)).toBe(100.05);

    expect(roundFinancial(100.055)).toBe(100.06);

    expect(roundFinancial(-10.555)).toBe(-10.55);
  });
});
