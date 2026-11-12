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
} from '../../src/main/database/repositories/sales.repo';
import {
  cancelSaleExchange,
  createSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import { getReportsSummary } from '../../src/main/database/repositories/reports.repo';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';
import { roundMoney } from '../../src/shared/money';

type TestVariant = {
  variant_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
};

type VariantSpec = {
  code: string;
  sell: number;
  cost: number;
  discountPrice?: number;
};

function catalog(specs: VariantSpec[], categoryId: number | null = null) {
  createProduct({
    name: `Profit Regression ${specs[0].code}`,
    category_id: categoryId,
    image_path: null,
    description: null,
    variants: specs.map((item) => ({
      barcode: item.code,
      size: 'M',
      color: item.code,
      buy_price: item.cost,
      sell_price: item.sell,
      ...(item.discountPrice === undefined
        ? {}
        : { discount_price: item.discountPrice }),
      min_stock: 1,
      opening_qty: 30,
    })),
  });

  return Object.fromEntries(
    specs.map((item) => {
      const variant = getVariantByBarcode(item.code) as TestVariant | undefined;
      if (!variant) throw new Error(`Missing test variant: ${item.code}`);
      return [item.code, variant];
    }),
  ) as Record<string, TestVariant>;
}

type SaleRow = {
  variant: TestVariant;
  quantity?: number;
  price?: number;
  listPrice?: number;
};

function sell(
  rows: SaleRow[],
  invoiceDiscount: number,
  expectedTotal: number,
  promotionId: number | null = null,
) {
  const items = rows.map(({ variant, quantity = 1, price, listPrice }) => ({
    variant_id: variant.variant_id,
    product_name: variant.product_name,
    barcode: variant.barcode,
    size: variant.size,
    color: variant.color,
    quantity,
    unit_price: price ?? variant.sell_price,
    ...(listPrice === undefined ? {} : { list_unit_price: listPrice }),
  }));

  const subTotal = items.reduce(
    (sum, item) => sum + Number(item.unit_price) * Number(item.quantity),
    0,
  );

  const sale = createSale({
    user_id: 1,
    customer_id: null,
    promotion_id: promotionId,
    sub_total: subTotal,
    discount_value: invoiceDiscount,
    grand_total: expectedTotal,
    paid: expectedTotal,
    change_amount: 0,
    payment_method: 'store_cash',
    items,
  });

  expect(Number(sale.grand_total)).toBe(expectedTotal);
  return sale;
}

function saleItemId(saleId: number, variant: TestVariant) {
  const row = getDb()
    .prepare(
      `
      SELECT id FROM sale_items
      WHERE sale_id = ? AND variant_id = ?
      ORDER BY id ASC LIMIT 1
    `,
    )
    .get(saleId, variant.variant_id) as { id: number } | undefined;
  if (!row) throw new Error(`Sale item missing: ${variant.barcode}`);
  return row.id;
}

function returnItem(saleId: number, variant: TestVariant, quantity = 1) {
  return createSaleReturn({
    original_sale_id: saleId,
    user_id: 1,
    refund_payment_method: 'store_cash',
    items: [
      {
        sale_item_id: saleItemId(saleId, variant),
        variant_id: variant.variant_id,
        quantity,
      },
    ],
  });
}

function returnBundle(saleId: number) {
  const items = getDb()
    .prepare(
      `
      SELECT id, variant_id, quantity
      FROM sale_items
      WHERE sale_id = ? AND promotion_group_id IS NOT NULL
      ORDER BY id ASC
    `,
    )
    .all(saleId) as Array<{ id: number; variant_id: number; quantity: number }>;
  if (items.length === 0) throw new Error('No promotion bundle to return');
  return createSaleReturn({
    original_sale_id: saleId,
    user_id: 1,
    refund_payment_method: 'store_cash',
    items: items.map((item) => ({
      sale_item_id: item.id,
      variant_id: item.variant_id,
      quantity: item.quantity,
    })),
  });
}

function regularUnitId(saleId: number, variant: TestVariant) {
  const state = getSaleExchangeState(saleId);
  const unit = state.groups
    .filter((group: any) => group.group_kind === 'regular')
    .flatMap((group: any) => group.units)
    .find(
      (unit: any) =>
        Number(unit.current_variant_id) === variant.variant_id &&
        Number(unit.is_returned || 0) === 0,
    );
  if (!unit) throw new Error(`Regular unit missing: ${variant.barcode}`);
  return Number(unit.id);
}

function exchangeUnit(
  saleId: number,
  unitId: number,
  replacement: TestVariant,
) {
  return createSaleExchange({
    original_sale_id: saleId,
    user_id: 1,
    payment_method: 'store_cash',
    items: [
      { promotion_unit_id: unitId, new_variant_id: replacement.variant_id },
    ],
  });
}

function restoreReturn(returnId: number) {
  cancelSaleReturn({
    return_id: returnId,
    actor_id: 1,
    reason: 'Profit regression',
  });
}

function restoreExchange(exchangeId: number) {
  cancelSaleExchange({
    exchange_id: exchangeId,
    actor_id: 1,
    reason: 'Profit regression',
  });
}

type ProfitExpectation = {
  revenue: number;
  cost: number;
  gross?: number;
  normalDiscount?: number;
  promotionDiscount?: number;
  productDiscount?: number;
};

function checkProfit(expected: ProfitExpectation) {
  const report = getReportsSummary() as any;
  const summary = report.summary;
  const actual = (key: string) => Number(summary[key] || 0);

  // The independent accounting invariant: net profit = net sales - actual COGS.
  expect(actual('net_sales')).toBeCloseTo(expected.revenue, 6);
  expect(actual('net_profit_after_discounts')).toBeCloseTo(
    expected.revenue - expected.cost,
    6,
  );
  // Isolated tests have no expenses, supplier rounding or cash variances.
  expect(actual('final_net_profit')).toBeCloseTo(
    expected.revenue - expected.cost,
    6,
  );
  if (expected.gross !== undefined) {
    expect(actual('gross_profit_before_discounts')).toBeCloseTo(
      expected.gross,
      6,
    );
  }
  if (expected.normalDiscount !== undefined) {
    expect(actual('normal_discounts')).toBeCloseTo(expected.normalDiscount, 6);
  }
  if (expected.promotionDiscount !== undefined) {
    expect(actual('promotion_discounts')).toBeCloseTo(
      expected.promotionDiscount,
      6,
    );
  }
  if (expected.productDiscount !== undefined) {
    expect(actual('product_discounts')).toBeCloseTo(
      expected.productDiscount,
      6,
    );
  }
  return report;
}

describe('sales profit regression: discounts, exchanges, promotions, returns', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  // Amount and percentage inputs MUST create the same stored discount and profit.
  for (const discountMode of ['amount', 'percent'] as const) {
    it(`reconciles ${discountMode} invoice discount profit through exchange, partial returns and cancellation`, () => {
      const v = catalog([
        { code: 'PROFIT150', sell: 150, cost: 70 },
        { code: 'PROFIT200', sell: 200, cost: 90 },
        { code: 'PROFIT350', sell: 350, cost: 150 },
        { code: 'PROFIT300', sell: 300, cost: 130 },
      ]);
      const discount =
        discountMode === 'percent' ? roundMoney((700 * 7.5) / 100) : 53;
      expect(discount).toBe(53);

      const sale = sell(
        [
          { variant: v.PROFIT150 },
          { variant: v.PROFIT200 },
          { variant: v.PROFIT350 },
        ],
        discount,
        647,
      );
      checkProfit({ revenue: 647, cost: 310, gross: 390, normalDiscount: 53 }); // 337

      const exchange = exchangeUnit(
        sale.saleId,
        regularUnitId(sale.saleId, v.PROFIT350),
        v.PROFIT300,
      );
      expect(exchange.difference_amount).toBe(-23);
      checkProfit({ revenue: 624, cost: 290, gross: 360, normalDiscount: 26 }); // 334

      // A later catalog purchase-price edit must not rewrite historical COGS.
      getDb()
        .prepare('UPDATE product_variants SET buy_price = 999 WHERE id = ?')
        .run(v.PROFIT300.variant_id);
      checkProfit({ revenue: 624, cost: 290, normalDiscount: 26 });

      const first = returnItem(sale.saleId, v.PROFIT150);
      expect(first.return_value).toBe(139);
      checkProfit({ revenue: 485, cost: 220, gross: 280, normalDiscount: 15 }); // 265

      const second = returnItem(sale.saleId, v.PROFIT200);
      expect(second.return_value).toBe(185);
      checkProfit({ revenue: 300, cost: 130, gross: 170, normalDiscount: 0 }); // 170

      restoreReturn(second.returnId);
      checkProfit({ revenue: 485, cost: 220 }); // 265
      restoreReturn(first.returnId);
      checkProfit({ revenue: 624, cost: 290 }); // 334
      restoreExchange(exchange.exchangeId);
      checkProfit({ revenue: 647, cost: 310, gross: 390, normalDiscount: 53 }); // 337
    });
  }

  it('reconciles buy-2-get-1 + fixed invoice discount + regular exchange + bundle return', () => {
    const category = createCategory({ name: 'Profit Promotion Category' });
    const promo = catalog(
      [
        { code: 'PROM250', sell: 250, cost: 110 },
        { code: 'PROM200', sell: 200, cost: 90 },
        { code: 'PROM150', sell: 150, cost: 70 },
      ],
      category.id,
    );
    const reg = catalog([
      { code: 'REG100', sell: 100, cost: 50 },
      { code: 'REG120', sell: 120, cost: 60 },
    ]);
    const promotion = createPromotion({
      name: 'Profit Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'category',
      category_id: category.id,
      product_ids: [],
      actor_id: 1,
    });
    togglePromotion(promotion.promotionId, 1);

    const sale = sell(
      [
        { variant: promo.PROM250 },
        { variant: promo.PROM200 },
        { variant: promo.PROM150 },
        { variant: reg.REG100 },
      ],
      20,
      530,
      promotion.promotionId,
    );
    checkProfit({
      revenue: 530,
      cost: 320,
      gross: 380,
      normalDiscount: 20,
      promotionDiscount: 150,
    }); // 210

    const exchange = exchangeUnit(
      sale.saleId,
      regularUnitId(sale.saleId, reg.REG100),
      reg.REG120,
    );
    expect(exchange.difference_amount).toBe(24);
    checkProfit({
      revenue: 554,
      cost: 330,
      gross: 390,
      normalDiscount: 16,
      promotionDiscount: 150,
    }); // 224

    const returned = returnBundle(sale.saleId);
    expect(returned.return_value).toBe(434);
    checkProfit({
      revenue: 120,
      cost: 60,
      gross: 60,
      normalDiscount: 0,
      promotionDiscount: 0,
    }); // 60

    restoreReturn(returned.returnId);
    checkProfit({ revenue: 554, cost: 330 }); // 224
    restoreExchange(exchange.exchangeId);
    checkProfit({
      revenue: 530,
      cost: 320,
      normalDiscount: 20,
      promotionDiscount: 150,
    }); // 210
  });

  it('keeps the one-pound discount on the untouched item during promotion returns', () => {
    const category = createCategory({ name: 'Profit Tiny Discount Promotion' });
    const promo = catalog(
      [
        { code: 'ONE250', sell: 250, cost: 110 },
        { code: 'ONE200', sell: 200, cost: 90 },
        { code: 'ONE150', sell: 150, cost: 70 },
      ],
      category.id,
    );
    const reg = catalog([
      { code: 'ONE100', sell: 100, cost: 50 },
      { code: 'ONE120', sell: 120, cost: 60 },
      { code: 'ONE300', sell: 300, cost: 150 },
    ]);
    const promotion = createPromotion({
      name: 'One Pound Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'category',
      category_id: category.id,
      product_ids: [],
      actor_id: 1,
    });
    togglePromotion(promotion.promotionId, 1);

    const sale = sell(
      [
        { variant: promo.ONE250 },
        { variant: promo.ONE200 },
        { variant: promo.ONE150 },
        { variant: reg.ONE100 },
        { variant: reg.ONE300 },
      ],
      1,
      849,
      promotion.promotionId,
    );
    checkProfit({
      revenue: 849,
      cost: 470,
      normalDiscount: 1,
      promotionDiscount: 150,
    }); // 379

    const exchange = exchangeUnit(
      sale.saleId,
      regularUnitId(sale.saleId, reg.ONE100),
      reg.ONE120,
    );
    expect(exchange.difference_amount).toBe(20);
    checkProfit({ revenue: 869, cost: 480, normalDiscount: 1 }); // 389

    const returnPromotion = returnBundle(sale.saleId);
    expect(returnPromotion.return_value).toBe(450);
    checkProfit({
      revenue: 419,
      cost: 210,
      normalDiscount: 1,
      promotionDiscount: 0,
    }); // 209

    restoreReturn(returnPromotion.returnId);
    checkProfit({ revenue: 869, cost: 480 }); // 389
    restoreExchange(exchange.exchangeId);
    checkProfit({ revenue: 849, cost: 470 }); // 379

    const returnRegular = returnItem(sale.saleId, reg.ONE100);
    expect(returnRegular.return_value).toBe(100);
    checkProfit({ revenue: 749, cost: 420 }); // 329
    const returnPromotionAgain = returnBundle(sale.saleId);
    expect(returnPromotionAgain.return_value).toBe(450);
    checkProfit({ revenue: 299, cost: 150, normalDiscount: 1 }); // 149
  });

  it('preserves profit for three units and unequal per-unit rounding through refund and cancellation', () => {
    const v = catalog([
      { code: 'Q100', sell: 100, cost: 50 },
      { code: 'Q80', sell: 80, cost: 40 },
    ]);
    const sale = sell([{ variant: v.Q100, quantity: 3 }], 2, 298);
    checkProfit({ revenue: 298, cost: 150, normalDiscount: 2 }); // 148

    const first = returnItem(sale.saleId, v.Q100);
    expect(first.return_value).toBe(99);
    checkProfit({ revenue: 199, cost: 100 }); // 99

    const exchange = exchangeUnit(
      sale.saleId,
      regularUnitId(sale.saleId, v.Q100),
      v.Q80,
    );
    expect(exchange.difference_amount).toBe(-19);
    checkProfit({ revenue: 180, cost: 90 }); // 90

    const last = returnItem(sale.saleId, v.Q100);
    expect(last.return_value).toBe(100);
    checkProfit({ revenue: 80, cost: 40 }); // 40

    restoreReturn(last.returnId);
    checkProfit({ revenue: 180, cost: 90 }); // 90
    restoreExchange(exchange.exchangeId);
    checkProfit({ revenue: 199, cost: 100 }); // 99
    restoreReturn(first.returnId);
    checkProfit({ revenue: 298, cost: 150, normalDiscount: 2 }); // 148
  });

  it('preserves profit when a direct return happens before any exchange screen is opened', () => {
    const v = catalog([
      { code: 'DIRECT150', sell: 150, cost: 70 },
      { code: 'DIRECT200', sell: 200, cost: 90 },
      { code: 'DIRECT250', sell: 250, cost: 110 },
      { code: 'DIRECT300', sell: 300, cost: 130 },
    ]);
    const sale = sell(
      [
        { variant: v.DIRECT150 },
        { variant: v.DIRECT200 },
        { variant: v.DIRECT250 },
      ],
      1,
      599,
    );
    checkProfit({ revenue: 599, cost: 270 }); // 329

    // IMPORTANT: no call to getSaleExchangeState before the first return.
    const returned = returnItem(sale.saleId, v.DIRECT250);
    expect(returned.return_value).toBe(249);
    checkProfit({ revenue: 350, cost: 160 }); // 190

    const exchange = exchangeUnit(
      sale.saleId,
      regularUnitId(sale.saleId, v.DIRECT150),
      v.DIRECT300,
    );
    expect(exchange.difference_amount).toBe(150);
    checkProfit({ revenue: 500, cost: 220 }); // 280

    restoreExchange(exchange.exchangeId);
    checkProfit({ revenue: 350, cost: 160 }); // 190
    restoreReturn(returned.returnId);
    checkProfit({ revenue: 599, cost: 270 }); // 329
  });

  it('subtracts product-price and invoice discounts once, then uses replacement cost', () => {
    const v = catalog([
      { code: 'PRODUCTOLD', sell: 190, discountPrice: 150, cost: 90 },
      { code: 'PRODUCTNEW', sell: 250, discountPrice: 180, cost: 120 },
    ]);
    const sale = sell(
      [{ variant: v.PRODUCTOLD, price: 150, listPrice: 190 }],
      10,
      140,
    );
    checkProfit({
      revenue: 140,
      cost: 90,
      gross: 100,
      normalDiscount: 10,
      productDiscount: 40,
    }); // 50

    const exchange = exchangeUnit(
      sale.saleId,
      regularUnitId(sale.saleId, v.PRODUCTOLD),
      v.PRODUCTNEW,
    );
    expect(exchange.difference_amount).toBe(40);
    checkProfit({
      revenue: 180,
      cost: 120,
      gross: 130,
      normalDiscount: 0,
      productDiscount: 70,
    }); // 60

    // A replacement return points to the original sale_item_id, but CURRENT variant_id.
    const returned = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: saleItemId(sale.saleId, v.PRODUCTOLD),
          variant_id: v.PRODUCTNEW.variant_id,
          quantity: 1,
        },
      ],
    });
    expect(returned.return_value).toBe(180);
    checkProfit({
      revenue: 0,
      cost: 0,
      gross: 0,
      normalDiscount: 0,
      productDiscount: 0,
    });

    restoreReturn(returned.returnId);
    checkProfit({ revenue: 180, cost: 120 }); // 60
    restoreExchange(exchange.exchangeId);
    checkProfit({
      revenue: 140,
      cost: 90,
      gross: 100,
      normalDiscount: 10,
      productDiscount: 40,
    }); // 50
  });

  it('keeps the entire invoice value when tiny partial returns round to zero', () => {
    const v = catalog([{ code: 'TINY', sell: 2, cost: 1 }]);
    const sale = sell(
      [
        { variant: v.TINY, price: 2 },
        { variant: v.TINY, price: 1 },
        { variant: v.TINY, price: 1 },
      ],
      3,
      1,
    );
    checkProfit({ revenue: 1, cost: 3, normalDiscount: 3 }); // -2

    const items = getDb()
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
      .all(sale.saleId) as Array<{ id: number }>;
    expect(items).toHaveLength(3);

    const returned = [];
    for (const [index, amount] of [0, 1, 0].entries()) {
      const r = createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        refund_payment_method: 'store_cash',
        items: [
          {
            sale_item_id: items[index].id,
            variant_id: v.TINY.variant_id,
            quantity: 1,
          },
        ],
      });
      expect(r.return_value).toBe(amount);
      returned.push(r);
      const revenues = [1, 0, 0];
      const costs = [2, 1, 0];
      checkProfit({ revenue: revenues[index], cost: costs[index] });
    }
    for (let index = returned.length - 1; index >= 0; index -= 1) {
      restoreReturn(returned[index].returnId);
    }
    checkProfit({ revenue: 1, cost: 3, normalDiscount: 3 }); // -2
  });

  it('tracks repeated exchanges of the same unit without duplicating its old invoice discount', () => {
    const v = catalog([
      { code: 'REPEAT100', sell: 100, cost: 50 },
      { code: 'REPEAT200', sell: 200, cost: 90 },
      { code: 'REPEAT150', sell: 150, cost: 70 },
      { code: 'REPEAT120', sell: 120, cost: 60 },
    ]);
    const sale = sell(
      [{ variant: v.REPEAT100 }, { variant: v.REPEAT200 }],
      1,
      299,
    );
    checkProfit({ revenue: 299, cost: 140 }); // 159

    const unitId = regularUnitId(sale.saleId, v.REPEAT100);
    const first = exchangeUnit(sale.saleId, unitId, v.REPEAT150);
    expect(first.difference_amount).toBe(50);
    checkProfit({ revenue: 349, cost: 160 }); // 189

    const second = exchangeUnit(sale.saleId, unitId, v.REPEAT120);
    expect(second.difference_amount).toBe(-30);
    checkProfit({ revenue: 319, cost: 150 }); // 169

    const returned = returnItem(sale.saleId, v.REPEAT200);
    expect(returned.return_value).toBe(199);
    checkProfit({ revenue: 120, cost: 60 }); // 60

    restoreReturn(returned.returnId);
    checkProfit({ revenue: 319, cost: 150 }); // 169
    restoreExchange(second.exchangeId);
    checkProfit({ revenue: 349, cost: 160 }); // 189
    restoreExchange(first.exchangeId);
    checkProfit({ revenue: 299, cost: 140 }); // 159
  });

  it('uses the cost of replacement gifts in promotion exchange and full return', () => {
    const category = createCategory({ name: 'Gift Profit Category' });
    const v = catalog(
      [
        { code: 'GIFT250', sell: 250, cost: 110 },
        { code: 'GIFT200', sell: 200, cost: 90 },
        { code: 'GIFT150', sell: 150, cost: 70 },
        { code: 'GIFT300', sell: 300, cost: 130 },
      ],
      category.id,
    );
    const promotion = createPromotion({
      name: 'Gift Profit Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'category',
      category_id: category.id,
      product_ids: [],
      actor_id: 1,
    });
    togglePromotion(promotion.promotionId, 1);

    const sale = sell(
      [{ variant: v.GIFT250 }, { variant: v.GIFT200 }, { variant: v.GIFT150 }],
      0,
      450,
      promotion.promotionId,
    );
    checkProfit({ revenue: 450, cost: 270, promotionDiscount: 150 }); // 180

    const gift = getDb()
      .prepare(
        `SELECT id FROM sale_promotion_units WHERE sale_id = ? AND current_is_gift = 1 LIMIT 1`,
      )
      .get(sale.saleId) as { id: number };
    expect(gift).toBeTruthy();
    const exchange = exchangeUnit(sale.saleId, gift.id, v.GIFT300);
    expect(exchange.difference_amount).toBe(100);
    checkProfit({ revenue: 550, cost: 330, promotionDiscount: 200 }); // 220

    const returned = returnBundle(sale.saleId);
    expect(returned.return_value).toBe(550);
    checkProfit({
      revenue: 0,
      cost: 0,
      gross: 0,
      normalDiscount: 0,
      promotionDiscount: 0,
    });

    restoreReturn(returned.returnId);
    checkProfit({ revenue: 550, cost: 330 }); // 220
    restoreExchange(exchange.exchangeId);
    checkProfit({ revenue: 450, cost: 270 }); // 180
  });
});
