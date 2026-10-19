import {
  SELECTIVE_BACKUP_FORMAT,
  SELECTIVE_BACKUP_SCHEMA_VERSION,
  normalizeSelectiveBackupSections,
  selectiveBackupRequiresEncryption,
  type SelectiveBackupManifestV1,
} from '../../shared/selective-backup';

import { getDb } from './db';
import { validateSelectiveBackupPackageDataV1 } from './selective-backup-validation';

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
   * نقاط الولاء مستقلة عن تاريخ
   * الفواتير ونقدر ننقلها بأمان
   * مع Adjustment افتتاحي.
   */
  points_balance: number;

  is_active: number;

  created_at: string | null;

  updated_at: string | null;
};

export type CustomersBackupSectionV1 = {
  section: 'customers';

  customers: CustomersBackupRowV1[];

  counts: {
    customers: number;
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
          points_balance,
          0
        ) AS points_balance,

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

    points_balance: Number(row.points_balance || 0),

    is_active: Number(row.is_active) === 1 ? 1 : 0,

    created_at: row.created_at ?? null,

    updated_at: row.updated_at ?? null,
  }));

  return {
    section: 'customers',

    customers,

    counts: {
      customers: customers.length,
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

  is_active: number;

  created_at: string | null;

  updated_at: string | null;
};

export type SuppliersBackupSectionV1 = {
  section: 'suppliers';

  suppliers: SuppliersBackupRowV1[];

  counts: {
    suppliers: number;
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

    is_active: Number(row.is_active) === 1 ? 1 : 0,

    created_at: row.created_at ?? null,

    updated_at: row.updated_at ?? null,
  }));

  return {
    section: 'suppliers',

    suppliers,

    counts: {
      suppliers: suppliers.length,
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
 * Customer open debts
 * ========================= */

export type CustomerOpenDebtBackupRowV1 = {
  customer_source_id: number;

  remaining_amount: number;

  due_date: string | null;

  business_date: string | null;

  created_at: string | null;
};

export type CustomerOpenDebtsBackupSectionV1 = {
  section: 'customer_open_debts';

  debts: CustomerOpenDebtBackupRowV1[];

  counts: {
    entries: number;

    customers: number;

    total_amount: number;
  };
};

export function buildCustomerOpenDebtsBackupSection(): CustomerOpenDebtsBackupSectionV1 {
  const rows = getDb()
    .prepare(
      `
        SELECT
          customer_id,
          remaining_amount,
          due_date,
          business_date,
          created_at

        FROM sales

        WHERE
          customer_id
            IS NOT NULL

          AND cancelled_at
            IS NULL

          AND IFNULL(
            type,
            'sale'
          ) IN (
            'sale',
            'opening_balance'
          )

          AND remaining_amount > 0

        ORDER BY
          customer_id ASC,
          id ASC
        `,
    )
    .all() as Array<any>;

  const debts = rows.map((row): CustomerOpenDebtBackupRowV1 => ({
    customer_source_id: Number(row.customer_id),

    remaining_amount: Number(row.remaining_amount || 0),

    due_date: row.due_date ?? null,

    business_date: row.business_date ?? null,

    created_at: row.created_at ?? null,
  }));

  const customers = new Set(debts.map((row) => row.customer_source_id));

  return {
    section: 'customer_open_debts',

    debts,

    counts: {
      entries: debts.length,

      customers: customers.size,

      total_amount: debts.reduce(
        (sum, row) => sum + Number(row.remaining_amount || 0),
        0,
      ),
    },
  };
}

/* =========================
 * Supplier open dues
 * ========================= */

export type SupplierOpenDueBackupRowV1 = {
  supplier_source_id: number;

  remaining_amount: number;

  due_date: string | null;

  business_date: string | null;

  created_at: string | null;
};

export type SupplierOpenDuesBackupSectionV1 = {
  section: 'supplier_open_dues';

  dues: SupplierOpenDueBackupRowV1[];

  counts: {
    entries: number;

    suppliers: number;

    total_amount: number;
  };
};

export function buildSupplierOpenDuesBackupSection(): SupplierOpenDuesBackupSectionV1 {
  const rows = getDb()
    .prepare(
      `
        SELECT
          supplier_id,
          remaining_amount,
          due_date,
          business_date,
          created_at

        FROM purchase_invoices

        WHERE
          cancelled_at
            IS NULL

          AND IFNULL(
            status,
            'active'
          ) != 'cancelled'

          AND remaining_amount > 0

        ORDER BY
          supplier_id ASC,
          id ASC
        `,
    )
    .all() as Array<any>;

  const dues = rows.map((row): SupplierOpenDueBackupRowV1 => ({
    supplier_source_id: Number(row.supplier_id),

    remaining_amount: Number(row.remaining_amount || 0),

    due_date: row.due_date ?? null,

    business_date: row.business_date ?? null,

    created_at: row.created_at ?? null,
  }));

  const suppliers = new Set(dues.map((row) => row.supplier_source_id));

  return {
    section: 'supplier_open_dues',

    dues,

    counts: {
      entries: dues.length,

      suppliers: suppliers.size,

      total_amount: dues.reduce(
        (sum, row) => sum + Number(row.remaining_amount || 0),
        0,
      ),
    },
  };
}

/* =========================
 * Open liabilities
 * ========================= */

export type OpenLiabilityBackupRowV1 = {
  source_id: number;

  party_name: string;

  title: string;

  category: string | null;

  remaining_amount: number;

  due_date: string | null;

  notes: string | null;

  created_by_source_id: number | null;

  business_date: string | null;

  created_at: string | null;
};

export type OpenLiabilitiesBackupSectionV1 = {
  section: 'open_liabilities';

  liabilities: OpenLiabilityBackupRowV1[];

  counts: {
    liabilities: number;

    total_amount: number;
  };
};

export function buildOpenLiabilitiesBackupSection(): OpenLiabilitiesBackupSectionV1 {
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          party_name,
          title,
          category,
          remaining_amount,
          due_date,
          notes,
          created_by,
          business_date,
          created_at

        FROM store_liabilities

        WHERE
          status = 'open'

          AND remaining_amount > 0

        ORDER BY id ASC
        `,
    )
    .all() as Array<any>;

  const liabilities = rows.map((row): OpenLiabilityBackupRowV1 => ({
    source_id: Number(row.id),

    party_name: String(row.party_name || ''),

    title: String(row.title || ''),

    category: row.category ?? null,

    remaining_amount: Number(row.remaining_amount || 0),

    due_date: row.due_date ?? null,

    notes: row.notes ?? null,

    created_by_source_id:
      row.created_by == null ? null : Number(row.created_by),

    business_date: row.business_date ?? null,

    created_at: row.created_at ?? null,
  }));

  return {
    section: 'open_liabilities',

    liabilities,

    counts: {
      liabilities: liabilities.length,

      total_amount: liabilities.reduce(
        (sum, row) => sum + Number(row.remaining_amount || 0),
        0,
      ),
    },
  };
}

/* =========================
 * Account opening balances
 * ========================= */

export const SELECTIVE_CASH_ACCOUNT_KEYS = [
  'store_cash',
  'store_safe',
  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',
] as const;

export type SelectiveCashAccountKey =
  (typeof SELECTIVE_CASH_ACCOUNT_KEYS)[number];

export type AccountOpeningBalanceBackupRowV1 = {
  account: SelectiveCashAccountKey;

  balance: number;
};

export type AccountOpeningBalancesBackupSectionV1 = {
  section: 'account_opening_balances';

  accounts: AccountOpeningBalanceBackupRowV1[];

  counts: {
    accounts: number;

    non_zero_accounts: number;
  };
};

export function buildAccountOpeningBalancesBackupSection(): AccountOpeningBalancesBackupSectionV1 {
  const db = getDb();

  const accounts = SELECTIVE_CASH_ACCOUNT_KEYS.map(
    (account): AccountOpeningBalanceBackupRowV1 => {
      const row = db
        .prepare(
          `
            SELECT
              IFNULL(
                SUM(
                  CASE
                    WHEN direction =
                      'in'
                    THEN amount

                    WHEN direction =
                      'out'
                    THEN -amount

                    ELSE 0
                  END
                ),
                0
              ) AS balance

            FROM cash_movements

            WHERE
              cancelled_at
                IS NULL

              AND (
                CASE
                  WHEN
                    payment_method
                      IS NULL

                    OR TRIM(
                      payment_method
                    ) = ''

                    OR payment_method =
                      'cash'

                  THEN
                    'store_cash'

                  WHEN payment_method =
                    'card'

                  THEN
                    'fawry_machine'

                  WHEN payment_method =
                    'wallet'

                  THEN
                    'owner_vodafone'

                  WHEN payment_method IN (
                    'bank',
                    'bank_transfer'
                  )

                  THEN
                    'owner_bank'

                  WHEN payment_method IN (
                    'store_cash',
                    'store_safe',
                    'owner_cash',
                    'owner_bank',
                    'owner_vodafone',
                    'fawry_machine'
                  )

                  THEN
                    payment_method

                  ELSE
                    'store_cash'
                END
              ) = ?
            `,
        )
        .get(account) as {
        balance: number;
      };

      return {
        account,

        balance: Number(row?.balance || 0),
      };
    },
  );

  return {
    section: 'account_opening_balances',

    accounts,

    counts: {
      accounts: accounts.length,

      non_zero_accounts: accounts.filter(
        (row) => Math.abs(Number(row.balance || 0)) > 0.0001,
      ).length,
    },
  };
}

/* =========================
 * Open purchase orders
 * ========================= */

export type OpenPurchaseOrderItemBackupV1 = {
  variant_source_id: number;

  product_name: string;

  barcode: string | null;

  size: string | null;

  color: string | null;

  quantity: number;

  unit_cost: number;
};

export type OpenPurchaseOrderBackupRowV1 = {
  source_id: number;

  supplier_source_id: number;

  status: 'draft' | 'ordered';

  notes: string | null;

  created_by_source_id: number | null;

  ordered_by_source_id: number | null;

  created_at: string | null;

  updated_at: string | null;

  ordered_at: string | null;

  items: OpenPurchaseOrderItemBackupV1[];
};

export type OpenPurchaseOrdersBackupSectionV1 = {
  section: 'open_purchase_orders';

  orders: OpenPurchaseOrderBackupRowV1[];

  counts: {
    orders: number;

    items: number;
  };
};

export function buildOpenPurchaseOrdersBackupSection(): OpenPurchaseOrdersBackupSectionV1 {
  const db = getDb();

  const orders = db
    .prepare(
      `
      SELECT
        id,
        supplier_id,
        status,
        notes,
        created_by,
        ordered_by,
        created_at,
        updated_at,
        ordered_at

      FROM purchase_orders

      WHERE status IN (
        'draft',
        'ordered'
      )

      ORDER BY id ASC
      `,
    )
    .all() as Array<any>;

  const itemRows = db
    .prepare(
      `
      SELECT
        purchase_order_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost

      FROM purchase_order_items

      WHERE purchase_order_id IN (
        SELECT id

        FROM purchase_orders

        WHERE status IN (
          'draft',
          'ordered'
        )
      )

      ORDER BY
        purchase_order_id ASC,
        id ASC
      `,
    )
    .all() as Array<any>;

  const itemsByOrder = new Map<number, OpenPurchaseOrderItemBackupV1[]>();

  for (const row of itemRows) {
    const orderId = Number(row.purchase_order_id);

    const list = itemsByOrder.get(orderId) ?? [];

    list.push({
      variant_source_id: Number(row.variant_id),

      product_name: String(row.product_name || ''),

      barcode: row.barcode ?? null,

      size: row.size ?? null,

      color: row.color ?? null,

      quantity: Number(row.quantity || 0),

      unit_cost: Number(row.unit_cost || 0),
    });

    itemsByOrder.set(orderId, list);
  }

  const exported = orders.map((order): OpenPurchaseOrderBackupRowV1 => ({
    source_id: Number(order.id),

    supplier_source_id: Number(order.supplier_id),

    status: order.status === 'ordered' ? 'ordered' : 'draft',

    notes: order.notes ?? null,

    created_by_source_id:
      order.created_by == null ? null : Number(order.created_by),

    ordered_by_source_id:
      order.ordered_by == null ? null : Number(order.ordered_by),

    created_at: order.created_at ?? null,

    updated_at: order.updated_at ?? null,

    ordered_at: order.ordered_at ?? null,

    items: itemsByOrder.get(Number(order.id)) ?? [],
  }));

  return {
    section: 'open_purchase_orders',

    orders: exported,

    counts: {
      orders: exported.length,

      items: itemRows.length,
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

    customer_open_debts?: CustomerOpenDebtsBackupSectionV1;

    suppliers?: SuppliersBackupSectionV1;

    supplier_open_dues?: SupplierOpenDuesBackupSectionV1;

    users_permissions?: UsersPermissionsBackupSectionV1;

    promotions?: PromotionsBackupSectionV1;

    open_liabilities?: OpenLiabilitiesBackupSectionV1;

    account_opening_balances?: AccountOpeningBalancesBackupSectionV1;

    open_purchase_orders?: OpenPurchaseOrdersBackupSectionV1;

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

      case 'customer_open_debts': {
        const value = buildCustomerOpenDebtsBackupSection();

        data.customer_open_debts = value;

        counts.customer_open_debts = value.counts.entries;

        break;
      }

      case 'suppliers': {
        const value = buildSuppliersBackupSection();

        data.suppliers = value;

        counts.suppliers = value.counts.suppliers;

        break;
      }

      case 'supplier_open_dues': {
        const value = buildSupplierOpenDuesBackupSection();

        data.supplier_open_dues = value;

        counts.supplier_open_dues = value.counts.entries;

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

      case 'open_liabilities': {
        const value = buildOpenLiabilitiesBackupSection();

        data.open_liabilities = value;

        counts.open_liabilities = value.counts.liabilities;

        break;
      }

      case 'account_opening_balances': {
        const value = buildAccountOpeningBalancesBackupSection();

        data.account_opening_balances = value;

        counts.account_opening_balances = value.counts.non_zero_accounts;

        break;
      }

      case 'open_purchase_orders': {
        const value = buildOpenPurchaseOrdersBackupSection();

        data.open_purchase_orders = value;

        counts.open_purchase_orders = value.counts.orders;

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

export function validateSelectiveBackupPackageV1(
  value: unknown,
): asserts value is SelectiveBackupPackageV1 {
  validateSelectiveBackupPackageDataV1(value, SELECTIVE_STORE_SETTING_KEYS);
}
