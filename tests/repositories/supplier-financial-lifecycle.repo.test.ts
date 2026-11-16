import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';
import {
  createPurchaseInvoice,
  cancelPurchaseInvoice,
  getPurchaseInvoice,
  getSupplierStatement,
  recordSupplierPayment,
  cancelSupplierPaymentBatch,
} from '../../src/main/database/repositories/purchases.repo';
import {
  createSupplierAdvancePayment,
  updateSupplierAdvancePayment,
  cancelSupplierAdvancePayment,
} from '../../src/main/database/repositories/supplier-advances.repo';
import { getSupplierFinancialTraces } from '../../src/main/database/repositories/supplier-financial-trace.repo';
import { getSupplierAccountAvailableCredit } from '../../src/main/database/repositories/supplier-account-credits.repo';
import { createActivityLog } from '../../src/main/database/repositories/activity.repo';

function arrange() {
  const db = getDb();
  const supplier = createSupplier({ name: 'Financial lifecycle supplier' }) as {
    id: number;
  };
  db.prepare(
    `
    INSERT INTO cash_movements (
      type, amount, direction, payment_method, reference_type
    ) VALUES ('deposit', 100000, 'in', 'owner_cash', 'test_seed')
  `,
  ).run();

  createProduct({
    name: 'Financial lifecycle product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'FIN-CYCLE-001',
        size: 'M',
        color: 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: 0,
        opening_qty: 0,
      },
    ],
  });
  const variant = getVariantByBarcode('FIN-CYCLE-001') as
    { variant_id: number } | undefined;
  if (!variant) throw new Error('Missing test variant');
  return { supplierId: supplier.id, variantId: variant.variant_id, db };
}

function invoice(supplierId: number, variantId: number, total: number) {
  return createPurchaseInvoice({
    supplier_id: supplierId,
    actor_id: 1,
    paid_amount: 0,
    payment_method: 'owner_cash',
    items: [{ variant_id: variantId, quantity: 1, unit_cost: total }],
  });
}

describe('supplier financial lifecycle and unified trace', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  it('corrects a partially consumed advance, protects allocations and reverses cash exactly', () => {
    const { supplierId, variantId, db } = arrange();
    const purchase = invoice(supplierId, variantId, 300);
    const advance = createSupplierAdvancePayment({
      supplier_id: supplierId,
      amount: 500,
      payment_method: 'owner_cash',
      actor_id: 1,
    });
    expect(advance.allocated).toBe(300);
    expect(advance.remaining_credit).toBe(200);

    const correction = updateSupplierAdvancePayment({
      advance_id: advance.id,
      amount: 400,
      payment_method: 'owner_cash',
      actor_id: 1,
      reason: 'Correct the advance to 400',
    });
    expect(correction.old_amount).toBe(500);
    expect(correction.new_amount).toBe(400);
    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(100);

    createActivityLog({
      user_id: 1,
      entity: 'supplier_account_credits',
      entity_id: advance.id,
      action: 'supplier_advance_updated',
      details: JSON.stringify(correction),
    });

    const trace = getSupplierFinancialTraces(supplierId).find(
      (item) => item.key === `credit-${advance.id}`,
    );
    expect(trace).toBeDefined();
    expect(trace?.amount).toBe(400);
    expect(
      trace?.allocations.map((item) => [item.purchase_id, item.amount]),
    ).toEqual([[purchase.purchaseId, 300]]);
    expect(
      trace?.cash_movements.map((item) => [item.direction, item.amount]),
    ).toEqual([
      ['out', 500],
      ['in', 100],
    ]);
    expect(
      trace?.events.some(
        (item) =>
          item.title === 'تصحيح دفعة مقدمة' &&
          item.old_amount === 500 &&
          item.new_amount === 400 &&
          item.reason === 'Correct the advance to 400',
      ),
    ).toBe(true);

    const before = getPurchaseInvoice(purchase.purchaseId) as any;
    expect(before.purchase.remaining_amount).toBe(0);
    expect(before.purchase.supplier_credit_applied).toBe(300);
    expect(() =>
      updateSupplierAdvancePayment({
        advance_id: advance.id,
        amount: 250,
        payment_method: 'owner_cash',
        actor_id: 1,
        reason: 'Invalid decrease',
      }),
    ).toThrow('أقل من الجزء المستخدم');
    expect(() =>
      cancelSupplierAdvancePayment({
        advance_id: advance.id,
        actor_id: 1,
        reason: 'Cannot cancel consumed credit',
      }),
    ).toThrow('رصيدها مستخدم');
    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(100);

    cancelPurchaseInvoice({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      reason: 'Cancel the benefiting invoice',
    });
    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(400);
    const afterCancel = getSupplierFinancialTraces(supplierId).find(
      (item) => item.key === `credit-${advance.id}`,
    );
    expect(afterCancel?.allocations[0].cancelled_at).toBeTruthy();

    cancelSupplierAdvancePayment({
      advance_id: advance.id,
      actor_id: 1,
      reason: 'Credit is no longer consumed',
    });
    expect(getSupplierAccountAvailableCredit(db, supplierId)).toBe(0);
    const supplier = db
      .prepare('SELECT balance FROM suppliers WHERE id = ?')
      .get(supplierId) as { balance: number };
    expect(supplier.balance).toBeCloseTo(0, 8);
    const cash = db
      .prepare(
        `
      SELECT direction, amount FROM cash_movements
      WHERE reference_id = ?
        AND reference_type IN (
          'supplier_advance', 'supplier_advance_adjustment',
          'supplier_advance_cancel'
        )
      ORDER BY id
    `,
      )
      .all(advance.id);
    expect(cash).toEqual([
      { direction: 'out', amount: 500 },
      { direction: 'in', amount: 100 },
      { direction: 'in', amount: 400 },
    ]);
  });

  it('traces a multi-invoice supplier payment and retains cancellation history', () => {
    const { supplierId, variantId, db } = arrange();
    const first = invoice(supplierId, variantId, 100);
    const second = invoice(supplierId, variantId, 150);

    const payment = recordSupplierPayment({
      supplier_id: supplierId,
      actor_id: 1,
      amount: 200,
      payment_method: 'owner_cash',
    });
    createActivityLog({
      user_id: 1,
      entity: 'supplier_payment_batches',
      entity_id: payment.payment_batch_id,
      action: 'supplier_payment_recorded',
      details: JSON.stringify({ amount: 200 }),
    });

    const statement = getSupplierStatement(supplierId) as any;
    const trace = statement.financial_traces.find(
      (row: any) => row.key === `payment-${payment.payment_batch_id}`,
    );
    expect(trace).toBeDefined();
    expect(
      trace.allocations.map((row: any) => [row.purchase_id, row.amount]),
    ).toEqual([
      [first.purchaseId, 100],
      [second.purchaseId, 100],
    ]);
    expect(
      trace.cash_movements.map((row: any) => [row.direction, row.amount]),
    ).toEqual([['out', 200]]);
    expect(trace.events[0].title).toBe('تسجيل دفعة مورد');

    const cancelled = cancelSupplierPaymentBatch({
      batch_id: payment.payment_batch_id,
      actor_id: 1,
      reason: 'Reversed test payment',
    });
    expect(cancelled.success).toBe(true);
    const after = getSupplierFinancialTraces(supplierId).find(
      (row) => row.key === `payment-${payment.payment_batch_id}`,
    );
    expect(after?.cancelled_at).toBeTruthy();
    expect(after?.cancel_reason).toBe('Reversed test payment');
    expect(
      after?.cash_movements.map((row) => [row.direction, row.amount]),
    ).toEqual([
      ['out', 200],
      ['in', 200],
    ]);
    expect(
      (
        db
          .prepare('SELECT balance FROM suppliers WHERE id = ?')
          .get(supplierId) as { balance: number }
      ).balance,
    ).toBe(250);
  });
});
