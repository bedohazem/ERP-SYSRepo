import { describe, expect, it } from 'vitest';

import {
  formatActivityDetails,
  getActivityActionLabel,
  getActivityEntityLabel,
  findActivityActionsByArabicName,
} from '../../src/renderer/utils/activity-log';

describe('activity log Arabic display', () => {
  it('translates supplier and system operations', () => {
    expect(getActivityActionLabel('supplier_advance_updated')).toBe(
      'تعديل دفعة مقدمة للمورد',
    );

    expect(getActivityActionLabel('supplier_opening_balance_created')).toBe(
      'تسجيل رصيد افتتاحي للمورد',
    );

    expect(getActivityActionLabel('purchase_order_received')).toBe(
      'استلام أمر شراء',
    );

    expect(getActivityActionLabel('selective_backup_restored')).toBe(
      'استرجاع نسخة احتياطية انتقائية',
    );

    expect(getActivityEntityLabel('supplier_account_credits')).toBe(
      'الأرصدة الدائنة للموردين',
    );
  });

  it('finds actions using their displayed Arabic names', () => {
    const actions = findActivityActionsByArabicName('دفعة مقدمة');

    expect(actions).toContain('supplier_advance_created');
    expect(actions).toContain('supplier_advance_updated');
    expect(actions).toContain('supplier_advance_cancelled');

    expect(findActivityActionsByArabicName('استلام أمر شراء')).toContain(
      'purchase_order_received',
    );

    expect(findActivityActionsByArabicName('')).toEqual([]);
  });

  it('translates known activity actions', () => {
    expect(getActivityActionLabel('supplier_payment_recorded')).toBe(
      'تسجيل دفعة مورد',
    );

    expect(getActivityActionLabel('expense_cancelled')).toBe('إلغاء مصروف');

    expect(getActivityActionLabel('cash_day_close_updated')).toBe(
      'تعديل تقفيل يوم',
    );

    expect(getActivityActionLabel('inventory_stock_adjusted')).toBe(
      'تسوية مخزون',
    );

    expect(getActivityActionLabel('cash_shift_opened')).toBe('فتح شفت');

    expect(getActivityEntityLabel('cash_shifts')).toBe('الشفتات');

    expect(getActivityEntityLabel('inventory')).toBe('المخزون');
  });

  it('does not expose unknown backend action names', () => {
    expect(getActivityActionLabel('unknown_backend_action')).toBe(
      'عملية أخرى بالنظام',
    );

    expect(getActivityEntityLabel('unknown_backend_entity')).toBe('قسم آخر');
  });

  it('formats nested details in Arabic without raw backend keys', () => {
    const result = formatActivityDetails(
      JSON.stringify({
        before: {
          total_amount: 500,
          payment_method: 'store_cash',
        },

        after: {
          total_amount: 450,
          payment_method: 'owner_cash',
        },

        old_amount: 500,
        new_amount: 450,
      }),
    );

    expect(result).toContain('قبل التعديل');

    expect(result).toContain('بعد التعديل');

    expect(result).toContain('الإجمالي');

    expect(result).toContain('كاش درج المحل');

    expect(result).not.toContain('before');

    expect(result).not.toContain('after');

    expect(result).not.toContain('total_amount');

    expect(result).not.toContain('payment_method');
  });

  it('translates backend values', () => {
    const result = formatActivityDetails(
      JSON.stringify({
        direction: 'out',
        payment_status: 'partial',
        type: 'supplier_payment',
        is_active: 1,
        shift_id: 12,
      }),
    );

    expect(result).toContain('خارج');
    expect(result).toContain('مدفوع جزئيًا');
    expect(result).toContain('دفعة مورد');
    expect(result).toContain('نعم');
    expect(result).toContain('رقم الشفت');
  });
});
