import { describe, expect, it } from 'vitest';

import { calculateInventoryCostReversal } from '../../src/shared/inventory-reversal-financials';

describe('inventory cost reversal', () => {
  it.each([
    {
      stock: 10,
      value: 1500,
      quantity: 2,
      requested: 400,
      actual: 400,
      adjustment: 0,
      remaining: 1100,
      fallback: false,
    },
    {
      stock: 10,
      value: 1500,
      quantity: 10,
      requested: 2000,
      actual: 1500,
      adjustment: 500,
      remaining: 0,
      fallback: true,
    },
    {
      stock: 10,
      value: 1500,
      quantity: 10,
      requested: 1000,
      actual: 1500,
      adjustment: -500,
      remaining: 0,
      fallback: true,
    },
    {
      stock: 10,
      value: 1500,
      quantity: 4,
      requested: 1600,
      actual: 600,
      adjustment: 1000,
      remaining: 900,
      fallback: true,
    },
    {
      stock: 10,
      value: 1000,
      quantity: 10,
      requested: 1000,
      actual: 1000,
      adjustment: 0,
      remaining: 0,
      fallback: false,
    },
    {
      stock: 6,
      value: 935,
      quantity: 6,
      requested: 934.98,
      actual: 935,
      adjustment: -0.02,
      remaining: 0,
      fallback: true,
    },
    {
      stock: 6,
      value: 935,
      quantity: 1,
      requested: 1000,
      actual: 155.83,
      adjustment: 844.17,
      remaining: 779.17,
      fallback: true,
    },
    {
      stock: 5,
      value: 0,
      quantity: 2,
      requested: 0,
      actual: 0,
      adjustment: 0,
      remaining: 0,
      fallback: false,
    },
    {
      stock: 5,
      value: 0,
      quantity: 2,
      requested: 100,
      actual: 0,
      adjustment: 100,
      remaining: 0,
      fallback: true,
    },
    {
      stock: 1,
      value: 100,
      quantity: 1,
      requested: 0,
      actual: 100,
      adjustment: -100,
      remaining: 0,
      fallback: true,
    },
  ])(
    'reconciles cost $requested against inventory $value and quantity $quantity',
    (scenario) => {
      const result = calculateInventoryCostReversal({
        stock: scenario.stock,
        inventoryValue: scenario.value,
        quantity: scenario.quantity,
        requestedCost: scenario.requested,
      });

      expect(result.actualCost).toBe(scenario.actual);

      expect(result.costAdjustment).toBe(scenario.adjustment);

      expect(result.remainingValue).toBe(scenario.remaining);

      expect(result.remainingStock).toBe(scenario.stock - scenario.quantity);

      expect(result.usedAverageFallback).toBe(scenario.fallback);

      expect(result.actualCost + result.remainingValue).toBeCloseTo(
        scenario.value,
        8,
      );

      expect(result.actualCost + result.costAdjustment).toBeCloseTo(
        scenario.requested,
        8,
      );
    },
  );

  it('rejects insufficient stock regardless of cost', () => {
    expect(() =>
      calculateInventoryCostReversal({
        stock: 2,
        inventoryValue: 1000,
        quantity: 3,
        requestedCost: 100,
      }),
    ).toThrow('Insufficient stock');
  });

  it.each([
    { stock: -1 },
    { stock: 0 },
    { inventoryValue: -1 },
    { quantity: 0 },
    { quantity: -1 },
    { requestedCost: -1 },
    { requestedCost: NaN },
    { inventoryValue: Infinity },
  ])('rejects invalid inventory reversal input: %j', (override) => {
    expect(() =>
      calculateInventoryCostReversal({
        stock: 5,
        inventoryValue: 500,
        quantity: 1,
        requestedCost: 100,
        ...override,
      }),
    ).toThrow();
  });
});
