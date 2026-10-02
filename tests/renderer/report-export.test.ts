import { describe, expect, it } from 'vitest'

import {
  buildReportsCsv,
  buildReportsPdfHtml,
} from '../../src/renderer/pages/Reports/report-export'

const data = {
  summary: {
    gross_sales: 100,
    net_sales: 90,
    total_returns: 10,
    final_net_profit: 25,
    sales_count: 2,
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
}

describe('report export builders', () => {
  it('builds UTF-8 friendly CSV content with escaped cells', () => {
    const csv = buildReportsCsv(
      data,

      'أكتوبر 2026',
    )

    expect(csv).toContain('"تقرير ERP"')

    expect(csv).toContain('"منتج ""اختبار"", خاص"')

    expect(csv).toContain('"الفترة: أكتوبر 2026"')
  })

  it('escapes HTML values in PDF export', () => {
    const html = buildReportsPdfHtml(
      data,

      'أكتوبر 2026',
    )

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

    expect(html).not.toContain('<script>alert(1)</script>')

    expect(html).toContain('منتج &quot;اختبار&quot;, خاص')
  })
})
