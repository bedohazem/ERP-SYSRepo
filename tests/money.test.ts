import { describe, expect, it } from 'vitest';

import { formatMoney, roundMoney } from '../src/shared/money';

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

  it('formats money without decimal fractions', () => {
    expect(formatMoney(12)).toBe('12 ج.م');

    expect(formatMoney(12.49)).toBe('12 ج.م');

    expect(formatMoney(12.5)).toBe('13 ج.م');

    expect(formatMoney(100)).not.toContain('.00');
  });
});
