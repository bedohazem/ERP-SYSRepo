import {
  SELECTIVE_BACKUP_FORMAT,
  SELECTIVE_BACKUP_SCHEMA_VERSION,
  normalizeSelectiveBackupSections,
  selectiveBackupRequiresEncryption,
  type SelectiveBackupManifestV1,
} from '../../shared/selective-backup';

import { getDb } from './db';

/* =========================
 * Catalog + Stock
 * ========================= */

export type CatalogStockBackupCategoryV1 = {
  source_id: number;

  name: string;

  description: string | null;

  is_active: number;

  created_at: string | null;
};

export type CatalogStockBackupVariantV1 = {
  source_id: number;

  barcode: string;

  size: string;

  color: string;

  buy_price: number;

  sell_price: number;

  discount_price: number | null;

  min_stock: number;

  is_active: number;

  current_stock: number;

  average_cost: number;

  inventory_value: number;

  created_at: string | null;
};

export type CatalogStockBackupProductV1 = {
  source_id: number;

  name: string;

  category_source_id: number | null;

  image_path: string | null;

  description: string | null;

  is_active: number;

  created_at: string | null;

  variants: CatalogStockBackupVariantV1[];
};

export type CatalogStockBackupSectionV1 = {
  section: 'catalog_stock';

  categories: CatalogStockBackupCategoryV1[];

  products: CatalogStockBackupProductV1[];

  counts: {
    categories: number;

    products: number;

    variants: number;

    total_stock_units: number;
  };
};

type RawVariantRow = {
  id: number;

  product_id: number;

  barcode: string | null;

  size: string | null;

  color: string | null;

  buy_price: number;

  sell_price: number;

  discount_price: number | null;

  min_stock: number;

  is_active: number;

  average_cost: number;

  inventory_value: number;

  created_at: string | null;

  current_stock: number;
};

export function buildCatalogStockBackupSection(): CatalogStockBackupSectionV1 {
  const db = getDb();

  const categories = db
    .prepare(
      `
      SELECT
        id,
        name,
        description,
        is_active,
        created_at

      FROM categories

      ORDER BY id ASC
      `,
    )
    .all() as Array<{
    id: number;

    name: string;

    description: string | null;

    is_active: number;

    created_at: string | null;
  }>;

  const products = db
    .prepare(
      `
      SELECT
        id,
        name,
        category_id,
        image_path,
        description,
        is_active,
        created_at

      FROM products

      ORDER BY id ASC
      `,
    )
    .all() as Array<{
    id: number;

    name: string;

    category_id: number | null;

    image_path: string | null;

    description: string | null;

    is_active: number;

    created_at: string | null;
  }>;

  const variantRows = db
    .prepare(
      `
      SELECT
        v.id,
        v.product_id,

        v.barcode,
        v.size,
        v.color,

        v.buy_price,
        v.sell_price,
        v.discount_price,

        v.min_stock,
        v.is_active,

        v.average_cost,
        v.inventory_value,

        v.created_at,

        IFNULL(
          SUM(
            CASE
              WHEN sm.type = 'in'
                THEN sm.quantity

              WHEN sm.type = 'out'
                THEN -sm.quantity

              ELSE 0
            END
          ),
          0
        ) AS current_stock

      FROM product_variants v

      LEFT JOIN stock_movements sm
        ON sm.variant_id = v.id

      GROUP BY
        v.id,
        v.product_id,

        v.barcode,
        v.size,
        v.color,

        v.buy_price,
        v.sell_price,
        v.discount_price,

        v.min_stock,
        v.is_active,

        v.average_cost,
        v.inventory_value,

        v.created_at

      ORDER BY v.id ASC
      `,
    )
    .all() as RawVariantRow[];

  const variantsByProduct = new Map<number, CatalogStockBackupVariantV1[]>();

  let totalStockUnits = 0;

  for (const row of variantRows) {
    const barcode = String(row.barcode || '').trim();

    if (!barcode) {
      throw new Error(
        `لا يمكن إنشاء النسخة الانتقائية: الصنف رقم ${row.id} بدون باركود`,
      );
    }

    const currentStock = Number(row.current_stock || 0);

    const averageCost = Number(row.average_cost || 0);

    const inventoryValue = Number(row.inventory_value || 0);

    if (!Number.isFinite(currentStock) || currentStock < -0.000001) {
      throw new Error(`مخزون الصنف ${barcode} غير صحيح`);
    }

    if (!Number.isFinite(averageCost) || averageCost < 0) {
      throw new Error(`متوسط تكلفة الصنف ${barcode} غير صحيح`);
    }

    if (!Number.isFinite(inventoryValue) || inventoryValue < -0.01) {
      throw new Error(`قيمة مخزون الصنف ${barcode} غير صحيحة`);
    }

    const cleanStock = Math.abs(currentStock) <= 0.000001 ? 0 : currentStock;

    const variant: CatalogStockBackupVariantV1 = {
      source_id: Number(row.id),

      barcode,

      size: String(row.size || ''),

      color: String(row.color || ''),

      buy_price: Number(row.buy_price || 0),

      sell_price: Number(row.sell_price || 0),

      discount_price:
        row.discount_price == null ? null : Number(row.discount_price),

      min_stock: Number(row.min_stock || 0),

      is_active: Number(row.is_active) === 1 ? 1 : 0,

      current_stock: cleanStock,

      average_cost: averageCost,

      inventory_value: Math.abs(inventoryValue) <= 0.01 ? 0 : inventoryValue,

      created_at: row.created_at ?? null,
    };

    const variants = variantsByProduct.get(Number(row.product_id)) ?? [];

    variants.push(variant);

    variantsByProduct.set(Number(row.product_id), variants);

    totalStockUnits += cleanStock;
  }

  const exportedProducts = products.map(
    (product): CatalogStockBackupProductV1 => ({
      source_id: Number(product.id),

      name: String(product.name),

      category_source_id:
        product.category_id == null ? null : Number(product.category_id),

      image_path: product.image_path ?? null,

      description: product.description ?? null,

      is_active: Number(product.is_active) === 1 ? 1 : 0,

      created_at: product.created_at ?? null,

      variants: variantsByProduct.get(Number(product.id)) ?? [],
    }),
  );

  const exportedCategories = categories.map(
    (category): CatalogStockBackupCategoryV1 => ({
      source_id: Number(category.id),

      name: String(category.name),

      description: category.description ?? null,

      is_active: Number(category.is_active) === 1 ? 1 : 0,

      created_at: category.created_at ?? null,
    }),
  );

  return {
    section: 'catalog_stock',

    categories: exportedCategories,

    products: exportedProducts,

    counts: {
      categories: exportedCategories.length,

      products: exportedProducts.length,

      variants: variantRows.length,

      total_stock_units: totalStockUnits,
    },
  };
}

/* =========================
 * Customers
 * ========================= */

export type CustomersBackupRowV1 = {
  source_id: number;

  name: string;

  phone: string | null;

  email: string | null;

  address: string | null;

  notes: string | null;

  credit_limit: number | null;

  credit_days: number | null;

  /*
   * وقت الـRestore هنعتبره
   * Opening State، مش تاريخ بيع.
   */
  opening_balance: number;

  opening_points_balance: number;

  lifetime_total_spent: number;

  is_active: number;

  created_at: string | null;

  updated_at: string | null;
};

export type CustomersBackupSectionV1 = {
  section: 'customers';

  customers: CustomersBackupRowV1[];

  counts: {
    customers: number;

    debtors: number;
  };
};

export function buildCustomersBackupSection(): CustomersBackupSectionV1 {
  const rows = getDb()
    .prepare(
      `
      SELECT
        id,
        name,
        phone,
        email,
        address,
        notes,

        credit_limit,
        credit_days,

        IFNULL(
          balance,
          0
        ) AS balance,

        IFNULL(
          points_balance,
          0
        ) AS points_balance,

        IFNULL(
          total_spent,
          0
        ) AS total_spent,

        is_active,
        created_at,
        updated_at

      FROM customers

      ORDER BY id ASC
      `,
    )
    .all() as Array<any>;

  const customers = rows.map((row): CustomersBackupRowV1 => ({
    source_id: Number(row.id),

    name: String(row.name || ''),

    phone: row.phone ?? null,

    email: row.email ?? null,

    address: row.address ?? null,

    notes: row.notes ?? null,

    credit_limit: row.credit_limit == null ? null : Number(row.credit_limit),

    credit_days: row.credit_days == null ? null : Number(row.credit_days),

    opening_balance: Number(row.balance || 0),

    opening_points_balance: Number(row.points_balance || 0),

    lifetime_total_spent: Number(row.total_spent || 0),

    is_active: Number(row.is_active) === 1 ? 1 : 0,

    created_at: row.created_at ?? null,

    updated_at: row.updated_at ?? null,
  }));

  return {
    section: 'customers',

    customers,

    counts: {
      customers: customers.length,

      debtors: customers.filter((row) => row.opening_balance > 0).length,
    },
  };
}

/* =========================
 * Suppliers
 * ========================= */

export type SuppliersBackupRowV1 = {
  source_id: number;

  name: string;

  phone: string | null;

  email: string | null;

  address: string | null;

  notes: string | null;

  credit_days: number | null;

  opening_balance: number;

  lifetime_total_purchased: number;

  is_active: number;

  created_at: string | null;

  updated_at: string | null;
};

export type SuppliersBackupSectionV1 = {
  section: 'suppliers';

  suppliers: SuppliersBackupRowV1[];

  counts: {
    suppliers: number;

    creditors: number;
  };
};

export function buildSuppliersBackupSection(): SuppliersBackupSectionV1 {
  const rows = getDb()
    .prepare(
      `
      SELECT
        id,
        name,
        phone,
        email,
        address,
        notes,

        credit_days,

        IFNULL(
          balance,
          0
        ) AS balance,

        IFNULL(
          total_purchased,
          0
        ) AS total_purchased,

        is_active,
        created_at,
        updated_at

      FROM suppliers

      ORDER BY id ASC
      `,
    )
    .all() as Array<any>;

  const suppliers = rows.map((row): SuppliersBackupRowV1 => ({
    source_id: Number(row.id),

    name: String(row.name || ''),

    phone: row.phone ?? null,

    email: row.email ?? null,

    address: row.address ?? null,

    notes: row.notes ?? null,

    credit_days: row.credit_days == null ? null : Number(row.credit_days),

    opening_balance: Number(row.balance || 0),

    lifetime_total_purchased: Number(row.total_purchased || 0),

    is_active: Number(row.is_active) === 1 ? 1 : 0,

    created_at: row.created_at ?? null,

    updated_at: row.updated_at ?? null,
  }));

  return {
    section: 'suppliers',

    suppliers,

    counts: {
      suppliers: suppliers.length,

      creditors: suppliers.filter((row) => row.opening_balance > 0).length,
    },
  };
}

/* =========================
 * Users + permissions
 * ========================= */

export type UserPermissionBackupV1 = {
  permission: string;

  allowed: number;
};

export type UserBackupRowV1 = {
  source_id: number;

  name: string;

  username: string;

  role: string;

  is_active: number;

  must_change_password: number;

  created_at: string | null;

  /*
   * مهم:
   * لا يوجد password
   * ولا password_hash هنا.
   */
  permission_overrides: UserPermissionBackupV1[];
};

export type UsersPermissionsBackupSectionV1 = {
  section: 'users_permissions';

  users: UserBackupRowV1[];

  counts: {
    users: number;

    permission_overrides: number;
  };
};

export function buildUsersPermissionsBackupSection(): UsersPermissionsBackupSectionV1 {
  const db = getDb();

  const users = db
    .prepare(
      `
      SELECT
        id,
        name,
        username,
        role,
        is_active,
        must_change_password,
        created_at

      FROM users

      ORDER BY id ASC
      `,
    )
    .all() as Array<any>;

  const permissionRows = db
    .prepare(
      `
      SELECT
        user_id,
        permission,
        allowed

      FROM user_permissions

      ORDER BY
        user_id ASC,
        permission ASC
      `,
    )
    .all() as Array<{
    user_id: number;

    permission: string;

    allowed: number;
  }>;

  const permissionsByUser = new Map<number, UserPermissionBackupV1[]>();

  for (const row of permissionRows) {
    const list = permissionsByUser.get(Number(row.user_id)) ?? [];

    list.push({
      permission: String(row.permission),

      allowed: Number(row.allowed) === 1 ? 1 : 0,
    });

    permissionsByUser.set(Number(row.user_id), list);
  }

  const exportedUsers = users.map((user): UserBackupRowV1 => ({
    source_id: Number(user.id),

    name: String(user.name || ''),

    username: String(user.username || ''),

    role: String(user.role || 'cashier'),

    is_active: Number(user.is_active) === 1 ? 1 : 0,

    must_change_password: 1,

    created_at: user.created_at ?? null,

    permission_overrides: permissionsByUser.get(Number(user.id)) ?? [],
  }));

  return {
    section: 'users_permissions',

    users: exportedUsers,

    counts: {
      users: exportedUsers.length,

      permission_overrides: permissionRows.length,
    },
  };
}

/* =========================
 * Promotions
 * ========================= */

export type PromotionBackupRowV1 = {
  source_id: number;

  name: string;

  type: string;

  value: number;

  buy_qty: number | null;

  free_qty: number | null;

  scope_type: string;

  category_source_id: number | null;

  product_source_ids: number[];

  duration_hours: number | null;

  /*
   * ends_at المطلق من الجهاز
   * القديم مش هنستخدمه في Restore.
   *
   * الـRestore هيعيد حسابه من
   * duration_hours لو العرض Active.
   */
  is_active: number;

  created_by_source_id: number | null;

  created_at: string | null;

  updated_at: string | null;
};

export type PromotionsBackupSectionV1 = {
  section: 'promotions';

  promotions: PromotionBackupRowV1[];

  counts: {
    promotions: number;

    active_promotions: number;
  };
};

export function buildPromotionsBackupSection(): PromotionsBackupSectionV1 {
  const db = getDb();

  const promotions = db
    .prepare(
      `
      SELECT
        id,
        name,
        type,
        value,
        buy_qty,
        free_qty,
        scope_type,
        category_id,
        duration_hours,
        ends_at,
        is_active,
        created_by,
        created_at,
        updated_at

      FROM promotions

      ORDER BY id ASC
      `,
    )
    .all() as Array<any>;

  const links = db
    .prepare(
      `
      SELECT
        promotion_id,
        product_id

      FROM promotion_products

      ORDER BY
        promotion_id ASC,
        product_id ASC
      `,
    )
    .all() as Array<{
    promotion_id: number;

    product_id: number;
  }>;

  const productsByPromotion = new Map<number, number[]>();

  for (const link of links) {
    const list = productsByPromotion.get(Number(link.promotion_id)) ?? [];

    list.push(Number(link.product_id));

    productsByPromotion.set(Number(link.promotion_id), list);
  }

  const exported = promotions.map((promotion): PromotionBackupRowV1 => ({
    source_id: Number(promotion.id),

    name: String(promotion.name || ''),

    type: String(promotion.type || ''),

    value: Number(promotion.value || 0),

    buy_qty: promotion.buy_qty == null ? null : Number(promotion.buy_qty),

    free_qty: promotion.free_qty == null ? null : Number(promotion.free_qty),

    scope_type: String(promotion.scope_type || 'all'),

    category_source_id:
      promotion.category_id == null ? null : Number(promotion.category_id),

    product_source_ids: productsByPromotion.get(Number(promotion.id)) ?? [],

    duration_hours:
      promotion.duration_hours == null
        ? null
        : Number(promotion.duration_hours),

    is_active:
      Number(promotion.is_active) === 1 &&
      (promotion.ends_at == null || Number(promotion.ends_at) > Date.now())
        ? 1
        : 0,

    created_by_source_id:
      promotion.created_by == null ? null : Number(promotion.created_by),

    created_at: promotion.created_at ?? null,

    updated_at: promotion.updated_at ?? null,
  }));

  return {
    section: 'promotions',

    promotions: exported,

    counts: {
      promotions: exported.length,

      active_promotions: exported.filter((item) => item.is_active === 1).length,
    },
  };
}

/* =========================
 * Store settings
 * ========================= */

/*
 * Allowlist فقط.
 *
 * أي key جديد مش هيتصدر
 * تلقائيًا لحد ما نراجعه.
 *
 * خصوصًا:
 * - auto_backup_dir
 * - printer/device settings
 * - activation/trial keys
 * ممنوعين.
 */
export const SELECTIVE_STORE_SETTING_KEYS = [
  'app_name',
  'app_logo_url',
  'app_theme',

  'store_phone',
  'store_address',

  'store_qr_enabled',
  'store_qr_title',
  'store_qr_primary_url',

  'loyalty_enabled',
  'loyalty_earn_amount',
  'loyalty_earn_points',
  'loyalty_point_value',
  'loyalty_min_redeem_points',

  'barcode_label_width_mm',
  'barcode_label_height_mm',
  'barcode_copies',
  'barcode_auto_print_after_save',

  'barcode_content_offset_x_mm',
  'barcode_content_offset_y_mm',

  'barcode_name_font_size',
  'barcode_name_position',
  'barcode_name_align',

  'barcode_price_font_size',
  'barcode_price_position',
  'barcode_price_align',

  'barcode_size_font_size',
  'barcode_size_position',
  'barcode_size_align',

  'barcode_color_font_size',
  'barcode_color_position',
  'barcode_color_align',

  'barcode_value_font_size',
  'barcode_value_position',
  'barcode_value_align',

  'barcode_svg_height',

  'receipt_paper_size',
  'receipt_width_px',
  'receipt_font_size_px',

  'receipt_padding_top_px',
  'receipt_padding_right_px',
  'receipt_padding_bottom_px',
  'receipt_padding_left_px',

  'receipt_silent_print',
] as const;

export type StoreSettingsBackupSectionV1 = {
  section: 'store_settings';

  settings: Record<string, string>;

  counts: {
    settings: number;
  };
};

export function buildStoreSettingsBackupSection(): StoreSettingsBackupSectionV1 {
  const db = getDb();

  const placeholders = SELECTIVE_STORE_SETTING_KEYS.map(() => '?').join(', ');

  const rows = db
    .prepare(
      `
      SELECT
        key,
        value

      FROM app_settings

      WHERE key IN (
        ${placeholders}
      )

      ORDER BY key ASC
      `,
    )
    .all(...SELECTIVE_STORE_SETTING_KEYS) as Array<{
    key: string;

    value: string | null;
  }>;

  const settings: Record<string, string> = {};

  for (const row of rows) {
    settings[row.key] = String(row.value ?? '');
  }

  return {
    section: 'store_settings',

    settings,

    counts: {
      settings: rows.length,
    },
  };
}

/* =========================
 * Package
 * ========================= */

export type SelectiveBackupPackageV1 = {
  manifest: SelectiveBackupManifestV1;

  data: {
    catalog_stock?: CatalogStockBackupSectionV1;

    customers?: CustomersBackupSectionV1;

    suppliers?: SuppliersBackupSectionV1;

    users_permissions?: UsersPermissionsBackupSectionV1;

    promotions?: PromotionsBackupSectionV1;

    store_settings?: StoreSettingsBackupSectionV1;
  };
};

type BuildSelectiveBackupPackageInput = {
  sections: readonly unknown[];

  appVersion: string;
};

export function buildSelectiveBackupPackage(
  input: BuildSelectiveBackupPackageInput,
): SelectiveBackupPackageV1 {
  const sections = normalizeSelectiveBackupSections(input.sections);

  const appVersion = String(input.appVersion || '').trim();

  if (!appVersion) {
    throw new Error('إصدار البرنامج غير متاح لإنشاء النسخة الانتقائية');
  }

  const data: SelectiveBackupPackageV1['data'] = {};

  const counts: SelectiveBackupManifestV1['counts'] = {};

  for (const section of sections) {
    switch (section) {
      case 'catalog_stock': {
        const value = buildCatalogStockBackupSection();

        data.catalog_stock = value;

        counts.catalog_stock = value.counts.variants;

        break;
      }

      case 'customers': {
        const value = buildCustomersBackupSection();

        data.customers = value;

        counts.customers = value.counts.customers;

        break;
      }

      case 'suppliers': {
        const value = buildSuppliersBackupSection();

        data.suppliers = value;

        counts.suppliers = value.counts.suppliers;

        break;
      }

      case 'users_permissions': {
        const value = buildUsersPermissionsBackupSection();

        data.users_permissions = value;

        counts.users_permissions = value.counts.users;

        break;
      }

      case 'promotions': {
        const value = buildPromotionsBackupSection();

        data.promotions = value;

        counts.promotions = value.counts.promotions;

        break;
      }

      case 'store_settings': {
        const value = buildStoreSettingsBackupSection();

        data.store_settings = value;

        counts.store_settings = value.counts.settings;

        break;
      }
    }
  }

  return {
    manifest: {
      format: SELECTIVE_BACKUP_FORMAT,

      schema_version: SELECTIVE_BACKUP_SCHEMA_VERSION,

      created_at: new Date().toISOString(),

      app_version: appVersion,

      sections,

      encrypted: selectiveBackupRequiresEncryption(sections),

      counts,
    },

    data,
  };
}

function assertArray(
  value: unknown,
  message: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
}

export function validateSelectiveBackupPackageV1(
  value: unknown,
): asserts value is SelectiveBackupPackageV1 {
  if (!value || typeof value !== 'object') {
    throw new Error('ملف النسخة الانتقائية غير صالح');
  }

  const backup = value as Partial<SelectiveBackupPackageV1>;

  const manifest = backup.manifest;

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest النسخة الانتقائية غير موجود');
  }

  if (manifest.format !== SELECTIVE_BACKUP_FORMAT) {
    throw new Error('هذا الملف ليس نسخة ERP انتقائية صالحة');
  }

  if (manifest.schema_version !== SELECTIVE_BACKUP_SCHEMA_VERSION) {
    throw new Error('إصدار ملف النسخة الانتقائية غير مدعوم');
  }

  const sections = normalizeSelectiveBackupSections(manifest.sections ?? []);

  if (
    sections.length !== manifest.sections.length ||
    sections.some((section, index) => section !== manifest.sections[index])
  ) {
    throw new Error('أقسام النسخة الانتقائية غير صحيحة');
  }

  if (
    typeof manifest.created_at !== 'string' ||
    !Number.isFinite(new Date(manifest.created_at).getTime())
  ) {
    throw new Error('تاريخ النسخة الانتقائية غير صحيح');
  }

  if (
    typeof manifest.app_version !== 'string' ||
    !manifest.app_version.trim()
  ) {
    throw new Error('إصدار البرنامج داخل النسخة غير صحيح');
  }

  if (typeof manifest.encrypted !== 'boolean') {
    throw new Error('حالة تشفير النسخة الانتقائية غير صحيحة');
  }

  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('بيانات النسخة الانتقائية غير موجودة');
  }

  for (const section of sections) {
    switch (section) {
      case 'catalog_stock':
        if (
          !backup.data.catalog_stock ||
          backup.data.catalog_stock.section !== 'catalog_stock'
        ) {
          throw new Error('بيانات المنتجات والمخزون غير صالحة');
        }

        assertArray(
          backup.data.catalog_stock.categories,
          'بيانات التصنيفات غير صالحة',
        );

        assertArray(
          backup.data.catalog_stock.products,
          'بيانات المنتجات غير صالحة',
        );

        break;

      case 'customers':
        if (
          !backup.data.customers ||
          backup.data.customers.section !== 'customers'
        ) {
          throw new Error('بيانات العملاء غير صالحة');
        }

        assertArray(backup.data.customers.customers, 'قائمة العملاء غير صالحة');

        break;

      case 'suppliers':
        if (
          !backup.data.suppliers ||
          backup.data.suppliers.section !== 'suppliers'
        ) {
          throw new Error('بيانات الموردين غير صالحة');
        }

        assertArray(
          backup.data.suppliers.suppliers,
          'قائمة الموردين غير صالحة',
        );

        break;

      case 'users_permissions':
        if (
          !backup.data.users_permissions ||
          backup.data.users_permissions.section !== 'users_permissions'
        ) {
          throw new Error('بيانات المستخدمين والصلاحيات غير صالحة');
        }

        assertArray(
          backup.data.users_permissions.users,
          'قائمة المستخدمين غير صالحة',
        );

        break;

      case 'promotions':
        if (
          !backup.data.promotions ||
          backup.data.promotions.section !== 'promotions'
        ) {
          throw new Error('بيانات العروض غير صالحة');
        }

        assertArray(
          backup.data.promotions.promotions,
          'قائمة العروض غير صالحة',
        );

        break;

      case 'store_settings':
        if (
          !backup.data.store_settings ||
          backup.data.store_settings.section !== 'store_settings' ||
          typeof backup.data.store_settings.settings !== 'object'
        ) {
          throw new Error('إعدادات المتجر داخل النسخة غير صالحة');
        }

        break;
    }
  }
}
