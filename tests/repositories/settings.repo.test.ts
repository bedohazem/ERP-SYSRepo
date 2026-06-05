import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  getAppLicenseStatus,
  getBarcodePrintSettings,
  getLoyaltySettings,
  saveAppLogoUrl,
  saveAppName,
  saveAppTheme,
  saveBarcodePrintSettings,
  saveLoyaltySettings
} from '../../src/main/database/repositories/settings.repo';

function getSettingValue(key: string) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT value
      FROM app_settings
      WHERE key = ?
      LIMIT 1
      `
    )
    .get(key) as { value: string } | undefined;

  return row?.value;
}

describe('settings repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('returns default barcode print settings', () => {
    const settings = getBarcodePrintSettings();

    expect(settings.barcode_label_width_mm).toBe(35);
    expect(settings.barcode_label_height_mm).toBe(25);
    expect(settings.barcode_copies).toBe(1);
    expect(settings.barcode_auto_print_after_save).toBe(false);
    expect(settings.barcode_name_font_size).toBe(8);
    expect(settings.barcode_name_position).toBe('top');
    expect(settings.barcode_name_align).toBe('center');
    expect(settings.barcode_price_font_size).toBe(7);
    expect(settings.barcode_price_position).toBe('bottom');
    expect(settings.barcode_price_align).toBe('center');
    expect(settings.barcode_svg_height).toBe(22);
  });

  it('saves barcode print settings', () => {
    const current = getBarcodePrintSettings();

    const result = saveBarcodePrintSettings({
      ...current,
      barcode_label_width_mm: 50,
      barcode_label_height_mm: 30,
      barcode_copies: 3,
      barcode_auto_print_after_save: true,
      barcode_content_offset_x_mm: 2,
      barcode_content_offset_y_mm: 4,
      barcode_name_font_size: 10,
      barcode_name_position: 'bottom',
      barcode_name_align: 'left',
      barcode_price_font_size: 9,
      barcode_price_position: 'top',
      barcode_price_align: 'right',
      barcode_svg_height: 30
    });

    expect(result.success).toBe(true);

    const saved = getBarcodePrintSettings();

    expect(saved.barcode_label_width_mm).toBe(50);
    expect(saved.barcode_label_height_mm).toBe(30);
    expect(saved.barcode_copies).toBe(3);
    expect(saved.barcode_auto_print_after_save).toBe(true);
    expect(saved.barcode_content_offset_x_mm).toBe(2);
    expect(saved.barcode_content_offset_y_mm).toBe(4);
    expect(saved.barcode_name_font_size).toBe(10);
    expect(saved.barcode_name_position).toBe('bottom');
    expect(saved.barcode_name_align).toBe('left');
    expect(saved.barcode_price_font_size).toBe(9);
    expect(saved.barcode_price_position).toBe('top');
    expect(saved.barcode_price_align).toBe('right');
    expect(saved.barcode_svg_height).toBe(30);

    expect(getSettingValue('barcode_label_width_mm')).toBe('50');
    expect(getSettingValue('barcode_auto_print_after_save')).toBe('true');
  });

  it('returns default loyalty settings', () => {
    const settings = getLoyaltySettings();

    expect(settings.loyalty_enabled).toBe(true);
    expect(settings.loyalty_earn_amount).toBe(100);
    expect(settings.loyalty_earn_points).toBe(1);
    expect(settings.loyalty_point_value).toBe(1);
    expect(settings.loyalty_min_redeem_points).toBe(1);
  });

  it('saves loyalty settings', () => {
    const saved = saveLoyaltySettings({
      loyalty_enabled: false,
      loyalty_earn_amount: 200,
      loyalty_earn_points: 5,
      loyalty_point_value: 2,
      loyalty_min_redeem_points: 10
    });

    expect(saved.loyalty_enabled).toBe(false);
    expect(saved.loyalty_earn_amount).toBe(200);
    expect(saved.loyalty_earn_points).toBe(5);
    expect(saved.loyalty_point_value).toBe(2);
    expect(saved.loyalty_min_redeem_points).toBe(10);

    const loaded = getLoyaltySettings();

    expect(loaded).toEqual(saved);
    expect(getSettingValue('loyalty_enabled')).toBe('false');
    expect(getSettingValue('loyalty_earn_amount')).toBe('200');
    expect(getSettingValue('loyalty_earn_points')).toBe('5');
    expect(getSettingValue('loyalty_point_value')).toBe('2');
    expect(getSettingValue('loyalty_min_redeem_points')).toBe('10');
  });

  it('falls back loyalty values when zero values are saved', () => {
    const saved = saveLoyaltySettings({
      loyalty_enabled: true,
      loyalty_earn_amount: 0,
      loyalty_earn_points: 0,
      loyalty_point_value: 0,
      loyalty_min_redeem_points: 0
    });

    expect(saved.loyalty_enabled).toBe(true);
    expect(saved.loyalty_earn_amount).toBe(100);
    expect(saved.loyalty_earn_points).toBe(1);
    expect(saved.loyalty_point_value).toBe(1);
    expect(saved.loyalty_min_redeem_points).toBe(1);
  });

  it('returns app license status with default app settings', () => {
    const status = getAppLicenseStatus();

    expect(status.app_name).toBe('ERP Store');
    expect(status.app_logo_url).toBe('');
    expect(status.app_theme).toBe('dark');
    expect(typeof status.activated).toBe('boolean');
    expect(typeof status.device_code).toBe('string');
  });

  it('saves app logo url', () => {
    const result = saveAppLogoUrl('  https://example.com/logo.png  ');

    expect(result.success).toBe(true);
    expect(result.status.app_logo_url).toBe('https://example.com/logo.png');
    expect(getSettingValue('app_logo_url')).toBe('https://example.com/logo.png');
  });

  it('saves app name and falls back to default when empty', () => {
    const custom = saveAppName('  My Store  ');

    expect(custom.success).toBe(true);
    expect(custom.status.app_name).toBe('My Store');
    expect(getSettingValue('app_name')).toBe('My Store');

    const fallback = saveAppName('   ');

    expect(fallback.success).toBe(true);
    expect(fallback.status.app_name).toBe('ERP Store');
    expect(getSettingValue('app_name')).toBe('ERP Store');
  });

  it('saves app theme and normalizes invalid theme to dark', () => {
    const light = saveAppTheme('light');

    expect(light.success).toBe(true);
    expect(light.status.app_theme).toBe('light');
    expect(getSettingValue('app_theme')).toBe('light');

    const dark = saveAppTheme('invalid' as any);

    expect(dark.success).toBe(true);
    expect(dark.status.app_theme).toBe('dark');
    expect(getSettingValue('app_theme')).toBe('dark');
  });

  it('rejects invalid barcode label dimensions and copies', () => {
    const current = getBarcodePrintSettings();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_label_width_mm: 0
      })
    ).toThrow();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_label_height_mm: -10
      })
    ).toThrow();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_copies: 0
      })
    ).toThrow();
  });

  it('rejects invalid barcode font sizes and svg height', () => {
    const current = getBarcodePrintSettings();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_name_font_size: 0
      })
    ).toThrow();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_price_font_size: -1
      })
    ).toThrow();

    expect(() =>
      saveBarcodePrintSettings({
        ...current,
        barcode_svg_height: 0
      })
    ).toThrow();
  });

  it('rejects invalid loyalty settings', () => {
    expect(() =>
      saveLoyaltySettings({
        loyalty_enabled: true,
        loyalty_earn_amount: -100,
        loyalty_earn_points: 1,
        loyalty_point_value: 1,
        loyalty_min_redeem_points: 1
      })
    ).toThrow();

    expect(() =>
      saveLoyaltySettings({
        loyalty_enabled: true,
        loyalty_earn_amount: 100,
        loyalty_earn_points: -1,
        loyalty_point_value: 1,
        loyalty_min_redeem_points: 1
      })
    ).toThrow();

    expect(() =>
      saveLoyaltySettings({
        loyalty_enabled: true,
        loyalty_earn_amount: 100,
        loyalty_earn_points: 1,
        loyalty_point_value: -1,
        loyalty_min_redeem_points: 1
      })
    ).toThrow();

    expect(() =>
      saveLoyaltySettings({
        loyalty_enabled: true,
        loyalty_earn_amount: 100,
        loyalty_earn_points: 1,
        loyalty_point_value: 1,
        loyalty_min_redeem_points: -5
      })
    ).toThrow();
  });
});