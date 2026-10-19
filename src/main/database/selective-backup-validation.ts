import { isPermissionKey, PERMISSION_KEYS } from '../../shared/permissions';

import {
  SELECTIVE_BACKUP_FORMAT,
  SELECTIVE_BACKUP_SCHEMA_VERSION,
  SELECTIVE_BACKUP_SECTIONS,
  normalizeSelectiveBackupSections,
  type SelectiveBackupSection,
} from '../../shared/selective-backup';

import {
  CASH_ACCOUNT_KEYS,
  isCashAccountKey,
} from '../../shared/cash-accounts';

type UnknownRecord = Record<string, unknown>;

const MAX_CATEGORIES = 25_000;
const MAX_PRODUCTS = 250_000;
const MAX_VARIANTS = 500_000;
const MAX_VARIANTS_PER_PRODUCT = 20_000;

const MAX_CUSTOMERS = 500_000;
const MAX_SUPPLIERS = 250_000;
const MAX_USERS = 5_000;
const MAX_PROMOTIONS = 50_000;

const MAX_FINANCIAL_ENTRIES = 1_000_000;
const MAX_LIABILITIES = 250_000;

const MAX_PURCHASE_ORDERS = 250_000;
const MAX_ORDER_ITEMS = 1_000_000;
const MAX_ORDER_ITEMS_PER_ORDER = 20_000;

const MAX_TEXT = 100_000;
const MAX_IMAGE_TEXT = 10 * 1024 * 1024;

const MAX_MONEY = 1_000_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000_000;
const MAX_POINTS = 1_000_000_000_000;

const PROMOTION_TYPES = new Set([
  'percent',
  'fixed_per_item',
  'fixed_invoice',
  'buy_x_get_y',
]);

const PROMOTION_SCOPES = new Set(['all', 'category', 'products']);

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} غير صالح`);
  }

  return value as UnknownRecord;
}

function asArray(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} غير صالحة`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} تتجاوز الحد المسموح`);
  }

  return value;
}

function assertOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  label: string,
) {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} يحتوي على حقل غير مسموح: ${key}`);
    }
  }
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
  options?: {
    required?: boolean;
  },
) {
  if (typeof value !== 'string') {
    throw new Error(`${label} غير صحيح`);
  }

  if (value.includes('\0')) {
    throw new Error(`${label} يحتوي على محارف غير مسموحة`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} أكبر من الحد المسموح`);
  }

  const trimmed = value.trim();

  if (options?.required && !trimmed) {
    throw new Error(`${label} مطلوب`);
  }

  return trimmed;
}

function nullableString(value: unknown, label: string, maxLength = MAX_TEXT) {
  if (value == null) {
    return null;
  }

  boundedString(value, label, maxLength);

  return value as string;
}

function finiteNumber(
  value: unknown,
  label: string,
  options?: {
    min?: number;
    max?: number;
  },
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} غير صحيح`);
  }

  if (options?.min != null && value < options.min) {
    throw new Error(`${label} أقل من الحد المسموح`);
  }

  if (options?.max != null && value > options.max) {
    throw new Error(`${label} أكبر من الحد المسموح`);
  }

  return value;
}

function integerNumber(
  value: unknown,
  label: string,
  options?: {
    min?: number;
    max?: number;
  },
) {
  const result = finiteNumber(value, label, options);

  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} يجب أن يكون رقمًا صحيحًا`);
  }

  return result;
}

function positiveId(value: unknown, label: string) {
  return integerNumber(value, label, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
}

function optionalPositiveId(value: unknown, label: string) {
  if (value == null) {
    return null;
  }

  return positiveId(value, label);
}

function flagValue(value: unknown, label: string) {
  const result = integerNumber(value, label, {
    min: 0,
    max: 1,
  });

  if (result !== 0 && result !== 1) {
    throw new Error(`${label} غير صحيح`);
  }

  return result;
}

function nullableDate(value: unknown, label: string) {
  if (value == null) {
    return null;
  }

  const text = boundedString(value, label, 10, {
    required: true,
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} غير صحيح`);
  }

  const parsed = new Date(`${text}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    throw new Error(`${label} غير صحيح`);
  }

  return text;
}

function nullableTimestamp(value: unknown, label: string) {
  if (value == null) {
    return null;
  }

  const text = boundedString(value, label, 64, {
    required: true,
  });

  const normalized = text.includes('T') ? text : text.replace(' ', 'T');

  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;

  if (!Number.isFinite(Date.parse(withZone))) {
    throw new Error(`${label} غير صحيح`);
  }

  return text;
}

function approximatelyEqual(left: number, right: number) {
  const tolerance = Math.max(
    0.000001,
    Math.max(Math.abs(left), Math.abs(right)) * 1e-9,
  );

  return Math.abs(left - right) <= tolerance;
}

function sectionRecord(
  data: UnknownRecord,
  section: SelectiveBackupSection,
  allowedKeys: readonly string[],
) {
  const result = asRecord(data[section], `قسم ${section}`);

  assertOnlyKeys(result, ['section', ...allowedKeys], `قسم ${section}`);

  if (result.section !== section) {
    throw new Error(`هوية قسم ${section} غير صحيحة`);
  }

  return result;
}

function countsRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
) {
  const result = asRecord(value, label);

  assertOnlyKeys(result, allowedKeys, label);

  return result;
}

type CatalogValidation = {
  count: number;

  categoryIds: Set<number>;

  productIds: Set<number>;

  variantIds: Set<number>;
};

function validateCatalog(data: UnknownRecord): CatalogValidation {
  const section = sectionRecord(data, 'catalog_stock', [
    'categories',
    'products',
    'counts',
  ]);

  const categories = asArray(
    section.categories,
    'قائمة التصنيفات',
    MAX_CATEGORIES,
  );

  const products = asArray(section.products, 'قائمة المنتجات', MAX_PRODUCTS);

  const categoryIds = new Set<number>();

  const categoryNames = new Set<string>();

  for (const rawCategory of categories) {
    const category = asRecord(rawCategory, 'بيانات التصنيف');

    assertOnlyKeys(
      category,
      ['source_id', 'name', 'description', 'is_active', 'created_at'],
      'بيانات التصنيف',
    );

    const id = positiveId(category.source_id, 'رقم التصنيف');

    if (categoryIds.has(id)) {
      throw new Error(`رقم التصنيف ${id} مكرر داخل النسخة`);
    }

    categoryIds.add(id);

    const name = boundedString(category.name, 'اسم التصنيف', 500, {
      required: true,
    });

    if (categoryNames.has(name)) {
      throw new Error(`اسم التصنيف ${name} مكرر داخل النسخة`);
    }

    categoryNames.add(name);

    nullableString(category.description, `وصف التصنيف ${name}`);

    flagValue(category.is_active, `حالة التصنيف ${name}`);

    nullableTimestamp(category.created_at, `تاريخ التصنيف ${name}`);
  }

  const productIds = new Set<number>();

  const variantIds = new Set<number>();

  const barcodes = new Set<string>();

  let variantCount = 0;

  let totalStockUnits = 0;

  for (const rawProduct of products) {
    const product = asRecord(rawProduct, 'بيانات المنتج');

    assertOnlyKeys(
      product,
      [
        'source_id',
        'name',
        'category_source_id',
        'image_path',
        'description',
        'is_active',
        'created_at',
        'variants',
      ],
      'بيانات المنتج',
    );

    const productId = positiveId(product.source_id, 'رقم المنتج');

    if (productIds.has(productId)) {
      throw new Error(`رقم المنتج ${productId} مكرر داخل النسخة`);
    }

    productIds.add(productId);

    const productName = boundedString(product.name, 'اسم المنتج', 500, {
      required: true,
    });

    const categoryId = optionalPositiveId(
      product.category_source_id,
      `تصنيف المنتج ${productName}`,
    );

    if (categoryId != null && !categoryIds.has(categoryId)) {
      throw new Error(`تصنيف المنتج ${productName} غير موجود داخل النسخة`);
    }

    nullableString(
      product.image_path,
      `صورة المنتج ${productName}`,
      MAX_IMAGE_TEXT,
    );

    nullableString(product.description, `وصف المنتج ${productName}`);

    flagValue(product.is_active, `حالة المنتج ${productName}`);

    nullableTimestamp(product.created_at, `تاريخ المنتج ${productName}`);

    const variants = asArray(
      product.variants,
      `أصناف المنتج ${productName}`,
      MAX_VARIANTS_PER_PRODUCT,
    );

    for (const rawVariant of variants) {
      const variant = asRecord(rawVariant, `صنف المنتج ${productName}`);

      assertOnlyKeys(
        variant,
        [
          'source_id',
          'barcode',
          'size',
          'color',
          'buy_price',
          'sell_price',
          'discount_price',
          'min_stock',
          'is_active',
          'current_stock',
          'average_cost',
          'inventory_value',
          'created_at',
        ],
        `صنف المنتج ${productName}`,
      );

      const variantId = positiveId(variant.source_id, 'رقم الصنف');

      if (variantIds.has(variantId)) {
        throw new Error(`رقم الصنف ${variantId} مكرر داخل النسخة`);
      }

      variantIds.add(variantId);

      const barcode = boundedString(variant.barcode, 'الباركود', 512, {
        required: true,
      });

      if (barcodes.has(barcode)) {
        throw new Error(`الباركود ${barcode} مكرر داخل النسخة`);
      }

      barcodes.add(barcode);

      boundedString(variant.size, `مقاس ${barcode}`, 500);

      boundedString(variant.color, `لون ${barcode}`, 500);

      const buyPrice = finiteNumber(variant.buy_price, `سعر شراء ${barcode}`, {
        min: 0,
        max: MAX_MONEY,
      });

      const sellPrice = finiteNumber(variant.sell_price, `سعر بيع ${barcode}`, {
        min: 0,
        max: MAX_MONEY,
      });

      if (variant.discount_price != null) {
        const discount = finiteNumber(
          variant.discount_price,
          `سعر خصم ${barcode}`,
          {
            min: 0,
            max: MAX_MONEY,
          },
        );

        if (discount <= 0 || discount >= sellPrice) {
          throw new Error(`سعر الخصم للصنف ${barcode} غير صحيح`);
        }
      }

      finiteNumber(variant.min_stock, `حد مخزون ${barcode}`, {
        min: 0,
        max: MAX_QUANTITY,
      });

      flagValue(variant.is_active, `حالة الصنف ${barcode}`);

      const stock = finiteNumber(variant.current_stock, `مخزون ${barcode}`, {
        min: 0,
        max: MAX_QUANTITY,
      });

      finiteNumber(variant.average_cost, `متوسط تكلفة ${barcode}`, {
        min: 0,
        max: MAX_MONEY,
      });

      finiteNumber(variant.inventory_value, `قيمة مخزون ${barcode}`, {
        min: 0,
        max: MAX_MONEY,
      });

      nullableTimestamp(variant.created_at, `تاريخ الصنف ${barcode}`);

      void buyPrice;

      variantCount += 1;

      totalStockUnits += stock;

      if (variantCount > MAX_VARIANTS) {
        throw new Error('عدد الأصناف يتجاوز الحد المسموح');
      }
    }
  }

  const counts = countsRecord(
    section.counts,
    ['categories', 'products', 'variants', 'total_stock_units'],
    'عدادات المنتجات والمخزون',
  );

  if (
    integerNumber(counts.categories, 'عدد التصنيفات', {
      min: 0,
      max: MAX_CATEGORIES,
    }) !== categories.length
  ) {
    throw new Error('عدد التصنيفات لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.products, 'عدد المنتجات', {
      min: 0,
      max: MAX_PRODUCTS,
    }) !== products.length
  ) {
    throw new Error('عدد المنتجات لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.variants, 'عدد الأصناف', {
      min: 0,
      max: MAX_VARIANTS,
    }) !== variantCount
  ) {
    throw new Error('عدد الأصناف لا يطابق محتوى النسخة');
  }

  const declaredStock = finiteNumber(
    counts.total_stock_units,
    'إجمالي المخزون',
    {
      min: 0,
      max: MAX_MONEY,
    },
  );

  if (!approximatelyEqual(declaredStock, totalStockUnits)) {
    throw new Error('إجمالي المخزون لا يطابق محتوى النسخة');
  }

  return {
    count: variantCount,
    categoryIds,
    productIds,
    variantIds,
  };
}

function validateCustomers(data: UnknownRecord) {
  const section = sectionRecord(data, 'customers', ['customers', 'counts']);

  const rows = asArray(section.customers, 'قائمة العملاء', MAX_CUSTOMERS);

  const ids = new Set<number>();
  const phones = new Set<string>();
  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات العميل');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'name',
        'phone',
        'email',
        'address',
        'notes',
        'credit_limit',
        'credit_days',
        'points_balance',
        'is_active',
        'created_at',
        'updated_at',
      ],
      'بيانات العميل',
    );

    const id = positiveId(row.source_id, 'رقم العميل');

    if (ids.has(id)) {
      throw new Error(`رقم العميل ${id} مكرر داخل النسخة`);
    }

    ids.add(id);

    const name = boundedString(row.name, 'اسم العميل', 500, {
      required: true,
    });

    const phone = nullableString(row.phone, `هاتف العميل ${name}`, 1_000);

    if (phone != null && phone.trim()) {
      const normalizedPhone = phone.trim();

      if (phones.has(normalizedPhone)) {
        throw new Error(`هاتف العميل ${normalizedPhone} مكرر داخل النسخة`);
      }

      phones.add(normalizedPhone);
    }

    nullableString(row.email, `بريد العميل ${name}`, 1_000);

    nullableString(row.address, `عنوان العميل ${name}`);

    nullableString(row.notes, `ملاحظات العميل ${name}`);

    if (row.credit_limit != null) {
      finiteNumber(row.credit_limit, `الحد الائتماني للعميل ${name}`, {
        min: 0,
        max: MAX_MONEY,
      });
    }

    if (row.credit_days != null) {
      integerNumber(row.credit_days, `مدة ائتمان العميل ${name}`, {
        min: 0,
        max: 365_000,
      });
    }

    integerNumber(row.points_balance, `نقاط العميل ${name}`, {
      min: 0,
      max: MAX_POINTS,
    });

    flagValue(row.is_active, `حالة العميل ${name}`);

    nullableTimestamp(row.created_at, `تاريخ إنشاء العميل ${name}`);

    nullableTimestamp(row.updated_at, `تاريخ تعديل العميل ${name}`);
  }

  const counts = countsRecord(section.counts, ['customers'], 'عدادات العملاء');

  if (
    integerNumber(counts.customers, 'عدد العملاء', {
      min: 0,
      max: MAX_CUSTOMERS,
    }) !== rows.length
  ) {
    throw new Error('عدد العملاء لا يطابق محتوى النسخة');
  }

  return {
    count: rows.length,
    ids,
  };
}

function validateSuppliers(data: UnknownRecord) {
  const section = sectionRecord(data, 'suppliers', ['suppliers', 'counts']);

  const rows = asArray(section.suppliers, 'قائمة الموردين', MAX_SUPPLIERS);

  const ids = new Set<number>();
  const phones = new Set<string>();
  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات المورد');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'name',
        'phone',
        'email',
        'address',
        'notes',
        'credit_days',
        'is_active',
        'created_at',
        'updated_at',
      ],
      'بيانات المورد',
    );

    const id = positiveId(row.source_id, 'رقم المورد');

    if (ids.has(id)) {
      throw new Error(`رقم المورد ${id} مكرر داخل النسخة`);
    }

    ids.add(id);

    const name = boundedString(row.name, 'اسم المورد', 500, {
      required: true,
    });

    const phone = nullableString(row.phone, `هاتف المورد ${name}`, 1_000);

    if (phone != null && phone.trim()) {
      const normalizedPhone = phone.trim();

      if (phones.has(normalizedPhone)) {
        throw new Error(`هاتف المورد ${normalizedPhone} مكرر داخل النسخة`);
      }

      phones.add(normalizedPhone);
    }

    nullableString(row.email, `بريد المورد ${name}`, 1_000);

    nullableString(row.address, `عنوان المورد ${name}`);

    nullableString(row.notes, `ملاحظات المورد ${name}`);

    if (row.credit_days != null) {
      integerNumber(row.credit_days, `مدة ائتمان المورد ${name}`, {
        min: 0,
        max: 365_000,
      });
    }

    flagValue(row.is_active, `حالة المورد ${name}`);

    nullableTimestamp(row.created_at, `تاريخ إنشاء المورد ${name}`);

    nullableTimestamp(row.updated_at, `تاريخ تعديل المورد ${name}`);
  }

  const counts = countsRecord(section.counts, ['suppliers'], 'عدادات الموردين');

  if (
    integerNumber(counts.suppliers, 'عدد الموردين', {
      min: 0,
      max: MAX_SUPPLIERS,
    }) !== rows.length
  ) {
    throw new Error('عدد الموردين لا يطابق محتوى النسخة');
  }

  return {
    count: rows.length,
    ids,
  };
}

function validateUsers(data: UnknownRecord) {
  const section = sectionRecord(data, 'users_permissions', ['users', 'counts']);

  const rows = asArray(section.users, 'قائمة المستخدمين', MAX_USERS);

  const ids = new Set<number>();

  const usernames = new Set<string>();

  let permissionsCount = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات المستخدم');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'name',
        'username',
        'role',
        'is_active',
        'must_change_password',
        'created_at',
        'permission_overrides',
      ],
      'بيانات المستخدم',
    );

    const id = positiveId(row.source_id, 'رقم المستخدم');

    if (ids.has(id)) {
      throw new Error(`رقم المستخدم ${id} مكرر داخل النسخة`);
    }

    ids.add(id);

    boundedString(row.name, 'اسم المستخدم', 500, {
      required: true,
    });

    const username = boundedString(row.username, 'اسم دخول المستخدم', 250, {
      required: true,
    });

    if (usernames.has(username)) {
      throw new Error(`اسم الدخول ${username} مكرر داخل النسخة`);
    }

    usernames.add(username);

    if (row.role !== 'admin' && row.role !== 'cashier') {
      throw new Error(`دور المستخدم ${username} غير صحيح`);
    }

    flagValue(row.is_active, `حالة المستخدم ${username}`);

    if (
      flagValue(
        row.must_change_password,
        `حالة تغيير كلمة مرور ${username}`,
      ) !== 1
    ) {
      throw new Error(`المستخدم ${username} يجب أن يحتاج كلمة مرور جديدة`);
    }

    nullableTimestamp(row.created_at, `تاريخ المستخدم ${username}`);

    const permissions = asArray(
      row.permission_overrides,
      `صلاحيات المستخدم ${username}`,
      PERMISSION_KEYS.length,
    );

    const seenPermissions = new Set<string>();

    for (const rawPermission of permissions) {
      const permission = asRecord(rawPermission, `صلاحية المستخدم ${username}`);

      assertOnlyKeys(
        permission,
        ['permission', 'allowed'],
        `صلاحية المستخدم ${username}`,
      );

      const key = boundedString(
        permission.permission,
        `اسم صلاحية المستخدم ${username}`,
        200,
        {
          required: true,
        },
      );

      if (!isPermissionKey(key)) {
        throw new Error(`صلاحية غير معروفة للمستخدم ${username}: ${key}`);
      }

      if (seenPermissions.has(key)) {
        throw new Error(`الصلاحية ${key} مكررة للمستخدم ${username}`);
      }

      seenPermissions.add(key);

      flagValue(permission.allowed, `قيمة الصلاحية ${key}`);

      permissionsCount += 1;
    }
  }

  const counts = countsRecord(
    section.counts,
    ['users', 'permission_overrides'],
    'عدادات المستخدمين',
  );

  if (
    integerNumber(counts.users, 'عدد المستخدمين', {
      min: 0,
      max: MAX_USERS,
    }) !== rows.length
  ) {
    throw new Error('عدد المستخدمين لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.permission_overrides, 'عدد الصلاحيات', {
      min: 0,
      max: MAX_USERS * PERMISSION_KEYS.length,
    }) !== permissionsCount
  ) {
    throw new Error('عدد صلاحيات المستخدمين لا يطابق محتوى النسخة');
  }

  return {
    count: rows.length,
    ids,
  };
}

function validatePromotions(data: UnknownRecord, catalog: CatalogValidation) {
  const section = sectionRecord(data, 'promotions', ['promotions', 'counts']);

  const rows = asArray(section.promotions, 'قائمة العروض', MAX_PROMOTIONS);

  const ids = new Set<number>();

  let activeCount = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات العرض');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'name',
        'type',
        'value',
        'buy_qty',
        'free_qty',
        'scope_type',
        'category_source_id',
        'product_source_ids',
        'duration_hours',
        'is_active',
        'created_by_source_id',
        'created_at',
        'updated_at',
      ],
      'بيانات العرض',
    );

    const id = positiveId(row.source_id, 'رقم العرض');

    if (ids.has(id)) {
      throw new Error(`رقم العرض ${id} مكرر داخل النسخة`);
    }

    ids.add(id);

    const name = boundedString(row.name, 'اسم العرض', 500, {
      required: true,
    });

    const type = boundedString(row.type, `نوع العرض ${name}`, 100, {
      required: true,
    });

    if (!PROMOTION_TYPES.has(type)) {
      throw new Error(`نوع العرض ${name} غير مدعوم`);
    }

    const value = finiteNumber(row.value, `قيمة العرض ${name}`, {
      min: 0,
      max: MAX_MONEY,
    });

    if (type === 'percent' && value > 100) {
      throw new Error(`نسبة العرض ${name} غير صحيحة`);
    }

    const buyQty =
      row.buy_qty == null
        ? null
        : integerNumber(row.buy_qty, `كمية الشراء للعرض ${name}`, {
            min: 0,
            max: MAX_QUANTITY,
          });

    const freeQty =
      row.free_qty == null
        ? null
        : integerNumber(row.free_qty, `الكمية المجانية للعرض ${name}`, {
            min: 0,
            max: MAX_QUANTITY,
          });

    if (
      type === 'buy_x_get_y' &&
      (buyQty == null || buyQty <= 0 || freeQty == null || freeQty <= 0)
    ) {
      throw new Error(`كميات العرض ${name} غير صحيحة`);
    }

    const scope = boundedString(row.scope_type, `نطاق العرض ${name}`, 100, {
      required: true,
    });

    if (!PROMOTION_SCOPES.has(scope)) {
      throw new Error(`نطاق العرض ${name} غير صحيح`);
    }

    const categoryId = optionalPositiveId(
      row.category_source_id,
      `تصنيف العرض ${name}`,
    );

    if (
      scope === 'category' &&
      (categoryId == null || !catalog.categoryIds.has(categoryId))
    ) {
      throw new Error(`تصنيف العرض ${name} غير موجود داخل النسخة`);
    }

    const productIds = asArray(
      row.product_source_ids,
      `منتجات العرض ${name}`,
      MAX_PRODUCTS,
    );

    const seenProducts = new Set<number>();

    for (const rawProductId of productIds) {
      const productId = positiveId(rawProductId, `منتج العرض ${name}`);

      if (seenProducts.has(productId)) {
        throw new Error(`يوجد منتج مكرر داخل العرض ${name}`);
      }

      seenProducts.add(productId);

      if (!catalog.productIds.has(productId)) {
        throw new Error(`يوجد منتج غير موجود داخل العرض ${name}`);
      }
    }

    if (scope === 'products' && productIds.length === 0) {
      throw new Error(`العرض ${name} لا يحتوي على منتجات`);
    }

    if (row.duration_hours != null) {
      finiteNumber(row.duration_hours, `مدة العرض ${name}`, {
        min: 0.000001,
        max: 876_000,
      });
    }

    const active = flagValue(row.is_active, `حالة العرض ${name}`);

    if (active === 1) {
      activeCount += 1;
    }

    optionalPositiveId(row.created_by_source_id, `منشئ العرض ${name}`);

    nullableTimestamp(row.created_at, `تاريخ إنشاء العرض ${name}`);

    nullableTimestamp(row.updated_at, `تاريخ تعديل العرض ${name}`);
  }

  const counts = countsRecord(
    section.counts,
    ['promotions', 'active_promotions'],
    'عدادات العروض',
  );

  if (
    integerNumber(counts.promotions, 'عدد العروض', {
      min: 0,
      max: MAX_PROMOTIONS,
    }) !== rows.length
  ) {
    throw new Error('عدد العروض لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.active_promotions, 'عدد العروض النشطة', {
      min: 0,
      max: MAX_PROMOTIONS,
    }) !== activeCount
  ) {
    throw new Error('عدد العروض النشطة لا يطابق محتوى النسخة');
  }

  return rows.length;
}

function validateCustomerDebts(
  data: UnknownRecord,
  customerIds: ReadonlySet<number>,
) {
  const section = sectionRecord(data, 'customer_open_debts', [
    'debts',
    'counts',
  ]);

  const rows = asArray(
    section.debts,
    'قائمة مديونيات العملاء',
    MAX_FINANCIAL_ENTRIES,
  );

  const customers = new Set<number>();

  let totalAmount = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات مديونية العميل');

    assertOnlyKeys(
      row,
      [
        'customer_source_id',
        'remaining_amount',
        'due_date',
        'business_date',
        'created_at',
      ],
      'بيانات مديونية العميل',
    );

    const customerId = positiveId(
      row.customer_source_id,
      'رقم العميل في المديونية',
    );

    if (!customerIds.has(customerId)) {
      throw new Error(`مديونية مرتبطة بعميل غير موجود: ${customerId}`);
    }

    const amount = finiteNumber(row.remaining_amount, 'قيمة مديونية العميل', {
      min: 0.000001,
      max: MAX_MONEY,
    });

    nullableDate(row.due_date, 'تاريخ استحقاق مديونية العميل');

    nullableDate(row.business_date, 'تاريخ عمل مديونية العميل');

    nullableTimestamp(row.created_at, 'تاريخ إنشاء مديونية العميل');

    customers.add(customerId);

    totalAmount += amount;
  }

  const counts = countsRecord(
    section.counts,
    ['entries', 'customers', 'total_amount'],
    'عدادات مديونيات العملاء',
  );

  if (
    integerNumber(counts.entries, 'عدد مديونيات العملاء', {
      min: 0,
      max: MAX_FINANCIAL_ENTRIES,
    }) !== rows.length
  ) {
    throw new Error('عدد مديونيات العملاء لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.customers, 'عدد العملاء أصحاب المديونية', {
      min: 0,
      max: MAX_CUSTOMERS,
    }) !== customers.size
  ) {
    throw new Error('عدد العملاء أصحاب المديونية لا يطابق محتوى النسخة');
  }

  const declaredTotal = finiteNumber(
    counts.total_amount,
    'إجمالي مديونيات العملاء',
    {
      min: 0,
      max: MAX_MONEY,
    },
  );

  if (!approximatelyEqual(declaredTotal, totalAmount)) {
    throw new Error('إجمالي مديونيات العملاء لا يطابق محتوى النسخة');
  }

  return rows.length;
}

function validateSupplierDues(
  data: UnknownRecord,
  supplierIds: ReadonlySet<number>,
) {
  const section = sectionRecord(data, 'supplier_open_dues', ['dues', 'counts']);

  const rows = asArray(
    section.dues,
    'قائمة مستحقات الموردين',
    MAX_FINANCIAL_ENTRIES,
  );

  const suppliers = new Set<number>();

  let totalAmount = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات مستحق المورد');

    assertOnlyKeys(
      row,
      [
        'supplier_source_id',
        'remaining_amount',
        'due_date',
        'business_date',
        'created_at',
      ],
      'بيانات مستحق المورد',
    );

    const supplierId = positiveId(
      row.supplier_source_id,
      'رقم المورد في المستحق',
    );

    if (!supplierIds.has(supplierId)) {
      throw new Error(`مستحق مرتبط بمورد غير موجود: ${supplierId}`);
    }

    const amount = finiteNumber(row.remaining_amount, 'قيمة مستحق المورد', {
      min: 0.000001,
      max: MAX_MONEY,
    });

    nullableDate(row.due_date, 'تاريخ استحقاق المورد');

    nullableDate(row.business_date, 'تاريخ عمل مستحق المورد');

    nullableTimestamp(row.created_at, 'تاريخ إنشاء مستحق المورد');

    suppliers.add(supplierId);

    totalAmount += amount;
  }

  const counts = countsRecord(
    section.counts,
    ['entries', 'suppliers', 'total_amount'],
    'عدادات مستحقات الموردين',
  );

  if (
    integerNumber(counts.entries, 'عدد مستحقات الموردين', {
      min: 0,
      max: MAX_FINANCIAL_ENTRIES,
    }) !== rows.length
  ) {
    throw new Error('عدد مستحقات الموردين لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.suppliers, 'عدد الموردين أصحاب المستحقات', {
      min: 0,
      max: MAX_SUPPLIERS,
    }) !== suppliers.size
  ) {
    throw new Error('عدد الموردين أصحاب المستحقات لا يطابق محتوى النسخة');
  }

  const declaredTotal = finiteNumber(
    counts.total_amount,
    'إجمالي مستحقات الموردين',
    {
      min: 0,
      max: MAX_MONEY,
    },
  );

  if (!approximatelyEqual(declaredTotal, totalAmount)) {
    throw new Error('إجمالي مستحقات الموردين لا يطابق محتوى النسخة');
  }

  return rows.length;
}

function validateLiabilities(data: UnknownRecord) {
  const section = sectionRecord(data, 'open_liabilities', [
    'liabilities',
    'counts',
  ]);

  const rows = asArray(
    section.liabilities,
    'قائمة الالتزامات المفتوحة',
    MAX_LIABILITIES,
  );

  const ids = new Set<number>();

  let totalAmount = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات الالتزام');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'party_name',
        'title',
        'category',
        'remaining_amount',
        'due_date',
        'notes',
        'created_by_source_id',
        'business_date',
        'created_at',
      ],
      'بيانات الالتزام',
    );

    const id = positiveId(row.source_id, 'رقم الالتزام');

    if (ids.has(id)) {
      throw new Error(`رقم الالتزام ${id} مكرر داخل النسخة`);
    }

    ids.add(id);

    boundedString(row.party_name, 'جهة الالتزام', 1_000, {
      required: true,
    });

    boundedString(row.title, 'عنوان الالتزام', 1_000, {
      required: true,
    });

    nullableString(row.category, 'تصنيف الالتزام', 1_000);

    const amount = finiteNumber(row.remaining_amount, 'قيمة الالتزام', {
      min: 0.000001,
      max: MAX_MONEY,
    });

    nullableDate(row.due_date, 'تاريخ استحقاق الالتزام');

    nullableString(row.notes, 'ملاحظات الالتزام');

    optionalPositiveId(row.created_by_source_id, 'منشئ الالتزام');

    nullableDate(row.business_date, 'تاريخ عمل الالتزام');

    nullableTimestamp(row.created_at, 'تاريخ إنشاء الالتزام');

    totalAmount += amount;
  }

  const counts = countsRecord(
    section.counts,
    ['liabilities', 'total_amount'],
    'عدادات الالتزامات',
  );

  if (
    integerNumber(counts.liabilities, 'عدد الالتزامات', {
      min: 0,
      max: MAX_LIABILITIES,
    }) !== rows.length
  ) {
    throw new Error('عدد الالتزامات لا يطابق محتوى النسخة');
  }

  const declaredTotal = finiteNumber(counts.total_amount, 'إجمالي الالتزامات', {
    min: 0,
    max: MAX_MONEY,
  });

  if (!approximatelyEqual(declaredTotal, totalAmount)) {
    throw new Error('إجمالي الالتزامات لا يطابق محتوى النسخة');
  }

  return rows.length;
}

function validateAccountBalances(data: UnknownRecord) {
  const section = sectionRecord(data, 'account_opening_balances', [
    'accounts',
    'counts',
  ]);

  const rows = asArray(
    section.accounts,
    'قائمة أرصدة الحسابات',
    CASH_ACCOUNT_KEYS.length,
  );

  if (rows.length !== CASH_ACCOUNT_KEYS.length) {
    throw new Error('قائمة أرصدة الحسابات غير مكتملة');
  }

  const accounts = new Set<string>();

  let nonZero = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات رصيد الحساب');

    assertOnlyKeys(row, ['account', 'balance'], 'بيانات رصيد الحساب');

    const account = boundedString(row.account, 'اسم الحساب المالي', 100, {
      required: true,
    });

    if (!isCashAccountKey(account)) {
      throw new Error(`حساب مالي غير مدعوم داخل النسخة: ${account}`);
    }

    if (accounts.has(account)) {
      throw new Error(`الحساب ${account} مكرر داخل النسخة`);
    }

    accounts.add(account);

    const balance = finiteNumber(row.balance, `رصيد الحساب ${account}`, {
      min: -MAX_MONEY,
      max: MAX_MONEY,
    });

    if (Math.abs(balance) > 0.0001) {
      nonZero += 1;
    }
  }

  for (const requiredAccount of CASH_ACCOUNT_KEYS) {
    if (!accounts.has(requiredAccount)) {
      throw new Error(`الحساب ${requiredAccount} غير موجود داخل النسخة`);
    }
  }

  const counts = countsRecord(
    section.counts,
    ['accounts', 'non_zero_accounts'],
    'عدادات أرصدة الحسابات',
  );

  if (
    integerNumber(counts.accounts, 'عدد الحسابات', {
      min: 0,
      max: CASH_ACCOUNT_KEYS.length,
    }) !== rows.length
  ) {
    throw new Error('عدد الحسابات لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.non_zero_accounts, 'عدد الحسابات ذات الرصيد', {
      min: 0,
      max: CASH_ACCOUNT_KEYS.length,
    }) !== nonZero
  ) {
    throw new Error('عدد الحسابات ذات الرصيد لا يطابق محتوى النسخة');
  }

  return nonZero;
}

function validatePurchaseOrders(
  data: UnknownRecord,
  supplierIds: ReadonlySet<number>,
  variantIds: ReadonlySet<number>,
) {
  const section = sectionRecord(data, 'open_purchase_orders', [
    'orders',
    'counts',
  ]);

  const rows = asArray(
    section.orders,
    'قائمة أوامر الشراء',
    MAX_PURCHASE_ORDERS,
  );

  const orderIds = new Set<number>();

  let totalItems = 0;

  for (const rawRow of rows) {
    const row = asRecord(rawRow, 'بيانات أمر الشراء');

    assertOnlyKeys(
      row,
      [
        'source_id',
        'supplier_source_id',
        'status',
        'notes',
        'created_by_source_id',
        'ordered_by_source_id',
        'created_at',
        'updated_at',
        'ordered_at',
        'items',
      ],
      'بيانات أمر الشراء',
    );

    const orderId = positiveId(row.source_id, 'رقم أمر الشراء');

    if (orderIds.has(orderId)) {
      throw new Error(`رقم أمر الشراء ${orderId} مكرر داخل النسخة`);
    }

    orderIds.add(orderId);

    const supplierId = positiveId(
      row.supplier_source_id,
      `مورد أمر الشراء ${orderId}`,
    );

    if (!supplierIds.has(supplierId)) {
      throw new Error(`مورد أمر الشراء رقم ${orderId} غير موجود داخل النسخة`);
    }

    if (row.status !== 'draft' && row.status !== 'ordered') {
      throw new Error(`حالة أمر الشراء رقم ${orderId} غير صحيحة`);
    }

    nullableString(row.notes, `ملاحظات أمر الشراء ${orderId}`);

    optionalPositiveId(row.created_by_source_id, `منشئ أمر الشراء ${orderId}`);

    optionalPositiveId(row.ordered_by_source_id, `طالب أمر الشراء ${orderId}`);

    nullableTimestamp(row.created_at, `تاريخ إنشاء أمر الشراء ${orderId}`);

    nullableTimestamp(row.updated_at, `تاريخ تعديل أمر الشراء ${orderId}`);

    nullableTimestamp(row.ordered_at, `تاريخ طلب أمر الشراء ${orderId}`);

    const items = asArray(
      row.items,
      `أصناف أمر الشراء ${orderId}`,
      MAX_ORDER_ITEMS_PER_ORDER,
    );

    const orderVariantIds = new Set<number>();

    for (const rawItem of items) {
      const item = asRecord(rawItem, `صنف أمر الشراء ${orderId}`);

      assertOnlyKeys(
        item,
        [
          'variant_source_id',
          'product_name',
          'barcode',
          'size',
          'color',
          'quantity',
          'unit_cost',
        ],
        `صنف أمر الشراء ${orderId}`,
      );

      const variantId = positiveId(
        item.variant_source_id,
        `رقم صنف أمر الشراء ${orderId}`,
      );

      if (!variantIds.has(variantId)) {
        throw new Error(
          `الصنف رقم ${variantId} غير موجود داخل بيانات المنتجات`,
        );
      }

      if (orderVariantIds.has(variantId)) {
        throw new Error(
          `الصنف رقم ${variantId} مكرر داخل أمر الشراء ${orderId}`,
        );
      }

      orderVariantIds.add(variantId);

      boundedString(item.product_name, `اسم منتج أمر الشراء ${orderId}`, 500, {
        required: true,
      });

      nullableString(item.barcode, `باركود أمر الشراء ${orderId}`, 512);

      nullableString(item.size, `مقاس أمر الشراء ${orderId}`, 500);

      nullableString(item.color, `لون أمر الشراء ${orderId}`, 500);

      finiteNumber(item.quantity, `كمية أمر الشراء ${orderId}`, {
        min: 0.000001,
        max: MAX_QUANTITY,
      });

      finiteNumber(item.unit_cost, `تكلفة أمر الشراء ${orderId}`, {
        min: 0,
        max: MAX_MONEY,
      });

      totalItems += 1;

      if (totalItems > MAX_ORDER_ITEMS) {
        throw new Error('عدد أصناف أوامر الشراء يتجاوز الحد المسموح');
      }
    }
  }

  const counts = countsRecord(
    section.counts,
    ['orders', 'items'],
    'عدادات أوامر الشراء',
  );

  if (
    integerNumber(counts.orders, 'عدد أوامر الشراء', {
      min: 0,
      max: MAX_PURCHASE_ORDERS,
    }) !== rows.length
  ) {
    throw new Error('عدد أوامر الشراء لا يطابق محتوى النسخة');
  }

  if (
    integerNumber(counts.items, 'عدد أصناف أوامر الشراء', {
      min: 0,
      max: MAX_ORDER_ITEMS,
    }) !== totalItems
  ) {
    throw new Error('عدد أصناف أوامر الشراء لا يطابق محتوى النسخة');
  }

  return rows.length;
}

function validateStoreSettings(
  data: UnknownRecord,
  allowedKeys: readonly string[],
) {
  const section = sectionRecord(data, 'store_settings', ['settings', 'counts']);

  const settings = asRecord(section.settings, 'إعدادات المتجر');

  assertOnlyKeys(settings, allowedKeys, 'إعدادات المتجر');

  for (const [key, rawValue] of Object.entries(settings)) {
    const maxLength = key === 'app_logo_url' ? MAX_IMAGE_TEXT : MAX_TEXT;

    boundedString(rawValue, `قيمة الإعداد ${key}`, maxLength);
  }

  const keys = Object.keys(settings);

  const counts = countsRecord(
    section.counts,
    ['settings'],
    'عدادات إعدادات المتجر',
  );

  if (
    integerNumber(counts.settings, 'عدد إعدادات المتجر', {
      min: 0,
      max: allowedKeys.length,
    }) !== keys.length
  ) {
    throw new Error('عدد إعدادات المتجر لا يطابق محتوى النسخة');
  }

  return keys.length;
}

function validateManifestCount(
  counts: UnknownRecord,
  section: SelectiveBackupSection,
  expected: number,
) {
  const value = integerNumber(counts[section], `عدد ${section} في Manifest`, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });

  if (value !== expected) {
    throw new Error(`عداد القسم ${section} في Manifest لا يطابق محتوى النسخة`);
  }
}

export function validateSelectiveBackupPackageDataV1(
  value: unknown,
  allowedStoreSettingKeys: readonly string[],
): void {
  const backup = asRecord(value, 'ملف النسخة الانتقائية');

  assertOnlyKeys(backup, ['manifest', 'data'], 'ملف النسخة الانتقائية');

  const manifest = asRecord(backup.manifest, 'Manifest النسخة الانتقائية');

  assertOnlyKeys(
    manifest,
    [
      'format',
      'schema_version',
      'created_at',
      'app_version',
      'sections',
      'encrypted',
      'counts',
    ],
    'Manifest النسخة الانتقائية',
  );

  if (manifest.format !== SELECTIVE_BACKUP_FORMAT) {
    throw new Error('هذا الملف ليس نسخة ERP انتقائية صالحة');
  }

  if (manifest.schema_version !== SELECTIVE_BACKUP_SCHEMA_VERSION) {
    throw new Error('إصدار ملف النسخة الانتقائية غير مدعوم');
  }

  const rawSections = asArray(
    manifest.sections,
    'أقسام النسخة الانتقائية',
    SELECTIVE_BACKUP_SECTIONS.length,
  );

  const sections = normalizeSelectiveBackupSections(rawSections);

  if (
    sections.length !== rawSections.length ||
    sections.some((section, index) => section !== rawSections[index])
  ) {
    throw new Error('أقسام النسخة الانتقائية غير صحيحة');
  }

  const createdAt = boundedString(
    manifest.created_at,
    'تاريخ النسخة الانتقائية',
    64,
    {
      required: true,
    },
  );

  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error('تاريخ النسخة الانتقائية غير صحيح');
  }

  boundedString(manifest.app_version, 'إصدار البرنامج داخل النسخة', 128, {
    required: true,
  });

  /*
   * v1 الحالي ليس له Format
   * مشفر يمكننا فكّه.
   */
  if (manifest.encrypted !== false) {
    throw new Error('حالة تشفير النسخة الانتقائية غير مدعومة');
  }

  const data = asRecord(backup.data, 'بيانات النسخة الانتقائية');

  assertOnlyKeys(data, sections, 'بيانات النسخة الانتقائية');

  const manifestCounts = asRecord(manifest.counts, 'عدادات Manifest');

  assertOnlyKeys(manifestCounts, sections, 'عدادات Manifest');

  const selected = new Set<SelectiveBackupSection>(sections);

  const actualCounts = new Map<SelectiveBackupSection, number>();

  let catalog: CatalogValidation = {
    count: 0,

    categoryIds: new Set(),

    productIds: new Set(),

    variantIds: new Set(),
  };

  let customerIds = new Set<number>();

  let supplierIds = new Set<number>();

  if (selected.has('catalog_stock')) {
    catalog = validateCatalog(data);

    actualCounts.set('catalog_stock', catalog.count);
  }

  if (selected.has('customers')) {
    const result = validateCustomers(data);

    customerIds = result.ids;

    actualCounts.set('customers', result.count);
  }

  if (selected.has('customer_open_debts')) {
    actualCounts.set(
      'customer_open_debts',

      validateCustomerDebts(data, customerIds),
    );
  }

  if (selected.has('suppliers')) {
    const result = validateSuppliers(data);

    supplierIds = result.ids;

    actualCounts.set('suppliers', result.count);
  }

  if (selected.has('supplier_open_dues')) {
    actualCounts.set(
      'supplier_open_dues',

      validateSupplierDues(data, supplierIds),
    );
  }

  if (selected.has('users_permissions')) {
    const result = validateUsers(data);

    actualCounts.set('users_permissions', result.count);
  }

  if (selected.has('promotions')) {
    actualCounts.set(
      'promotions',

      validatePromotions(data, catalog),
    );
  }

  if (selected.has('open_liabilities')) {
    actualCounts.set(
      'open_liabilities',

      validateLiabilities(data),
    );
  }

  if (selected.has('account_opening_balances')) {
    actualCounts.set(
      'account_opening_balances',

      validateAccountBalances(data),
    );
  }

  if (selected.has('open_purchase_orders')) {
    actualCounts.set(
      'open_purchase_orders',

      validatePurchaseOrders(data, supplierIds, catalog.variantIds),
    );
  }

  if (selected.has('store_settings')) {
    actualCounts.set(
      'store_settings',

      validateStoreSettings(data, allowedStoreSettingKeys),
    );
  }

  for (const section of sections) {
    const expected = actualCounts.get(section);

    if (expected == null) {
      throw new Error(`تعذر التحقق من القسم ${section}`);
    }

    validateManifestCount(manifestCounts, section, expected);
  }
}
