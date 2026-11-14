import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';

import {
  createSupplierAdvancePayment,
  cancelSupplierAdvancePayment,
} from '../../src/main/database/repositories/supplier-advances.repo';

import { getSupplierAccountAvailableCredit } from '../../src/main/database/repositories/supplier-account-credits.repo';

function setup() {
  const db = getDb();

  const userResult = db
    .prepare(
      `
    INSERT INTO users (
      name, username, password, role, is_active
    )
    VALUES ('Advance Test Admin', 'advance_test_admin', 'test', 'admin', 1)
  `,
    )
    .run();

  const supplier = createSupplier({
    name: 'Supplier Advance Test',
  }) as { id: number };

  db.prepare(
    `
    INSERT INTO cash_movements (
      type, amount, direction,
      payment_method, reference_type
    )
    VALUES ('deposit', 10000, 'in', 'owner_cash', 'test_seed')
  `,
  ).run();

  return {
    supplierId: supplier.id,
    actorId: Number(userResult.lastInsertRowid),
  };
}

describe('supplier advances', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  it('creates an advance without changing purchases or inventory', () => {
    const { supplierId, actorId } = setup();

    const result = createSupplierAdvancePayment({
      supplier_id: supplierId,
      amount: 2000,
      payment_method: 'owner_cash',
      notes: 'دفعة مقدمة',
      actor_id: actorId,
    });

    expect(result.amount).toBe(2000);
    expect(result.remaining_credit).toBe(2000);
    expect(result.supplier_balance).toBe(-2000);

    const db = getDb();

    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(2000);

    const cash = db
      .prepare(
        `
      SELECT COUNT(*) AS count, SUM(amount) AS amount
      FROM cash_movements
      WHERE reference_type = 'supplier_advance'
        AND direction = 'out'
    `,
      )
      .get() as { count: number; amount: number };

    expect(cash.count).toBe(1);
    expect(cash.amount).toBe(2000);

    const purchases = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM purchase_invoices
    `,
      )
      .get() as { count: number };

    const inventory = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM stock_movements
    `,
      )
      .get() as { count: number };

    expect(purchases.count).toBe(0);
    expect(inventory.count).toBe(0);
  });

  it('cancels an unused advance with a reversing cash movement', () => {
    const { supplierId, actorId } = setup();

    const advance = createSupplierAdvancePayment({
      supplier_id: supplierId,
      amount: 500,
      payment_method: 'owner_cash',
      actor_id: actorId,
    });

    const result = cancelSupplierAdvancePayment({
      advance_id: advance.id,
      reason: 'تم إلغاء الاتفاق',
      actor_id: actorId,
    });

    expect(result.ok).toBe(true);
    expect(result.supplier_balance).toBe(0);

    expect(getSupplierAccountAvailableCredit(getDb(), supplierId)).toBe(0);

    const cash = getDb()
      .prepare(
        `
      SELECT direction, amount
      FROM cash_movements
      WHERE reference_id = ?
        AND reference_type IN (
          'supplier_advance',
          'supplier_advance_cancel'
        )
      ORDER BY id ASC
    `,
      )
      .all(advance.id);

    expect(cash).toEqual([
      { direction: 'out', amount: 500 },
      { direction: 'in', amount: 500 },
    ]);

    expect(() =>
      cancelSupplierAdvancePayment({
        advance_id: advance.id,
        reason: 'إلغاء مكرر',
        actor_id: actorId,
      }),
    ).toThrow('ملغاة بالفعل');
  });

  it('reports only the credit used from the new advance', () => {
    const { supplierId, actorId } = setup();
    const db = getDb();

    // رصيد سابق لصالحنا: 200 جنيه.
    db.prepare(
      `
      INSERT INTO supplier_account_credits (
        supplier_id, source_type, amount
      )
      VALUES (?, 'opening_credit', 200)
    `,
    ).run(supplierId);

    // مديونية مفتوحة للاختبار: 300 جنيه.
    db.prepare(
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
    ).run(supplierId);

    // دفعة جديدة بـ200 جنيه:
    // 200 من القديم + 100 من الجديد
    // يسددوا المديونية، ويتبقى 100 من الجديد.
    const advance = createSupplierAdvancePayment({
      supplier_id: supplierId,
      amount: 200,
      payment_method: 'owner_cash',
      actor_id: actorId,
    });

    expect(advance.allocated).toBe(100);
    expect(advance.remaining_credit).toBe(100);
    expect(advance.supplier_balance).toBe(-100);

    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(100);
  });

  it('uses the supplier name in the cash movement', () => {
    const { supplierId, actorId } = setup();

    const advance = createSupplierAdvancePayment({
      supplier_id: supplierId,
      amount: 500,
      payment_method: 'owner_cash',
      notes: 'مقدم بضاعة',
      actor_id: actorId,
    });

    const row = getDb()
      .prepare(
        `
      SELECT notes
      FROM cash_movements
      WHERE reference_type = 'supplier_advance'
        AND reference_id = ?
    `,
      )
      .get(advance.id) as { notes: string };

    expect(row.notes).toBe(
      'دفعة مقدمة للمورد: Supplier Advance Test - مقدم بضاعة',
    );
  });
});
