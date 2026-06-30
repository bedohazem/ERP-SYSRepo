import { getDb } from '../db';
import {
  getDeviceLicenseStatus,
  activateDevice,
  deactivateDevice
} from '../../security/device-license';

export type BarcodeItemPosition =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'above_barcode'
  | 'below_barcode'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'hidden';

export type BarcodeItemAlign = 'left' | 'center' | 'right';

export type BarcodePrintSettings = {
  barcode_label_width_mm: number;
  barcode_label_height_mm: number;
  barcode_copies: number;
  barcode_auto_print_after_save: boolean;

  barcode_content_offset_x_mm: number;
  barcode_content_offset_y_mm: number;

  barcode_name_font_size: number;
  barcode_name_position: BarcodeItemPosition;
  barcode_name_align: BarcodeItemAlign;

  barcode_price_font_size: number;
  barcode_price_position: BarcodeItemPosition;
  barcode_price_align: BarcodeItemAlign;

  barcode_size_font_size: number;
  barcode_size_position: BarcodeItemPosition;
  barcode_size_align: BarcodeItemAlign;

  barcode_color_font_size: number;
  barcode_color_position: BarcodeItemPosition;
  barcode_color_align: BarcodeItemAlign;

  barcode_value_font_size: number;
  barcode_value_position: BarcodeItemPosition;
  barcode_value_align: BarcodeItemAlign;

  barcode_svg_height: number;
};

const DEFAULT_SETTINGS: BarcodePrintSettings = {
  barcode_label_width_mm: 35,
  barcode_label_height_mm: 25,
  barcode_copies: 1,
  barcode_auto_print_after_save: false,

  barcode_content_offset_x_mm: 0,
  barcode_content_offset_y_mm: 0,

  barcode_name_font_size: 8,
  barcode_name_position: 'top',
  barcode_name_align: 'center',

  barcode_price_font_size: 7,
  barcode_price_position: 'bottom',
  barcode_price_align: 'center',

  barcode_size_font_size: 6,
  barcode_size_position: 'above_barcode',
  barcode_size_align: 'center',

  barcode_color_font_size: 6,
  barcode_color_position: 'above_barcode',
  barcode_color_align: 'center',

  barcode_value_font_size: 7,
  barcode_value_position: 'below_barcode',
  barcode_value_align: 'center',

  barcode_svg_height: 22
};

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === 'true';
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText<T extends string>(value: string | undefined, fallback: T): T {
  return (value ?? fallback) as T;
}

export function getBarcodePrintSettings(): BarcodePrintSettings {
  const db = getDb();

  const rows = db
    .prepare(`SELECT key, value FROM app_settings`)
    .all() as Array<{ key: string; value: string }>;

  const map = new Map(rows.map((row) => [row.key, row.value]));

return {
  barcode_label_width_mm: toNumber(
    map.get('barcode_label_width_mm'),
    DEFAULT_SETTINGS.barcode_label_width_mm
  ),
  barcode_label_height_mm: toNumber(
    map.get('barcode_label_height_mm'),
    DEFAULT_SETTINGS.barcode_label_height_mm
  ),
  barcode_copies: toNumber(
    map.get('barcode_copies'),
    DEFAULT_SETTINGS.barcode_copies
  ),
  barcode_auto_print_after_save: toBool(
    map.get('barcode_auto_print_after_save'),
    DEFAULT_SETTINGS.barcode_auto_print_after_save
  ),

  barcode_content_offset_x_mm: toNumber(
    map.get('barcode_content_offset_x_mm'),
    DEFAULT_SETTINGS.barcode_content_offset_x_mm
  ),
  barcode_content_offset_y_mm: toNumber(
    map.get('barcode_content_offset_y_mm'),
    DEFAULT_SETTINGS.barcode_content_offset_y_mm
  ),

  barcode_name_font_size: toNumber(
    map.get('barcode_name_font_size'),
    DEFAULT_SETTINGS.barcode_name_font_size
  ),
  barcode_name_position: toText(
    map.get('barcode_name_position'),
    DEFAULT_SETTINGS.barcode_name_position
  ),
  barcode_name_align: toText(
    map.get('barcode_name_align'),
    DEFAULT_SETTINGS.barcode_name_align
  ),

  barcode_price_font_size: toNumber(
    map.get('barcode_price_font_size'),
    DEFAULT_SETTINGS.barcode_price_font_size
  ),
  barcode_price_position: toText(
    map.get('barcode_price_position'),
    DEFAULT_SETTINGS.barcode_price_position
  ),
  barcode_price_align: toText(
    map.get('barcode_price_align'),
    DEFAULT_SETTINGS.barcode_price_align
  ),

  barcode_size_font_size: toNumber(
    map.get('barcode_size_font_size'),
    DEFAULT_SETTINGS.barcode_size_font_size
  ),
  barcode_size_position: toText(
    map.get('barcode_size_position'),
    DEFAULT_SETTINGS.barcode_size_position
  ),
  barcode_size_align: toText(
    map.get('barcode_size_align'),
    DEFAULT_SETTINGS.barcode_size_align
  ),

  barcode_color_font_size: toNumber(
    map.get('barcode_color_font_size'),
    DEFAULT_SETTINGS.barcode_color_font_size
  ),
  barcode_color_position: toText(
    map.get('barcode_color_position'),
    DEFAULT_SETTINGS.barcode_color_position
  ),
  barcode_color_align: toText(
    map.get('barcode_color_align'),
    DEFAULT_SETTINGS.barcode_color_align
  ),

  barcode_value_font_size: toNumber(
    map.get('barcode_value_font_size'),
    DEFAULT_SETTINGS.barcode_value_font_size
  ),
  barcode_value_position: toText(
    map.get('barcode_value_position'),
    DEFAULT_SETTINGS.barcode_value_position
  ),
  barcode_value_align: toText(
    map.get('barcode_value_align'),
    DEFAULT_SETTINGS.barcode_value_align
  ),

  barcode_svg_height: toNumber(
    map.get('barcode_svg_height'),
    DEFAULT_SETTINGS.barcode_svg_height
  )
};
}

function assertPositiveNumber(value: unknown, message: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(message);
  }

  return numberValue;
}

function assertFiniteNumber(value: unknown, message: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(message);
  }

  return numberValue;
}

function validateBarcodePrintSettings(input: BarcodePrintSettings) {
  assertPositiveNumber(input.barcode_label_width_mm, 'عرض ملصق الباركود غير صحيح');
  assertPositiveNumber(input.barcode_label_height_mm, 'ارتفاع ملصق الباركود غير صحيح');
  assertPositiveNumber(input.barcode_copies, 'عدد نسخ الباركود غير صحيح');

  assertFiniteNumber(input.barcode_content_offset_x_mm, 'إزاحة الباركود الأفقية غير صحيحة');
  assertFiniteNumber(input.barcode_content_offset_y_mm, 'إزاحة الباركود الرأسية غير صحيحة');

  assertPositiveNumber(input.barcode_name_font_size, 'حجم خط اسم المنتج غير صحيح');
  assertPositiveNumber(input.barcode_price_font_size, 'حجم خط السعر غير صحيح');
  assertPositiveNumber(input.barcode_size_font_size, 'حجم خط المقاس غير صحيح');
  assertPositiveNumber(input.barcode_color_font_size, 'حجم خط اللون غير صحيح');
  assertPositiveNumber(input.barcode_value_font_size, 'حجم خط قيمة الباركود غير صحيح');

  assertPositiveNumber(input.barcode_svg_height, 'ارتفاع الباركود غير صحيح');
}

export function saveBarcodePrintSettings(input: BarcodePrintSettings) {
  const db = getDb();

  validateBarcodePrintSettings(input);

  const stmt = db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const tx = db.transaction(() => {
    stmt.run('barcode_label_width_mm', String(input.barcode_label_width_mm));
    stmt.run('barcode_label_height_mm', String(input.barcode_label_height_mm));
    stmt.run('barcode_copies', String(input.barcode_copies));
    stmt.run( 'barcode_auto_print_after_save', String(input.barcode_auto_print_after_save));

    stmt.run('barcode_content_offset_x_mm', String(input.barcode_content_offset_x_mm));
    stmt.run('barcode_content_offset_y_mm', String(input.barcode_content_offset_y_mm));

    stmt.run('barcode_name_font_size', String(input.barcode_name_font_size));
    stmt.run('barcode_name_position', String(input.barcode_name_position));
    stmt.run('barcode_name_align', String(input.barcode_name_align));

    stmt.run('barcode_price_font_size', String(input.barcode_price_font_size));
    stmt.run('barcode_price_position', String(input.barcode_price_position));
    stmt.run('barcode_price_align', String(input.barcode_price_align));

    stmt.run('barcode_size_font_size', String(input.barcode_size_font_size));
    stmt.run('barcode_size_position', String(input.barcode_size_position));
    stmt.run('barcode_size_align', String(input.barcode_size_align));

    stmt.run('barcode_color_font_size', String(input.barcode_color_font_size));
    stmt.run('barcode_color_position', String(input.barcode_color_position));
    stmt.run('barcode_color_align', String(input.barcode_color_align));

    stmt.run('barcode_value_font_size', String(input.barcode_value_font_size));
    stmt.run('barcode_value_position', String(input.barcode_value_position));
    stmt.run('barcode_value_align', String(input.barcode_value_align));

    stmt.run('barcode_svg_height', String(input.barcode_svg_height));
  });

    tx();

    return { success: true };
}



export type LoyaltySettings = {
  loyalty_enabled: boolean;
  loyalty_earn_amount: number;
  loyalty_earn_points: number;
  loyalty_point_value: number;
  loyalty_min_redeem_points: number;
};

function getSetting(key: string, fallback: string) {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

function saveSetting(key: string, value: string) {
  const db = getDb();

  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getLoyaltySettings(): LoyaltySettings {
  return {
    loyalty_enabled: getSetting('loyalty_enabled', 'true') === 'true',
    loyalty_earn_amount: Number(getSetting('loyalty_earn_amount', '100')),
    loyalty_earn_points: Number(getSetting('loyalty_earn_points', '1')),
    loyalty_point_value: Number(getSetting('loyalty_point_value', '1')),
    loyalty_min_redeem_points: Number(getSetting('loyalty_min_redeem_points', '1'))
  };
}

export function saveLoyaltySettings(input: LoyaltySettings) {
  const loyaltyEarnAmount = Number(input.loyalty_earn_amount || 100);
  const loyaltyEarnPoints = Number(input.loyalty_earn_points || 1);
  const loyaltyPointValue = Number(input.loyalty_point_value || 1);
  const loyaltyMinRedeemPoints = Number(input.loyalty_min_redeem_points || 1);

  if (!Number.isFinite(loyaltyEarnAmount) || loyaltyEarnAmount <= 0) {
    throw new Error('قيمة كسب النقاط غير صحيحة');
  }

  if (!Number.isFinite(loyaltyEarnPoints) || loyaltyEarnPoints <= 0) {
    throw new Error('عدد النقاط المكتسبة غير صحيح');
  }

  if (!Number.isFinite(loyaltyPointValue) || loyaltyPointValue <= 0) {
    throw new Error('قيمة النقطة غير صحيحة');
  }

  if (!Number.isFinite(loyaltyMinRedeemPoints) || loyaltyMinRedeemPoints <= 0) {
    throw new Error('الحد الأدنى لاستخدام النقاط غير صحيح');
  }

  saveSetting('loyalty_enabled', String(Boolean(input.loyalty_enabled)));
  saveSetting('loyalty_earn_amount', String(loyaltyEarnAmount));
  saveSetting('loyalty_earn_points', String(loyaltyEarnPoints));
  saveSetting('loyalty_point_value', String(loyaltyPointValue));
  saveSetting('loyalty_min_redeem_points', String(loyaltyMinRedeemPoints));

  return getLoyaltySettings();
}

export type AppLicenseStatus = {
  activated: boolean;
  trial_started_at: string;
  trial_days: number;
  trial_expires_at: string;
  days_left: number;
  expired: boolean;
  blocked: boolean;
  message: string;
  device_code: string;
  app_logo_url: string;
  app_name: string;
  store_phone: string;
  store_address: string;
  store_qr_enabled: boolean;
  store_qr_title: string;
  store_qr_primary_url: string;
  app_theme: 'dark' | 'light';
};

export function getAppLicenseStatus(): AppLicenseStatus {
  const license = getDeviceLicenseStatus();

  const appLogoUrl = getSetting('app_logo_url', '');
  const appName = getSetting('app_name', 'ERP Store');
  const storePhone = getSetting('store_phone', '');
  const storeAddress = getSetting('store_address', '');
  const storeQrEnabled = getSetting('store_qr_enabled', 'false') === 'true';
  const storeQrTitle = getSetting('store_qr_title', 'امسح الكود للتواصل معنا');
  const storeQrPrimaryUrl = getSetting('store_qr_primary_url', '');
  const appTheme = getSetting('app_theme', 'dark') === 'light' ? 'light' : 'dark';

  return {
    activated: license.activated,
    trial_started_at: license.trial_started_at,
    trial_days: license.trial_days,
    trial_expires_at: license.trial_expires_at,
    days_left: license.days_left,
    expired: license.expired,
    blocked: license.blocked,
    message: license.message,
    device_code: license.device_code,
    app_logo_url: appLogoUrl,
    app_name: appName,
    store_phone: storePhone,
    store_address: storeAddress,
    store_qr_enabled: storeQrEnabled,
    store_qr_title: storeQrTitle,
    store_qr_primary_url: storeQrPrimaryUrl,
    app_theme: appTheme
  };
}

export function activateApp(code: string) {
  const result = activateDevice(code);

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    message: result.message,
    status: getAppLicenseStatus()
  };
}

export function deactivateApp() {
  const result = deactivateDevice();

  return {
    success: true,
    message: result.message,
    status: getAppLicenseStatus()
  };
}

export function saveAppLogoUrl(url: string) {
  saveSetting('app_logo_url', String(url || '').trim());

  return {
    success: true,
    status: getAppLicenseStatus()
  };
}
export function saveAppName(name: string) {
  const cleanName = String(name || '').trim() || 'ERP Store';

  saveSetting('app_name', cleanName);

  return {
    success: true,
    status: getAppLicenseStatus()
  };
}

export function saveStoreContactInfo(phone: string, address: string) {
  const cleanPhone = String(phone || '').trim();
  const cleanAddress = String(address || '').trim();

  saveSetting('store_phone', cleanPhone);
  saveSetting('store_address', cleanAddress);

  return {
    success: true,
    status: getAppLicenseStatus()
  };
}

export function saveAppTheme(theme: 'dark' | 'light') {
  const cleanTheme = theme === 'light' ? 'light' : 'dark';

  saveSetting('app_theme', cleanTheme);

  return {
    success: true,
    status: getAppLicenseStatus()
  };
}

export type StoreQrSettings = {
  store_qr_enabled: boolean;
  store_qr_title: string;
  store_qr_primary_url: string;
};

export function saveStoreQrSettings(input: StoreQrSettings) {
  saveSetting('store_qr_enabled', String(Boolean(input.store_qr_enabled)));
  saveSetting('store_qr_title', String(input.store_qr_title || '').trim() || 'امسح الكود للتواصل معنا');
  saveSetting('store_qr_primary_url', String(input.store_qr_primary_url || '').trim());

  return {
    success: true,
    status: getAppLicenseStatus()
  };
}