import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyProductsTable } from '../../src/renderer/pages/Dashboard/DailyProductsTable';
import {
  filterDailyProducts,
  paginateDailyProducts,
  summarizeDailyProducts,
  type DailyProductRow,
} from '../../src/renderer/pages/Dashboard/daily-products-model';

const row = (overrides: Partial<DailyProductRow> = {}): DailyProductRow => ({
  variant_id: 1,
  product_name: 'تيشيرت',
  size: 'L',
  color: 'أسود',
  sold_quantity: 3,
  returned_quantity: 1,
  exchange_quantity: 0,
  cancellation_quantity: 0,
  net_quantity: 2,
  ...overrides,
});

describe('daily products modal data and rendering', () => {
  it('searches Arabic name, size, color and variant id, ignoring case and outer spaces', () => {
    const rows = [
      row(),
      row({ variant_id: 2, product_name: 'HOODIE', size: 'XL', color: 'Blue' }),
    ];

    expect(filterDailyProducts(rows, ' تيشيرت ')).toEqual([rows[0]]);
    expect(filterDailyProducts(rows, 'hoodie')).toEqual([rows[1]]);
    expect(filterDailyProducts(rows, ' xl ')).toEqual([rows[1]]);
    expect(filterDailyProducts(rows, 'Blue')).toEqual([rows[1]]);
    expect(filterDailyProducts(rows, '2')).toEqual([rows[1]]);
    expect(filterDailyProducts(rows, 'not-present')).toEqual([]);
    expect(filterDailyProducts(rows, '')).toEqual(rows);
  });

  it('paginates 51 items with 50 per page without dropping or duplicating a row', () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      row({ variant_id: index + 1 }),
    );

    expect(paginateDailyProducts(rows, 1, 50)).toHaveLength(50);
    expect(paginateDailyProducts(rows, 2, 50)).toHaveLength(1);
    expect(paginateDailyProducts(rows, 2, 50)[0].variant_id).toBe(51);
    expect(paginateDailyProducts(rows, 999, 50)[0].variant_id).toBe(51);
    expect(paginateDailyProducts(rows, -5, 50)[0].variant_id).toBe(1);
    expect(
      paginateDailyProducts(rows, 1, 50).length +
        paginateDailyProducts(rows, 2, 50).length,
    ).toBe(51);
  });

  it('keeps a zero-net product in the results and reports its sales and returns', () => {
    const zero = row({
      variant_id: 5,
      sold_quantity: 2,
      returned_quantity: 2,
      net_quantity: 0,
    });
    const negative = row({
      variant_id: 6,
      sold_quantity: 0,
      returned_quantity: 1,
      net_quantity: -1,
    });
    const rows = filterDailyProducts([zero, negative], '');

    expect(rows).toHaveLength(2);
    expect(summarizeDailyProducts(rows)).toEqual({
      sold: 2,
      returned: 3,
      exchanged: 0,
      cancelled: 0,
      net: -1,
    });
  });

  it('keeps exchange and cancellation contributions separate', () => {
    const totals = summarizeDailyProducts([
      row({
        sold_quantity: 0,
        returned_quantity: 0,
        exchange_quantity: -1,
        cancellation_quantity: 1,
        net_quantity: 0,
      }),
      row({
        sold_quantity: 0,
        returned_quantity: 0,
        exchange_quantity: 1,
        cancellation_quantity: -1,
        net_quantity: 0,
      }),
    ]);
    expect(totals).toEqual({
      sold: 0,
      returned: 0,
      exchanged: 0,
      cancelled: 0,
      net: 0,
    });
  });

  it('renders all eight column headers, even for an empty result', () => {
    const html = renderToStaticMarkup(
      createElement(DailyProductsTable, { rows: [], empty: true }),
    );
    for (const title of [
      'المنتج',
      'المقاس',
      'اللون',
      'مباع',
      'مرتجع',
      'استبدال',
      'إلغاءات',
      'الصافي',
    ]) {
      expect(html).toContain(title);
    }
    expect(html.match(/<th /g) || []).toHaveLength(8);
    expect(html).toContain('لا توجد حركات منتجات مطابقة');
  });

  it('renders zero-net and negative-net rows, safely escaping product names', () => {
    const html = renderToStaticMarkup(
      createElement(DailyProductsTable, {
        rows: [
          row({ product_name: '<script>alert(1)</script>', net_quantity: 0 }),
          row({
            variant_id: 2,
            product_name: 'مرتجع قديم',
            sold_quantity: 0,
            returned_quantity: 1,
            net_quantity: -1,
          }),
        ],
        empty: false,
      }),
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('مرتجع قديم');
    expect(html).toContain('>0</td>');
    expect(html).toContain('>-1</td>');
    expect(html.match(/<tr /g) || []).toHaveLength(3);
  });
});
