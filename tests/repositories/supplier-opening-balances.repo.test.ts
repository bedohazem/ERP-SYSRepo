import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';

import { createSupplierOpeningBalance } from '../../src/main/database/repositories/supplier-opening-balances.repo';
import {
  getSupplierAccountAvailableCredit,
  allocateSupplierAccountCreditToPurchase,
  releaseSupplierAccountCreditAllocations,
} from '../../src/main/database/repositories/supplier-account-credits.repo';

function makeSupplier() {
  return createSupplier({
    name: 'Opening Balance Supplier',
  }) as { id: number };
}

describe('supplier opening balances', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  it('records payable opening balance without inventory or cash', () => {
    const supplier = makeSupplier();

    const result = createSupplierOpeningBalance({
      supplier_id: supplier.id,
      direction: 'payable',
      amount: 5000.75,
      notes: 'مديونية من قبل استخدام البرنامج',
    });

    expect(result.balance).toBe(5000.75);

    const db = getDb();

    const invoice = db
      .prepare(
        `
      SELECT
        status,
        total_amount,
        remaining_amount
      FROM purchase_invoices
      WHERE supplier_id = ?
    `,
      )
      .get(supplier.id) as {
      status: string;
      total_amount: number;
      remaining_amount: number;
    };

    expect(invoice).toEqual({
      status: 'opening_balance',
      total_amount: 5000.75,
      remaining_amount: 5000.75,
    });

    const account = db
      .prepare(
        `
      SELECT balance, total_purchased
      FROM suppliers
      WHERE id = ?
    `,
      )
      .get(supplier.id) as {
      balance: number;
      total_purchased: number;
    };

    expect(account.balance).toBe(5000.75);
    expect(account.total_purchased).toBe(0);

    const inventory = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM purchase_items
    `,
      )
      .get() as { count: number };

    const cash = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM cash_movements
    `,
      )
      .get() as { count: number };

    expect(inventory.count).toBe(0);
    expect(cash.count).toBe(0);
  });

  it('records opening credit without creating a purchase', () => {
    const supplier = makeSupplier();

    const result = createSupplierOpeningBalance({
      supplier_id: supplier.id,
      direction: 'receivable',
      amount: 1500,
      notes: 'رصيد سابق لصالح المحل',
    });

    expect(result.balance).toBe(-1500);

    const db = getDb();

    const credit = db
      .prepare(
        `
      SELECT source_type, amount
      FROM supplier_account_credits
      WHERE supplier_id = ?
    `,
      )
      .get(supplier.id) as {
      source_type: string;
      amount: number;
    };

    expect(credit).toEqual({
      source_type: 'opening_credit',
      amount: 1500,
    });

    const account = db
      .prepare(
        `
      SELECT balance
      FROM suppliers
      WHERE id = ?
    `,
      )
      .get(supplier.id) as { balance: number };

    expect(account.balance).toBe(-1500);

    const invoices = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM purchase_invoices
      WHERE supplier_id = ?
    `,
      )
      .get(supplier.id) as { count: number };

    const cash = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM cash_movements
    `,
      )
      .get() as { count: number };

    expect(invoices.count).toBe(0);
    expect(cash.count).toBe(0);
  });

  it('rejects duplicate opening balances', () => {
    const supplier = makeSupplier();

    createSupplierOpeningBalance({
      supplier_id: supplier.id,
      direction: 'payable',
      amount: 500,
      notes: 'رصيد سابق',
    });

    expect(() =>
      createSupplierOpeningBalance({
        supplier_id: supplier.id,
        direction: 'receivable',
        amount: 100,
        notes: 'محاولة مكررة',
      }),
    ).toThrow('لم تُسجّل عليه معاملات مالية');

    const row = getDb()
      .prepare(
        `
      SELECT balance
      FROM suppliers
      WHERE id = ?
    `,
      )
      .get(supplier.id) as { balance: number };

    expect(row.balance).toBe(500);
  });

  it('rejects invalid amounts and missing reasons', () => {
    const supplier = makeSupplier();

    expect(() =>
      createSupplierOpeningBalance({
        supplier_id: supplier.id,
        direction: 'payable',
        amount: 100.755,
        notes: 'رصيد سابق',
      }),
    ).toThrow('مبلغ الرصيد الافتتاحي غير صحيح');

    expect(() =>
      createSupplierOpeningBalance({
        supplier_id: supplier.id,
        direction: 'payable',
        amount: 100,
        notes: ' ',
      }),
    ).toThrow('سبب الرصيد الافتتاحي مطلوب');
  });

  it('allocates opening credit once and restores it on cancellation', () => {
    const supplier = makeSupplier();

    createSupplierOpeningBalance({
      supplier_id: supplier.id,
      direction: 'receivable',
      amount: 500,
      notes: 'رصيد سابق',
    });

    const db = getDb();

    expect(getSupplierAccountAvailableCredit(db, supplier.id)).toBe(500);

    const purchase = db
      .prepare(
        `
      INSERT INTO purchase_invoices (
        supplier_id,
        total_amount,
        sub_total,
        paid_amount,
        remaining_amount,
        payment_status
      )
      VALUES (?, 300, 300, 0, 300, 'unpaid')
    `,
      )
      .run(supplier.id);

    const purchaseId = Number(purchase.lastInsertRowid);

    const allocated = allocateSupplierAccountCreditToPurchase(db, {
      supplier_id: supplier.id,
      purchase_id: purchaseId,
      amount: 300,
    });

    expect(allocated).toBe(300);

    expect(getSupplierAccountAvailableCredit(db, supplier.id)).toBe(200);

    expect(() =>
      allocateSupplierAccountCreditToPurchase(db, {
        supplier_id: supplier.id,
        purchase_id: purchaseId,
        amount: 300,
      }),
    ).toThrow('الرصيد الدائن المتاح غير كافٍ');

    releaseSupplierAccountCreditAllocations(db, purchaseId);

    expect(getSupplierAccountAvailableCredit(db, supplier.id)).toBe(500);
  });
});
