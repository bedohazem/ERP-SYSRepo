import { describe, expect, it } from 'vitest';

import { calculatePurchaseReturnSettlement } from '../../src/shared/purchase-return-financials';

describe('purchase return settlement', () => {
  it('preserves normal invoice accounting', () => {
    expect(
      calculatePurchaseReturnSettlement({
        invoiceTotal: 54.02,
        invoiceCost: 54.02,
        previouslyReturnedFinancial: 0,
        previouslyReturnedCost: 0,
        requestedCost: 18.01,
        completesInvoice: false,
      }),
    ).toEqual({
      financialAmount: 18.01,
      inventoryCost: 18.01,
      costAdjustment: 0,
      remainingFinancial: 36.01,
      remainingCost: 36.01,
    });
  });

  it.each([
    {
      invoice: 19022.5,
      cost: 19022.54,
      adjustment: -0.04,
    },
    {
      invoice: 3671.88,
      cost: 3671.87,
      adjustment: 0.01,
    },
    {
      invoice: 15405.62,
      cost: 15405.65,
      adjustment: -0.03,
    },
    {
      invoice: 0,
      cost: 0,
      adjustment: 0,
    },
  ])('reconciles a full return: $invoice / $cost', (scenario) => {
    const result = calculatePurchaseReturnSettlement({
      invoiceTotal: scenario.invoice,
      invoiceCost: scenario.cost,
      previouslyReturnedFinancial: 0,
      previouslyReturnedCost: 0,
      requestedCost: scenario.cost,
      completesInvoice: true,
    });

    expect(result.financialAmount).toBe(scenario.invoice);
    expect(result.inventoryCost).toBe(scenario.cost);
    expect(result.costAdjustment).toBe(scenario.adjustment);

    expect(result.remainingFinancial).toBe(0);
    expect(result.remainingCost).toBe(0);
  });

  it.each([
    { invoice: 100, cost: 100.04, adjustment: -0.04 },
    { invoice: 100.04, cost: 100, adjustment: 0.04 },
  ])('reconciles multiple partial returns: $invoice / $cost', (scenario) => {
    const first = calculatePurchaseReturnSettlement({
      invoiceTotal: scenario.invoice,
      invoiceCost: scenario.cost,
      previouslyReturnedFinancial: 0,
      previouslyReturnedCost: 0,
      requestedCost: 40,
      completesInvoice: false,
    });

    expect(first.financialAmount).toBe(40);
    expect(first.costAdjustment).toBe(0);

    const second = calculatePurchaseReturnSettlement({
      invoiceTotal: scenario.invoice,
      invoiceCost: scenario.cost,
      previouslyReturnedFinancial: first.financialAmount,
      previouslyReturnedCost: first.inventoryCost,
      requestedCost: first.remainingCost,
      completesInvoice: true,
    });

    expect(second.financialAmount).toBe(first.remainingFinancial);

    expect(second.costAdjustment).toBe(scenario.adjustment);
    expect(second.remainingFinancial).toBe(0);
    expect(second.remainingCost).toBe(0);
  });

  it('never over-refunds the saved invoice amount', () => {
    const first = calculatePurchaseReturnSettlement({
      invoiceTotal: 100,
      invoiceCost: 100.04,
      previouslyReturnedFinancial: 0,
      previouslyReturnedCost: 0,
      requestedCost: 100.01,
      completesInvoice: false,
    });

    expect(first.financialAmount).toBe(100);
    expect(first.inventoryCost).toBe(100.01);
    expect(first.costAdjustment).toBe(-0.01);

    const second = calculatePurchaseReturnSettlement({
      invoiceTotal: 100,
      invoiceCost: 100.04,
      previouslyReturnedFinancial: 100,
      previouslyReturnedCost: 100.01,
      requestedCost: 0.03,
      completesInvoice: true,
    });

    expect(second.financialAmount).toBe(0);
    expect(second.inventoryCost).toBe(0.03);
    expect(second.costAdjustment).toBe(-0.03);
    expect(second.remainingCost).toBe(0);
  });

  it('rejects material historical discrepancies', () => {
    expect(() =>
      calculatePurchaseReturnSettlement({
        invoiceTotal: 100,
        invoiceCost: 101,
        previouslyReturnedFinancial: 0,
        previouslyReturnedCost: 0,
        requestedCost: 101,
        completesInvoice: true,
      }),
    ).toThrow('manual review');
  });

  it('rejects returns exceeding the available cost', () => {
    expect(() =>
      calculatePurchaseReturnSettlement({
        invoiceTotal: 100,
        invoiceCost: 100,
        previouslyReturnedFinancial: 80,
        previouslyReturnedCost: 80,
        requestedCost: 21,
        completesInvoice: false,
      }),
    ).toThrow();
  });

  it('rejects inconsistent historical allocations', () => {
    expect(() =>
      calculatePurchaseReturnSettlement({
        invoiceTotal: 100,
        invoiceCost: 100.04,
        previouslyReturnedFinancial: 40,
        previouslyReturnedCost: 39,
        requestedCost: 10,
        completesInvoice: false,
      }),
    ).toThrow();
  });

  it('rejects an incomplete cost marked as a full return', () => {
    expect(() =>
      calculatePurchaseReturnSettlement({
        invoiceTotal: 100,
        invoiceCost: 100,
        previouslyReturnedFinancial: 0,
        previouslyReturnedCost: 0,
        requestedCost: 90,
        completesInvoice: true,
      }),
    ).toThrow();
  });

  it.each([-1, NaN, Infinity, 10.001])(
    'rejects invalid monetary input: %s',
    (amount) => {
      expect(() =>
        calculatePurchaseReturnSettlement({
          invoiceTotal: 100,
          invoiceCost: 100,
          previouslyReturnedFinancial: 0,
          previouslyReturnedCost: 0,
          requestedCost: amount,
          completesInvoice: false,
        }),
      ).toThrow();
    },
  );
});
