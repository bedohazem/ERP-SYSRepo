import { describe, expect, it } from 'vitest';

import { getSaleAuditItemChanges } from '../../src/renderer/components/SaleAuditChanges';

describe('sale audit item changes', () => {
  it('detects quantity and selling price changes', () => {
    const result = getSaleAuditItemChanges(
      [
        {
          variant_id: 1,
          product_name: 'Test Product',
          quantity: 1,
          unit_price: 100,
          line_total: 100,
        },
      ],
      [
        {
          variant_id: 1,
          product_name: 'Test Product',
          quantity: 2,
          unit_price: 120,
          line_total: 240,
        },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('changed');
    expect(result[0].beforeQuantity).toBe(1);
    expect(result[0].afterQuantity).toBe(2);
    expect(result[0].beforePrice).toBe(100);
    expect(result[0].afterPrice).toBe(120);
  });

  it('detects added products', () => {
    const result = getSaleAuditItemChanges(
      [],
      [
        {
          variant_id: 2,
          product_name: 'New Product',
          quantity: 1,
          unit_price: 200,
          line_total: 200,
        },
      ],
    );

    expect(result[0].status).toBe('added');
    expect(result[0].beforeQuantity).toBeNull();
    expect(result[0].afterQuantity).toBe(1);
  });

  it('detects removed products', () => {
    const result = getSaleAuditItemChanges(
      [
        {
          variant_id: 3,
          product_name: 'Old Product',
          quantity: 1,
          unit_price: 150,
          line_total: 150,
        },
      ],
      [],
    );

    expect(result[0].status).toBe('removed');
    expect(result[0].beforeQuantity).toBe(1);
    expect(result[0].afterQuantity).toBeNull();
  });

  it('does not report unchanged items', () => {
    const item = {
      variant_id: 1,
      product_name: 'Same Product',
      quantity: 2,
      unit_price: 100,
      line_total: 200,
    };

    expect(getSaleAuditItemChanges([item], [{ ...item }])).toEqual([]);
  });

  it('aggregates duplicate variant lines accurately', () => {
    const result = getSaleAuditItemChanges(
      [
        {
          variant_id: 1,
          quantity: 1,
          unit_price: 100,
          line_total: 100,
        },
        {
          variant_id: 1,
          quantity: 2,
          unit_price: 100,
          line_total: 200,
        },
      ],
      [
        {
          variant_id: 1,
          quantity: 4,
          unit_price: 100,
          line_total: 400,
        },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0].beforeQuantity).toBe(3);
    expect(result[0].afterQuantity).toBe(4);
    expect(result[0].beforePrice).toBe(100);
    expect(result[0].afterPrice).toBe(100);
  });
});
