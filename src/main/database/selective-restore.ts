import { randomBytes } from 'node:crypto';

import { getDb } from './db';

import { receiveStockAtCost } from './inventory-cost';

import { hashPassword } from '../security/password';

import { isPermissionKey } from '../../shared/permissions';

import {
  normalizeSelectiveBackupSections,
  type SelectiveBackupSection,
} from '../../shared/selective-backup';

import {
  SELECTIVE_STORE_SETTING_KEYS,
  validateSelectiveBackupPackageV1,
  type SelectiveBackupPackageV1,
} from './selective-backup';

function requirePositiveId(value: unknown, label: string) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${label} غير صحيح داخل النسخة الانتقائية`);
  }

  return numberValue;
}

function requireText(value: unknown, label: string) {
  const text = String(value ?? '').trim();

  if (!text) {
    throw new Error(`${label} غير موجود داخل النسخة الانتقائية`);
  }

  return text;
}

function finiteNumber(value: unknown, label: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`${label} غير صحيح داخل النسخة الانتقائية`);
  }

  return numberValue;
}

function tableRowCount(tableName: string) {
  const db = getDb();

  const exists = db
    .prepare(
      `
      SELECT 1
      FROM sqlite_master
      WHERE
        type = 'table'
        AND name = ?
      LIMIT 1
      `,
    )
    .get(tableName);

  if (!exists) {
    return 0;
  }

  const safeTableName = tableName.replace(/"/g, '""');

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM "${safeTableName}"
      `,
    )
    .get() as {
    count: number;
  };

  return Number(row?.count || 0);
}

function assertRestoreTargetIsClean(
  sections: readonly SelectiveBackupSection[],
  actorId: number,
) {
  /*
   * إعدادات المتجر فقط ينفع تتطبق
   * على نظام شغال.
   *
   * باقي الأقسام حاليًا مصممة
   * Restore بعد Factory Reset،
   * مش Merge.
   */
  const needsCleanDatabase = sections.some(
    (section) => section !== 'store_settings',
  );

  if (!needsCleanDatabase) {
    return;
  }

  const operationalTables = [
    'sales',
    'sale_returns',
    'sale_exchanges',
    'held_sales',

    'purchase_invoices',
    'purchase_returns',

    'cash_movements',
    'cash_shifts',

    'expenses',
    'liabilities',

    'stock_count_sessions',
  ];

  for (const tableName of operationalTables) {
    if (tableRowCount(tableName) > 0) {
      throw new Error(
        'الاسترجاع الانتقائي للبيانات الأساسية متاح بعد تصفير البرنامج فقط حتى لا يتم دمج تاريخ مالي جديد مع بيانات قديمة',
      );
    }
  }

  const db = getDb();

  if (sections.includes('catalog_stock')) {
    const productsCount = tableRowCount('products');

    if (productsCount > 0) {
      throw new Error(
        'يوجد منتجات بالفعل. صفّر البرنامج أولًا قبل استرجاع المنتجات والمخزون',
      );
    }
  }

  if (sections.includes('customers') && tableRowCount('customers') > 0) {
    throw new Error(
      'يوجد عملاء بالفعل. صفّر البرنامج أولًا قبل استرجاع العملاء',
    );
  }

  if (sections.includes('suppliers') && tableRowCount('suppliers') > 0) {
    throw new Error(
      'يوجد موردين بالفعل. صفّر البرنامج أولًا قبل استرجاع الموردين',
    );
  }

  if (sections.includes('promotions') && tableRowCount('promotions') > 0) {
    throw new Error('يوجد عروض بالفعل. صفّر البرنامج أولًا قبل استرجاع العروض');
  }

  if (sections.includes('users_permissions')) {
    const otherUsers = db
      .prepare(
        `
        SELECT COUNT(*) AS count

        FROM users

        WHERE id <> ?
        `,
      )
      .get(actorId) as {
      count: number;
    };

    if (Number(otherUsers?.count || 0) > 0) {
      throw new Error(
        'يوجد مستخدمين آخرين بالفعل. استرجاع المستخدمين متاح بعد التصفير وإنشاء المدير الأول فقط',
      );
    }
  }
}

function restoreCatalogStock(
  backup: SelectiveBackupPackageV1,
  actorId: number,
) {
  const section = backup.data.catalog_stock;

  if (!section) {
    throw new Error('قسم المنتجات والمخزون غير موجود داخل النسخة');
  }

  const db = getDb();

  /*
   * بعد Factory Reset بيكون
   * فيه تصنيفات افتراضية فقط.
   *
   * طالما products = 0
   * نقدر نستبدل التصنيفات
   * بالـsnapshot الأصلي.
   */
  db.prepare(
    `
    DELETE FROM categories
    `,
  ).run();

  const categoryIds = new Set<number>();

  for (const category of section.categories) {
    const id = requirePositiveId(category.source_id, 'رقم التصنيف');

    if (categoryIds.has(id)) {
      throw new Error(`رقم التصنيف ${id} مكرر داخل النسخة`);
    }

    categoryIds.add(id);

    db.prepare(
      `
      INSERT INTO categories (
        id,
        name,
        description,
        is_active,
        created_at
      )

      VALUES (
        ?, ?, ?, ?, ?
      )
      `,
    ).run(
      id,

      requireText(category.name, 'اسم التصنيف'),

      category.description ?? null,

      Number(category.is_active) === 1 ? 1 : 0,

      category.created_at ?? null,
    );
  }

  const productIds = new Set<number>();

  const variantIds = new Set<number>();

  const barcodes = new Set<string>();

  let variantsRestored = 0;

  let stockUnitsRestored = 0;

  for (const product of section.products) {
    const productId = requirePositiveId(product.source_id, 'رقم المنتج');

    if (productIds.has(productId)) {
      throw new Error(`رقم المنتج ${productId} مكرر داخل النسخة`);
    }

    productIds.add(productId);

    let categoryId: number | null = null;

    if (product.category_source_id != null) {
      categoryId = requirePositiveId(
        product.category_source_id,
        'رقم تصنيف المنتج',
      );

      if (!categoryIds.has(categoryId)) {
        throw new Error(`تصنيف المنتج ${product.name} غير موجود داخل النسخة`);
      }
    }

    const portableImage =
      typeof product.image_path === 'string' &&
      product.image_path.startsWith('data:image/')
        ? product.image_path
        : null;

    db.prepare(
      `
      INSERT INTO products (
        id,
        name,
        category_id,
        image_path,
        description,
        is_active,
        created_at
      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
      `,
    ).run(
      productId,

      requireText(product.name, 'اسم المنتج'),

      categoryId,

      portableImage,

      product.description ?? null,

      Number(product.is_active) === 1 ? 1 : 0,

      product.created_at ?? null,
    );

    if (!Array.isArray(product.variants)) {
      throw new Error(`أصناف المنتج ${product.name} غير صالحة`);
    }

    for (const variant of product.variants) {
      const variantId = requirePositiveId(variant.source_id, 'رقم الصنف');

      if (variantIds.has(variantId)) {
        throw new Error(`رقم الصنف ${variantId} مكرر داخل النسخة`);
      }

      variantIds.add(variantId);

      const barcode = requireText(variant.barcode, 'الباركود');

      if (barcodes.has(barcode)) {
        throw new Error(`الباركود ${barcode} مكرر داخل النسخة`);
      }

      barcodes.add(barcode);

      const buyPrice = finiteNumber(variant.buy_price, `سعر شراء ${barcode}`);

      const sellPrice = finiteNumber(variant.sell_price, `سعر بيع ${barcode}`);

      const minStock = finiteNumber(variant.min_stock, `حد مخزون ${barcode}`);

      const currentStock = finiteNumber(
        variant.current_stock,
        `مخزون ${barcode}`,
      );

      const averageCost = finiteNumber(
        variant.average_cost,
        `متوسط تكلفة ${barcode}`,
      );

      if (
        buyPrice < 0 ||
        sellPrice < 0 ||
        minStock < 0 ||
        currentStock < 0 ||
        averageCost < 0
      ) {
        throw new Error(`يوجد قيمة سالبة غير صالحة في الصنف ${barcode}`);
      }

      const discountPrice =
        variant.discount_price == null
          ? null
          : finiteNumber(variant.discount_price, `سعر الخصم ${barcode}`);

      if (
        discountPrice != null &&
        (discountPrice <= 0 || discountPrice >= sellPrice)
      ) {
        throw new Error(`سعر الخصم للصنف ${barcode} غير صحيح`);
      }

      db.prepare(
        `
        INSERT INTO product_variants (
          id,
          product_id,
          barcode,
          size,
          color,
          buy_price,
          sell_price,
          discount_price,
          min_stock,
          is_active,
          average_cost,
          inventory_value,
          created_at
        )

        VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          0, 0, ?
        )
        `,
      ).run(
        variantId,
        productId,

        barcode,

        String(variant.size || ''),

        String(variant.color || ''),

        buyPrice,
        sellPrice,
        discountPrice,

        minStock,

        Number(variant.is_active) === 1 ? 1 : 0,

        variant.created_at ?? null,
      );

      if (currentStock > 0) {
        receiveStockAtCost(db, {
          variant_id: variantId,

          quantity: currentStock,

          unit_cost: averageCost,

          created_by: actorId,

          reference_id: productId,

          reference_type: 'selective_restore_opening_stock',

          notes: 'رصيد افتتاحي من نسخة انتقائية',
        });
      }

      variantsRestored += 1;

      stockUnitsRestored += currentStock;
    }
  }

  return {
    products: section.products.length,

    variants: variantsRestored,

    stock_units: stockUnitsRestored,
  };
}

function restoreCustomers(backup: SelectiveBackupPackageV1) {
  const section = backup.data.customers;

  if (!section) {
    throw new Error('قسم العملاء غير موجود داخل النسخة');
  }

  const db = getDb();

  let restored = 0;

  for (const customer of section.customers) {
    const id = requirePositiveId(customer.source_id, 'رقم العميل');

    const points = finiteNumber(
      customer.points_balance,
      `نقاط العميل ${customer.name}`,
    );

    if (!Number.isInteger(points) || points < 0) {
      throw new Error(`نقاط العميل ${customer.name} غير صحيحة`);
    }

    const creditLimit =
      customer.credit_limit == null
        ? null
        : finiteNumber(
            customer.credit_limit,
            `الحد الائتماني للعميل ${customer.name}`,
          );

    if (creditLimit != null && creditLimit < 0) {
      throw new Error(`الحد الائتماني للعميل ${customer.name} غير صحيح`);
    }

    const creditDays =
      customer.credit_days == null
        ? null
        : finiteNumber(
            customer.credit_days,
            `مدة ائتمان العميل ${customer.name}`,
          );

    if (
      creditDays != null &&
      (!Number.isInteger(creditDays) || creditDays < 0)
    ) {
      throw new Error(`مدة ائتمان العميل ${customer.name} غير صحيحة`);
    }

    /*
     * balance و total_spent
     * يفضلوا Default = 0.
     *
     * لا ننقلهم بدون تاريخ مالي
     * متكامل يفسرهم.
     */
    db.prepare(
      `
      INSERT INTO customers (
        id,
        name,
        phone,
        email,
        address,
        notes,

        points_balance,

        credit_limit,
        credit_days,

        is_active,

        created_at,
        updated_at
      )

      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?,
        ?, ?,
        ?,
        ?, ?
      )
      `,
    ).run(
      id,

      requireText(customer.name, 'اسم العميل'),

      customer.phone ?? null,

      customer.email ?? null,

      customer.address ?? null,

      customer.notes ?? null,

      points,

      creditLimit,

      creditDays,

      Number(customer.is_active) === 1 ? 1 : 0,

      customer.created_at ?? null,

      customer.updated_at ?? null,
    );

    if (points > 0) {
      db.prepare(
        `
        INSERT INTO loyalty_transactions (
          customer_id,
          sale_id,
          type,
          points,
          amount,
          notes
        )

        VALUES (
          ?, NULL, 'adjust', ?, 0, ?
        )
        `,
      ).run(
        id,

        points,

        'رصيد نقاط افتتاحي من نسخة انتقائية',
      );
    }

    restored += 1;
  }

  return restored;
}

function restoreSuppliers(backup: SelectiveBackupPackageV1) {
  const section = backup.data.suppliers;

  if (!section) {
    throw new Error('قسم الموردين غير موجود داخل النسخة');
  }

  const db = getDb();

  let restored = 0;

  for (const supplier of section.suppliers) {
    const id = requirePositiveId(supplier.source_id, 'رقم المورد');

    const creditDays =
      supplier.credit_days == null
        ? null
        : finiteNumber(
            supplier.credit_days,
            `مدة ائتمان المورد ${supplier.name}`,
          );

    if (
      creditDays != null &&
      (!Number.isInteger(creditDays) || creditDays < 0)
    ) {
      throw new Error(`مدة ائتمان المورد ${supplier.name} غير صحيحة`);
    }

    /*
     * balance و total_purchased
     * Default = 0.
     *
     * مستحقات المورد تدخل لاحقًا
     * من Section محاسبي مستقل.
     */
    db.prepare(
      `
      INSERT INTO suppliers (
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
      )

      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?,
        ?,
        ?, ?
      )
      `,
    ).run(
      id,

      requireText(supplier.name, 'اسم المورد'),

      supplier.phone ?? null,

      supplier.email ?? null,

      supplier.address ?? null,

      supplier.notes ?? null,

      creditDays,

      Number(supplier.is_active) === 1 ? 1 : 0,

      supplier.created_at ?? null,

      supplier.updated_at ?? null,
    );

    restored += 1;
  }

  return restored;
}

function restoreUsers(backup: SelectiveBackupPackageV1, actorId: number) {
  const section = backup.data.users_permissions;

  if (!section) {
    throw new Error('قسم المستخدمين غير موجود داخل النسخة');
  }

  const db = getDb();

  const currentAdmin = db
    .prepare(
      `
      SELECT
        id,
        username

      FROM users

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(actorId) as
    | {
        id: number;

        username: string;
      }
    | undefined;

  if (!currentAdmin) {
    throw new Error('جلسة المدير الحالية غير صالحة');
  }

  const userIdMap = new Map<number, number>();

  let restored = 0;

  let skippedCurrentAdmin = 0;

  for (const user of section.users) {
    const sourceId = requirePositiveId(user.source_id, 'رقم المستخدم');

    const username = requireText(user.username, 'اسم دخول المستخدم');

    /*
     * لو نفس Username للمدير
     * الحالي، نحافظ على المدير
     * وكلمة مروره الحالية.
     */
    if (
      username.toLowerCase() === String(currentAdmin.username).toLowerCase()
    ) {
      userIdMap.set(sourceId, currentAdmin.id);

      skippedCurrentAdmin += 1;

      continue;
    }

    const role = user.role === 'admin' ? 'admin' : 'cashier';

    /*
     * لا نسترجع أي Password Hash.
     *
     * بنعمل كلمة مرور عشوائية
     * غير معروفة ونخلي الحساب
     * Inactive لحد ما المدير
     * يحدد باسورد جديد ويفعله.
     */
    const temporaryPassword = `${randomBytes(48).toString('base64url')}Aa1`;

    const result = db
      .prepare(
        `
        INSERT INTO users (
          name,
          username,
          password,
          role,
          is_active,
          must_change_password,
          created_at
        )

        VALUES (
          ?, ?, ?, ?, 0, 1, ?
        )
        `,
      )
      .run(
        requireText(user.name, 'اسم المستخدم'),

        username,

        hashPassword(temporaryPassword),

        role,

        user.created_at ?? null,
      );

    const newId = Number(result.lastInsertRowid);

    userIdMap.set(sourceId, newId);

    if (role !== 'admin') {
      if (!Array.isArray(user.permission_overrides)) {
        throw new Error(`صلاحيات المستخدم ${username} غير صالحة`);
      }

      for (const override of user.permission_overrides) {
        const permission = String(override.permission || '');

        if (!isPermissionKey(permission)) {
          throw new Error(
            `صلاحية غير معروفة للمستخدم ${username}: ${permission}`,
          );
        }

        db.prepare(
          `
          INSERT INTO user_permissions (
            user_id,
            permission,
            allowed
          )

          VALUES (?, ?, ?)
          `,
        ).run(
          newId,

          permission,

          Number(override.allowed) === 1 ? 1 : 0,
        );
      }
    }

    restored += 1;
  }

  return {
    userIdMap,

    restored,

    skippedCurrentAdmin,
  };
}

function restorePromotions(
  backup: SelectiveBackupPackageV1,

  userIdMap: ReadonlyMap<number, number>,
) {
  const section = backup.data.promotions;

  if (!section) {
    throw new Error('قسم العروض غير موجود داخل النسخة');
  }

  const db = getDb();

  const allowedTypes = new Set([
    'percent',
    'fixed_per_item',
    'fixed_invoice',
    'buy_x_get_y',
  ]);

  const allowedScopes = new Set(['all', 'category', 'products']);

  let restored = 0;

  for (const promotion of section.promotions) {
    const id = requirePositiveId(promotion.source_id, 'رقم العرض');

    const type = String(promotion.type || '');

    const scope = String(promotion.scope_type || '');

    if (!allowedTypes.has(type) || !allowedScopes.has(scope)) {
      throw new Error(`بيانات العرض ${promotion.name} غير صحيحة`);
    }

    const value = finiteNumber(promotion.value, `قيمة العرض ${promotion.name}`);

    const durationHours =
      promotion.duration_hours == null
        ? null
        : finiteNumber(promotion.duration_hours, `مدة العرض ${promotion.name}`);

    if (durationHours != null && durationHours <= 0) {
      throw new Error(`مدة العرض ${promotion.name} غير صحيحة`);
    }

    let categoryId: number | null = null;

    if (scope === 'category') {
      categoryId = requirePositiveId(
        promotion.category_source_id,
        `تصنيف العرض ${promotion.name}`,
      );

      const categoryExists = db
        .prepare(
          `
          SELECT id
          FROM categories
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(categoryId);

      if (!categoryExists) {
        throw new Error(`تصنيف العرض ${promotion.name} غير موجود`);
      }
    }

    const productIds =
      scope === 'products'
        ? (promotion.product_source_ids || []).map((productId) =>
            requirePositiveId(productId, `منتج العرض ${promotion.name}`),
          )
        : [];

    if (scope === 'products' && productIds.length === 0) {
      throw new Error(`العرض ${promotion.name} لا يحتوي على منتجات`);
    }

    for (const productId of productIds) {
      const exists = db
        .prepare(
          `
          SELECT id
          FROM products
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(productId);

      if (!exists) {
        throw new Error(`يوجد منتج غير موجود داخل العرض ${promotion.name}`);
      }
    }

    const active = Number(promotion.is_active) === 1 ? 1 : 0;

    const endsAt =
      active && durationHours != null
        ? Math.round(Date.now() + durationHours * 60 * 60 * 1000)
        : null;

    const createdBy =
      promotion.created_by_source_id == null
        ? null
        : (userIdMap.get(Number(promotion.created_by_source_id)) ?? null);

    db.prepare(
      `
      INSERT INTO promotions (
        id,
        name,
        type,
        value,
        buy_qty,
        free_qty,
        scope_type,
        category_id,
        is_active,
        created_by,
        duration_hours,
        ends_at,
        created_at,
        updated_at
      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
      `,
    ).run(
      id,

      requireText(promotion.name, 'اسم العرض'),

      type,

      value,

      promotion.buy_qty == null
        ? null
        : finiteNumber(
            promotion.buy_qty,
            `كمية الشراء للعرض ${promotion.name}`,
          ),

      promotion.free_qty == null
        ? null
        : finiteNumber(
            promotion.free_qty,
            `كمية الهدية للعرض ${promotion.name}`,
          ),

      scope,

      categoryId,

      active,

      createdBy,

      durationHours,

      endsAt,

      promotion.created_at ?? null,

      promotion.updated_at ?? null,
    );

    for (const productId of productIds) {
      db.prepare(
        `
        INSERT INTO promotion_products (
          promotion_id,
          product_id
        )

        VALUES (?, ?)
        `,
      ).run(id, productId);
    }

    restored += 1;
  }

  return restored;
}

function restoreStoreSettings(backup: SelectiveBackupPackageV1) {
  const section = backup.data.store_settings;

  if (!section) {
    throw new Error('قسم إعدادات المتجر غير موجود داخل النسخة');
  }

  const db = getDb();

  const allowedKeys = new Set<string>(SELECTIVE_STORE_SETTING_KEYS);

  const upsert = db.prepare(
    `
      INSERT INTO app_settings (
        key,
        value
      )

      VALUES (?, ?)

      ON CONFLICT(key)
      DO UPDATE SET
        value =
          excluded.value
      `,
  );

  let restored = 0;

  for (const [key, rawValue] of Object.entries(section.settings)) {
    /*
     * حتى لو الملف اتعدل يدويًا،
     * ممنوع أي Key خارج Allowlist.
     */
    if (!allowedKeys.has(key)) {
      continue;
    }

    upsert.run(key, String(rawValue ?? ''));

    restored += 1;
  }

  return restored;
}

export type SelectiveRestoreResult = {
  sections: SelectiveBackupSection[];

  counts: Partial<Record<SelectiveBackupSection, number>>;

  users_restored: number;

  users_skipped_current_admin: number;

  users_require_password_reset: number;

  stock_units_restored: number;
};

export function restoreSelectiveBackupPackage(
  backup: SelectiveBackupPackageV1,

  requestedSections: readonly unknown[],

  actorIdInput: number,
): SelectiveRestoreResult {
  validateSelectiveBackupPackageV1(backup);

  const actorId = requirePositiveId(actorIdInput, 'رقم المدير');

  const sections = normalizeSelectiveBackupSections(requestedSections);

  for (const section of sections) {
    if (!backup.manifest.sections.includes(section)) {
      throw new Error(`القسم ${section} غير موجود داخل النسخة المختارة`);
    }
  }

  assertRestoreTargetIsClean(sections, actorId);

  const db = getDb();

  const counts: SelectiveRestoreResult['counts'] = {};

  const userIdMap = new Map<number, number>();

  let usersRestored = 0;

  let usersSkippedCurrentAdmin = 0;

  let stockUnitsRestored = 0;

  const tx = db.transaction(() => {
    if (sections.includes('catalog_stock')) {
      const result = restoreCatalogStock(backup, actorId);

      counts.catalog_stock = result.variants;

      stockUnitsRestored = result.stock_units;
    }

    if (sections.includes('customers')) {
      counts.customers = restoreCustomers(backup);
    }

    if (sections.includes('suppliers')) {
      counts.suppliers = restoreSuppliers(backup);
    }

    if (sections.includes('users_permissions')) {
      const result = restoreUsers(backup, actorId);

      usersRestored = result.restored;

      usersSkippedCurrentAdmin = result.skippedCurrentAdmin;

      for (const [sourceId, targetId] of result.userIdMap) {
        userIdMap.set(sourceId, targetId);
      }

      counts.users_permissions = usersRestored;
    }

    if (sections.includes('promotions')) {
      counts.promotions = restorePromotions(backup, userIdMap);
    }

    if (sections.includes('store_settings')) {
      counts.store_settings = restoreStoreSettings(backup);
    }

    const foreignKeyIssues = db
      .prepare(
        `
          PRAGMA foreign_key_check
          `,
      )
      .all();

    if (foreignKeyIssues.length > 0) {
      throw new Error('فشل التحقق من العلاقات بعد الاسترجاع الانتقائي');
    }
  });

  tx();

  return {
    sections,

    counts,

    users_restored: usersRestored,

    users_skipped_current_admin: usersSkippedCurrentAdmin,

    users_require_password_reset: usersRestored,

    stock_units_restored: stockUnitsRestored,
  };
}
