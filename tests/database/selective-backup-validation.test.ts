import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createCategory,
  createProduct,
} from '../../src/main/database/repositories/product.repo';

import {
  buildSelectiveBackupPackage,
  validateSelectiveBackupPackageV1,
} from '../../src/main/database/selective-backup';

import { restoreSelectiveBackupPackage } from '../../src/main/database/selective-restore';

function cloneBackup<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createRichBackup() {
  const db = getDb();

  const admin = db
    .prepare(
      `
      SELECT id

      FROM users

      WHERE role = 'admin'

      ORDER BY id ASC

      LIMIT 1
      `,
    )
    .get() as {
    id: number;
  };

  const category = createCategory({
    name: 'Validation Category',

    description: 'validation',
  });

  const product = createProduct({
    name: 'Validation Product',

    category_id: category.id,

    image_path: null,

    description: 'validation product',

    variants: [
      {
        barcode: 'VALIDATION-001',

        size: 'M',

        color: 'Black',

        buy_price: 20,

        sell_price: 50,

        min_stock: 1,

        opening_qty: 5,
      },
    ],
  });

  const variant = db
    .prepare(
      `
      SELECT id

      FROM product_variants

      WHERE barcode =
        'VALIDATION-001'

      LIMIT 1
      `,
    )
    .get() as {
    id: number;
  };

  const customer = db
    .prepare(
      `
      INSERT INTO customers (
        name,
        phone,
        points_balance
      )

      VALUES (
        'Validation Customer',
        '01010000000',
        10
      )
      `,
    )
    .run();

  const supplier = db
    .prepare(
      `
      INSERT INTO suppliers (
        name,
        phone
      )

      VALUES (
        'Validation Supplier',
        '01020000000'
      )
      `,
    )
    .run();

  const customerId = Number(customer.lastInsertRowid);

  const supplierId = Number(supplier.lastInsertRowid);

  db.prepare(
    `
    INSERT INTO sales (
      type,

      customer_id,
      user_id,

      business_date,

      sub_total,
      grand_total,

      paid,
      remaining_amount,

      payment_status,

      payment_method,

      due_date
    )

    VALUES (
      'sale',

      ?, ?,

      '2026-10-01',

      100,
      100,

      0,
      100,

      'unpaid',

      'owner_bank',

      '2026-10-30'
    )
    `,
  ).run(customerId, admin.id);

  db.prepare(
    `
    UPDATE customers

    SET
      balance = 100,
      total_spent = 100

    WHERE id = ?
    `,
  ).run(customerId);

  db.prepare(
    `
    INSERT INTO purchase_invoices (
      supplier_id,

      total_amount,
      sub_total,

      paid_amount,
      remaining_amount,

      payment_status,
      payment_method,

      status,

      business_date,
      due_date
    )

    VALUES (
      ?,

      150,
      150,

      0,
      150,

      'unpaid',
      'owner_bank',

      'active',

      '2026-10-02',
      '2026-10-31'
    )
    `,
  ).run(supplierId);

  db.prepare(
    `
    UPDATE suppliers

    SET
      balance = 150,
      total_purchased = 150

    WHERE id = ?
    `,
  ).run(supplierId);

  db.prepare(
    `
    INSERT INTO store_liabilities (
      party_name,
      title,
      category,

      total_amount,
      paid_amount,
      remaining_amount,

      status,

      due_date,

      created_by,
      business_date
    )

    VALUES (
      'Validation Party',
      'Validation Liability',
      'other',

      200,
      0,
      200,

      'open',

      '2026-11-01',

      ?,
      '2026-10-03'
    )
    `,
  ).run(admin.id);

  db.prepare(
    `
    INSERT INTO cash_movements (
      type,
      amount,
      direction,

      payment_method,

      reference_type,

      created_by,
      business_date
    )

    VALUES (
      'deposit',
      500,
      'in',

      'owner_bank',

      'manual',

      ?,
      '2026-10-03'
    )
    `,
  ).run(admin.id);

  const order = db
    .prepare(
      `
      INSERT INTO purchase_orders (
        supplier_id,
        status,
        notes,
        created_by
      )

      VALUES (
        ?,
        'draft',
        'Validation PO',
        ?
      )
      `,
    )
    .run(supplierId, admin.id);

  db.prepare(
    `
    INSERT INTO purchase_order_items (
      purchase_order_id,

      variant_id,

      product_name,
      barcode,
      size,
      color,

      quantity,
      unit_cost,
      line_total
    )

    VALUES (
      ?,

      ?,

      'Validation Product',
      'VALIDATION-001',
      'M',
      'Black',

      2,
      25,
      50
    )
    `,
  ).run(
    Number(order.lastInsertRowid),

    variant.id,
  );

  void product;

  return buildSelectiveBackupPackage({
    sections: [
      'catalog_stock',

      'customers',
      'customer_open_debts',

      'suppliers',
      'supplier_open_dues',

      'users_permissions',

      'promotions',

      'open_liabilities',

      'account_opening_balances',

      'open_purchase_orders',

      'store_settings',
    ],

    appVersion: 'validation-test',
  });
}

describe('selective backup strict validation', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  }, 30_000);

  it('accepts a valid complete selective backup', () => {
    const backup = createRichBackup();

    expect(() => validateSelectiveBackupPackageV1(backup)).not.toThrow();
  }, 30_000);

  it('rejects duplicate barcodes', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    const product = tampered.data.catalog_stock!.products[0];

    product.variants.push({
      ...product.variants[0],

      source_id: 999_999,
    });

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'الباركود',
    );
  }, 30_000);

  it('rejects unknown permissions before restore', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    tampered.data.users_permissions!.users[0].permission_overrides.push({
      permission: 'root.everything',

      allowed: 1,
    });

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'صلاحية غير معروفة',
    );
  }, 30_000);

  it('rejects extra sections not declared by the manifest', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup) as unknown as {
      data: Record<string, unknown>;
    };

    tampered.data.attacker_section = {
      dangerous: true,
    };

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'حقل غير مسموح',
    );
  }, 30_000);

  it('rejects unsupported financial account keys', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    (
      tampered.data.account_opening_balances!.accounts[0] as {
        account: string;
      }
    ).account = 'attacker_account';

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'حساب مالي غير مدعوم',
    );
  }, 30_000);

  it('rejects purchase orders pointing to a missing variant', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    tampered.data.open_purchase_orders!.orders[0].items[0].variant_source_id = 999_999_999;

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'غير موجود داخل بيانات المنتجات',
    );
  }, 30_000);

  it('rejects invalid dates and non-finite numbers', () => {
    const backup = createRichBackup();

    const badDate = cloneBackup(backup);

    badDate.data.customer_open_debts!.debts[0].due_date = '2026-99-99';

    expect(() => validateSelectiveBackupPackageV1(badDate)).toThrow(
      'تاريخ استحقاق مديونية العميل غير صحيح',
    );

    const badNumber = cloneBackup(backup);

    badNumber.data.supplier_open_dues!.dues[0].remaining_amount =
      Number.POSITIVE_INFINITY;

    expect(() => validateSelectiveBackupPackageV1(badNumber)).toThrow(
      'قيمة مستحق المورد غير صحيح',
    );
  }, 30_000);

  it('rejects oversized text values', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    tampered.data.customers!.customers[0].name = 'X'.repeat(501);

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'أكبر من الحد المسموح',
    );
  }, 30_000);

  it('rejects manifest count tampering', () => {
    const backup = createRichBackup();

    const tampered = cloneBackup(backup);

    tampered.manifest.counts.catalog_stock = 999_999;

    expect(() => validateSelectiveBackupPackageV1(tampered)).toThrow(
      'لا يطابق محتوى النسخة',
    );
  }, 30_000);

  it('rejects a malformed backup before restored data can remain in the database', () => {
    const sourceBackup = createRichBackup();

    const tampered = cloneBackup(sourceBackup);

    tampered.data.customers!.customers[0].points_balance =
      Number.POSITIVE_INFINITY;

    resetDatabaseData();

    const db = getDb();

    const admin = db
      .prepare(
        `
            SELECT id

            FROM users

            WHERE role =
              'admin'

            ORDER BY id ASC

            LIMIT 1
            `,
      )
      .get() as {
      id: number;
    };

    const before = (
      db
        .prepare(
          `
              SELECT COUNT(*) AS count

              FROM customers
              `,
        )
        .get() as {
        count: number;
      }
    ).count;

    expect(() =>
      restoreSelectiveBackupPackage(
        tampered,

        tampered.manifest.sections,

        admin.id,
      ),
    ).toThrow('نقاط العميل');

    const after = (
      db
        .prepare(
          `
              SELECT COUNT(*) AS count

              FROM customers
              `,
        )
        .get() as {
        count: number;
      }
    ).count;

    expect(after).toBe(before);

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

  it('rejects duplicate customer and supplier phones before restore', () => {
    const backup = createRichBackup();

    const duplicateCustomer = cloneBackup(backup);

    duplicateCustomer.data.customers!.customers.push({
      ...duplicateCustomer.data.customers!.customers[0],

      source_id: 999_991,

      name: 'Duplicate Phone Customer',
    });

    duplicateCustomer.data.customers!.counts.customers += 1;

    duplicateCustomer.manifest.counts.customers =
      Number(duplicateCustomer.manifest.counts.customers ?? 0) + 1;

    expect(() => validateSelectiveBackupPackageV1(duplicateCustomer)).toThrow(
      'هاتف العميل',
    );

    const duplicateSupplier = cloneBackup(backup);

    duplicateSupplier.data.suppliers!.suppliers.push({
      ...duplicateSupplier.data.suppliers!.suppliers[0],

      source_id: 999_992,

      name: 'Duplicate Phone Supplier',
    });

    duplicateSupplier.data.suppliers!.counts.suppliers += 1;

    duplicateSupplier.manifest.counts.suppliers =
      Number(duplicateSupplier.manifest.counts.suppliers ?? 0) + 1;

    expect(() => validateSelectiveBackupPackageV1(duplicateSupplier)).toThrow(
      'هاتف المورد',
    );
  }, 30_000);
});
