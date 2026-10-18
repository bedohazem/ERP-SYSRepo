import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { receiveStockAtCost } from '../../src/main/database/inventory-cost';

import {
  buildCatalogStockBackupSection,
  buildSelectiveBackupPackage,
  validateSelectiveBackupPackageV1,
} from '../../src/main/database/selective-backup';
import { restoreSelectiveBackupPackage } from '../../src/main/database/selective-restore';

describe('selective backup exporter', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  }, 30_000);

  it('exports current catalog stock and weighted-average cost', () => {
    const category = createCategory({
      name: 'Selective Backup Category',

      description: 'Backup test category',
    });

    createProduct({
      name: 'Selective Backup Product',

      category_id: category.id,

      description: 'Product description',

      image_path: null,

      variants: [
        {
          barcode: 'SELECTIVE-001',

          size: 'M',

          color: 'Black',

          buy_price: 40,

          sell_price: 100,

          discount_price: 90,

          min_stock: 2,

          opening_qty: 5,
        },

        {
          barcode: 'SELECTIVE-002',

          size: 'L',

          color: 'Blue',

          buy_price: 30,

          sell_price: 80,

          min_stock: 1,

          opening_qty: 0,
        },
      ],
    });

    const firstVariant = getVariantByBarcode('SELECTIVE-001');

    expect(firstVariant).toBeTruthy();

    receiveStockAtCost(getDb(), {
      variant_id: firstVariant!.variant_id,

      quantity: 5,

      unit_cost: 60,

      created_by: null,

      reference_type: 'selective_backup_test',

      reference_id: null,
    });

    const backup = buildCatalogStockBackupSection();

    const product = backup.products.find(
      (item) => item.name === 'Selective Backup Product',
    );

    const variant = product?.variants.find(
      (item) => item.barcode === 'SELECTIVE-001',
    );

    expect(variant).toMatchObject({
      current_stock: 10,

      average_cost: 50,

      inventory_value: 500,

      discount_price: 90,
    });

    expect(backup.counts.total_stock_units).toBe(10);
  });

  it('exports every supported setup section without credentials or device-local settings', () => {
    const db = getDb();

    const category = createCategory({
      name: 'Complete Backup Category',

      description: null,
    });

    const createdProduct = createProduct({
      name: 'Complete Backup Product',

      category_id: category.id,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'COMPLETE-001',

          size: 'M',

          color: 'Black',

          buy_price: 25,

          sell_price: 50,

          min_stock: 1,

          opening_qty: 3,
        },
      ],
    });

    db.prepare(
      `
          INSERT INTO customers (
            name,
            phone,
            balance,
            points_balance,
            total_spent,
            credit_limit,
            credit_days
          )

          VALUES (
            'Backup Customer',
            '01000000001',
            150,
            12,
            900,
            500,
            30
          )
          `,
    ).run();

    db.prepare(
      `
          INSERT INTO suppliers (
            name,
            phone,
            balance,
            total_purchased,
            credit_days
          )

          VALUES (
            'Backup Supplier',
            '01000000002',
            300,
            1200,
            45
          )
          `,
    ).run();

    const userResult = db
      .prepare(
        `
            INSERT INTO users (
              name,
              username,
              password,
              role,
              is_active,
              must_change_password
            )

            VALUES (
              'Backup Cashier',
              'backup-cashier',
              'SECRET-HASH-MUST-NOT-EXPORT',
              'cashier',
              1,
              0
            )
            `,
      )
      .run();

    const userId = Number(userResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO user_permissions (
            user_id,
            permission,
            allowed
          )

          VALUES (
            ?,
            'products.manage',
            1
          )
          `,
    ).run(userId);

    const promotionResult = db
      .prepare(
        `
            INSERT INTO promotions (
              name,
              type,
              value,
              scope_type,
              category_id,
              is_active,
              created_by,
              duration_hours
            )

            VALUES (
              'Backup Promotion',
              'percent',
              10,
              'products',
              NULL,
              1,
              ?,
              24
            )
            `,
      )
      .run(userId);

    db.prepare(
      `
          INSERT INTO promotion_products (
            promotion_id,
            product_id
          )

          VALUES (?, ?)
          `,
    ).run(Number(promotionResult.lastInsertRowid), createdProduct.productId);

    db.prepare(
      `
          INSERT INTO app_settings (
            key,
            value
          )

          VALUES
            (
              'app_name',
              'Backup Store'
            ),
            (
              'auto_backup_dir',
              'Z:\\OLD-PC'
            ),
            (
              'app_activated',
              'true'
            )

          ON CONFLICT(key)
          DO UPDATE SET
            value =
              excluded.value
          `,
    ).run();

    const backup = buildSelectiveBackupPackage({
      sections: [
        'catalog_stock',
        'customers',
        'suppliers',
        'users_permissions',
        'promotions',
        'store_settings',
      ],

      appVersion: '3.2.0-test',
    });

    expect(backup.manifest.sections).toEqual([
      'catalog_stock',
      'customers',
      'suppliers',
      'users_permissions',
      'promotions',
      'store_settings',
    ]);

    const customer = backup.data.customers?.customers.find(
      (item) => item.name === 'Backup Customer',
    );

    expect(customer).toMatchObject({
      points_balance: 12,

      credit_limit: 500,

      credit_days: 30,
    });

    expect(
      Object.prototype.hasOwnProperty.call(customer || {}, 'opening_balance'),
    ).toBe(false);

    expect(
      Object.prototype.hasOwnProperty.call(
        customer || {},
        'lifetime_total_spent',
      ),
    ).toBe(false);

    const supplier = backup.data.suppliers?.suppliers.find(
      (item) => item.name === 'Backup Supplier',
    );

    expect(supplier).toMatchObject({
      credit_days: 45,
    });

    expect(
      Object.prototype.hasOwnProperty.call(supplier || {}, 'opening_balance'),
    ).toBe(false);

    expect(
      Object.prototype.hasOwnProperty.call(
        supplier || {},
        'lifetime_total_purchased',
      ),
    ).toBe(false);

    const user = backup.data.users_permissions?.users.find(
      (item) => item.username === 'backup-cashier',
    );

    expect(user).toBeTruthy();

    expect(user?.permission_overrides).toContainEqual({
      permission: 'products.manage',

      allowed: 1,
    });

    expect(Object.prototype.hasOwnProperty.call(user || {}, 'password')).toBe(
      false,
    );

    expect(JSON.stringify(backup.data.users_permissions)).not.toContain(
      'SECRET-HASH-MUST-NOT-EXPORT',
    );

    const promotion = backup.data.promotions?.promotions.find(
      (item) => item.name === 'Backup Promotion',
    );

    expect(promotion?.product_source_ids).toEqual([createdProduct.productId]);

    expect(backup.data.store_settings?.settings.app_name).toBe('Backup Store');

    expect(
      backup.data.store_settings?.settings.auto_backup_dir,
    ).toBeUndefined();

    expect(backup.data.store_settings?.settings.app_activated).toBeUndefined();

    expect(() => validateSelectiveBackupPackageV1(backup)).not.toThrow();
  });

  it('automatically includes catalog when promotions are selected', () => {
    const backup = buildSelectiveBackupPackage({
      sections: ['promotions'],

      appVersion: '3.2.0-test',
    });

    expect(backup.manifest.sections).toEqual(['catalog_stock', 'promotions']);

    expect(backup.data.catalog_stock).toBeTruthy();

    expect(backup.data.promotions).toBeTruthy();
  });

  it('rejects tampered package format', () => {
    const backup = buildSelectiveBackupPackage({
      sections: ['customers'],

      appVersion: '3.2.0-test',
    });

    const tampered = {
      ...backup,

      manifest: {
        ...backup.manifest,

        format: 'fake-backup',
      },
    };

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'هذا الملف ليس نسخة ERP انتقائية صالحة',
    );
  });

  it('restores a complete setup into a clean database while preserving the current admin and device-local settings', () => {
    const db = getDb();

    const category = createCategory({
      name: 'Restore Category',

      description: 'restore-test',
    });

    const product = createProduct({
      name: 'Restore Product',

      category_id: category.id,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'RESTORE-001',

          size: 'XL',

          color: 'Black',

          buy_price: 40,

          sell_price: 100,

          min_stock: 2,

          opening_qty: 5,
        },
      ],
    });

    db.prepare(
      `
          INSERT INTO customers (
            name,
            phone,
            balance,
            points_balance,
            total_spent
          )

          VALUES (
            'Restore Customer',
            '01111111111',
            200,
            15,
            1000
          )
          `,
    ).run();

    db.prepare(
      `
          INSERT INTO suppliers (
            name,
            phone,
            balance,
            total_purchased
          )

          VALUES (
            'Restore Supplier',
            '01222222222',
            350,
            1800
          )
          `,
    ).run();

    const userResult = db
      .prepare(
        `
            INSERT INTO users (
              name,
              username,
              password,
              role,
              is_active,
              must_change_password
            )

            VALUES (
              'Restore Cashier',
              'restore-cashier',
              'DO-NOT-RESTORE-THIS-HASH',
              'cashier',
              1,
              0
            )
            `,
      )
      .run();

    const sourceUserId = Number(userResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO user_permissions (
            user_id,
            permission,
            allowed
          )

          VALUES (
            ?,
            'inventory.view',
            1
          )
          `,
    ).run(sourceUserId);

    const promotion = db
      .prepare(
        `
            INSERT INTO promotions (
              name,
              type,
              value,
              scope_type,
              is_active,
              duration_hours,
              created_by
            )

            VALUES (
              'Restore Promotion',
              'percent',
              10,
              'products',
              1,
              24,
              ?
            )
            `,
      )
      .run(sourceUserId);

    db.prepare(
      `
          INSERT INTO promotion_products (
            promotion_id,
            product_id
          )

          VALUES (?, ?)
          `,
    ).run(
      Number(promotion.lastInsertRowid),

      product.productId,
    );

    db.prepare(
      `
          INSERT INTO app_settings (
            key,
            value
          )

          VALUES (
            'app_name',
            'Restored Business'
          )

          ON CONFLICT(key)
          DO UPDATE SET
            value =
              excluded.value
          `,
    ).run();

    const backup = buildSelectiveBackupPackage({
      sections: [
        'catalog_stock',
        'customers',
        'suppliers',
        'users_permissions',
        'promotions',
        'store_settings',
      ],

      appVersion: 'restore-test',
    });

    /*
     * نحاكي Factory Reset.
     */
    resetDatabaseData();

    const cleanDb = getDb();

    const currentAdmin = cleanDb
      .prepare(
        `
            SELECT
              id,
              username

            FROM users

            WHERE role =
              'admin'

            ORDER BY id ASC

            LIMIT 1
            `,
      )
      .get() as {
      id: number;

      username: string;
    };

    /*
     * Machine-local setting
     * لازم يفضل زي ما هو.
     */
    cleanDb
      .prepare(
        `
          INSERT INTO app_settings (
            key,
            value
          )

          VALUES (
            'auto_backup_dir',
            'CURRENT-DEVICE-BACKUPS'
          )

          ON CONFLICT(key)
          DO UPDATE SET
            value =
              excluded.value
          `,
      )
      .run();

    const result = restoreSelectiveBackupPackage(
      backup,

      backup.manifest.sections,

      currentAdmin.id,
    );

    expect(result.sections).toEqual(backup.manifest.sections);

    const restoredVariant = cleanDb
      .prepare(
        `
            SELECT
              v.id,
              v.average_cost,
              v.inventory_value,

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
              ) AS stock

            FROM product_variants v

            LEFT JOIN stock_movements sm
              ON sm.variant_id =
                v.id

            WHERE v.barcode =
              'RESTORE-001'

            GROUP BY v.id
            `,
      )
      .get() as {
      stock: number;

      average_cost: number;

      inventory_value: number;
    };

    expect(Number(restoredVariant.stock)).toBe(5);

    expect(Number(restoredVariant.average_cost)).toBe(40);

    expect(Number(restoredVariant.inventory_value)).toBe(200);

    const restoredCustomer = cleanDb
      .prepare(
        `
            SELECT
              balance,
              points_balance,
              total_spent

            FROM customers

            WHERE name =
              'Restore Customer'
            `,
      )
      .get() as {
      balance: number;

      points_balance: number;

      total_spent: number;
    };

    expect(restoredCustomer).toMatchObject({
      balance: 0,

      points_balance: 15,

      total_spent: 0,
    });

    const restoredSupplier = cleanDb
      .prepare(
        `
            SELECT
              balance,
              total_purchased

            FROM suppliers

            WHERE name =
              'Restore Supplier'
            `,
      )
      .get() as {
      balance: number;

      total_purchased: number;
    };

    expect(restoredSupplier).toMatchObject({
      balance: 0,

      total_purchased: 0,
    });

    const restoredOpenCustomerDebt = cleanDb
      .prepare(
        `
        SELECT IFNULL(
          SUM(
            remaining_amount
          ),
          0
        ) AS total

        FROM sales

        WHERE customer_id = (
          SELECT id
          FROM customers
          WHERE name =
            'Restore Customer'
          LIMIT 1
        )

          AND cancelled_at IS NULL

          AND IFNULL(
            type,
            'sale'
          ) = 'sale'
        `,
      )
      .get() as {
      total: number;
    };

    expect(Number(restoredOpenCustomerDebt.total)).toBe(0);

    const restoredOpenSupplierDebt = cleanDb
      .prepare(
        `
        SELECT IFNULL(
          SUM(
            remaining_amount
          ),
          0
        ) AS total

        FROM purchase_invoices

        WHERE supplier_id = (
          SELECT id
          FROM suppliers
          WHERE name =
            'Restore Supplier'
          LIMIT 1
        )

          AND cancelled_at IS NULL
        `,
      )
      .get() as {
      total: number;
    };

    expect(Number(restoredOpenSupplierDebt.total)).toBe(0);

    const restoredUser = cleanDb
      .prepare(
        `
            SELECT
              password,
              is_active,
              must_change_password

            FROM users

            WHERE username =
              'restore-cashier'
            `,
      )
      .get() as {
      password: string;

      is_active: number;

      must_change_password: number;
    };

    expect(restoredUser.is_active).toBe(0);

    expect(restoredUser.must_change_password).toBe(1);

    expect(restoredUser.password).not.toBe('DO-NOT-RESTORE-THIS-HASH');

    /*
     * المدير الحالي فضل موجود.
     */
    expect(
      cleanDb
        .prepare(
          `
            SELECT id
            FROM users
            WHERE id = ?
            `,
        )
        .get(currentAdmin.id),
    ).toBeTruthy();

    const restoredPromotionLink = cleanDb
      .prepare(
        `
            SELECT COUNT(*) AS count

            FROM promotion_products pp

            JOIN promotions p
              ON p.id =
                pp.promotion_id

            JOIN products pr
              ON pr.id =
                pp.product_id

            WHERE
              p.name =
                'Restore Promotion'

              AND pr.name =
                'Restore Product'
            `,
      )
      .get() as {
      count: number;
    };

    expect(Number(restoredPromotionLink.count)).toBe(1);

    expect(
      (
        cleanDb
          .prepare(
            `
              SELECT value
              FROM app_settings
              WHERE key =
                'app_name'
              `,
          )
          .get() as {
          value: string;
        }
      ).value,
    ).toBe('Restored Business');

    expect(
      (
        cleanDb
          .prepare(
            `
              SELECT value
              FROM app_settings
              WHERE key =
                'auto_backup_dir'
              `,
          )
          .get() as {
          value: string;
        }
      ).value,
    ).toBe('CURRENT-DEVICE-BACKUPS');

    expect(
      cleanDb
        .prepare(
          `
            PRAGMA foreign_key_check
            `,
        )
        .all(),
    ).toEqual([]);
  }, 30_000);
});
