import { describe, expect, it } from 'vitest';

import {
  buildReportsCsv,
  buildReportsPdfHtml,
} from '../../src/renderer/pages/Reports/report-export';

const data = {
  summary: {
    gross_sales: 100,
    net_sales: 90,
    total_returns: 10,
    gross_profit_before_discounts: 30.75,

    net_profit_after_discounts: 27.25,

    final_net_profit: 25.31,
    sales_count: 2,
    total_purchase_invoices: 46,

    total_purchase_exact_amount: 45.69,

    purchase_rounding_increase: 0.31,

    purchase_rounding_decrease: 0,

    purchase_rounding_net: 0.31,
  },

  cashAccounts: [
    {
      payment_method: 'store_cash',

      label: 'كاش درج المحل',

      total_in: 100,

      total_out: 20,

      balance: 80,
    },
  ],

  cashAccountsTotalBalance: 80,

  cashierSales: [
    {
      cashier_name: 'أحمد',

      sales_count: 2,

      sales_total: 100,

      returns_count: 1,

      returns_total: 10,

      exchange_count: 0,

      exchange_adjustment: 0,

      net_sales: 90,
    },
  ],

  salespersonSales: [
    {
      salesperson_id: 1,

      salesperson_name: 'أحمد',

      sales_count: 2,

      sales_total: 100,

      returns_count: 1,

      returns_total: 10,

      exchange_count: 0,

      exchange_adjustment: 0,

      net_sales: 90,
    },
  ],

  topProducts: [
    {
      product_name: 'منتج "اختبار", خاص',

      size: 'M',

      color: 'أسود',

      net_quantity: 2,

      net_total: 90,
    },
  ],

  paymentMethods: [
    {
      payment_method: 'cash',

      count: 2,

      total: 90,
    },
  ],

  lowStock: [],

  topCustomers: [
    {
      name: '<script>alert(1)</script>',

      phone: '01000000000',

      sales_count: 2,

      total_spent: 90,
    },
  ],

  dailySales: [
    {
      day: '2026-10-03',

      total: 90,
    },
  ],
};

describe('report export builders', () => {
  it('builds UTF-8 friendly CSV content with escaped cells', () => {
    const csv = buildReportsCsv(
      data,

      'أكتوبر 2026',
    );

    expect(csv).toContain('"تقرير ERP"');

    expect(csv).toContain('"منتج ""اختبار"", خاص"');

    expect(csv).toContain('"الفترة: أكتوبر 2026"');
    expect(csv).toContain('"زيادات تقريب المشتريات"');

    expect(csv).toContain('"0.31"');

    expect(csv).toContain('"صافي فرق تقريب المشتريات"');
    expect(csv).toContain('"صافي الربح النهائي"');

    expect(csv).toContain('"25.31"');
  });

  it('escapes HTML values in PDF export', () => {
    const html = buildReportsPdfHtml(
      data,

      'أكتوبر 2026',
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    expect(html).not.toContain('<script>alert(1)</script>');

    expect(html).toContain('منتج &quot;اختبار&quot;, خاص');
  });

  it('neutralizes spreadsheet formulas in text cells without changing numeric negatives', () => {
    const riskyData = {
      ...data,

      topProducts: [
        {
          ...data.topProducts[0],

          product_name: '=HYPERLINK("https://example.com")',

          net_total: -25,
        },
      ],

      topCustomers: [
        {
          ...data.topCustomers[0],

          name: '@SUM(1+1)',
        },
      ],
    };

    const csv = buildReportsCsv(riskyData, 'اختبار');

    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")"`);

    expect(csv).toContain(`"'@SUM(1+1)"`);

    expect(csv).not.toContain(`"=HYPERLINK(`);

    expect(csv).not.toContain(`"@SUM(`);

    expect(csv).toContain('"-25"');
  });
});
