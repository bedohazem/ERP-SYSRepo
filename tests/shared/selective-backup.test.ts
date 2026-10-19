import { describe, expect, it } from 'vitest';

import {
  getSelectiveBackupPresetSections,
  normalizeSelectiveBackupSections,
  selectiveBackupRequiresEncryption,
} from '../../src/shared/selective-backup';

describe('selective backup contract', () => {
  it('normalizes duplicate sections', () => {
    expect(
      normalizeSelectiveBackupSections([
        'catalog_stock',
        'customers',
        'catalog_stock',
      ]),
    ).toEqual(['catalog_stock', 'customers']);
  });

  it('automatically includes dependencies', () => {
    expect(normalizeSelectiveBackupSections(['promotions'])).toEqual([
      'catalog_stock',
      'promotions',
    ]);
  });

  it('builds products preset', () => {
    expect(getSelectiveBackupPresetSections('products_stock')).toEqual([
      'catalog_stock',
    ]);
  });

  it('builds contacts preset', () => {
    expect(getSelectiveBackupPresetSections('contacts')).toEqual([
      'customers',
      'suppliers',
    ]);
  });

  it('builds complete setup preset', () => {
    expect(getSelectiveBackupPresetSections('complete_setup')).toEqual([
      'catalog_stock',

      'customers',
      'customer_open_debts',

      'suppliers',
      'supplier_open_dues',

      'users_permissions',

      'promotions',

      'open_liabilities',

      'account_opening_balances',

      'open_purchase_orders',

      'store_settings',
    ]);
  });

  it('automatically includes financial dependencies', () => {
    expect(normalizeSelectiveBackupSections(['customer_open_debts'])).toEqual([
      'customers',
      'customer_open_debts',
    ]);

    expect(normalizeSelectiveBackupSections(['supplier_open_dues'])).toEqual([
      'suppliers',
      'supplier_open_dues',
    ]);

    expect(normalizeSelectiveBackupSections(['open_purchase_orders'])).toEqual([
      'catalog_stock',
      'suppliers',
      'open_purchase_orders',
    ]);
  });

  it('does not require encryption because credentials are never exported', () => {
    expect(selectiveBackupRequiresEncryption(['users_permissions'])).toBe(
      false,
    );
  });

  it('rejects unsupported sections', () => {
    expect(() =>
      normalizeSelectiveBackupSections(['catalog_stock', 'fake_section']),
    ).toThrow('نوع بيانات غير مدعوم');
  });

  it('rejects empty selection', () => {
    expect(() => normalizeSelectiveBackupSections([])).toThrow(
      'اختار نوع بيانات واحد على الأقل',
    );
  });
});
