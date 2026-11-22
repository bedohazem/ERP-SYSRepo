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
  cancelSaleReturn,
  cancelSaleInvoice,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo';
import {
  createSaleExchange,
  cancelSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import {
  openCashShift,
  closeCashShift,
  getOpenCashShift,
  getCashShiftExpectedBalance,
} from '../../src/main/database/repositories/cash-shifts.repo';
import { getReportsSummary } from '../../src/main/database/repositories/reports.repo';
import { getDailyProductSummary } from '../../src/main/database/repositories/sales-history-report.repo';

type Variant = {
  variant_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
};

type ProductRow = {
  variant_id: number;
  product_name: string;
  size: string;
  color: string;
  net_quantity: number;
};

function seedVariants() {
  createProduct({
    name: 'Daily Summary Shirt',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'DAILY-SUMMARY-M',
        size: 'M',
        color: 'Black',
        buy_price: 40,
        sell_price: 100,
        min_stock: 1,
        opening_qty: 30,
      },
      {
        barcode: 'DAILY-SUMMARY-L',
        size: 'L',
        color: 'Blue',
        buy_price: 50,
        sell_price: 120,
        min_stock: 1,
        opening_qty: 30,
      },
    ],
  });

  const m = getVariantByBarcode('DAILY-SUMMARY-M') as Variant | undefined;
  const l = getVariantByBarcode('DAILY-SUMMARY-L') as Variant | undefined;

  if (!m || !l) throw new Error('Failed to seed daily summary variants');

  return { m, l };
}

function sell(variant: Variant, quantity: number) {
  const total = variant.sell_price * quantity;

  return createSale({
    user_id: 1,
    customer_id: null,
    sub_total: total,
    discount_value: 0,
    grand_total: total,
    change_amount: 0,
    paid: total,
    payment_method: 'store_cash',
    items: [
      {
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity,
        unit_price: variant.sell_price,
      },
    ],
  });
}

function dailyRows(date = getLocalBusinessDate()): ProductRow[] {
  const result = getReportsSummary({ date_from: date, date_to: date });
  return result.topProducts as ProductRow[];
}

function getQuantity(rows: ProductRow[], variantId: number): number {
  return rows.find((row) => row.variant_id === variantId)?.net_quantity ?? 0;
}

function startNextBusinessShift() {
  const oldShift = getOpenCashShift();
  if (!oldShift) throw new Error('Expected an open shift');

  const closingAmount = getCashShiftExpectedBalance(
    oldShift.id,
  ).expected_closing_amount;

  closeCashShift({
    shift_id: oldShift.id,
    closing_counted_amount: closingAmount,
    left_for_next_shift: closingAmount,
    closed_by: 1,
  });

  const currentShift = openCashShift({
    opening_counted_amount: closingAmount,
    opened_by: 1,
  });

  const today = getLocalBusinessDate();
  const prior = getDb()
    .prepare("SELECT date(?, '-1 day') AS value")
    .get(today) as { value: string };

  // Update the test fixture AFTER opening the new shift, so the
  // production shift-date validation remains untouched.
  getDb()
    .prepare('UPDATE cash_shifts SET business_date = ? WHERE id = ?')
    .run(prior.value, oldShift.id);

  return { today, yesterday: prior.value, oldShift, currentShift };
}

describe('daily products summary (real sales journal)', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  it('is empty when there are no sales', () => {
    expect(dailyRows()).toEqual([]);
  });

  it('counts pieces per variant without merging sizes or colors', () => {
    const { m, l } = seedVariants();
    sell(m, 3);
    sell(l, 2);

    const rows = dailyRows();

    expect(rows).toHaveLength(2);
    expect(getQuantity(rows, m.variant_id)).toBe(3);
    expect(getQuantity(rows, l.variant_id)).toBe(2);
    expect(rows.reduce((total, row) => total + row.net_quantity, 0)).toBe(5);

    const small = rows.find((row) => row.variant_id === m.variant_id);
    const large = rows.find((row) => row.variant_id === l.variant_id);

    expect(small).toMatchObject({
      product_name: 'Daily Summary Shirt',
      size: 'M',
      color: 'Black',
    });
    expect(large).toMatchObject({
      product_name: 'Daily Summary Shirt',
      size: 'L',
      color: 'Blue',
    });
  });

  it('subtracts a returned piece from the daily quantity', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);
    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Daily products test return',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(getQuantity(dailyRows(), m.variant_id)).toBe(2);
  });

  it('restores the piece if the return is cancelled', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);
    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Daily products test return',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(getQuantity(dailyRows(), m.variant_id)).toBe(2);

    cancelSaleReturn({
      return_id: saleReturn.returnId,
      actor_id: 1,
      reason: 'Daily products test cancellation',
    });

    expect(getQuantity(dailyRows(), m.variant_id)).toBe(3);
  });

  it('moves one piece from the old variant to the new variant on exchange', () => {
    const { m, l } = seedVariants();
    const sale = sell(m, 1);

    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups
      .flatMap((group) => group.units)
      .find((entry) => Number(entry.is_returned || 0) === 0);

    expect(unit).toBeDefined();

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Daily products test exchange',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: l.variant_id,
        },
      ],
    });

    const afterExchange = dailyRows();
    expect(getQuantity(afterExchange, m.variant_id)).toBe(0);
    expect(getQuantity(afterExchange, l.variant_id)).toBe(1);
    expect(afterExchange).toHaveLength(1);

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Daily products test exchange cancellation',
    });

    const afterCancellation = dailyRows();
    expect(getQuantity(afterCancellation, m.variant_id)).toBe(1);
    expect(getQuantity(afterCancellation, l.variant_id)).toBe(0);
    expect(afterCancellation).toHaveLength(1);
  });

  it('removes the sold pieces when their invoice is cancelled', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);

    expect(getQuantity(dailyRows(), m.variant_id)).toBe(3);

    cancelSaleInvoice({
      sale_id: sale.saleId,
      actor_id: 1,
      reason: 'Daily products test invoice cancellation',
    });

    expect(dailyRows()).toEqual([]);
  });

  it('uses the shift business date rather than the invoice timestamp', () => {
    const { m } = seedVariants();
    const sale = sell(m, 2);
    const today = getLocalBusinessDate();
    const historical = '2026-08-10';

    const db = getDb();
    const saleRow = db
      .prepare('SELECT shift_id FROM sales WHERE id = ?')
      .get(sale.saleId) as { shift_id: number };

    db.prepare('UPDATE cash_shifts SET business_date = ? WHERE id = ?').run(
      historical,
      saleRow.shift_id,
    );

    expect(dailyRows(today)).toEqual([]);
    expect(getQuantity(dailyRows(historical), m.variant_id)).toBe(2);
  });
  it('attributes a return today to today even when the invoice was sold yesterday', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);
    const { today, yesterday } = startNextBusinessShift();

    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(3);
    expect(dailyRows(today)).toEqual([]);

    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Previous-day invoice return',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    // Yesterday's sales do not change; the return is a -1 event today.
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(3);
    expect(getQuantity(dailyRows(today), m.variant_id)).toBe(-1);
    expect(getQuantity(getReportsSummary().topProducts, m.variant_id)).toBe(2);
  });

  it('attributes a new-day exchange to the new day without rewriting the old sale', () => {
    const { m, l } = seedVariants();
    const sale = sell(m, 1);
    const { today, yesterday } = startNextBusinessShift();

    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups
      .flatMap((group) => group.units)
      .find((entry) => Number(entry.is_returned || 0) === 0);

    expect(unit).toBeDefined();

    createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Previous-day sale exchanged today',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: l.variant_id,
        },
      ],
    });

    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(1);
    expect(getQuantity(dailyRows(yesterday), l.variant_id)).toBe(0);
    expect(getQuantity(dailyRows(today), m.variant_id)).toBe(-1);
    expect(getQuantity(dailyRows(today), l.variant_id)).toBe(1);
    expect(getQuantity(getReportsSummary().topProducts, m.variant_id)).toBe(0);
    expect(getQuantity(getReportsSummary().topProducts, l.variant_id)).toBe(1);
  });

  it('records an old invoice cancellation as a negative quantity on the cancellation day', () => {
    const { m } = seedVariants();
    const sale = sell(m, 2);
    const { today, yesterday, currentShift } = startNextBusinessShift();

    const cancelled = cancelSaleInvoice({
      sale_id: sale.saleId,
      actor_id: 1,
      reason: 'Previous-day sale cancelled in current shift',
    });

    expect(cancelled.cancelled_shift_id).toBe(currentShift.id);
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(2);
    expect(getQuantity(dailyRows(today), m.variant_id)).toBe(-2);
    expect(getReportsSummary().topProducts).toEqual([]);
  });

  it('reverses yesterday return on the cancellation day only', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);
    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return in original shift',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    const { today, yesterday, currentShift } = startNextBusinessShift();
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(2);

    const cancelled = cancelSaleReturn({
      return_id: returned.returnId,
      actor_id: 1,
      reason: 'Return cancellation in later shift',
    });

    expect(cancelled.cancelled_shift_id).toBe(currentShift.id);
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(2);
    expect(getQuantity(dailyRows(today), m.variant_id)).toBe(1);
    expect(getQuantity(getReportsSummary().topProducts, m.variant_id)).toBe(3);
  });

  it('reverses yesterday exchange on the cancellation day only', () => {
    const { m, l } = seedVariants();
    const sale = sell(m, 1);
    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups
      .flatMap((group) => group.units)
      .find((entry) => Number(entry.is_returned || 0) === 0);

    expect(unit).toBeDefined();

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Exchange in original shift',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: l.variant_id,
        },
      ],
    });

    const { today, yesterday, currentShift } = startNextBusinessShift();
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(0);
    expect(getQuantity(dailyRows(yesterday), l.variant_id)).toBe(1);

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Exchange cancellation in later shift',
    });

    expect(cancelled.cancelled_shift_id).toBe(currentShift.id);
    expect(getQuantity(dailyRows(yesterday), m.variant_id)).toBe(0);
    expect(getQuantity(dailyRows(yesterday), l.variant_id)).toBe(1);
    expect(getQuantity(dailyRows(today), m.variant_id)).toBe(1);
    expect(getQuantity(dailyRows(today), l.variant_id)).toBe(-1);
    expect(getQuantity(getReportsSummary().topProducts, m.variant_id)).toBe(1);
    expect(getQuantity(getReportsSummary().topProducts, l.variant_id)).toBe(0);
  });
});

describe('daily product movement breakdown', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  const todayRows = () => getDailyProductSummary(getLocalBusinessDate());
  const item = (date: string, variantId: number) =>
    getDailyProductSummary(date).find((row) => row.variant_id === variantId);

  it('shows both a sale and return even when net quantity is zero', () => {
    const { m } = seedVariants();
    const sale = sell(m, 1);
    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Daily breakdown complete return',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(todayRows()).toHaveLength(1);
    expect(item(getLocalBusinessDate(), m.variant_id)).toMatchObject({
      sold_quantity: 1,
      returned_quantity: 1,
      exchange_quantity: 0,
      cancellation_quantity: 0,
      net_quantity: 0,
    });
  });

  it('separates outgoing and incoming exchange quantities by variant', () => {
    const { m, l } = seedVariants();
    const sale = sell(m, 1);
    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups
      .flatMap((group) => group.units)
      .find((entry) => Number(entry.is_returned || 0) === 0);

    expect(unit).toBeDefined();

    createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Daily movement breakdown exchange',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: l.variant_id,
        },
      ],
    });

    const date = getLocalBusinessDate();
    expect(item(date, m.variant_id)).toMatchObject({
      sold_quantity: 1,
      returned_quantity: 0,
      exchange_quantity: -1,
      cancellation_quantity: 0,
      net_quantity: 0,
    });
    expect(item(date, l.variant_id)).toMatchObject({
      sold_quantity: 0,
      returned_quantity: 0,
      exchange_quantity: 1,
      cancellation_quantity: 0,
      net_quantity: 1,
    });
  });

  it('keeps an old sale in its day and shows a negative return today', () => {
    const { m } = seedVariants();
    const sale = sell(m, 3);
    const { today, yesterday } = startNextBusinessShift();
    const receipt = getSaleReceipt(sale.saleId) as {
      items: Array<{ id: number }>;
    };

    createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Older invoice returned in current shift',
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: receipt.items[0].id,
          variant_id: m.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(item(yesterday, m.variant_id)).toMatchObject({
      sold_quantity: 3,
      returned_quantity: 0,
      net_quantity: 3,
    });
    expect(item(today, m.variant_id)).toMatchObject({
      sold_quantity: 0,
      returned_quantity: 1,
      exchange_quantity: 0,
      cancellation_quantity: 0,
      net_quantity: -1,
    });
  });

  it('records a later invoice cancellation separately from returned pieces', () => {
    const { m } = seedVariants();
    const sale = sell(m, 2);
    const { today, yesterday } = startNextBusinessShift();

    cancelSaleInvoice({
      sale_id: sale.saleId,
      actor_id: 1,
      reason: 'Cancel yesterday invoice in current shift',
    });

    expect(item(yesterday, m.variant_id)).toMatchObject({
      sold_quantity: 2,
      cancellation_quantity: 0,
      net_quantity: 2,
    });
    expect(item(today, m.variant_id)).toMatchObject({
      sold_quantity: 0,
      returned_quantity: 0,
      exchange_quantity: 0,
      cancellation_quantity: -2,
      net_quantity: -2,
    });
  });

  it('reverses an old exchange only on its cancellation date', () => {
    const { m, l } = seedVariants();
    const sale = sell(m, 1);
    const state = getSaleExchangeState(sale.saleId);
    const unit = state.groups
      .flatMap((group) => group.units)
      .find((entry) => Number(entry.is_returned || 0) === 0);

    expect(unit).toBeDefined();

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Old exchange cancelled in newer shift',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: l.variant_id,
        },
      ],
    });

    const { today, yesterday } = startNextBusinessShift();

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Cancel old exchange today',
    });

    expect(item(yesterday, m.variant_id)).toMatchObject({
      sold_quantity: 1,
      exchange_quantity: -1,
      net_quantity: 0,
    });
    expect(item(yesterday, l.variant_id)).toMatchObject({
      exchange_quantity: 1,
      net_quantity: 1,
    });
    expect(item(today, m.variant_id)).toMatchObject({
      cancellation_quantity: 1,
      net_quantity: 1,
    });
    expect(item(today, l.variant_id)).toMatchObject({
      cancellation_quantity: -1,
      net_quantity: -1,
    });
  });
  it('returns the current barcode and catalog sale price for a selected historical date', () => {
    const { m } = seedVariants();
    const sale = sell(m, 2);
    const date = getLocalBusinessDate();
    const first = getDailyProductSummary(date).find(
      (row) => row.variant_id === m.variant_id,
    );
    expect(first).toMatchObject({
      barcode: 'DAILY-SUMMARY-M',
      sell_price: 100,
      net_quantity: 2,
    });

    getDb()
      .prepare('UPDATE product_variants SET sell_price = ? WHERE id = ?')
      .run(175, m.variant_id);

    const second = getDailyProductSummary(date).find(
      (row) => row.variant_id === m.variant_id,
    );
    expect(second).toMatchObject({
      barcode: 'DAILY-SUMMARY-M',
      sell_price: 175,
      net_quantity: 2,
    });
    // Catalog updates must not rewrite historical invoice values.
    expect(
      getReportsSummary({ date_from: date, date_to: date }).summary.sales_count,
    ).toBe(1);
    expect(sale.saleId).toBeGreaterThan(0);
  });
});
