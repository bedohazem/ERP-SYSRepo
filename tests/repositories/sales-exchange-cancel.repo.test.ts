import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import {
  createPromotion,
  togglePromotion,
} from '../../src/main/database/repositories/promotions.repo';

import {
  cancelSaleReturn,
  createSale,
  createSaleReturn,
  listSales,
} from '../../src/main/database/repositories/sales.repo';

import {
  cancelSaleExchange,
  createSaleExchange,
  listSaleExchanges,
} from '../../src/main/database/repositories/sales-exchange.repo';

import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo';

import {
  getCashierDashboardSummary,
  getReportsSummary,
} from '../../src/main/database/repositories/reports.repo';

import { getSalesHistoryReport } from '../../src/main/database/repositories/sales-history-report.repo';

import {
  closeCashShift,
  getCashShiftDetails,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo';

type VariantRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  stock: number;
};

type PromoBarcode = 'CEX150' | 'CEX200' | 'CEX250' | 'CEX300' | 'CEX350';

function setLoyaltyEnabled(enabled: boolean) {
  const db = getDb();

  const update = db.prepare(`
    UPDATE app_settings
    SET value = ?
    WHERE key = ?
  `);

  update.run(enabled ? 'true' : 'false', 'loyalty_enabled');

  update.run('100', 'loyalty_earn_amount');

  update.run('1', 'loyalty_earn_points');

  update.run('1', 'loyalty_point_value');

  update.run('1', 'loyalty_min_redeem_points');
}

function seedCatalog() {
  const category = createCategory({
    name: 'Exchange Cancellation Category',
  });

  createProduct({
    name: 'Exchange Cancellation Product',

    category_id: Number(category.id),

    image_path: null,
    description: null,

    variants: [
      {
        barcode: 'CEX150',
        size: '150',
        color: 'Black',
        buy_price: 70,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX250',
        size: '250',
        color: 'Black',
        buy_price: 110,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'CEX350',
        size: '350',
        color: 'Black',
        buy_price: 150,
        sell_price: 350,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });

  const get = (barcode: PromoBarcode) =>
    getVariantByBarcode(barcode) as VariantRow;

  return {
    categoryId: Number(category.id),

    variants: {
      CEX150: get('CEX150'),
      CEX200: get('CEX200'),
      CEX250: get('CEX250'),
      CEX300: get('CEX300'),
      CEX350: get('CEX350'),
    },
  };
}

function createCustomer(points = 0) {
  const result = getDb()
    .prepare(
      `
      INSERT INTO customers (
        name,
        phone,
        points_balance
      )
      VALUES (?, ?, ?)
      `,
    )
    .run(
      'Exchange Cancel Customer',
      `0109${Date.now().toString().slice(-7)}`,
      points,
    );

  return Number(result.lastInsertRowid);
}

function createPromotionSale(
  barcodes: PromoBarcode[],
  options?: {
    customerId?: number | null;
    paid?: number;
  },
) {
  const catalog = seedCatalog();

  const promotion = createPromotion({
    name: 'Cancel Test Buy 2 Get 1',

    type: 'buy_x_get_y',

    value: 0,

    buy_qty: 2,
    free_qty: 1,

    scope_type: 'category',

    category_id: catalog.categoryId,

    product_ids: [],

    actor_id: 1,
  });

  togglePromotion(promotion.promotionId, 1);

  const items = barcodes.map((barcode) => {
    const variant = catalog.variants[barcode];

    return {
      variant_id: variant.variant_id,

      product_name: variant.product_name,

      barcode: variant.barcode,

      size: variant.size,

      color: variant.color,

      quantity: 1,

      unit_price: variant.sell_price,
    };
  });

  const subTotal = items.reduce(
    (total, item) => total + Number(item.unit_price),
    0,
  );

  const freeCount = Math.floor(items.length / 3);

  const promotionDiscount = [...items]
    .sort((a, b) => Number(a.unit_price) - Number(b.unit_price))
    .slice(0, freeCount)
    .reduce((total, item) => total + Number(item.unit_price), 0);

  const grandTotal = subTotal - promotionDiscount;

  const sale = createSale({
    user_id: 1,

    customer_id: options?.customerId ?? null,

    promotion_id: promotion.promotionId,

    sub_total: subTotal,

    discount_value: 0,

    grand_total: grandTotal,

    change_amount: 0,

    payment_method: 'cash',

    paid: options?.paid === undefined ? grandTotal : options.paid,

    items,
  });

  return {
    ...catalog,

    promotionId: promotion.promotionId,

    sale,
  };
}

function getUnits(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE sale_id = ?
      ORDER BY id ASC
      `,
    )
    .all(saleId) as any[];
}

function getUnitByPrice(saleId: number, price: number) {
  return getUnits(saleId).find(
    (unit) => Number(unit.current_unit_price) === price,
  );
}

function stock(barcode: string) {
  return Number((getVariantByBarcode(barcode) as VariantRow).stock || 0);
}

function customerBalance(customerId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as any;

  return Number(row?.balance || 0);
}

function customerPoints(customerId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT points_balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(customerId) as any;

  return Number(row?.points_balance || 0);
}

function fullBundleReturnItems(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        variant_id,
        quantity

      FROM sale_items

      WHERE
        sale_id = ?

        AND
          promotion_group_id
          IS NOT NULL

      ORDER BY id ASC
      `,
    )
    .all(saleId)
    .map((item: any) => ({
      sale_item_id: Number(item.id),

      variant_id: Number(item.variant_id),

      quantity: Number(item.quantity),
    }));
}

describe('sale exchange cancellation', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();

    setLoyaltyEnabled(false);
    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });
  }, 30_000);

  it('cancels the latest exchange and restores stock current state cash reports and audit history', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'تغيير الهدية',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(100);

    expect(stock('CEX150')).toBe(20);

    expect(stock('CEX300')).toBe(19);

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      reason: 'رجوع عن الاستبدال',

      actor_id: 1,
    });

    expect(cancelled.ok).toBe(true);

    expect(cancelled.exchange_id).toBe(exchange.exchangeId);

    expect(cancelled.cash_refunded).toBe(100);

    const units = getUnits(result.sale.saleId);

    expect(
      units
        .map((unit) => Number(unit.current_unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250]);

    const gift = units.find((unit) => Number(unit.current_is_gift) === 1);

    expect(Number(gift.current_unit_price)).toBe(150);

    expect(stock('CEX150')).toBe(19);

    expect(stock('CEX300')).toBe(20);

    const reverseCash = getDb()
      .prepare(
        `
            SELECT *
            FROM cash_movements

            WHERE
              reference_type =
                'sale_exchange_cancel'

              AND
                reference_id = ?

            ORDER BY id DESC
            LIMIT 1
            `,
      )
      .get(exchange.exchangeId) as any;

    expect(reverseCash).toBeTruthy();

    expect(reverseCash.direction).toBe('out');

    expect(Number(reverseCash.amount)).toBe(100);

    const exchangeRow = getDb()
      .prepare(
        `
            SELECT *
            FROM sale_exchanges
            WHERE id = ?
            LIMIT 1
            `,
      )
      .get(exchange.exchangeId) as any;

    expect(exchangeRow.cancelled_at).toBeTruthy();

    expect(exchangeRow.cancel_reason).toBe('رجوع عن الاستبدال');

    const state = getSaleCurrentState(result.sale.saleId);

    expect(state.financials.exchange_count).toBe(0);

    expect(state.financials.net_grand_total).toBe(450);

    expect(state.exchanges).toHaveLength(1);

    expect(state.exchanges[0].cancelled_at).toBeTruthy();

    const history = listSaleExchanges({
      status: 'cancelled',

      search: String(exchange.exchangeId),
    });

    expect(history.rows).toHaveLength(1);

    expect(history.rows[0].can_cancel).toBe(false);

    const sales = listSales({
      search: `#${result.sale.saleId}`,

      limit: 50,
      offset: 0,
    });

    expect(Number((sales.rows[0] as any).exchange_count)).toBe(0);

    expect(Number((sales.rows[0] as any).cancelled_exchange_count)).toBe(1);

    const reports = getReportsSummary() as any;

    expect(reports.summary.exchange_count).toBe(0);

    expect(reports.summary.gross_sales).toBe(450);

    expect(reports.summary.net_sales).toBe(450);
  });

  it('requires LIFO cancellation across the whole invoice', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const unit = getUnitByPrice(result.sale.saleId, 150);

    const first = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    const second = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.variants.CEX350.variant_id,
        },
      ],
    });

    expect(() =>
      cancelSaleExchange({
        exchange_id: first.exchangeId,

        actor_id: 1,

        reason: 'إلغاء غير مرتب',
      }),
    ).toThrow('يجب إلغاء آخر عملية استبدال أولًا');

    cancelSaleExchange({
      exchange_id: second.exchangeId,

      actor_id: 1,

      reason: 'إلغاء الثاني',
    });

    cancelSaleExchange({
      exchange_id: first.exchangeId,

      actor_id: 1,

      reason: 'إلغاء الأول',
    });

    const units = getUnits(result.sale.saleId);

    expect(
      units
        .map((item) => Number(item.current_unit_price))
        .sort((a: number, b: number) => a - b),
    ).toEqual([150, 200, 250]);
  });

  it.each([
    {
      scenario: 'fully paid',
      paid: 450,
      expectedDebtReduction: 0,
      expectedCashRefund: 540,
    },
    {
      scenario: 'partially paid',
      paid: 200,
      expectedDebtReduction: 250,
      expectedCashRefund: 290,
    },
  ])(
    'reconciles a full return after discounted exchange ($scenario)',
    ({ paid, expectedDebtReduction, expectedCashRefund }) => {
      const db = getDb();
      const customerId = createCustomer();

      const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'], {
        customerId,
        paid,
      });

      const saleId = result.sale.saleId;
      const gift = getUnitByPrice(saleId, 150);

      expect(customerBalance(customerId)).toBe(450 - paid);

      const exchange = createSaleExchange({
        original_sale_id: saleId,
        user_id: 1,
        payment_method: 'store_cash',
        discount_type: 'amount',
        discount_input: 10,
        items: [
          {
            promotion_unit_id: Number(gift.id),
            new_variant_id: result.variants.CEX300.variant_id,
          },
        ],
      });

      expect(exchange.exchange_discount_value).toBe(10);
      expect(exchange.difference_amount).toBe(90);
      expect(exchange.amount_to_collect).toBe(90);

      const before = getSaleCurrentState(saleId);
      const beforeReport = getSalesHistoryReport();

      expect(before.financials.net_grand_total).toBe(540);
      expect(before.financials.current_exchange_discount_value).toBe(10);

      expect(beforeReport.summary.net_sales).toBe(540);
      expect(beforeReport.summary.exchange_discounts).toBe(10);
      expect(beforeReport.summary.net_profit_after_discounts).toBe(210);

      expect(customerBalance(customerId)).toBe(450 - paid);

      // Return the entire promotion, including the replacement.
      const saleReturn = createSaleReturn({
        original_sale_id: saleId,
        user_id: 1,
        refund_payment_method: 'store_cash',
        reason: 'Discounted exchange full return',
        items: fullBundleReturnItems(saleId),
      });

      expect(saleReturn.return_value).toBe(540);
      expect(saleReturn.refundAmount).toBe(expectedCashRefund);
      expect(saleReturn.debt_reduction_amount).toBe(expectedDebtReduction);

      const returnRow = db
        .prepare(
          `
        SELECT
          refund_amount,
          exchange_discount_value,
          cash_refund_amount,
          debt_reduction_amount
        FROM sale_returns
        WHERE id = ?
      `,
        )
        .get(saleReturn.returnId) as any;

      expect(Number(returnRow.refund_amount)).toBe(540);
      expect(Number(returnRow.exchange_discount_value)).toBe(10);
      expect(Number(returnRow.cash_refund_amount)).toBe(expectedCashRefund);
      expect(Number(returnRow.debt_reduction_amount)).toBe(
        expectedDebtReduction,
      );

      // All returned units must carry their actual discount shares.
      const returnItems = db
        .prepare(
          `
        SELECT
          COUNT(*) AS item_count,
          IFNULL(SUM(exchange_discount_value), 0)
            AS exchange_discount,
          IFNULL(SUM(cost_value), 0)
            AS returned_cost
        FROM sale_return_items
        WHERE return_id = ?
      `,
        )
        .get(saleReturn.returnId) as any;

      expect(Number(returnItems.item_count)).toBe(3);
      expect(Number(returnItems.exchange_discount)).toBe(10);
      expect(Number(returnItems.returned_cost)).toBe(330);

      // Only the actual cash refund leaves the drawer.
      const refundMovement = db
        .prepare(
          `
        SELECT
          direction,
          amount,
          payment_method
        FROM cash_movements
        WHERE reference_type = 'sale_return'
          AND reference_id = ?
          AND cancelled_at IS NULL
      `,
        )
        .get(saleReturn.returnId) as any;

      expect(refundMovement).toBeTruthy();
      expect(refundMovement.direction).toBe('out');
      expect(Number(refundMovement.amount)).toBe(expectedCashRefund);
      expect(refundMovement.payment_method).toBe('store_cash');

      // No customer debt may remain after the full return.
      expect(customerBalance(customerId)).toBe(0);

      const after = getSaleCurrentState(saleId);

      expect(after.financials.net_grand_total).toBe(0);

      // Inventory must restore the actual returned variants.
      expect(stock('CEX150')).toBe(20);
      expect(stock('CEX200')).toBe(20);
      expect(stock('CEX250')).toBe(20);
      expect(stock('CEX300')).toBe(20);

      // Financial reports must reverse the whole sale exactly once.
      const history = getSalesHistoryReport();
      const reports = getReportsSummary();

      expect(history.summary.net_sales).toBe(0);
      expect(history.summary.exchange_discounts).toBe(0);
      expect(history.summary.promotion_discounts).toBe(0);
      expect(history.summary.total_discounts).toBe(0);
      expect(history.summary.net_profit_after_discounts).toBe(0);

      expect(reports.summary.net_sales).toBe(0);
      expect(reports.summary.exchange_discounts).toBe(0);
      expect(reports.summary.net_profit_after_discounts).toBe(0);

      // Cashier figures must reconcile with the same financial events.
      const dashboard = getCashierDashboardSummary({
        user_id: 1,
      });

      expect(dashboard.sales.net_sales).toBe(0);
      expect(dashboard.sales.returns_total).toBe(540);
      expect(dashboard.sales.return_cash_refund).toBe(expectedCashRefund);
      expect(dashboard.sales.return_debt_reduction).toBe(expectedDebtReduction);
      expect(dashboard.discounts.exchange).toBe(0);
    },
  );

  it('retains exchange discounts across repeated exchanges and reverses each grant once', () => {
    const db = getDb();

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const saleId = result.sale.saleId;
    const unit = getUnitByPrice(saleId, 150);

    const checkFinancials = (
      netSales: number,
      exchangeDiscount: number,
      promotionDiscount: number,
      netProfit: number,
    ) => {
      const state = getSaleCurrentState(saleId);
      const history = getSalesHistoryReport();
      const reports = getReportsSummary();
      const dashboard = getCashierDashboardSummary({
        user_id: 1,
      });

      const unitDiscount = getUnits(saleId).reduce(
        (sum, item) => sum + Number(item.current_exchange_discount_value || 0),
        0,
      );

      expect(state.financials.net_grand_total).toBe(netSales);
      expect(state.financials.current_exchange_discount_value).toBe(
        exchangeDiscount,
      );

      expect(unitDiscount).toBe(exchangeDiscount);

      expect(history.summary.net_sales).toBe(netSales);
      expect(history.summary.exchange_discounts).toBe(exchangeDiscount);
      expect(history.summary.promotion_discounts).toBe(promotionDiscount);
      expect(history.summary.total_discounts).toBe(
        promotionDiscount + exchangeDiscount,
      );
      expect(history.summary.net_profit_after_discounts).toBe(netProfit);

      expect(reports.summary.net_sales).toBe(netSales);
      expect(reports.summary.exchange_discounts).toBe(exchangeDiscount);
      expect(reports.summary.net_profit_after_discounts).toBe(netProfit);

      expect(dashboard.sales.net_sales).toBe(netSales);
      expect(dashboard.discounts.exchange).toBe(exchangeDiscount);
    };

    // First exchange: 150 -> 300, granting 10.
    const first = createSaleExchange({
      original_sale_id: saleId,
      user_id: 1,
      payment_method: 'store_cash',
      discount_type: 'amount',
      discount_input: 10,
      items: [
        {
          promotion_unit_id: Number(unit.id),
          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(first.exchange_discount_value).toBe(10);
    expect(first.exchange_discount_delta).toBe(10);
    expect(first.difference_amount).toBe(90);
    expect(first.amount_to_collect).toBe(90);

    checkFinancials(540, 10, 200, 210);

    // Second exchange: 300 -> 350.
    // The old grant remains 10.
    // New positive difference = 50.
    // A 10% grant adds only 5.
    const second = createSaleExchange({
      original_sale_id: saleId,
      user_id: 1,
      payment_method: 'store_cash',
      discount_type: 'percent',
      discount_input: 10,
      items: [
        {
          promotion_unit_id: Number(unit.id),
          new_variant_id: result.variants.CEX350.variant_id,
        },
      ],
    });

    expect(second.exchange_discount_value).toBe(5);
    expect(second.exchange_discount_delta).toBe(5);
    expect(second.difference_amount).toBe(45);
    expect(second.amount_to_collect).toBe(45);

    checkFinancials(585, 15, 200, 235);

    // Verify independent historical discount grants.
    const exchangeRows = db
      .prepare(
        `
      SELECT
        exchange_discount_value,
        exchange_discount_delta
      FROM sale_exchanges
      WHERE id IN (?, ?)
      ORDER BY id
    `,
      )
      .all(first.exchangeId, second.exchangeId) as any[];

    expect(
      exchangeRows.map((row) => Number(row.exchange_discount_value)),
    ).toEqual([10, 5]);

    expect(
      exchangeRows.map((row) => Number(row.exchange_discount_delta)),
    ).toEqual([10, 5]);

    // Cannot cancel the older exchange first.
    expect(() =>
      cancelSaleExchange({
        exchange_id: first.exchangeId,
        actor_id: 1,
        reason: 'Invalid cancellation order',
      }),
    ).toThrow('يجب إلغاء آخر عملية استبدال أولًا');

    checkFinancials(585, 15, 200, 235);

    // Cancel second: restore first discount only.
    const cancelSecond = cancelSaleExchange({
      exchange_id: second.exchangeId,
      actor_id: 1,
      reason: 'Cancel second discounted exchange',
    });

    expect(cancelSecond.ok).toBe(true);

    checkFinancials(540, 10, 200, 210);

    // Cancel first: restore original invoice.
    const cancelFirst = cancelSaleExchange({
      exchange_id: first.exchangeId,
      actor_id: 1,
      reason: 'Cancel first discounted exchange',
    });

    expect(cancelFirst.ok).toBe(true);

    checkFinancials(450, 0, 150, 180);

    // Cash refunds must reverse each collection once.
    const reverseMovements = db
      .prepare(
        `
      SELECT reference_id, direction, amount
      FROM cash_movements
      WHERE reference_type = 'sale_exchange_cancel'
        AND reference_id IN (?, ?)
      ORDER BY reference_id
    `,
      )
      .all(first.exchangeId, second.exchangeId) as any[];

    expect(
      reverseMovements.map((row) => ({
        reference_id: Number(row.reference_id),
        direction: row.direction,
        amount: Number(row.amount),
      })),
    ).toEqual([
      {
        reference_id: first.exchangeId,
        direction: 'out',
        amount: 90,
      },
      {
        reference_id: second.exchangeId,
        direction: 'out',
        amount: 45,
      },
    ]);

    // Original stock must be fully restored.
    expect(stock('CEX150')).toBe(19);
    expect(stock('CEX200')).toBe(19);
    expect(stock('CEX250')).toBe(19);
    expect(stock('CEX300')).toBe(20);
    expect(stock('CEX350')).toBe(20);
  });

  it('blocks exchange cancellation while a newer active return exists', () => {
    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      items: fullBundleReturnItems(result.sale.saleId),
    });

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,

        actor_id: 1,

        reason: 'محاولة قبل المرتجع',
      }),
    ).toThrow('يجب إلغاء المرتجع الأحدث أولًا');

    cancelSaleReturn({
      return_id: saleReturn.returnId,

      actor_id: 1,

      reason: 'إلغاء المرتجع',
    });

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء بعد المرتجع',
    });

    expect(cancelled.ok).toBe(true);
  });

  it('blocks cancelling an older return while a newer active exchange exists', () => {
    const result = createPromotionSale([
      'CEX250',
      'CEX200',
      'CEX150',
      'CEX350',
    ]);

    const db = getDb();

    const saleItems = db
      .prepare(
        `
      SELECT
        id,
        variant_id,
        quantity,
        promotion_group_id

      FROM sale_items

      WHERE sale_id = ?

      ORDER BY id ASC
      `,
      )
      .all(result.sale.saleId) as any[];

    const standaloneItem = saleItems.find((item) => !item.promotion_group_id);

    expect(standaloneItem).toBeTruthy();

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      reason: 'مرتجع قبل الاستبدال',

      items: [
        {
          sale_item_id: Number(standaloneItem.id),

          variant_id: Number(standaloneItem.variant_id),

          quantity: 1,
        },
      ],
    });

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'استبدال أحدث من المرتجع',

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(() =>
      cancelSaleReturn({
        return_id: saleReturn.returnId,

        actor_id: 1,

        reason: 'محاولة إلغاء مرتجع قديم',
      }),
    ).toThrow('يجب إلغاء الاستبدال الأحدث أولًا');

    expect(
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,

        actor_id: 1,

        reason: 'إلغاء الاستبدال الأحدث',
      }).ok,
    ).toBe(true);

    expect(
      cancelSaleReturn({
        return_id: saleReturn.returnId,

        actor_id: 1,

        reason: 'إلغاء المرتجع بعد الاستبدال',
      }).ok,
    ).toBe(true);
  });

  it('restores customer debt when cancelling a cheaper exchange', () => {
    const customerId = createCustomer();

    const result = createPromotionSale(['CEX300', 'CEX250', 'CEX200'], {
      customerId,
      paid: 400,
    });

    expect(result.sale.remaining_amount).toBe(150);

    expect(customerBalance(customerId)).toBe(150);

    const unit300 = getUnitByPrice(result.sale.saleId, 300);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'owner_bank',

      items: [
        {
          promotion_unit_id: Number(unit300.id),

          new_variant_id: result.variants.CEX150.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-100);

    expect(exchange.debt_reduction_amount).toBe(100);

    const originalShift = getOpenCashShift();

    expect(originalShift).toBeTruthy();

    expect(exchange.shift_id).toBe(originalShift!.id);

    const afterExchange = getDb()
      .prepare(
        `
            SELECT
              remaining_amount

            FROM sales
            WHERE id = ?
            `,
      )
      .get(result.sale.saleId) as any;

    expect(Number(afterExchange.remaining_amount)).toBe(50);

    expect(customerBalance(customerId)).toBe(50);

    /*
     * إلغاء الاستبدال يتم داخل
     * نفس الشفت الذي أُنشئ فيه.
     *
     * الهدف هنا التأكد من أن
     * خفض المديونية يُعكس بشكل صحيح.
     */
    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء استبدال خفض الدين',
    });

    expect(cancelled.debt_restored).toBe(100);

    expect(cancelled.cancelled_shift_id).toBe(originalShift!.id);

    const exchangeRow = getDb()
      .prepare(
        `
    SELECT
      shift_id,
      cancelled_shift_id

    FROM sale_exchanges

    WHERE id = ?
    `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(exchangeRow.shift_id)).toBe(originalShift!.id);

    expect(Number(exchangeRow.cancelled_shift_id)).toBe(originalShift!.id);

    const reverseMovement = getDb()
      .prepare(
        `
        SELECT id

        FROM cash_movements

        WHERE reference_type =
          'sale_exchange_cancel'

          AND reference_id = ?

        LIMIT 1
        `,
      )
      .get(exchange.exchangeId);

    expect(reverseMovement).toBeUndefined();

    const restoredSale = getDb()
      .prepare(
        `
            SELECT
              remaining_amount,
              payment_status

            FROM sales
            WHERE id = ?
            `,
      )
      .get(result.sale.saleId) as any;

    expect(Number(restoredSale.remaining_amount)).toBe(150);

    expect(restoredSale.payment_status).toBe('partial');

    expect(customerBalance(customerId)).toBe(150);
  });

  it('reverses loyalty adjustments created by the cancelled exchange', () => {
    setLoyaltyEnabled(true);

    const customerId = createCustomer();

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150'], {
      customerId,
    });

    expect(result.sale.loyalty_points_earned).toBe(4);

    expect(customerPoints(customerId)).toBe(4);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.loyalty_earned_points_adjustment).toBe(1);

    expect(customerPoints(customerId)).toBe(5);

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'إلغاء مع النقاط',
    });

    expect(cancelled.loyalty_balance_reversed).toBe(-1);

    expect(customerPoints(customerId)).toBe(4);

    const state = getSaleCurrentState(result.sale.saleId);

    expect(state.financials.current_loyalty_points_earned).toBe(4);
  });

  it('reconciles discounted safe exchange cancellation without an open shift', () => {
    const db = getDb();

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const currentShift = getOpenCashShift();

    expect(currentShift).toBeTruthy();

    closeCashShift({
      shift_id: currentShift!.id,

      closing_counted_amount: 450,

      left_for_next_shift: 0,

      closed_by: 1,
    });

    expect(getOpenCashShift()).toBeNull();
    const originalShiftSnapshot = getCashShiftDetails(currentShift!.id);
    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,
      payment_method: 'store_safe',
      discount_type: 'amount',
      discount_input: 10,
      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.shift_id).toBeNull();
    expect(exchange.exchange_discount_value).toBe(10);
    expect(exchange.difference_amount).toBe(90);
    expect(exchange.amount_to_collect).toBe(90);

    const beforeCancel = getSalesHistoryReport();

    expect(beforeCancel.summary.net_sales).toBe(540);
    expect(beforeCancel.summary.exchange_discounts).toBe(10);
    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'Cancel safe exchange',
    });

    expect(cancelled.cancelled_shift_id).toBeNull();

    const reverse = db
      .prepare(
        `
      SELECT
        shift_id,
        payment_method,
        direction,
        amount

      FROM cash_movements

      WHERE reference_type =
        'sale_exchange_cancel'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(reverse.shift_id).toBeNull();

    expect(reverse.payment_method).toBe('store_safe');

    expect(reverse.direction).toBe('out');

    expect(Number(reverse.amount)).toBe(90);

    const exchangeRow = db
      .prepare(
        `
      SELECT
        shift_id,
        cancelled_shift_id,
        cancelled_outside_shift,
        cancelled_at
      FROM sale_exchanges
      WHERE id = ?
    `,
      )
      .get(exchange.exchangeId) as any;

    expect(exchangeRow.shift_id).toBeNull();
    expect(exchangeRow.cancelled_shift_id).toBeNull();
    expect(Number(exchangeRow.cancelled_outside_shift)).toBe(1);
    expect(exchangeRow.cancelled_at).toBeTruthy();

    const oldShiftAfter = getCashShiftDetails(currentShift!.id);

    expect(oldShiftAfter.sales).toEqual(originalShiftSnapshot.sales);
    expect(oldShiftAfter.sales_summary).toEqual(
      originalShiftSnapshot.sales_summary,
    );
    expect(oldShiftAfter.operations_summary).toEqual(
      originalShiftSnapshot.operations_summary,
    );
    expect(oldShiftAfter.movements).toEqual(originalShiftSnapshot.movements);

    const current = getSaleCurrentState(result.sale.saleId);

    expect(current.financials.net_grand_total).toBe(450);
    expect(current.financials.current_exchange_discount_value).toBe(0);

    const history = getSalesHistoryReport();
    const reports = getReportsSummary();

    expect(history.summary.net_sales).toBe(450);
    expect(history.summary.exchange_discounts).toBe(0);
    expect(history.summary.total_discounts).toBe(150);
    expect(history.summary.net_profit_after_discounts).toBe(180);

    expect(reports.summary.net_sales).toBe(450);
    expect(reports.summary.exchange_discounts).toBe(0);

    expect(stock('CEX150')).toBe(19);
    expect(stock('CEX300')).toBe(20);

    expect(getOpenCashShift()).toBeNull();

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 1,
        reason: 'Duplicate cancellation',
      }),
    ).toThrow('عملية الاستبدال ملغاة بالفعل');
  });

  it('reconciles discounted exchange cancellation across closed and new shifts', () => {
    const db = getDb();
    const shiftA = getOpenCashShift()!;

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      discount_type: 'amount',
      discount_input: 10,
      items: [
        {
          promotion_unit_id: Number(gift.id),
          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.exchange_discount_value).toBe(10);
    expect(exchange.difference_amount).toBe(90);
    expect(exchange.amount_to_collect).toBe(90);

    const dashboardA = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboardA.sales.net_sales).toBe(540);
    expect(dashboardA.discounts.exchange).toBe(10);

    closeCashShift({
      shift_id: shiftA.id,
      closing_counted_amount: 540,
      left_for_next_shift: 540,
      closed_by: 1,
    });

    const closedSnapshot = getCashShiftDetails(shiftA.id);

    const historicalSnapshot = {
      sales: closedSnapshot.sales,
      sales_summary: closedSnapshot.sales_summary,
      operations_summary: closedSnapshot.operations_summary,
      movements: closedSnapshot.movements,
      preview: closedSnapshot.preview,
    };

    const shiftB = openCashShift({
      opening_counted_amount: 540,
      opened_by: 1,
    });

    expect(shiftB.id).not.toBe(shiftA.id);

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Discounted exchange cross-shift regression',
    });

    expect(cancelled.cancelled_shift_id).toBe(shiftB.id);

    // Closed shift must preserve its historical figures.
    const afterCancellation = getCashShiftDetails(shiftA.id);

    expect({
      sales: afterCancellation.sales,
      sales_summary: afterCancellation.sales_summary,
      operations_summary: afterCancellation.operations_summary,
      movements: afterCancellation.movements,
      preview: afterCancellation.preview,
    }).toEqual(historicalSnapshot);

    // Cancellation must affect only the new shift.
    const dashboardB = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboardB.shift?.id).toBe(shiftB.id);

    // Reverse the full exchange difference.
    expect(dashboardB.sales.net_sales).toBe(-90);

    // Promotion gift changed from 150 to 200.
    // Cancelling the exchange reverses that extra 50.
    expect(dashboardB.discounts.promotion).toBe(-50);

    // Reverse the discretionary exchange discount.
    expect(dashboardB.discounts.exchange).toBe(-10);

    // Total discount reversal: -50 - 10 = -60.
    expect(dashboardB.discounts.total).toBe(-60);

    // Shift details must match the cashier dashboard.
    const shiftBDetails = getCashShiftDetails(shiftB.id);

    expect(shiftBDetails.sales_summary.net_sales).toBe(-90);
    expect(shiftBDetails.sales_summary.discounts_total).toBe(-60);

    const reverseMovements = db
      .prepare(
        `
      SELECT shift_id, direction, amount
      FROM cash_movements
      WHERE reference_type = 'sale_exchange_cancel'
        AND reference_id = ?
      ORDER BY id
    `,
      )
      .all(exchange.exchangeId) as Array<{
      shift_id: number | null;
      direction: string;
      amount: number;
    }>;

    expect(reverseMovements).toHaveLength(1);
    expect(Number(reverseMovements[0].shift_id)).toBe(shiftB.id);
    expect(reverseMovements[0].direction).toBe('out');
    expect(Number(reverseMovements[0].amount)).toBe(90);

    // Original invoice and inventory must be restored.
    const current = getSaleCurrentState(result.sale.saleId);

    expect(current.financials.net_grand_total).toBe(450);
    expect(current.financials.current_exchange_discount_value).toBe(0);

    expect(stock('CEX150')).toBe(19);
    expect(stock('CEX300')).toBe(20);

    // Reports must reconcile after the reversal.
    const history = getSalesHistoryReport();
    const reports = getReportsSummary();

    expect(history.summary.net_sales).toBe(450);
    expect(history.summary.exchange_discounts).toBe(0);
    expect(history.summary.promotion_discounts).toBe(150);
    expect(history.summary.total_discounts).toBe(150);
    expect(history.summary.net_profit_after_discounts).toBe(180);

    expect(reports.summary.net_sales).toBe(450);
    expect(reports.summary.exchange_discounts).toBe(0);
    expect(reports.summary.total_discounts).toBe(150);

    // A cancelled exchange cannot be cancelled twice.
    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 1,
        reason: 'Duplicate cancellation',
      }),
    ).toThrow('عملية الاستبدال ملغاة بالفعل');
  });

  it('blocks discounted drawer exchange cancellation without a shift', () => {
    const db = getDb();
    const originalShift = getOpenCashShift()!;

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      discount_type: 'amount',
      discount_input: 10,
      items: [
        {
          promotion_unit_id: Number(gift.id),
          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(90);
    expect(exchange.exchange_discount_value).toBe(10);

    closeCashShift({
      shift_id: originalShift.id,
      closing_counted_amount: 540,
      left_for_next_shift: 540,
      closed_by: 1,
    });

    expect(getOpenCashShift()).toBeNull();

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 1,
        reason: 'Cancellation without drawer shift',
      }),
    ).toThrow('لا يمكن إلغاء استبدال بدون شفت مفتوح');

    const row = db
      .prepare(
        `
        SELECT cancelled_at, cancelled_shift_id
        FROM sale_exchanges
        WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(row.cancelled_at).toBeNull();
    expect(row.cancelled_shift_id).toBeNull();

    const reversals = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM cash_movements
        WHERE reference_type = 'sale_exchange_cancel'
          AND reference_id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(reversals.total)).toBe(0);

    const history = getSalesHistoryReport();

    expect(history.summary.net_sales).toBe(540);
    expect(history.summary.exchange_discounts).toBe(10);
  });

  it('allows admin to cancel a previous-shift exchange in the current shift', () => {
    const db = getDb();

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(gift.id),

          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.amount_to_collect).toBe(100);

    const originalShift = getOpenCashShift();

    expect(originalShift).toBeTruthy();

    closeCashShift({
      shift_id: originalShift!.id,

      closing_counted_amount: 550,

      left_for_next_shift: 550,

      closed_by: 1,
    });

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 1,
        reason: 'Admin cancellation without shift',
      }),
    ).toThrow('لا يمكن إلغاء استبدال بدون شفت مفتوح');

    /*
     * وحتى فتح شفت جديد
     * لا يسمح بتعديل تاريخ الشفت القديم.
     */
    const currentShift = openCashShift({
      opening_counted_amount: 550,

      opened_by: 1,
    });

    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Admin cancellation in new shift',
    });

    expect(cancelled.cancelled_shift_id).toBe(currentShift.id);

    expect(currentShift.id).not.toBe(originalShift!.id);

    const exchangeRow = db
      .prepare(
        `
      SELECT
        shift_id,
        cancelled_shift_id,
        cancelled_at
      FROM sale_exchanges
      WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(exchangeRow.shift_id)).toBe(originalShift!.id);
    expect(Number(exchangeRow.cancelled_shift_id)).toBe(currentShift.id);
    expect(exchangeRow.cancelled_at).toBeTruthy();

    const reverseMovement = db
      .prepare(
        `
      SELECT
        shift_id,
        direction,
        amount
      FROM cash_movements
      WHERE reference_type = 'sale_exchange_cancel'
        AND reference_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(reverseMovement.shift_id)).toBe(currentShift.id);
    expect(reverseMovement.direction).toBe('out');
    expect(Number(reverseMovement.amount)).toBe(100);
  });

  it('blocks cashier from cancelling an exchange from a previous shift', () => {
    const db = getDb();

    const originalShift = getOpenCashShift()!;

    const result = createPromotionSale(['CEX250', 'CEX200', 'CEX150']);

    const gift = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(gift.id),
          new_variant_id: result.variants.CEX300.variant_id,
        },
      ],
    });

    expect(exchange.shift_id).toBe(originalShift.id);

    closeCashShift({
      shift_id: originalShift.id,
      closing_counted_amount: 550,
      left_for_next_shift: 550,
      closed_by: 1,
    });

    db.prepare(
      `
    INSERT OR IGNORE INTO users (
      id,
      name,
      username,
      password,
      role,
      is_active
    )
    VALUES (?, ?, ?, ?, 'cashier', 1)
    `,
    ).run(2, 'Exchange Cashier', 'exchange_cashier', 'test-password');

    const currentShift = openCashShift({
      opening_counted_amount: 550,
      opened_by: 2,
    });

    expect(currentShift.id).not.toBe(originalShift.id);

    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 2,
        reason: 'Cashier cross-shift cancellation',
      }),
    ).toThrow('لا يمكن إلغاء الاستبدال إلا داخل نفس الشفت الذي تم فيه');

    const row = db
      .prepare(
        `
      SELECT
        cancelled_at,
        cancelled_shift_id
      FROM sale_exchanges
      WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(row.cancelled_at).toBeNull();
    expect(row.cancelled_shift_id).toBeNull();
  });
});
