import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createCategory,
  createProduct,
} from '../../src/main/database/repositories/product.repo';

import { resetDatabaseKeepingSelectiveData } from '../../src/main/database/selective-reset';

function ensureAdmin() {
  const db = getDb();

  const existing = db
    .prepare(
      `
      SELECT
        id,
        username,
        password

      FROM users

      WHERE role =
        'admin'

      ORDER BY id ASC

      LIMIT 1
      `,
    )
    .get() as
    | {
        id: number;

        username: string;

        password: string;
      }
    | undefined;

  if (existing) {
    return existing;
  }

  const result = db
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
        'Selective Reset Admin',
        'selective-reset-admin',
        'PRESERVED-ADMIN-HASH',
        'admin',
        1,
        0
      )
      `,
    )
    .run();

  return {
    id: Number(result.lastInsertRowid),

    username: 'selective-reset-admin',

    password: 'PRESERVED-ADMIN-HASH',
  };
}

describe('selective reset', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  }, 30_000);

  it('resets operational history while keeping selected master data and current admin', () => {
    const db = getDb();

    const admin = ensureAdmin();

    const category = createCategory({
      name: 'Keep Category',

      description: null,
    });

    createProduct({
      name: 'Keep Product',

      category_id: category.id,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'KEEP-001',

          size: 'M',

          color: 'Black',

          buy_price: 20,

          sell_price: 50,

          min_stock: 1,

          opening_qty: 7,
        },
      ],
    });

    db.prepare(
      `
          INSERT INTO customers (
            name,
            phone,
            points_balance
          )

          VALUES (
            'Keep Customer',
            '01011111111',
            25
          )
          `,
    ).run();

    db.prepare(
      `
          INSERT INTO suppliers (
            name,
            phone
          )

          VALUES (
            'Delete Supplier',
            '01022222222'
          )
          `,
    ).run();

    /*
     * تاريخ تشغيل لازم يختفي.
     */
    db.prepare(
      `
          INSERT INTO expenses (
            title,
            amount,
            payment_method,
            created_by,
            business_date
          )

          VALUES (
            'Old Expense',
            100,
            'owner_cash',
            ?,
            date(
              'now',
              'localtime'
            )
          )
          `,
    ).run(admin.id);

    const result = resetDatabaseKeepingSelectiveData({
      sections: ['catalog_stock', 'customers'],

      actorId: admin.id,

      appVersion: 'selective-reset-test',
    });

    expect(result.sections).toEqual(['catalog_stock', 'customers']);

    expect(result.preserved_admin.username).toBe(admin.username);

    const restoredAdmin = db
      .prepare(
        `
            SELECT
              id,
              username,
              password,
              role,
              is_active

            FROM users

            WHERE id = ?
            `,
      )
      .get(admin.id) as {
      id: number;

      username: string;

      password: string;

      role: string;

      is_active: number;
    };

    expect(restoredAdmin).toMatchObject({
      id: admin.id,

      username: admin.username,

      password: admin.password,

      role: 'admin',

      is_active: 1,
    });

    expect(
      db
        .prepare(
          `
            SELECT id
            FROM products
            WHERE name =
              'Keep Product'
            `,
        )
        .get(),
    ).toBeTruthy();

    const stock = db
      .prepare(
        `
            SELECT IFNULL(
              SUM(
                CASE
                  WHEN sm.type =
                    'in'
                  THEN sm.quantity

                  WHEN sm.type =
                    'out'
                  THEN -sm.quantity

                  ELSE 0
                END
              ),
              0
            ) AS stock

            FROM product_variants v

            LEFT JOIN
              stock_movements sm
              ON sm.variant_id =
                 v.id

            WHERE v.barcode =
              'KEEP-001'
            `,
      )
      .get() as {
      stock: number;
    };

    expect(Number(stock.stock)).toBe(7);

    const customer = db
      .prepare(
        `
            SELECT
              name,
              points_balance,
              balance,
              total_spent

            FROM customers

            WHERE name =
              'Keep Customer'
            `,
      )
      .get() as {
      name: string;

      points_balance: number;

      balance: number;

      total_spent: number;
    };

    expect(customer).toMatchObject({
      name: 'Keep Customer',

      points_balance: 25,

      balance: 0,

      total_spent: 0,
    });

    /*
     * المورد لم يكن ضمن
     * الاختيارات، إذًا اختفى.
     */
    expect(
      db
        .prepare(
          `
            SELECT id
            FROM suppliers
            WHERE name =
              'Delete Supplier'
            `,
        )
        .get(),
    ).toBeUndefined();

    /*
     * التاريخ التشغيلي اتمسح.
     */
    expect(
      (
        db
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM expenses
              `,
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(0);

    expect(
      db
        .prepare(
          `
            PRAGMA foreign_key_check
            `,
        )
        .all(),
    ).toEqual([]);
  }, 30_000);

  it('restores other users only when users are selected and keeps the current admin password', () => {
    const db = getDb();

    const admin = ensureAdmin();

    db.prepare(
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
            'Old Cashier',
            'old-cashier',
            'OLD-CASHIER-HASH',
            'cashier',
            1,
            0
          )
          `,
    ).run();

    resetDatabaseKeepingSelectiveData({
      sections: ['users_permissions'],

      actorId: admin.id,

      appVersion: 'selective-reset-test',
    });

    const preservedAdmin = db
      .prepare(
        `
            SELECT
              password,
              is_active

            FROM users

            WHERE id = ?
            `,
      )
      .get(admin.id) as {
      password: string;

      is_active: number;
    };

    expect(preservedAdmin.password).toBe(admin.password);

    expect(preservedAdmin.is_active).toBe(1);

    const restoredCashier = db
      .prepare(
        `
            SELECT
              password,
              is_active,
              must_change_password

            FROM users

            WHERE username =
              'old-cashier'
            `,
      )
      .get() as {
      password: string;

      is_active: number;

      must_change_password: number;
    };

    expect(restoredCashier).toBeTruthy();

    expect(restoredCashier.password).not.toBe('OLD-CASHIER-HASH');

    expect(restoredCashier.is_active).toBe(0);

    expect(restoredCashier.must_change_password).toBe(1);
  }, 30_000);

  it('resets portable store settings when they are not selected and keeps device-local settings', () => {
    const db = getDb();

    const admin = ensureAdmin();

    db.prepare(
      `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES
          (
            'app_name',
            'Old Custom Store'
          ),

          (
            'app_theme',
            'light'
          ),

          (
            'auto_backup_dir',
            'D:\\ERP-LOCAL-BACKUPS'
          )

        ON CONFLICT(key)
        DO UPDATE SET
          value =
            excluded.value
        `,
    ).run();

    resetDatabaseKeepingSelectiveData({
      sections: ['customers'],

      actorId: admin.id,

      appVersion: 'selective-reset-test',
    });

    const appName = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'app_name'

          LIMIT 1
          `,
      )
      .get();

    expect(appName).toBeUndefined();

    const theme = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'app_theme'

          LIMIT 1
          `,
      )
      .get() as {
      value: string;
    };

    expect(theme.value).toBe('dark');

    const backupDir = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'auto_backup_dir'

          LIMIT 1
          `,
      )
      .get() as {
      value: string;
    };

    expect(backupDir.value).toBe('D:\\ERP-LOCAL-BACKUPS');
  }, 30_000);

  it('restores selected portable store settings while still keeping device-local settings', () => {
    const db = getDb();

    const admin = ensureAdmin();

    db.prepare(
      `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES
          (
            'app_name',
            'Keep My Store'
          ),

          (
            'app_theme',
            'light'
          ),

          (
            'auto_backup_dir',
            'E:\\LOCAL-BACKUPS'
          )

        ON CONFLICT(key)
        DO UPDATE SET
          value =
            excluded.value
        `,
    ).run();

    resetDatabaseKeepingSelectiveData({
      sections: ['store_settings'],

      actorId: admin.id,

      appVersion: 'selective-reset-test',
    });

    const appName = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'app_name'

          LIMIT 1
          `,
      )
      .get() as {
      value: string;
    };

    expect(appName.value).toBe('Keep My Store');

    const theme = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'app_theme'

          LIMIT 1
          `,
      )
      .get() as {
      value: string;
    };

    expect(theme.value).toBe('light');

    const backupDir = db
      .prepare(
        `
          SELECT value

          FROM app_settings

          WHERE key =
            'auto_backup_dir'

          LIMIT 1
          `,
      )
      .get() as {
      value: string;
    };

    expect(backupDir.value).toBe('E:\\LOCAL-BACKUPS');
  }, 30_000);
});
