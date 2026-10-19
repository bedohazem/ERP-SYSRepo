import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeDb,
  getDb,
  getDbPath,
  resetDatabaseData,
} from '../../src/main/database/db';

import { validateErpDatabaseFile } from '../../src/main/database/backup-integrity';

import {
  createVerifiedDatabaseBackup,
  restoreVerifiedDatabase,
  runDatabaseMaintenanceWithVerifiedSafetyBackup,
  cleanupRestoreSafetyBackups,
} from '../../src/main/database/database-backup';
import { runDatabaseMaintenanceExclusive } from '../../src/main/database/database-maintenance-lock';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { createSale } from '../../src/main/database/repositories/sales.repo';

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import { getVariantStock } from '../../src/main/database/repositories/inventory.repo';
import {
  createHistoricalPreVersionedErpFixture,
  HISTORICAL_PRE_VERSIONED_COMMIT,
} from '../fixtures/historical-pre-versioned-erp';

function tempPath(name: string) {
  return path.join(path.dirname(getDbPath()), name);
}

describe('database backup integrity', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  it('creates a verified ERP backup', async () => {
    const backupPath = tempPath(`verified-${Date.now()}.db`);

    try {
      const result = await createVerifiedDatabaseBackup(backupPath);

      expect(result.size).toBeGreaterThan(0);

      expect(result.tables).toContain('users');

      expect(result.tables).toContain('sales');

      expect(() => validateErpDatabaseFile(backupPath)).not.toThrow();
    } finally {
      try {
        fs.rmSync(backupPath, {
          force: true,
        });
      } catch {
        // ignore
      }
    }
  });

  it('keeps the maintenance lock held through the safety backup and protected work', async () => {
    const backupPath = tempPath(`maintenance-window-${Date.now()}.db`);

    let releaseProtectedWork!: () => void;

    let signalProtectedWorkStarted!: () => void;

    const protectedWorkStarted = new Promise<void>((resolve) => {
      signalProtectedWorkStarted = resolve;
    });

    const holdProtectedWork = new Promise<void>((resolve) => {
      releaseProtectedWork = resolve;
    });

    let competingMaintenanceEntered = false;

    try {
      const protectedOperation = runDatabaseMaintenanceWithVerifiedSafetyBackup(
        backupPath,

        async () => {
          signalProtectedWorkStarted();

          await holdProtectedWork;
        },
      );

      await protectedWorkStarted;

      /*
       * العملية الثانية لازم تستنى
       * لحد ما Callback العملية
       * المحمية يخلص، مش مجرد
       * انتهاء إنشاء الـbackup.
       */
      const competingOperation = runDatabaseMaintenanceExclusive(async () => {
        competingMaintenanceEntered = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(competingMaintenanceEntered).toBe(false);

      releaseProtectedWork();

      await protectedOperation;

      await competingOperation;

      expect(competingMaintenanceEntered).toBe(true);

      expect(() => validateErpDatabaseFile(backupPath)).not.toThrow();
    } finally {
      releaseProtectedWork();

      try {
        fs.rmSync(backupPath, {
          force: true,
        });
      } catch {
        // ignore cleanup errors
      }
    }
  }, 30_000);

  it('rejects an ERP backup with foreign key violations', async () => {
    const backupPath = tempPath(`broken-fk-${Date.now()}.db`);

    try {
      await createVerifiedDatabaseBackup(backupPath);

      const brokenDb = new Database(backupPath);

      try {
        brokenDb.pragma('foreign_keys = OFF');

        brokenDb
          .prepare(
            `
          INSERT INTO sale_items (
            sale_id,
            variant_id,
            product_name,
            barcode,
            size,
            color,
            quantity,
            unit_cost,
            unit_price,
            promotion_discount_value,
            line_total,
            is_gift,
            promotion_group_id
          )

          VALUES (
            999999999,
            NULL,
            'Broken FK Item',
            NULL,
            NULL,
            NULL,
            1,
            0,
            10,
            0,
            10,
            0,
            NULL
          )
          `,
          )
          .run();
      } finally {
        brokenDb.close();
      }

      expect(() => validateErpDatabaseFile(backupPath)).toThrow(
        'علاقات مكسورة',
      );
    } finally {
      fs.rmSync(backupPath, {
        force: true,
      });
    }
  });

  it('rejects a non database file', () => {
    const badPath = tempPath(`bad-${Date.now()}.db`);

    fs.writeFileSync(badPath, 'not a database', 'utf8');

    try {
      expect(() => validateErpDatabaseFile(badPath)).toThrow(
        'قاعدة بيانات ERP',
      );
    } finally {
      fs.rmSync(badPath, {
        force: true,
      });
    }
  });

  it('rejects a valid sqlite database that is not an ERP backup', () => {
    const otherPath = tempPath(`other-${Date.now()}.db`);

    const other = new Database(otherPath);

    other.exec(
      `
          CREATE TABLE notes (
            id INTEGER PRIMARY KEY,
            text TEXT
          );
          `,
    );

    other.close();

    try {
      expect(() => validateErpDatabaseFile(otherPath)).toThrow(
        'ليس نسخة ERP صالحة',
      );
    } finally {
      fs.rmSync(otherPath, {
        force: true,
      });
    }
  });

  it('restores a verified backup and preserves a safety backup', async () => {
    const sourcePath = tempPath(`restore-source-${Date.now()}.db`);

    await createVerifiedDatabaseBackup(sourcePath);

    const db = getDb();

    db.prepare(
      `
          INSERT INTO app_settings (
            key,
            value
          )

          VALUES (
            'restore_test_marker',
            'after-backup'
          )

          ON CONFLICT(key)
          DO UPDATE SET
            value = excluded.value
          `,
    ).run();

    const restored = await restoreVerifiedDatabase(sourcePath);

    expect(restored.safetyBackupPath).toBeTruthy();

    expect(fs.existsSync(restored.safetyBackupPath!)).toBe(true);

    const marker = getDb()
      .prepare(
        `
              SELECT value

              FROM app_settings

              WHERE key =
                'restore_test_marker'
              `,
      )
      .get();

    expect(marker).toBeUndefined();

    fs.rmSync(sourcePath, {
      force: true,
    });

    fs.rmSync(restored.safetyBackupPath!, {
      force: true,
    });
  });

  it('automatically rolls back when replacing the live database fails', async () => {
    const sourcePath = tempPath(`rollback-source-${Date.now()}.db`);

    /*
     * Source صالحة.
     */
    await createVerifiedDatabaseBackup(sourcePath);

    /*
     * بعد إنشاء Source نضيف
     * Marker إلى القاعدة الحالية.
     * Safety backup لازم تحفظه.
     */
    getDb()
      .prepare(
        `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES (
          'rollback_marker',
          'current-database'
        )

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
        `,
      )
      .run();

    const renameSpy = vi.spyOn(fs, 'renameSync');

    renameSpy.mockImplementationOnce(() => {
      throw new Error('simulated replace failure');
    });

    try {
      await expect(restoreVerifiedDatabase(sourcePath)).rejects.toThrow(
        'simulated replace failure',
      );

      /*
       * القاعدة الأصلية لازم
       * تكون رجعت تلقائيًا.
       */
      const marker = getDb()
        .prepare(
          `
            SELECT value

            FROM app_settings

            WHERE key =
              'rollback_marker'

            LIMIT 1
            `,
        )
        .get() as
        | {
            value: string;
          }
        | undefined;

      expect(marker?.value).toBe('current-database');

      expect(() => validateErpDatabaseFile(getDbPath())).not.toThrow();
    } finally {
      renameSpy.mockRestore();

      fs.rmSync(sourcePath, {
        force: true,
      });

      /*
       * ننظف Safety backups
       * التي أنشأها الاختبار.
       */
      const dir = path.dirname(getDbPath());

      const prefix = `${path.basename(getDbPath())}.before-restore-`;

      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(prefix) && file.endsWith('.bak')) {
          fs.rmSync(path.join(dir, file), {
            force: true,
          });
        }
      }
    }
  });

  it('does not touch the live database when the selected backup is invalid', async () => {
    const badPath = tempPath(`invalid-restore-${Date.now()}.db`);

    getDb()
      .prepare(
        `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES (
          'invalid_restore_marker',
          'still-here'
        )

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
        `,
      )
      .run();

    fs.writeFileSync(badPath, 'definitely not sqlite', 'utf8');

    try {
      await expect(restoreVerifiedDatabase(badPath)).rejects.toThrow();

      const marker = getDb()
        .prepare(
          `
            SELECT value

            FROM app_settings

            WHERE key =
              'invalid_restore_marker'

            LIMIT 1
            `,
        )
        .get() as
        | {
            value: string;
          }
        | undefined;

      expect(marker?.value).toBe('still-here');
    } finally {
      fs.rmSync(badPath, {
        force: true,
      });
    }
  });

  it('clears legacy activation and device-local settings after restore', async () => {
    const sourcePath = tempPath(`device-local-settings-${Date.now()}.db`);

    const db = getDb();

    const sourceSettings = [
      ['auto_backup_dir', 'Z:\\Old-PC\\ERP-Backups'],
      ['cash_drawer_printer_name', 'OLD-PC-PRINTER'],

      /*
       * Legacy database-based activation.
       */
      ['app_activated', 'true'],
      ['app_trial_days', '999'],
      ['app_trial_started_at', '2020-01-01T00:00:00.000Z'],
      ['app_deactivated_at', '2020-01-02T00:00:00.000Z'],

      /*
       * Store setting لازم يفضل موجود
       * لإثبات إننا مش بنمسح app_settings كلها.
       */
      ['app_name', 'Restored Store'],
    ] as const;

    const upsert = db.prepare(
      `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES (?, ?)

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
        `,
    );

    const seedSourceSettings = db.transaction(() => {
      for (const [key, value] of sourceSettings) {
        upsert.run(key, value);
      }
    });

    seedSourceSettings();

    await createVerifiedDatabaseBackup(sourcePath);

    const restored = await restoreVerifiedDatabase(sourcePath);

    try {
      const liveDb = getDb();

      const removedKeys = [
        'auto_backup_dir',
        'cash_drawer_printer_name',
        'app_activated',
        'app_trial_days',
        'app_trial_started_at',
        'app_deactivated_at',
      ];

      for (const key of removedKeys) {
        const row = liveDb
          .prepare(
            `
              SELECT value
              FROM app_settings
              WHERE key = ?
              `,
          )
          .get(key);

        expect(row).toBeUndefined();
      }

      const preservedSetting = liveDb
        .prepare(
          `
            SELECT value
            FROM app_settings
            WHERE key = 'app_name'
            `,
        )
        .get() as
        | {
            value: string;
          }
        | undefined;

      expect(preservedSetting?.value).toBe('Restored Store');

      expect(() => validateErpDatabaseFile(getDbPath())).not.toThrow();
    } finally {
      fs.rmSync(sourcePath, {
        force: true,
      });

      if (restored.safetyBackupPath) {
        fs.rmSync(restored.safetyBackupPath, {
          force: true,
        });
      }
    }
  }, 30_000);

  it('keeps only the newest restore safety backups', () => {
    const stamp = Date.now();

    const fakeTarget = tempPath(`retention-${stamp}.db`);

    const prefix = `${path.basename(fakeTarget)}.before-restore-`;

    const dir = path.dirname(fakeTarget);

    const files: string[] = [];

    try {
      for (let index = 0; index < 7; index += 1) {
        const filePath = path.join(dir, `${prefix}${index}.bak`);

        fs.writeFileSync(filePath, `backup-${index}`, 'utf8');

        const date = new Date(Date.now() - index * 1000);

        fs.utimesSync(filePath, date, date);

        files.push(filePath);
      }

      const result = cleanupRestoreSafetyBackups(fakeTarget, 5);

      expect(result.deleted).toBe(2);

      expect(files.filter((file) => fs.existsSync(file))).toHaveLength(5);
    } finally {
      for (const file of files) {
        fs.rmSync(file, {
          force: true,
        });
      }
    }
  });

  it('restores a legacy ERP backup, runs migrations and preserves financial history', async () => {
    const legacyPath = tempPath(`legacy-${Date.now()}.db`);

    const shift = openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });

    createProduct({
      name: 'Legacy Restore Product',
      category_id: null,
      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'LEGACY-RESTORE-001',
          size: 'M',
          color: 'Black',

          buy_price: 40,
          sell_price: 100,

          min_stock: 1,
          opening_qty: 5,
        },
      ],
    });

    const variant = getVariantByBarcode('LEGACY-RESTORE-001')!;

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 200,
      discount_value: 0,
      grand_total: 200,

      paid: 200,
      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,

          quantity: 2,
          unit_price: 100,
        },
      ],
    });

    const expectedLatestVersion = Number(
      (
        getDb()
          .prepare(
            `
          SELECT
            MAX(version) AS version

          FROM schema_migrations
          `,
          )
          .get() as {
          version: number;
        }
      ).version,
    );

    await createVerifiedDatabaseBackup(legacyPath);

    const legacyDb = new Database(legacyPath);

    try {
      legacyDb.pragma('foreign_keys = OFF');

      /*
       * نحاكي نسخة من قبل
       * Purchase Orders وباقي
       * الـmigrations الحديثة.
       */
      legacyDb.exec(`
        DROP INDEX IF EXISTS
          idx_cash_shifts_business_date;

        DROP INDEX IF EXISTS
          idx_expenses_business_date;

        DROP INDEX IF EXISTS
          idx_purchase_returns_business_date;

        DROP INDEX IF EXISTS
          idx_store_liabilities_business_date;

        DROP INDEX IF EXISTS
          idx_store_liability_payments_business_date;


        ALTER TABLE sales
        DROP COLUMN list_sub_total;

        ALTER TABLE sales
        DROP COLUMN product_discount_value;

        ALTER TABLE sale_items
        DROP COLUMN list_unit_price;


        ALTER TABLE sale_returns
        DROP COLUMN list_sub_total;

        ALTER TABLE sale_returns
        DROP COLUMN product_discount_value;

        ALTER TABLE sale_return_items
        DROP COLUMN list_unit_price;

        ALTER TABLE sale_return_items
        DROP COLUMN product_discount_value;


        ALTER TABLE sale_promotion_units
        DROP COLUMN original_list_unit_price;

        ALTER TABLE sale_promotion_units
        DROP COLUMN current_list_unit_price;


        ALTER TABLE sale_exchanges
        DROP COLUMN old_product_discount_value;

        ALTER TABLE sale_exchanges
        DROP COLUMN new_product_discount_value;

        ALTER TABLE sale_exchange_items
        DROP COLUMN old_list_unit_price;

        ALTER TABLE sale_exchange_items
        DROP COLUMN new_list_unit_price;


        ALTER TABLE held_sale_items
        DROP COLUMN unit_price;

        ALTER TABLE held_sale_items
        DROP COLUMN list_unit_price;


        ALTER TABLE cash_shifts
        DROP COLUMN business_date;

        ALTER TABLE expenses
        DROP COLUMN business_date;

        ALTER TABLE purchase_returns
        DROP COLUMN business_date;

        ALTER TABLE store_liabilities
        DROP COLUMN business_date;

        ALTER TABLE store_liability_payments
        DROP COLUMN business_date;

      DELETE FROM schema_migrations
      WHERE version > 10;

      DROP TABLE IF EXISTS
        purchase_order_items;

      DROP TABLE IF EXISTS
        purchase_orders;
    `);
    } finally {
      legacyDb.close();
    }

    expect(() => validateErpDatabaseFile(legacyPath)).not.toThrow();

    const restored = await restoreVerifiedDatabase(legacyPath);

    try {
      const liveDb = getDb();

      const versionRow = liveDb
        .prepare(
          `
        SELECT
          MAX(version) AS version

        FROM schema_migrations
        `,
        )
        .get() as {
        version: number;
      };

      expect(Number(versionRow.version)).toBe(expectedLatestVersion);

      expect(getVariantStock(variant.variant_id)).toBe(3);

      const restoredSale = liveDb
        .prepare(
          `
          SELECT
            grand_total,
            list_sub_total

          FROM sales

          WHERE id = ?
          `,
        )
        .get(sale.saleId) as {
        grand_total: number;
        list_sub_total: number | null;
      };

      expect(Number(restoredSale.grand_total)).toBe(200);

      expect(Number(restoredSale.list_sub_total)).toBe(200);

      const restoredShift = liveDb
        .prepare(
          `
          SELECT
            business_date

          FROM cash_shifts

          WHERE id = ?
          `,
        )
        .get(shift.id) as {
        business_date: string | null;
      };

      expect(String(restoredShift.business_date || '')).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );

      const purchaseOrdersTable = liveDb
        .prepare(
          `
        SELECT name

        FROM sqlite_master

        WHERE
          type = 'table'
          AND name = 'purchase_orders'
        `,
        )
        .get();

      expect(purchaseOrdersTable).toBeTruthy();

      const cashBalance = liveDb
        .prepare(
          `
        SELECT
          IFNULL(
            SUM(
              CASE
                WHEN direction = 'in'
                THEN amount
                ELSE -amount
              END
            ),
            0
          ) AS balance

        FROM cash_movements

        WHERE
          payment_method = 'store_cash'
          AND cancelled_at IS NULL
        `,
        )
        .get() as {
        balance: number;
      };

      expect(Number(cashBalance.balance)).toBe(200);

      expect(() => validateErpDatabaseFile(getDbPath())).not.toThrow();
    } finally {
      fs.rmSync(legacyPath, {
        force: true,
      });

      if (restored.safetyBackupPath) {
        fs.rmSync(restored.safetyBackupPath, {
          force: true,
        });
      }
    }
  });

  it('restores a real pre-versioned historical ERP fixture through every current migration', async () => {
    const historicalPath = tempPath(
      `historical-${HISTORICAL_PRE_VERSIONED_COMMIT.slice(0, 7)}-${Date.now()}.db`,
    );

    const expectedLatestVersion = Number(
      (
        getDb()
          .prepare(
            `
              SELECT MAX(version) AS version
              FROM schema_migrations
              `,
          )
          .get() as {
          version: number;
        }
      ).version,
    );

    createHistoricalPreVersionedErpFixture(historicalPath);

    /*
     * دي أهم نقطة:
     * الملف نفسه جاي من عصر ما قبل
     * versioned schema migrations.
     */
    const sourceDb = new Database(historicalPath, {
      readonly: true,
    });

    try {
      const migrationTable = sourceDb
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE
              type = 'table'
              AND name = 'schema_migrations'
            `,
        )
        .get();

      expect(migrationTable).toBeUndefined();

      const sourceForeignKeyErrors = sourceDb.pragma(
        'foreign_key_check',
      ) as unknown[];

      expect(sourceForeignKeyErrors).toEqual([]);
    } finally {
      sourceDb.close();
    }

    /*
     * الـrestore validator لازم يقبل
     * قاعدة ERP تاريخية حقيقية قبل
     * تشغيل migrations الحديثة عليها.
     */
    expect(() => validateErpDatabaseFile(historicalPath)).not.toThrow();

    const restored = await restoreVerifiedDatabase(historicalPath);

    try {
      const liveDb = getDb();

      /*
       * كل الـmigrations من البداية
       * حتى أحدث نسخة لازم تكون اتطبقت.
       */
      const versionRow = liveDb
        .prepare(
          `
            SELECT MAX(version) AS version
            FROM schema_migrations
            `,
        )
        .get() as {
        version: number;
      };

      expect(Number(versionRow.version)).toBe(expectedLatestVersion);

      /*
       * لازم marker التاريخية نفسها
       * تفضل موجودة بعد الاسترجاع والترقية.
       */
      const marker = liveDb
        .prepare(
          `
            SELECT value
            FROM app_settings
            WHERE key = 'historical_fixture_marker'
            `,
        )
        .get() as
        | {
            value: string;
          }
        | undefined;

      expect(marker?.value).toBe('pre-versioned');

      /*
       * Historical stock:
       *
       * +5 opening
       * -2 sale
       * +3 purchase
       * = 6
       *
       * Migration 1 لازم كمان تحول
       * legacy "opening" إلى "in".
       */
      expect(getVariantStock(1)).toBe(6);

      const openingMovement = liveDb
        .prepare(
          `
            SELECT type
            FROM stock_movements
            WHERE id = 1
            `,
        )
        .get() as {
        type: string;
      };

      expect(openingMovement.type).toBe('in');

      /*
       * Migration 4:
       *
       * النسخة القديمة ماكانتش بتخزن
       * moving weighted average history.
       *
       * نقطة البداية المتعمدة:
       * current stock × legacy buy_price.
       *
       * 6 × 40 = 240.
       */
      const variant = liveDb
        .prepare(
          `
            SELECT
              buy_price,
              average_cost,
              inventory_value

            FROM product_variants

            WHERE id = 1
            `,
        )
        .get() as {
        buy_price: number;
        average_cost: number;
        inventory_value: number;
      };

      expect(Number(variant.buy_price)).toBe(40);

      expect(Number(variant.average_cost)).toBe(40);

      expect(Number(variant.inventory_value)).toBe(240);

      /*
       * Sale history لازم تفضل كما هي،
       * والـsnapshot columns الحديثة
       * تتعمل لها backfill بدون اختراع
       * خصومات تاريخية.
       */
      const sale = liveDb
        .prepare(
          `
            SELECT
              grand_total,
              list_sub_total,
              product_discount_value,
              business_date

            FROM sales

            WHERE id = 1
            `,
        )
        .get() as {
        grand_total: number;
        list_sub_total: number | null;
        product_discount_value: number;
        business_date: string | null;
      };

      expect(Number(sale.grand_total)).toBe(200);

      expect(Number(sale.list_sub_total)).toBe(200);

      expect(Number(sale.product_discount_value)).toBe(0);

      expect(sale.business_date).toBe('2026-09-22');

      const saleItem = liveDb
        .prepare(
          `
            SELECT
              quantity,
              unit_cost,
              unit_price,
              list_unit_price

            FROM sale_items

            WHERE id = 1
            `,
        )
        .get() as {
        quantity: number;
        unit_cost: number;
        unit_price: number;
        list_unit_price: number | null;
      };

      expect(Number(saleItem.quantity)).toBe(2);

      expect(Number(saleItem.unit_cost)).toBe(40);

      expect(Number(saleItem.unit_price)).toBe(100);

      expect(Number(saleItem.list_unit_price)).toBe(100);

      /*
       * Customer / supplier accounting
       * لازم مايتغيرش أثناء الترقية.
       */
      const customer = liveDb
        .prepare(
          `
            SELECT balance
            FROM customers
            WHERE id = 1
            `,
        )
        .get() as {
        balance: number;
      };

      expect(Number(customer.balance)).toBe(0);

      const supplier = liveDb
        .prepare(
          `
            SELECT
              total_purchased,
              balance

            FROM suppliers

            WHERE id = 1
            `,
        )
        .get() as {
        total_purchased: number;
        balance: number;
      };

      expect(Number(supplier.total_purchased)).toBe(150);

      expect(Number(supplier.balance)).toBe(150);

      /*
       * Purchase history + Migration 3
       * business-date backfill.
       */
      const purchase = liveDb
        .prepare(
          `
            SELECT
              total_amount,
              paid_amount,
              remaining_amount,
              business_date

            FROM purchase_invoices

            WHERE id = 1
            `,
        )
        .get() as {
        total_amount: number;
        paid_amount: number;
        remaining_amount: number;
        business_date: string | null;
      };

      expect(Number(purchase.total_amount)).toBe(150);

      expect(Number(purchase.paid_amount)).toBe(0);

      expect(Number(purchase.remaining_amount)).toBe(150);

      expect(purchase.business_date).toBe('2026-09-22');

      /*
       * Liability accounting must survive.
       */
      const liability = liveDb
        .prepare(
          `
            SELECT
              total_amount,
              paid_amount,
              remaining_amount,
              business_date

            FROM store_liabilities

            WHERE id = 1
            `,
        )
        .get() as {
        total_amount: number;
        paid_amount: number;
        remaining_amount: number;
        business_date: string | null;
      };

      expect(Number(liability.total_amount)).toBe(100);

      expect(Number(liability.paid_amount)).toBe(30);

      expect(Number(liability.remaining_amount)).toBe(70);

      expect(liability.business_date).toBe('2026-09-22');

      const liabilityPayment = liveDb
        .prepare(
          `
            SELECT
              amount,
              business_date

            FROM store_liability_payments

            WHERE id = 1
            `,
        )
        .get() as {
        amount: number;
        business_date: string | null;
      };

      expect(Number(liabilityPayment.amount)).toBe(30);

      expect(liabilityPayment.business_date).toBe('2026-09-22');

      /*
       * Migration 15 / 16:
       * historical shift and expense dates.
       */
      const shift = liveDb
        .prepare(
          `
            SELECT business_date
            FROM cash_shifts
            WHERE id = 1
            `,
        )
        .get() as {
        business_date: string | null;
      };

      expect(shift.business_date).toBe('2026-09-22');

      const expense = liveDb
        .prepare(
          `
            SELECT
              amount,
              business_date

            FROM expenses

            WHERE id = 1
            `,
        )
        .get() as {
        amount: number;
        business_date: string | null;
      };

      expect(Number(expense.amount)).toBe(20);

      expect(expense.business_date).toBe('2026-09-22');

      /*
       * Raw historical cash accounting:
       *
       * +200 sale
       * -20 expense
       * -30 liability payment
       * = 150
       *
       * الحساب هنا متعمد يكون بدون
       * الاعتماد على اسم account الحديث،
       * لأن النسخة التاريخية كانت تستخدم
       * legacy payment_method = cash.
       */
      const cash = liveDb
        .prepare(
          `
            SELECT
              COUNT(*) AS movements_count,

              IFNULL(
                SUM(
                  CASE
                    WHEN direction = 'in'
                    THEN amount
                    ELSE -amount
                  END
                ),
                0
              ) AS balance

            FROM cash_movements

            WHERE cancelled_at IS NULL
            `,
        )
        .get() as {
        movements_count: number;
        balance: number;
      };

      expect(Number(cash.movements_count)).toBe(3);

      expect(Number(cash.balance)).toBe(150);

      /*
       * Migration 11 schema must now exist
       * even though the historical source
       * predates Purchase Orders.
       */
      const purchaseOrdersTable = liveDb
        .prepare(
          `
            SELECT name

            FROM sqlite_master

            WHERE
              type = 'table'
              AND name = 'purchase_orders'
            `,
        )
        .get();

      expect(purchaseOrdersTable).toBeTruthy();

      /*
       * أهم invariant بعد كل الترقية:
       * مفيش أي FK مكسورة.
       */
      const foreignKeyErrors = liveDb.pragma('foreign_key_check') as unknown[];

      expect(foreignKeyErrors).toEqual([]);

      expect(() => validateErpDatabaseFile(getDbPath())).not.toThrow();
    } finally {
      fs.rmSync(historicalPath, {
        force: true,
      });

      if (restored.safetyBackupPath) {
        fs.rmSync(restored.safetyBackupPath, {
          force: true,
        });
      }
    }
  }, 30_000);
});
