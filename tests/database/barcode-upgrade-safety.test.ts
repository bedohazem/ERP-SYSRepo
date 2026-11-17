import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import {
  closeDb,
  getDb,
  getDbPath,
  resetDatabaseData,
} from '../../src/main/database/db';

import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

const protectedTables = [
  'products',
  'product_variants',
  'stock_movements',
  'customers',
  'suppliers',
  'sales',
  'sale_items',
  'sale_payments',
  'purchase_invoices',
  'purchase_items',
  'supplier_payments',
  'cash_movements',
] as const;

function captureData(db: Database.Database) {
  return Object.fromEntries(
    protectedTables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
    ]),
  );
}

describe('barcode migration 42 data safety', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  afterEach(() => {
    closeDb();
  });

  it('upgrades populated version 41 without modifying business records', () => {
    const db = getDb();

    createProduct({
      name: 'Upgrade Safety Product',
      category_id: null,
      variants: [
        {
          barcode: 'SAFETY-001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 200,
          min_stock: 1,
          opening_qty: 5,
        },
      ],
    });

    const variant = getVariantByBarcode('SAFETY-001')!;

    const customerId = Number(
      db
        .prepare(
          `
        INSERT INTO customers (
          name, phone, balance, total_spent
        )
        VALUES ('Safety Customer', '01099990001', 150, 200)
        `,
        )
        .run().lastInsertRowid,
    );

    const supplierId = Number(
      db
        .prepare(
          `
        INSERT INTO suppliers (
          name, phone, balance, total_purchased
        )
        VALUES ('Safety Supplier', '01099990002', 160, 160)
        `,
        )
        .run().lastInsertRowid,
    );

    const saleId = Number(
      db
        .prepare(
          `
        INSERT INTO sales (
          type, customer_id,
          sub_total, grand_total,
          paid, remaining_amount,
          payment_status, payment_method
        )
        VALUES (
          'sale', ?, 200, 200,
          50, 150, 'partial', 'store_cash'
        )
        `,
        )
        .run(customerId).lastInsertRowid,
    );

    db.prepare(
      `
      INSERT INTO sale_items (
        sale_id, variant_id,
        product_name, barcode, size, color,
        quantity, unit_cost, unit_price, line_total
      )
      VALUES (
        ?, ?, 'Upgrade Safety Product',
        'SAFETY-001', 'M', 'Black',
        1, 100, 200, 200
      )
      `,
    ).run(saleId, variant.variant_id);

    const purchaseId = Number(
      db
        .prepare(
          `
        INSERT INTO purchase_invoices (
          supplier_id, sub_total, total_amount,
          paid_amount, remaining_amount,
          payment_status
        )
        VALUES (?, 160, 160, 0, 160, 'unpaid')
        `,
        )
        .run(supplierId).lastInsertRowid,
    );

    db.prepare(
      `
      INSERT INTO purchase_items (
        purchase_id, variant_id,
        product_name, barcode, size, color,
        quantity, unit_cost, line_total
      )
      VALUES (
        ?, ?, 'Upgrade Safety Product',
        'SAFETY-001', 'M', 'Black',
        2, 80, 160
      )
      `,
    ).run(purchaseId, variant.variant_id);

    db.prepare(
      `
      INSERT INTO cash_movements (
        type, amount, direction,
        payment_method, reference_id, reference_type
      )
      VALUES (
        'sale', 50, 'in',
        'store_cash', ?, 'sale'
      )
      `,
    ).run(saleId);

    /*
     * نحاكي إصدار 41 داخل قاعدة الاختبارات المؤقتة.
     * ممنوع تنفيذ الجزء ده على قاعدة المحل.
     */
    closeDb();

    const legacyDb = new Database(getDbPath());

    let before: ReturnType<typeof captureData>;

    try {
      legacyDb.exec(`
        DROP TRIGGER IF EXISTS
          trg_variant_barcode_history_insert;

        DROP TRIGGER IF EXISTS
          trg_variant_barcode_history_update;

        DROP TABLE IF EXISTS
          product_variant_barcode_history;

        DELETE FROM schema_migrations
        WHERE version = 42;
      `);

      const version = legacyDb
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get() as { version: number };

      expect(version.version).toBe(41);

      before = captureData(legacyDb);
    } finally {
      legacyDb.close();
    }

    /*
     * إعادة فتح القاعدة تُشغّل Migration 42 تلقائيًا.
     */
    const upgradedDb = getDb();

    const after = captureData(upgradedDb);

    expect(after).toEqual(before);

    const version = upgradedDb
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number };

    expect(version.version).toBe(42);

    const history = upgradedDb
      .prepare(
        `
        SELECT variant_id
        FROM product_variant_barcode_history
        WHERE barcode = 'SAFETY-001'
        `,
      )
      .get() as { variant_id: number };

    expect(history.variant_id).toBe(variant.variant_id);

    expect(upgradedDb.pragma('foreign_key_check')).toEqual([]);

    expect(
      upgradedDb.pragma('integrity_check', {
        simple: true,
      }),
    ).toBe('ok');

    /*
     * فتح البرنامج مرة ثانية لا يعيد تشغيل الترقية
     * ولا يغير البيانات.
     */
    closeDb();

    const reopenedDb = getDb();

    expect(captureData(reopenedDb)).toEqual(before);
  }, 30_000);
});
