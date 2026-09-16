import { describe, expect, it } from 'vitest'

import { buildShiftCloseReceiptHtml } from '../../src/renderer/utils/shiftReceiptPrint'

import { DEFAULT_RECEIPT_PRINT_SETTINGS } from '../../src/renderer/utils/receiptPrint'

describe('shift close thermal receipt', () => {
  it('builds a thermal shift receipt without reconciliation secrets', () => {
    const html = buildShiftCloseReceiptHtml(
      {
        shift_id: 17,

        cashier_name: 'Test Cashier',

        opened_at: '2026-09-16 09:00:00',

        closed_at: '2026-09-16 17:00:00',

        closing_counted_amount: 500,

        left_for_next_shift: 100,
      },

      {
        app_name: 'ERP Store',

        store_phone: '01000000000',

        store_address: 'Cairo',
      },

      {
        ...DEFAULT_RECEIPT_PRINT_SETTINGS,

        receipt_width_px: 245,
      },
    )

    expect(html).toContain('إيصال إغلاق شفت')

    expect(html).toContain('#17')

    expect(html).toContain('Test Cashier')

    expect(html).toContain('500.00')

    expect(html).toContain('100.00')

    /*
     * 500 - 100
     */
    expect(html).toContain('400.00')

    expect(html).toContain('width:\n              245px')

    /*
     * ممنوع كشف نتيجة
     * المطابقة للكاشير.
     */
    expect(html).not.toContain('المفروض في الدرج')

    expect(html).not.toContain('عجز')

    expect(html).not.toContain('زيادة')

    expect(html).not.toContain('expected_closing_amount')

    expect(html).not.toContain('closing_difference')
  })
})
