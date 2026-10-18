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
      'suppliers',
      'users_permissions',
      'promotions',
      'store_settings',
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
