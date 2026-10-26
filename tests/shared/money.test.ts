import { describe, expect, it } from 'vitest';

import {
  allocateProportionalAmount,
  formatMoney,
  roundCost,
  roundFinancial,
  roundMoney,
  splitAmountAcrossUnits,
  preservePrecision,
  truncateForDisplay,
  allocateProportionalAmountPrecise,
  hasPositivePreciseAmount,
  isEffectivelyZero,
  normalizePreciseZero,
  formatSignedPreciseMoney,
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

  it('keeps all cost values at cent precision', () => {
    expect(roundCost(100)).toBe(100);

    expect(roundCost(100.5)).toBe(100.5);

    expect(roundCost(100.25)).toBe(100.25);

    expect(roundCost(100.256)).toBe(100.26);
  });

  it('allocates proportional values without losing cents', () => {
    expect(allocateProportionalAmount(1870, 7, 12)).toBe(1090.83);

    expect(allocateProportionalAmount(779.17, 5, 5)).toBe(779.17);
    expect(allocateProportionalAmount(1870, 24, 12)).toBe(3740);
  });

  it('splits a value across units while preserving the exact total', () => {
    const units = splitAmountAcrossUnits(1090.83, 7);

    expect(units).toHaveLength(7);

    expect(roundCost(units.reduce((sum, value) => sum + value, 0))).toBe(
      1090.83,
    );

    expect(units.every((value) => roundCost(value) === value)).toBe(true);
  });

  it('preserves full precision and truncates only for display', () => {
    expect(preservePrecision(84.375)).toBe(84.375);

    expect(truncateForDisplay(100)).toBe('100');

    expect(truncateForDisplay(100.5)).toBe('100.5');

    expect(truncateForDisplay(84.375)).toBe('84.37');

    expect(truncateForDisplay(590.625)).toBe('590.62');

    expect(truncateForDisplay(100.3587)).toBe('100.35');

    expect(truncateForDisplay(15511.8675)).toBe('15511.86');

    expect(truncateForDisplay(0.1325)).toBe('0.13');
  });

  it('allocates inventory value without cent rounding', () => {
    expect(allocateProportionalAmountPrecise(590.625, 3, 7)).toBeCloseTo(
      253.125,
      12,
    );
  });

  it('ignores floating point noise around zero', () => {
    expect(isEffectivelyZero(0)).toBe(true);

    expect(isEffectivelyZero(0.0000000002)).toBe(true);

    expect(isEffectivelyZero(-0.0000000002)).toBe(true);

    expect(hasPositivePreciseAmount(0.0000000002)).toBe(false);

    expect(hasPositivePreciseAmount(0.000001)).toBe(true);

    expect(normalizePreciseZero(0.0000000002)).toBe(0);

    expect(normalizePreciseZero(-0.0000000002)).toBe(0);

    expect(normalizePreciseZero(84.375)).toBe(84.375);
  });

  it('formats precise signed money without positive zero noise', () => {
    expect(formatSignedPreciseMoney(84.375)).toBe('+84.37 ج.م');

    expect(formatSignedPreciseMoney(-84.375)).toBe('-84.37 ج.م');

    expect(formatSignedPreciseMoney(0.0000000002)).toBe('0 ج.م');

    expect(formatSignedPreciseMoney(-0.0000000002)).toBe('0 ج.م');
  });
});
