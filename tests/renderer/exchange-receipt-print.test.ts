import { describe, expect, it } from 'vitest'

import { buildSaleExchangeReceiptHtml } from '../../src/renderer/utils/exchangeReceiptPrint'

describe('sale exchange receipt', () => {
  it('uses generic exchange labels for regular invoices', () => {
    const html = buildSaleExchangeReceiptHtml({
      id: 5,

      code: 'EXC-00005',

      original_sale_id: 10,

      created_at: '2026-09-17 10:00:00',

      customer_name: 'عميل نقدي',

      cashier_name: 'Cashier',

      old_group_total: 100,

      new_group_total: 150,

      difference_amount: 50,

      cash_collection_amount: 50,

      cash_refund_amount: 0,

      debt_reduction_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          old_product_name: 'قميص',

          old_size: 'M',
          old_color: 'Black',

          old_unit_price: 100,

          new_product_name: 'قميص',

          new_size: 'L',
          new_color: 'Blue',

          new_unit_price: 150,
        },
      ],
    })

    expect(html).toContain('إيصال استبدال')

    expect(html).toContain('القيمة قبل الاستبدال')

    expect(html).toContain('القيمة بعد الاستبدال')

    expect(html).not.toContain('قيمة العرض قبل')

    expect(html).not.toContain('قيمة العرض بعد')
  })
})
