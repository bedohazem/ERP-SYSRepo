import { describe, expect, it } from 'vitest';
import { buildPurchaseBarcodePlan } from '../../src/renderer/utils/purchase-barcode-print';

describe('purchase invoice barcode print plan', () => {
  it('prints exactly the purchased quantities, not global copy settings', () => {
    const plan = buildPurchaseBarcodePlan([
      { product_name: 'تيشيرت', barcode: 'PUR001', quantity: 10, sell_price: 200 },
      { product_name: 'بنطلون', barcode: 'PUR002', quantity: 5, sell_price: 300 },
    ]);
    expect(plan.map((item) => item.quantity)).toEqual([10, 5]);
    expect(plan.reduce((total, item) => total + item.quantity, 0)).toBe(15);
  });

  it('uses selling prices, not the purchase cost, and handles discount labels', () => {
    const [item] = buildPurchaseBarcodePlan([
      {
        product_name: 'تيشيرت', barcode: 'SHIRT-M', quantity: 4,
        sell_price: 250, discount_price: 220,
      },
    ]);
    expect(item.price).toBe(250);
    expect(item.discountPrice).toBe(220);
  });

  it('rejects missing barcodes and fractional label counts', () => {
    expect(() => buildPurchaseBarcodePlan([
      { product_name: 'غير معروف', quantity: 2 },
    ])).toThrow('ليس له باركود');
    expect(() => buildPurchaseBarcodePlan([
      { barcode: 'ABC', quantity: 1.5 },
    ])).toThrow('غير صالحة');
  });

  it('does not print 0 or negative label counts', () => {
    expect(() => buildPurchaseBarcodePlan([
      { barcode: 'ABC', quantity: 0 },
    ])).toThrow('غير صالحة');
    expect(() => buildPurchaseBarcodePlan([
      { barcode: 'ABC', quantity: -1 },
    ])).toThrow('غير صالحة');
  });
});
