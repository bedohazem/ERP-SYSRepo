import { describe, expect, it } from 'vitest';

import { buildSaleExchangeReceiptHtml } from '../../src/renderer/utils/exchangeReceiptPrint';

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
      old_product_discount_value: 40,

      new_product_discount_value: 50,
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
          old_list_unit_price: 140,
          new_product_name: 'قميص',

          new_size: 'L',
          new_color: 'Blue',

          new_unit_price: 150,
          new_list_unit_price: 200,
        },
      ],
    });

    expect(html).toContain('إيصال استبدال');

    expect(html).toContain('القيمة قبل الاستبدال');

    expect(html).toContain('القيمة بعد الاستبدال');

    expect(html).not.toContain('قيمة العرض قبل');

    expect(html).not.toContain('قيمة العرض بعد');
    expect(html).toContain('خصم المنتج');

    expect(html).toContain('140');

    expect(html).toContain('100');

    expect(html).toContain('200');

    expect(html).toContain('150');

    expect(html).toContain('40');

    expect(html).toContain('50');
  });

  it('prints exchange discount only when the actual grant is positive', () => {
    const baseExchange = {
      id: 10,
      code: 'EXC-00010',
      original_sale_id: 20,
      created_at: '2026-11-12 10:00:00',
      old_group_total: 200,
      new_group_total: 250,
      payment_method: 'store_cash',
      cash_refund_amount: 0,
      debt_reduction_amount: 0,
      items: [],
    };

    const withDiscount = buildSaleExchangeReceiptHtml({
      ...baseExchange,
      difference_amount: 40,
      cash_collection_amount: 40,
      exchange_discount_value: 10,
    });

    expect(withDiscount).toContain('خصم الاستبدال');

    const discountSection = withDiscount.slice(
      withDiscount.indexOf('خصم الاستبدال'),
      withDiscount.indexOf('خصم الاستبدال') + 200,
    );

    expect(discountSection).toContain('10');

    const withoutDiscount = buildSaleExchangeReceiptHtml({
      ...baseExchange,
      difference_amount: 50,
      cash_collection_amount: 50,
      exchange_discount_value: 0,
    });

    expect(withoutDiscount).not.toContain('خصم الاستبدال');
    expect(withoutDiscount).toContain('فرق الاستبدال');
  });
});
