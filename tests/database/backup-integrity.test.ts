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
  cleanupRestoreSafetyBackups,
} from '../../src/main/database/database-backup';

import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { createSale } from '../../src/main/database/repositories/sales.repo';

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import { getVariantStock } from '../../src/main/database/repositories/inventory.repo';

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
});
