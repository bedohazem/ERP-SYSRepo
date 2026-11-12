import { describe, expect, it } from 'vitest';
import { calculateExchangeDiscount } from '../../src/shared/exchange-discount';

const unit = (payable: number, existingDiscount = 0) => [
  { id: 1, payable, existingDiscount },
];

describe('exchange discretionary discount', () => {
  it('applies amount to a positive difference', () => {
    const result = calculateExchangeDiscount({
      type: 'amount',
      value: 10,
      positiveDifference: 50,
      units: unit(250),
    });
    expect(result.appliedDiscount).toBe(10);
    expect(result.discountDelta).toBe(10);
    expect(result.allocatedByUnit.get(1)).toBe(10);
  });
  it('applies percentage to the difference, not to the replacement price', () => {
    expect(
      calculateExchangeDiscount({
        type: 'percent',
        value: 10,
        positiveDifference: 50,
        units: unit(250),
      }).appliedDiscount,
    ).toBe(5);
  });
  it('cannot exceed the positive difference', () => {
    expect(
      calculateExchangeDiscount({
        type: 'amount',
        value: 100,
        positiveDifference: 50,
        units: unit(250),
      }).appliedDiscount,
    ).toBe(50);
  });
  it('never introduces extra discount on a zero or negative difference', () => {
    expect(
      calculateExchangeDiscount({
        type: 'amount',
        value: 20,
        positiveDifference: -20,
        units: unit(250),
      }).appliedDiscount,
    ).toBe(0);
  });
  it('keeps existing discounts when changing the replacement again', () => {
    const result = calculateExchangeDiscount({
      type: 'amount',
      value: 0,
      positiveDifference: 50,
      units: unit(300, 10),
    });
    expect(result.appliedDiscount).toBe(0);
    expect(result.nextGroupDiscount).toBe(10);
    expect(result.discountDelta).toBe(0);
  });
  it('caps old discount when the new group cannot carry it', () => {
    const result = calculateExchangeDiscount({
      type: 'amount',
      value: 0,
      positiveDifference: 0,
      units: unit(5, 10),
    });
    expect(result.nextGroupDiscount).toBe(5);
    expect(result.discountDelta).toBe(-5);
  });
  it('splits the discount deterministically among paid units', () => {
    const result = calculateExchangeDiscount({
      type: 'amount',
      value: 10,
      positiveDifference: 20,
      units: [
        { id: 1, payable: 250, existingDiscount: 0 },
        { id: 2, payable: 150, existingDiscount: 0 },
      ],
    });
    expect(result.allocatedByUnit.get(1)).toBe(6);
    expect(result.allocatedByUnit.get(2)).toBe(4);
  });
  it('rejects a percentage above 100', () => {
    expect(() =>
      calculateExchangeDiscount({
        type: 'percent',
        value: 120,
        positiveDifference: 50,
        units: unit(250),
      }),
    ).toThrow('100%');
  });
});
