import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import { getLocalBusinessDate } from '../../src/main/database/system-clock-guard';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createSale,
  createSaleReturn,
  cancelSaleInvoice,
  cancelSaleReturn,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo';
import {
  createSaleExchange,
  cancelSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import {
  getReportsSummary,
  getAdminDashboardTodaySummary,
  getCashierDashboardSummary,
} from '../../src/main/database/repositories/reports.repo';
import {
  openCashShift,
  getOpenCashShift,
  closeCashShift,
  getCashShiftDetails,
} from '../../src/main/database/repositories/cash-shifts.repo';
import {
  createPurchaseInvoice,
  createPurchaseReturn,
  updatePurchaseReturn,
  getPurchaseReturn,
} from '../../src/main/database/repositories/purchases.repo';

function yesterday() {
  const today = getLocalBusinessDate();
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}
function variant(barcode: string, sellPrice: number, buyPrice: number) {
  createProduct({
    name: `History ${barcode}`,
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode,
        size: 'M',
        color: 'Black',
        buy_price: buyPrice,
        sell_price: sellPrice,
        min_stock: 1,
        opening_qty: 10,
      },
    ],
  });
  return getVariantByBarcode(barcode) as any;
}
function sell(v: any, quantity = 1) {
  return createSale({
    user_id: 1,
    customer_id: null,
    sub_total: v.sell_price * quantity,
    discount_value: 0,
    grand_total: v.sell_price * quantity,
    paid: v.sell_price * quantity,
    remaining_amount: 0,
    change_amount: 0,
    payment_method: 'owner_bank',
    items: [
      {
        variant_id: v.variant_id,
        product_name: v.product_name,
        barcode: v.barcode,
        size: v.size,
        color: v.color,
        quantity,
        unit_price: v.sell_price,
      },
    ],
  });
}
function closeExistingShift() {
  const shift = getOpenCashShift()!;
  closeCashShift({
    shift_id: shift.id,
    closing_counted_amount: 0,
    left_for_next_shift: 0,
    closed_by: 1,
  });
  return shift;
}
function assertProfit(report: any, sales: number, profit: number) {
  expect(report.summary.net_sales).toBe(sales);
  expect(report.summary.net_profit_after_discounts).toBe(profit);
}

describe('final historical financial reconciliations', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30000);

  it('keeps original shift frozen and posts bank sale cancellation in the cancellation day', () => {
    const db = getDb();
    const v = variant('HIST-CANCEL-SALE', 300, 120);
    const shift1 = getOpenCashShift()!;
    const sale = sell(v);
    const oldDate = yesterday();
    const today = getLocalBusinessDate();
    db.prepare('UPDATE cash_shifts SET business_date = ? WHERE id = ?').run(
      oldDate,
      shift1.id,
    );
    const before = getCashShiftDetails(shift1.id);
    assertProfit(
      getReportsSummary({ date_from: oldDate, date_to: oldDate }),
      300,
      180,
    );
    closeExistingShift();
    const cancelled = cancelSaleInvoice({
      sale_id: sale.saleId,
      actor_id: 1,
      reason: 'Outside shift bank sale cancellation',
    });
    expect(cancelled.cancelled_shift_id).toBeNull();
    const flag = db
      .prepare('SELECT cancelled_outside_shift FROM sales WHERE id = ?')
      .get(sale.saleId) as any;
    expect(flag.cancelled_outside_shift).toBe(1);
    const after = getCashShiftDetails(shift1.id);
    expect(after.sales_summary).toEqual(before.sales_summary);
    expect(after.preview).toEqual(before.preview);
    assertProfit(
      getReportsSummary({ date_from: oldDate, date_to: oldDate }),
      300,
      180,
    );
    assertProfit(
      getReportsSummary({ date_from: today, date_to: today }),
      -300,
      -180,
    );
    assertProfit(getReportsSummary(), 0, 0);
    expect(getAdminDashboardTodaySummary(today).net_sales).toBe(-300);
    const daily = getReportsSummary({
      date_from: today,
      date_to: today,
    }) as any;
    expect(daily.dailySales.find((x: any) => x.day === today)?.total).toBe(
      -300,
    );
    expect(
      daily.cashierSales.find((x: any) => x.user_id === 1)?.net_sales,
    ).toBe(-300);
    expect(
      daily.topProducts.find((x: any) => x.variant_id === v.variant_id)
        ?.net_quantity,
    ).toBe(-1);
  });

  it('reverses historical sale returns on the cancellation shift without rewriting the original shift', () => {
    const db = getDb();
    const v = variant('HIST-CANCEL-RETURN', 100, 40);
    const shift1 = getOpenCashShift()!;
    const sale = sell(v, 3);
    const receipt = getSaleReceipt(sale.saleId) as any;
    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'owner_bank',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: v.variant_id,
          quantity: 1,
        },
      ],
    });
    db.prepare('UPDATE cash_shifts SET business_date = ? WHERE id = ?').run(
      yesterday(),
      shift1.id,
    );
    const before = getCashShiftDetails(shift1.id);
    assertProfit(
      getReportsSummary({ date_from: yesterday(), date_to: yesterday() }),
      200,
      120,
    );
    closeExistingShift();
    const shift2 = openCashShift({ opening_counted_amount: 0, opened_by: 1 });
    cancelSaleReturn({
      return_id: returned.returnId,
      actor_id: 1,
      reason: 'Return cancellation in next shift',
    });
    expect(getCashShiftDetails(shift1.id).sales_summary).toEqual(
      before.sales_summary,
    );
    assertProfit(
      getReportsSummary({ date_from: yesterday(), date_to: yesterday() }),
      200,
      120,
    );
    assertProfit(
      getReportsSummary({
        date_from: getLocalBusinessDate(),
        date_to: getLocalBusinessDate(),
      }),
      100,
      60,
    );
    assertProfit(getReportsSummary(), 300, 180);
    expect(getCashShiftDetails(shift2.id).sales_summary.net_sales).toBe(100);
    expect(getCashierDashboardSummary({ user_id: 1 }).sales.net_sales).toBe(
      100,
    );
  });

  it('reverses the exact exchange price and cost deltas in the later shift', () => {
    const db = getDb();
    const original = variant('HIST-X-OLD', 100, 50);
    const replacement = variant('HIST-X-NEW', 130, 70);
    const shift1 = getOpenCashShift()!;
    const sale = sell(original);
    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups.find((g: any) => g.group_kind === 'regular')
      ?.units[0];
    expect(unit).toBeTruthy();
    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'owner_bank',
      items: [
        {
          promotion_unit_id: Number(unit.id),
          new_variant_id: replacement.variant_id,
        },
      ],
    });
    expect(exchange.difference_amount).toBe(30);
    db.prepare('UPDATE cash_shifts SET business_date = ? WHERE id = ?').run(
      yesterday(),
      shift1.id,
    );
    const before = getCashShiftDetails(shift1.id);
    assertProfit(
      getReportsSummary({ date_from: yesterday(), date_to: yesterday() }),
      130,
      60,
    );
    closeExistingShift();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Reverse historic exchange',
    });
    expect(getCashShiftDetails(shift1.id).sales_summary).toEqual(
      before.sales_summary,
    );
    assertProfit(
      getReportsSummary({ date_from: yesterday(), date_to: yesterday() }),
      130,
      60,
    );
    assertProfit(
      getReportsSummary({
        date_from: getLocalBusinessDate(),
        date_to: getLocalBusinessDate(),
      }),
      -30,
      -10,
    );
    assertProfit(getReportsSummary(), 100, 50);
  });

  it('replaces purchase credit returns in later shifts atomically, and preserves old shift history', () => {
    const db = getDb();
    const oldShift = getOpenCashShift()!;
    const v = variant('HIST-PURCHASE-CREDIT', 150, 10.25);
    const result = db
      .prepare('INSERT INTO suppliers (name,phone) VALUES (?,?)')
      .run('Historical Test Supplier', '01012345678');
    const supplierId = Number(result.lastInsertRowid);
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,
      items: [{ variant_id: v.variant_id, quantity: 3, unit_cost: 10.25 }],
    });
    const purchaseItemId = Number(
      (
        db
          .prepare('SELECT id FROM purchase_items WHERE purchase_id = ?')
          .get(purchase.purchaseId) as any
      ).id,
    );
    const oldReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      refund_mode: 'credit',
      items: [{ purchase_item_id: purchaseItemId, quantity: 1 }],
    });
    const oldRow = db
      .prepare('SELECT shift_id FROM purchase_returns WHERE id = ?')
      .get(oldReturn.return_id) as any;
    expect(oldRow.shift_id).toBe(oldShift.id);
    const before = getCashShiftDetails(oldShift.id);
    closeExistingShift();
    const next = openCashShift({ opening_counted_amount: 0, opened_by: 1 });
    const updated = updatePurchaseReturn({
      return_id: oldReturn.return_id,
      actor_id: 1,
      reason: 'Correct credit quantity in later shift',
      refund_mode: 'credit',
      items: [{ purchase_item_id: purchaseItemId, quantity: 2 }],
    });
    const oldCancelled = db
      .prepare('SELECT cancelled_shift_id FROM purchase_returns WHERE id = ?')
      .get(oldReturn.return_id) as any;
    const newRow = db
      .prepare('SELECT shift_id FROM purchase_returns WHERE id = ?')
      .get(updated.return_id) as any;
    expect(oldCancelled.cancelled_shift_id).toBe(next.id);
    expect(newRow.shift_id).toBe(next.id);
    expect(getCashShiftDetails(oldShift.id).sales_summary).toEqual(
      before.sales_summary,
    );
    expect(getCashShiftDetails(oldShift.id).preview).toEqual(before.preview);
    expect(Number(getVariantByBarcode(v.barcode)?.stock)).toBe(11);
    const oldMovementCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cash_movements WHERE reference_id IN (?,?) AND reference_type LIKE 'purchase_return%'`,
      )
      .get(oldReturn.return_id, updated.return_id) as any;
    expect(Number(oldMovementCount.count)).toBe(0);
    expect(() =>
      updatePurchaseReturn({
        return_id: updated.return_id,
        actor_id: 1,
        reason: 'Intentionally invalid return quantity',
        refund_mode: 'credit',
        items: [{ purchase_item_id: purchaseItemId, quantity: 999 }],
      }),
    ).toThrow();
    expect(
      (getPurchaseReturn(updated.return_id) as any).return.cancelled_at,
    ).toBeNull();
    expect(Number(getVariantByBarcode(v.barcode)?.stock)).toBe(11);
    closeExistingShift();
    const editedOutside = updatePurchaseReturn({
      return_id: updated.return_id,
      actor_id: 1,
      reason: 'Correct outside shift without cash movement',
      refund_mode: 'credit',
      items: [{ purchase_item_id: purchaseItemId, quantity: 1 }],
    });
    expect(editedOutside.edited).toBe(true);
    const outsideCancellation = db
      .prepare(
        'SELECT cancelled_outside_shift FROM purchase_returns WHERE id = ?',
      )
      .get(updated.return_id) as any;
    expect(outsideCancellation.cancelled_outside_shift).toBe(1);
    const lastReturn = db
      .prepare('SELECT shift_id FROM purchase_returns WHERE id = ?')
      .get(editedOutside.return_id) as any;
    expect(lastReturn.shift_id).toBeNull();
  });

  it('rebooks a real bank purchase-return refund in the new shift only', () => {
    const db = getDb();
    const shift1 = getOpenCashShift()!;
    const v = variant('HIST-PURCHASE-CASH', 150, 10.25);
    // Initial owner-bank balance to allow the paid purchase.
    db.prepare(
      `
      INSERT INTO cash_movements (type,amount,direction,payment_method,reference_type,notes,created_by)
      VALUES ('deposit',1000,'in','owner_bank','test_seed','Initial bank balance',1)
    `,
    ).run();
    const supplierId = Number(
      db
        .prepare('INSERT INTO suppliers (name,phone) VALUES (?,?)')
        .run('Cash History Supplier', '01077770000').lastInsertRowid,
    );
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 31,
      settle_full_balance: true,
      payment_method: 'owner_bank',
      items: [{ variant_id: v.variant_id, quantity: 3, unit_cost: 10.25 }],
    });
    const purchaseItemId = Number(
      (
        db
          .prepare('SELECT id FROM purchase_items WHERE purchase_id = ?')
          .get(purchase.purchaseId) as any
      ).id,
    );
    const oldReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      refund_mode: 'cash',
      refund_payment_method: 'owner_bank',
      cash_refund_amount: 10,
      items: [{ purchase_item_id: purchaseItemId, quantity: 1 }],
    });
    expect(oldReturn.shift_id).toBe(shift1.id);
    const before = getCashShiftDetails(shift1.id);
    closeExistingShift();
    const shift2 = openCashShift({ opening_counted_amount: 0, opened_by: 1 });
    const changed = updatePurchaseReturn({
      return_id: oldReturn.return_id,
      actor_id: 1,
      reason: 'Replace refund in next shift',
      refund_mode: 'cash',
      refund_payment_method: 'owner_bank',
      cash_refund_amount: 20,
      items: [{ purchase_item_id: purchaseItemId, quantity: 2 }],
    });
    expect(changed.edited).toBe(true);
    expect(getCashShiftDetails(shift1.id).preview).toEqual(before.preview);
    const m = db
      .prepare(
        `
      SELECT reference_type, shift_id, direction, amount
      FROM cash_movements
      WHERE reference_type IN ('purchase_return','purchase_return_cancel')
        AND reference_id IN (?, ?)
      ORDER BY id ASC
    `,
      )
      .all(oldReturn.return_id, changed.return_id) as any[];
    expect(
      m.map((x) => [
        x.reference_type,
        x.shift_id,
        x.direction,
        Number(x.amount),
      ]),
    ).toEqual([
      ['purchase_return', shift1.id, 'in', 10],
      ['purchase_return_cancel', shift2.id, 'out', 10],
      ['purchase_return', shift2.id, 'in', 20],
    ]);
    expect(Number(getVariantByBarcode(v.barcode)?.stock)).toBe(11);
  });
});
