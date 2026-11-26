import { describe, expect, it } from 'vitest';
import { calculatePurchaseFinancials } from '../../src/shared/purchase-financials';

const item = (variantId: number, quantity: number, unitCost: number) => ({
  variantId,
  quantity,
  unitCost,
});

describe('purchase financial calculation', () => {
  it('preserves the full precision until invoice aggregation', () => {
    const result = calculatePurchaseFinancials([
      item(1, 3, 10.005),
      item(2, 3, 10.005),
    ]);

    expect(result.rawSubtotal).toBe('60.03');
    expect(result.totalAmount).toBe(60.03);

    expect(result.lines.map((line) => line.netTotal)).toEqual([30.02, 30.01]);

    expect(result.lines.map((line) => line.unitCost)).toEqual([10.005, 10.005]);
  });

  it('calculates percentage discount before truncation', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 3, 10.005), item(2, 3, 10.005)],
      'percent',
      10,
    );

    expect(result.rawDiscount).toBe('6.003');
    expect(result.rawTotal).toBe('54.027');

    expect(result.subTotal).toBe(60.03);
    expect(result.discountValue).toBe(6.01);
    expect(result.totalAmount).toBe(54.02);

    const cents = result.lines.reduce(
      (total, line) => total + Math.round(line.netTotal * 100),
      0,
    );

    expect(cents).toBe(5402);
  });

  it('calculates 25 percent discount accurately', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 1, 60.03)],
      'percent',
      25,
    );

    expect(result.rawTotal).toBe('45.0225');
    expect(result.totalAmount).toBe(45.02);
  });

  it('truncates invoice 61 raw subtotal at the final boundary', () => {
    const result = calculatePurchaseFinancials([item(1, 1, 24710.6145)]);

    expect(result.totalAmount).toBe(24710.61);
  });

  it('applies discount to the untruncated subtotal', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 1, 100.019)],
      'percent',
      25,
    );

    expect(result.rawSubtotal).toBe('100.019');
    expect(result.rawTotal).toBe('75.01425');
    expect(result.totalAmount).toBe(75.01);
  });

  it('does not change the original price after fixed discount', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 1, 1000)],
      'amount',
      50,
    );

    expect(result.totalAmount).toBe(950);
    expect(result.lines[0].unitCost).toBe(1000);
    expect(result.lines[0].effectiveUnitCost).toBe(950);
  });

  it('keeps merged and split totals identical', () => {
    const split = calculatePurchaseFinancials([
      item(1, 3, 95.625),
      item(2, 5, 95.625),
    ]);

    const merged = calculatePurchaseFinancials([item(1, 8, 95.625)]);

    expect(split.totalAmount).toBe(765);
    expect(split.totalAmount).toBe(merged.totalAmount);
  });

  it('allocates cents independently of line ordering', () => {
    const items = [item(1, 3, 10.005), item(2, 3, 10.005), item(3, 7, 84.375)];

    const first = calculatePurchaseFinancials(items, 'percent', 25);

    const second = calculatePurchaseFinancials(
      [...items].reverse(),
      'percent',
      25,
    );

    expect(first.totalAmount).toBe(second.totalAmount);

    expect(first.lines).toEqual([...second.lines].reverse());
  });

  it('handles recurring decimal input noise consistently', () => {
    const result = calculatePurchaseFinancials([item(1, 6, 935 / 6)]);

    expect(result.totalAmount).toBe(935);
  });

  it('supports a full discount without negative line values', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 3, 10.005), item(2, 7, 84.375)],
      'percent',
      100,
    );

    expect(result.totalAmount).toBe(0);

    expect(result.lines.every((line) => line.netTotal === 0)).toBe(true);
  });

  it('caps a fixed discount at the original subtotal', () => {
    const result = calculatePurchaseFinancials(
      [item(1, 1, 100)],
      'amount',
      150,
    );

    expect(result.discountValue).toBe(100);
    expect(result.totalAmount).toBe(0);
  });

  it('handles empty and zero-cost draft lines', () => {
    expect(calculatePurchaseFinancials([]).totalAmount).toBe(0);

    expect(
      calculatePurchaseFinancials([item(1, 0, 100), item(2, 10, 0)])
        .totalAmount,
    ).toBe(0);
  });

  it('rejects invalid financial inputs', () => {
    expect(() => calculatePurchaseFinancials([item(1, -1, 100)])).toThrow();

    expect(() => calculatePurchaseFinancials([item(1, 1, NaN)])).toThrow();

    expect(() =>
      calculatePurchaseFinancials([item(1, 1, 100)], 'percent', 101),
    ).toThrow();

    expect(() =>
      calculatePurchaseFinancials([item(1, 1, 100)], 'amount', -10),
    ).toThrow();
  });

  it('reconciles all posted amounts across many invoices', () => {
    for (let n = 1; n <= 100; n += 1) {
      const items = Array.from({ length: 23 }, (_, index) =>
        item(
          index + 1,
          1 + ((index + n) % 12),
          (10001 + index * 137 + n) / 1000,
        ),
      );

      const result = calculatePurchaseFinancials(items, 'percent', n % 101);

      const cents = (value: number) => Math.round(value * 100);

      expect(
        result.lines.reduce((total, line) => total + cents(line.grossTotal), 0),
      ).toBe(cents(result.subTotal));

      expect(
        result.lines.reduce((total, line) => total + cents(line.discount), 0),
      ).toBe(cents(result.discountValue));

      expect(
        result.lines.reduce((total, line) => total + cents(line.netTotal), 0),
      ).toBe(cents(result.totalAmount));

      for (const line of result.lines) {
        expect(line.netTotal).toBeGreaterThanOrEqual(0);

        expect(cents(line.grossTotal) - cents(line.discount)).toBe(
          cents(line.netTotal),
        );
      }
    }
  });
});
